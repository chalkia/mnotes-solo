/**
 * js/solo/local-storage-policy.js
 * Πολιτική τοπικής αποθήκευσης, ορίων (20/999), updated_at και σημαδιών διαγραφής (mnotes_tombstones)
 * Φορτώνεται ΜΟΝΟ στη Solo (μέσω build-solo.js). Όταν λείπει (στην Pro), τα άγκιστρα δεν υπάρχουν
 * και η Pro τρέχει 100% την υπάρχουσα συμπεριφορά της.
 */
(function (global) {
    'use strict';

    const TOMBSTONES_KEY = 'mnotes_tombstones';
    const TOMBSTONE_MAX_AGE_MS = 365 * 24 * 60 * 60 * 1000; // 365 μέρες (Ε7-β)
    const TOMBSTONE_MAX_COUNT = 2000;                        // 2.000 εγγραφές (Ε7-β)
    const FALLBACK_PAST_ISO = '2026-01-01T00:00:00.000Z';

    let warned15ThisSession = false;

    function getMaxSongsLimit() {
        if (typeof global.getUserLimits === 'function') {
            const lim = global.getUserLimits();
            if (lim && typeof lim.maxSongs === 'number') return lim.maxSongs;
        }
        return 20;
    }

    function getTrashIdSet() {
        const set = new Set();
        try {
            let sets = typeof allSetlists !== 'undefined' ? allSetlists : null;
            if (!sets && typeof localStorage !== 'undefined') {
                sets = JSON.parse(localStorage.getItem('mnotes_personal_setlists') || '{}');
            }
            const trash = sets && sets['🗑️ Κάδος'];
            if (trash && Array.isArray(trash.songs)) {
                trash.songs.forEach(item => {
                    const id = (typeof item === 'object' && item !== null) ? item.id : item;
                    if (id) set.add(String(id));
                });
            }
        } catch (_) {}
        return set;
    }

    function extractTimeMs(song, allowIdFallback) {
        if (!song || typeof song !== 'object') return 0;
        const raw = song.updated_at || song.updatedAt || song.created_at;
        if (raw) {
            const parsed = Date.parse(raw);
            if (!isNaN(parsed) && parsed > 0) return parsed;
        }
        if (allowIdFallback && song.id && typeof global.getCreationTimeFromId === 'function') {
            const fromId = global.getCreationTimeFromId(song.id);
            if (typeof fromId === 'number' && fromId > 0) return fromId;
        }
        return 0;
    }

    // ── Άγκιστρο 1: Καταμέτρηση ορίου (Ε1-α επίπεδο, Ε2-α εκτός Κάδου) ──────
    global.countSongsForLimit = function (pool) {
        const arr = Array.isArray(pool) ? pool : [];
        const trashIds = getTrashIdSet();
        let count = 0;
        for (const s of arr) {
            if (!s || !s.id || s.is_deleted) continue;
            if (String(s.id).includes('demo')) continue;
            if (trashIds.has(String(s.id))) continue;
            count++;
        }
        return count;
    };

    // ── Άγκιστρο 2: Επίπεδο μοντέλο (Ε1-α: καθαρισμός parent_id / is_clone) ──
    global.normalizeSongForEdition = function (song) {
        if (!song || typeof song !== 'object') return song;
        song.parent_id = null;
        song.is_clone = false;
        return song;
    };

    // ── Άγκιστρο 3: Ειδοποίηση 15/20 & Modal/Μήνυμα ορίου 20/20 ───────────────
    global.onSongCountChanged = function (count) {
        if (typeof global.SoloBackup !== 'undefined' && typeof global.SoloBackup.recordBackupChange === 'function') {
            global.SoloBackup.recordBackupChange();
        }
        const maxSongs = getMaxSongsLimit();
        if (maxSongs === 20 && count === 15 && !warned15ThisSession) {
            warned15ThisSession = true;
            if (typeof global.showToast === 'function') {
                global.showToast(
                    'Έχεις 15 από τα 20 δωρεάν τραγούδια. Με το mNotes Solo (3,99 € εφάπαξ) ξεκλειδώνεις 999 τραγούδια.',
                    'info'
                );
            }
        }
    };

    global.onSongLimitReached = function (reason, info) {
        const opts = info || {};
        const maxSongs = typeof opts.maxSongs === 'number' ? opts.maxSongs : getMaxSongsLimit();
        if (reason === 'import_overflow' && typeof opts.needed === 'number') {
            const msg = `Το αρχείο περιέχει ${opts.needed} νέα τραγούδια, αλλά στη βιβλιοθήκη σου χωράνε ακόμα ${opts.available} (όριο: ${maxSongs}). Δεν εισήχθη κανένα τραγούδι.`;
            if (typeof global.mAlert === 'function') {
                global.mAlert(msg);
            } else if (typeof global.showToast === 'function') {
                global.showToast(msg, 'warning');
            }
            return;
        }

        if (typeof document === 'undefined' || !document.body) return;
        let modal = document.getElementById('soloLimitModal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'soloLimitModal';
            modal.className = 'modal-overlay';
            modal.style.cssText = 'display:none; z-index:4500;';
            modal.innerHTML = `
                <div class="modal-content" style="max-width:420px; text-align:center;">
                    <h3 style="margin-top:0; color:var(--accent);">Έφτασες το όριο των ${maxSongs} τραγουδιών</h3>
                    <p style="line-height:1.5; color:var(--text-main);">
                        Η δωρεάν έκδοση του mNotes Solo περιλαμβάνει έως 20 τραγούδια.
                        Αναβάθμισε σε mNotes Solo (3,99 € εφάπαξ) για έως 999 τραγούδια και αντίγραφο ασφαλείας σε Google Drive / Dropbox.
                        Τα τραγούδια σου εξάγονται πάντα ελεύθερα.
                    </p>
                    <div style="display:flex; gap:10px; justify-content:center; margin-top:20px; flex-wrap:wrap;">
                        <button type="button" class="modal-btn accent" onclick="if(typeof exportJSON==='function') exportJSON();">Εξαγωγή αντιγράφου</button>
                        <button type="button" class="modal-btn" onclick="document.getElementById('soloLimitModal').style.display='none';">Κλείσιμο</button>
                    </div>
                </div>
            `;
            document.body.appendChild(modal);
        }
        modal.style.display = 'flex';
    };

    // ── Έλεγχος επαναφοράς από Κάδο (Ε2-α) ──────────────────────────────────
    global.canRestoreFromTrash = function () {
        const pool = typeof library !== 'undefined' ? library : (global.library || []);
        const currentCount = global.countSongsForLimit(pool);
        const maxSongs = getMaxSongsLimit();
        if (currentCount >= maxSongs) {
            global.onSongLimitReached('restore_trash', { currentCount, maxSongs });
            return false;
        }
        return true;
    };

    // ── Άγκιστρο 4: Σημάδια διαγραφής (mnotes_tombstones) + Pruning ──────────
    function readTombstones() {
        try {
            const raw = localStorage.getItem(TOMBSTONES_KEY);
            if (!raw) return [];
            const arr = JSON.parse(raw);
            return Array.isArray(arr) ? arr.filter(x => x && x.id && x.deleted_at) : [];
        } catch (_) {
            return [];
        }
    }

    function pruneAndWriteTombstones(list, nowMs) {
        const cutoff = (typeof nowMs === 'number' ? nowMs : Date.now()) - TOMBSTONE_MAX_AGE_MS;
        const map = new Map();
        for (const item of list) {
            if (!item || !item.id || !item.deleted_at) continue;
            const ts = Date.parse(item.deleted_at);
            if (isNaN(ts) || ts < cutoff) continue;
            const id = String(item.id);
            const prev = map.get(id);
            if (!prev || Date.parse(prev.deleted_at) < ts) {
                map.set(id, { id, deleted_at: new Date(ts).toISOString() });
            }
        }
        const sorted = Array.from(map.values())
            .sort((a, b) => Date.parse(b.deleted_at) - Date.parse(a.deleted_at))
            .slice(0, TOMBSTONE_MAX_COUNT);
        try {
            if (typeof global.safeSetLocal === 'function') global.safeSetLocal(TOMBSTONES_KEY, JSON.stringify(sorted));
            else localStorage.setItem(TOMBSTONES_KEY, JSON.stringify(sorted));
        } catch (_) {}
        return sorted;
    }

    global.readSongTombstones = readTombstones;
    global.pruneSongTombstones = pruneAndWriteTombstones;

    global.recordSongTombstones = function (ids, nowMs) {
        const list = readTombstones();
        const tsIso = new Date(typeof nowMs === 'number' ? nowMs : Date.now()).toISOString();
        for (const rawId of (Array.isArray(ids) ? ids : [])) {
            if (!rawId) continue;
            const id = String(rawId);
            if (id.startsWith('demo')) continue;
            list.push({ id, deleted_at: tsIso });
        }
        return pruneAndWriteTombstones(list, nowMs);
    };

    // ── Άγκιστρο 5: Εισαγωγή Solo (tombstones + Ε6-α + Ε4-α όλα-ή-τίποτα) ───
    global.soloImportSongs = function (rawSongs, opts) {
        const o = opts || {};
        const nowMs = typeof o.nowMs === 'number' ? o.nowMs : Date.now();
        const lib = Array.isArray(o.library) ? o.library : (typeof library !== 'undefined' ? library : (global.library || []));
        let tombstones = readTombstones();
        const tombMap = new Map(tombstones.map(t => [String(t.id), Date.parse(t.deleted_at) || 0]));

        let deletedCount = 0;
        let ignoredDeletedCount = 0;
        let skippedCount = 0;

        // 1. Εισερχόμενα tombstones (π.χ. από .mnote ή .mnotezip)
        if (Array.isArray(o.tombstones)) {
            for (const t of o.tombstones) {
                if (!t || !t.id || !t.deleted_at) continue;
                const tid = String(t.id);
                const delMs = Date.parse(t.deleted_at) || 0;
                if (!delMs) continue;
                const idx = lib.findIndex(s => s && String(s.id) === tid);
                if (idx > -1) {
                    const exMs = extractTimeMs(lib[idx], true);
                    if (exMs < delMs) {
                        lib.splice(idx, 1);
                        deletedCount++;
                    }
                }
                tombstones.push({ id: tid, deleted_at: new Date(delMs).toISOString() });
                if ((tombMap.get(tid) || 0) < delMs) tombMap.set(tid, delMs);
            }
        }

        const incoming = Array.isArray(rawSongs) ? rawSongs : [];
        const toAdd = [];
        const toUpdate = [];
        const resurrectedIds = new Set();

        for (const rawSong of incoming) {
            if (!rawSong || typeof rawSong !== 'object') continue;
            const rawId = rawSong.id ? String(rawSong.id) : '';
            const impMs = extractTimeMs(rawSong, true); // Ε6: πριν την ensureSongStructure (epoch 0 αν λείπει)

            // Εγγραφή με is_deleted: true
            if (rawSong.is_deleted) {
                if (rawId) {
                    const delMs = impMs || Date.parse(rawSong.deleted_at) || nowMs;
                    const idx = lib.findIndex(s => s && String(s.id) === rawId);
                    if (idx > -1 && extractTimeMs(lib[idx], true) < delMs) {
                        lib.splice(idx, 1);
                        deletedCount++;
                    }
                    tombstones.push({ id: rawId, deleted_at: new Date(delMs).toISOString() });
                    if ((tombMap.get(rawId) || 0) < delMs) tombMap.set(rawId, delMs);
                }
                continue;
            }

            // Έλεγχος με τοπικό tombstone (Ε6-α)
            if (rawId && tombMap.has(rawId)) {
                const delMs = tombMap.get(rawId);
                if (!impMs || impMs <= delMs) {
                    ignoredDeletedCount++;
                    continue;
                }
                resurrectedIds.add(rawId);
            }

            const existingIdx = rawId ? lib.findIndex(s => s && String(s.id) === rawId) : -1;
            if (existingIdx > -1) {
                const exMs = extractTimeMs(lib[existingIdx], true);
                if (impMs > exMs) {
                    toUpdate.push({ index: existingIdx, raw: rawSong, impMs });
                } else {
                    skippedCount++;
                }
            } else {
                toAdd.push({ raw: rawSong, impMs });
            }
        }

        // 2. Αυστηρός έλεγχος ορίου ΠΡΙΝ γραφτεί οτιδήποτε (Ε4-α: Όλα ή Τίποτα)
        const currentCount = global.countSongsForLimit(lib);
        const maxSongs = getMaxSongsLimit();
        const availableSlots = Math.max(0, maxSongs - currentCount);
        if (toAdd.length > availableSlots) {
            global.onSongLimitReached('import_overflow', {
                needed: toAdd.length,
                available: availableSlots,
                maxSongs
            });
            return {
                ok: false,
                blockedByLimit: true,
                addedCount: 0,
                updatedCount: 0,
                skippedCount,
                ignoredDeletedCount,
                deletedCount: 0
            };
        }

        // 3. Εφαρμογή ενημερώσεων & προσθηκών
        const addedIds = [];
        for (const item of toUpdate) {
            const prepared = { ...item.raw };
            if (!prepared.updated_at && item.impMs) prepared.updated_at = new Date(item.impMs).toISOString();
            const safe = typeof global.ensureSongStructure === 'function' ? global.ensureSongStructure(prepared) : prepared;
            global.normalizeSongForEdition(safe);
            safe.group_id = null;
            lib[item.index] = safe;
        }

        const genId = typeof o.generateId === 'function'
            ? o.generateId
            : () => 's_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);

        for (const item of toAdd) {
            const prepared = { ...item.raw };
            if (!prepared.id || String(prepared.id).startsWith('demo')) {
                prepared.id = genId();
            }
            if (!prepared.updated_at) {
                prepared.updated_at = item.impMs ? new Date(item.impMs).toISOString() : FALLBACK_PAST_ISO;
            }
            const safe = typeof global.ensureSongStructure === 'function' ? global.ensureSongStructure(prepared) : prepared;
            global.normalizeSongForEdition(safe);
            safe.group_id = null;
            lib.push(safe);
            addedIds.push(safe.id);
        }

        if (resurrectedIds.size > 0) {
            tombstones = tombstones.filter(t => !resurrectedIds.has(String(t.id)));
        }
        pruneAndWriteTombstones(tombstones, nowMs);

        if (typeof global.library !== 'undefined') global.library = lib;
        try {
            if (typeof global.saveData === 'function') global.saveData();
            else if (typeof global.safeSetLocal === 'function') global.safeSetLocal('mnotes_data', JSON.stringify(lib));
            else localStorage.setItem('mnotes_data', JSON.stringify(lib));
        } catch (_) {}

        const nextCount = global.countSongsForLimit(lib);
        global.onSongCountChanged(nextCount);

        return {
            ok: true,
            blockedByLimit: false,
            addedCount: toAdd.length,
            updatedCount: toUpdate.length,
            skippedCount,
            ignoredDeletedCount,
            deletedCount,
            addedIds
        };
    };

    // ── Άγκιστρο 6: Μετρητής κεφαλίδας ("Χ / 20" στη Free, "Χ" στην Paid) ──
    global.formatEditionSongCount = function (visibleCount) {
        const maxSongs = getMaxSongsLimit();
        const mode = typeof viewMode !== 'undefined' ? viewMode : 'library';
        const searchVal = typeof document !== 'undefined' ? (document.getElementById('searchInput')?.value || '').trim() : '';
        const tagVal = typeof document !== 'undefined' ? (document.getElementById('tagFilter')?.value || '').trim() : '';
        if (maxSongs < 999 && mode === 'library' && !searchVal && !tagVal) {
            return `${visibleCount} / ${maxSongs}`;
        }
        return String(visibleCount);
    };

    // ── Εφάπαξ συμπλήρωση παλιών τοπικών τραγουδιών χωρίς updated_at ──────────
    global.backfillSoloSongsMetadata = function () {
        try {
            const raw = localStorage.getItem('mnotes_data');
            if (!raw) return;
            const arr = JSON.parse(raw);
            if (!Array.isArray(arr)) return;
            let changed = false;
            for (const s of arr) {
                if (!s || typeof s !== 'object') continue;
                if (!s.updated_at) {
                    const ms = extractTimeMs(s, true);
                    s.updated_at = ms ? new Date(ms).toISOString() : FALLBACK_PAST_ISO;
                    changed = true;
                }
                if (s.parent_id !== null || s.is_clone) {
                    s.parent_id = null;
                    s.is_clone = false;
                    changed = true;
                }
            }
            if (changed) {
                if (typeof global.safeSetLocal === 'function') global.safeSetLocal('mnotes_data', JSON.stringify(arr));
                else localStorage.setItem('mnotes_data', JSON.stringify(arr));
            }
        } catch (_) {}
    };

    global.syncSoloEditionUI = function () {
        if (typeof document === 'undefined' || !document.body) return;
        const maxSongs = getMaxSongsLimit();
        const isPaid = maxSongs >= 999;
        document.body.setAttribute('data-solo-tier', isPaid ? 'paid' : 'free');
        const lineEl = document.getElementById('soloEditionLine');
        if (lineEl) {
            const key = isPaid ? 'solo_tier_paid' : 'solo_tier_free';
            const fallback = isPaid ? 'mNotes Solo · Πλήρης έκδοση' : 'mNotes Solo · Δωρεάν (έως 20 τραγούδια)';
            lineEl.setAttribute('data-i18n', key);
            lineEl.textContent = typeof global.t === 'function' ? global.t(key, fallback) : fallback;
        }
        if (typeof global.t === 'function') {
            document.querySelectorAll('[data-solo-only] [data-i18n]').forEach(el => {
                const k = el.getAttribute('data-i18n');
                if (k) el.textContent = global.t(k, el.textContent);
            });
        }
    };

    if (typeof document !== 'undefined') {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', global.syncSoloEditionUI);
        } else {
            global.syncSoloEditionUI();
        }
    }

    if (typeof localStorage !== 'undefined') {
        global.backfillSoloSongsMetadata();
    }

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = {
            countSongsForLimit: global.countSongsForLimit,
            normalizeSongForEdition: global.normalizeSongForEdition,
            onSongCountChanged: global.onSongCountChanged,
            onSongLimitReached: global.onSongLimitReached,
            canRestoreFromTrash: global.canRestoreFromTrash,
            recordSongTombstones: global.recordSongTombstones,
            readSongTombstones: global.readSongTombstones,
            pruneSongTombstones: global.pruneSongTombstones,
            soloImportSongs: global.soloImportSongs,
            formatEditionSongCount: global.formatEditionSongCount,
            backfillSoloSongsMetadata: global.backfillSoloSongsMetadata
        };
    }
})(typeof window !== 'undefined' ? window : globalThis);
