// ============================================================
//  ULTRAKILL Web Port - Unlock Everything Script
//  Paste into browser DevTools console WHILE the game is loading
//  (before the main menu appears), OR after the main menu loads.
//  Works by hooking into Emscripten's IDBFS / Unity WebGL FS.
// ============================================================

(function () {

  // ── 1. FIND THE EMSCRIPTEN MODULE ──────────────────────────
  // Unity WebGL exposes the Emscripten module globally (usually as `unityFramework`
  // after it initializes, but it's easiest to hook via the FS directly).

  function waitForModule(cb) {
    const interval = setInterval(() => {
      // The Unity Emscripten module attaches FS to the global scope
      if (typeof FS !== 'undefined' && FS.readdir) {
        clearInterval(interval);
        cb(FS);
      }
    }, 500);
    console.log('[ULTRAKILL Unlocker] Waiting for Emscripten FS...');
  }

  // ── 2. BINARY HELPERS (MS-NRBF / .bepis format) ───────────
  // The .bepis files are .NET Binary Format serialized objects.
  // For the demo, we construct minimal valid save blobs.
  //
  // Structure for generalprogress.bepis (GameProgressMoneyAndGear):
  //   All weapon unlock booleans set to true + high money value.
  //
  // Rather than hand-crafting full NRBF, we use a simpler approach:
  // write pre-built hex blobs derived from known-good saves.
  // Values below are for demo weapons: rev0/1, sho0/1/2, nai0/1/2/3.

  // Minimal valid generalprogress.bepis with everything unlocked + 9999 P
  // (Generated from known ULTRAKILL demo save structure)
  const PROGRESS_BEPIS_HEX =
    // NRBF header + SerializationHeaderRecord
    "00 01 00 00 00 FF FF FF FF 01 00 00 00 00 00 00 00" +
    // BinaryObjectString - type name
    "06 01 00 00 00 18 00 00 00 47 61 6D 65 50 72 6F 67" +
    "72 65 73 73 4D 6F 6E 65 79 41 6E 64 47 65 61 72" +
    // ClassWithMembersAndTypes record
    "05 01 00 00 00 18 00 00 00 47 61 6D 65 50 72 6F 67" +
    "72 65 73 73 4D 6F 6E 65 79 41 6E 64 47 65 61 72 00" +
    // ... (abbreviated - use the JS approach below instead)
    "0B";

  // NOTE: The hex blob approach is fragile without a real reference save.
  // Instead we use the FS write approach with a JavaScript-constructed buffer.

  // ── 3. BUILD SAVE FILES ────────────────────────────────────

  /**
   * Builds a minimal .NET BinaryFormatter (NRBF) blob for a boolean field.
   * Since we can't easily construct the full nested class graph without a
   * reference save, we use a different strategy: patch the FS *after* the
   * game creates its own save files (i.e., after first launch), then edit them.
   */

  function patchSaves(FS) {
    console.log('[ULTRAKILL Unlocker] FS found! Checking save directory...');

    // List what exists
    try {
      const saves = FS.readdir('/Saves');
      console.log('[ULTRAKILL Unlocker] /Saves contains:', saves);
    } catch (e) {
      console.warn('[ULTRAKILL Unlocker] /Saves not found yet. Try running this script after reaching the main menu.');
      return;
    }

    // ── Patch /Saves/difficulty → set to 2 (Standard) ──────────
    try {
      // The difficulty file contains a single ASCII digit or small integer
      FS.writeFile('/Saves/difficulty', new Uint8Array([0x32])); // '2' = Standard
      console.log('[ULTRAKILL Unlocker] ✓ Set difficulty to Standard');
    } catch (e) {
      console.warn('[ULTRAKILL Unlocker] Could not write difficulty:', e.message);
    }

    // ── List and patch level save files ───────────────────────
    try {
      const lvlDir = FS.readdir('/Saves/lvl');
      console.log('[ULTRAKILL Unlocker] Level saves:', lvlDir);

      // For each .bepis level file, try to flip the rank bytes to unlock
      lvlDir.forEach(f => {
        if (f.endsWith('.bepis')) {
          try {
            const data = FS.readFile('/Saves/lvl/' + f);
            console.log(`[ULTRAKILL Unlocker] Level file: ${f}, size: ${data.length} bytes`);
          } catch (e) {}
        }
      });
    } catch (e) {
      console.warn('[ULTRAKILL Unlocker] /Saves/lvl not found:', e.message);
    }

    // ── Patch generalprogress.bepis ───────────────────────────
    try {
      const gp = FS.readFile('/Saves/generalprogress.bepis');
      console.log('[ULTRAKILL Unlocker] generalprogress.bepis size:', gp.length, 'bytes');
      console.log('[ULTRAKILL Unlocker] Hex dump (first 128 bytes):',
        Array.from(gp.slice(0, 128)).map(b => b.toString(16).padStart(2,'0')).join(' '));

      // Patch boolean fields: scan for known field name strings then set byte after to 0x01
      const weaponFields = ['rev0','rev1','rev2','rev3','nai0','nai1','nai2','nai3',
                            'sho0','sho1','sho2','sho3','rai0','rai1','rai2','rai3'];
      const patched = new Uint8Array(gp);

      weaponFields.forEach(field => {
        const needle = new TextEncoder().encode(field);
        for (let i = 0; i < patched.length - needle.length - 2; i++) {
          let match = true;
          for (let j = 0; j < needle.length; j++) {
            if (patched[i + j] !== needle[j]) { match = false; break; }
          }
          if (match) {
            // In NRBF, the boolean value follows the field name string.
            // Typically: [length byte] [field name bytes] [0x08 type tag?] [value byte]
            // We scan a few bytes after the field name for a 0x00 and flip to 0x01
            for (let k = i + needle.length; k < i + needle.length + 8; k++) {
              if (patched[k] === 0x00) {
                patched[k] = 0x01;
                console.log(`[ULTRAKILL Unlocker] ✓ Patched ${field} at offset ${k}`);
                break;
              }
            }
          }
        }
      });

      // Also try to set money (P) to a large value
      // Search for 'money' field name and patch the 4 bytes after it
      const moneyNeedle = new TextEncoder().encode('money');
      for (let i = 0; i < patched.length - moneyNeedle.length - 8; i++) {
        let match = true;
        for (let j = 0; j < moneyNeedle.length; j++) {
          if (patched[i + j] !== moneyNeedle[j]) { match = false; break; }
        }
        if (match) {
          // Find the int32 value (4 bytes, little-endian) nearby and set to 9999
          for (let k = i + moneyNeedle.length; k < i + moneyNeedle.length + 10; k++) {
            // Look for 4 consecutive bytes that look like a small int
            if (k + 4 <= patched.length) {
              const val = patched[k] | (patched[k+1] << 8) | (patched[k+2] << 16) | (patched[k+3] << 24);
              if (val >= 0 && val < 100000) {
                patched[k]   = 0x0F;  // 9999 in LE = 0F 27 00 00
                patched[k+1] = 0x27;
                patched[k+2] = 0x00;
                patched[k+3] = 0x00;
                console.log(`[ULTRAKILL Unlocker] ✓ Set money to 9999 at offset ${k}`);
                break;
              }
            }
          }
          break;
        }
      }

      FS.writeFile('/Saves/generalprogress.bepis', patched);
      console.log('[ULTRAKILL Unlocker] ✓ Wrote patched generalprogress.bepis');

    } catch (e) {
      console.warn('[ULTRAKILL Unlocker] generalprogress.bepis not found yet. Load a level first, then run this script again.');
    }

    // ── Sync FS back to IndexedDB ─────────────────────────────
    try {
      FS.syncfs(false, (err) => {
        if (err) {
          console.error('[ULTRAKILL Unlocker] FS sync error:', err);
        } else {
          console.log('[ULTRAKILL Unlocker] ✓ Changes synced to IndexedDB!');
          console.log('[ULTRAKILL Unlocker] ✓ Reload the page or return to main menu for changes to take effect.');
        }
      });
    } catch (e) {
      console.warn('[ULTRAKILL Unlocker] Could not sync FS:', e.message);
    }
  }

  // ── 4. DUMP MODE (call this first to inspect save data) ────
  window.ukDump = function () {
    if (typeof FS === 'undefined') {
      console.error('FS not available yet. Wait for the game to load further.');
      return;
    }
    try {
      console.log('=== ULTRAKILL SAVE DUMP ===');
      const saves = FS.readdir('/Saves');
      console.log('/Saves:', saves);
      saves.forEach(f => {
        if (f === '.' || f === '..') return;
        const path = '/Saves/' + f;
        try {
          const stat = FS.stat(path);
          if (stat.isDir || FS.isDir(stat.mode)) {
            const sub = FS.readdir(path);
            console.log(path + '/', sub);
            sub.forEach(sf => {
              if (sf === '.' || sf === '..') return;
              try {
                const data = FS.readFile(path + '/' + sf);
                console.log(`  ${path}/${sf} (${data.length} bytes):`,
                  Array.from(data.slice(0, 64)).map(b => b.toString(16).padStart(2,'0')).join(' '));
              } catch(e) {}
            });
          } else {
            const data = FS.readFile(path);
            console.log(`${path} (${data.length} bytes):`,
              Array.from(data.slice(0, 64)).map(b => b.toString(16).padStart(2,'0')).join(' '));
          }
        } catch(e) {}
      });
    } catch (e) {
      console.error('Could not read /Saves:', e.message);
    }
  };

  // ── 5. UNLOCK MODE ─────────────────────────────────────────
  window.ukUnlock = function () {
    if (typeof FS === 'undefined') {
      console.error('FS not available yet.');
      return;
    }
    patchSaves(FS);
  };

  // ── 6. AUTO-RUN ────────────────────────────────────────────
  waitForModule(function (FS) {
    console.log('[ULTRAKILL Unlocker] FS ready!');
    console.log('[ULTRAKILL Unlocker] Commands available:');
    console.log('  ukDump()    - inspect current save files');
    console.log('  ukUnlock()  - patch weapons + money in save files');
    console.log('');
    console.log('[ULTRAKILL Unlocker] TIP: Run ukDump() first to see what exists,');
    console.log('  then load a level and die/complete it to generate saves,');
    console.log('  then run ukUnlock() to patch them.');
  });

})();
