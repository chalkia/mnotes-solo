/**
 * js/solo/backup.js — Αντίγραφο ασφαλείας .mnotezip για mNotes Solo (Φάση 4)
 *
 * Επαναχρησιμοποιεί αυτούσιο το js/modules/package.js (χωρίς αντιγραφή κώδικα),
 * συνδέοντάς το με IndexedDB (MNotesSoloAssetsDB), σημάδια διαγραφής Φάσης 2
 * και τοπικούς custom ρυθμούς (.mnr).
 */
(function (root) {
    'use strict';

    const SOLO_CUSTOM_RHYTHMS_KEY = 'mnotes_solo_custom_rhythms';
    const BACKUP_META_KEY = 'mnotes_solo_backup_meta';
    const REMINDER_DAYS = 7;
    const REMINDER_CHANGES = 10;
    const SNOOZE_DAYS = 3;
    const MS_PER_DAY = 24 * 60 * 60 * 1000;

    function readBackupMeta() {
        try {
            const raw = localStorage.getItem(BACKUP_META_KEY);
            if (raw) {
                const parsed = JSON.parse(raw);
                if (parsed && typeof parsed === 'object') return parsed;
            }
        } catch (_) {}
        return { lastBackupAt: 0, changesSinceBackup: 0, snoozedUntil: 0 };
    }

    function writeBackupMeta(meta) {
        try {
            const s = JSON.stringify(meta);
            if (typeof root.safeSetLocal === 'function') root.safeSetLocal(BACKUP_META_KEY, s);
            else if (typeof localStorage !== 'undefined') localStorage.setItem(BACKUP_META_KEY, s);
        } catch (_) {}
    }

    function recordBackupChange(nowMs) {
        const ts = typeof nowMs === 'number' ? nowMs : Date.now();
        const meta = readBackupMeta();
        if (!meta.lastBackupAt) meta.lastBackupAt = ts;
        meta.changesSinceBackup = (Number(meta.changesSinceBackup) || 0) + 1;
        writeBackupMeta(meta);
        return meta;
    }

    function markBackupCompleted(nowMs) {
        const ts = typeof nowMs === 'number' ? nowMs : Date.now();
        const meta = { lastBackupAt: ts, changesSinceBackup: 0, snoozedUntil: 0 };
        writeBackupMeta(meta);
        return meta;
    }

    function snoozeBackupReminder(nowMs) {
        const ts = typeof nowMs === 'number' ? nowMs : Date.now();
        const meta = readBackupMeta();
        meta.snoozedUntil = ts + SNOOZE_DAYS * MS_PER_DAY;
        writeBackupMeta(meta);
        return meta;
    }

    function shouldShowBackupReminder(opts) {
        const o = opts || {};
        const isPlay = o.isPlayMode !== undefined
            ? !!o.isPlayMode
            : (typeof document !== 'undefined' && document.body && document.body.classList.contains('play-mode'));
        if (isPlay) return false;

        const activeCount = typeof o.activeSongsCount === 'number'
            ? o.activeSongsCount
            : (Array.isArray(root.library) ? root.library.filter(s => s && !s.is_deleted).length : 0);
        if (activeCount <= 0) return false;

        const nowMs = typeof o.nowMs === 'number' ? o.nowMs : Date.now();
        const meta = readBackupMeta();
        if (meta.snoozedUntil && nowMs < meta.snoozedUntil) return false;

        const changes = Number(meta.changesSinceBackup) || 0;
        if (changes >= REMINDER_CHANGES) return true;
        if (changes > 0 && meta.lastBackupAt && (nowMs - meta.lastBackupAt) >= REMINDER_DAYS * MS_PER_DAY) {
            return true;
        }
        return false;
    }

    async function saveOrShareBackupFile(bytes, filename) {
        const blob = new Blob([bytes], { type: 'application/zip' });
        if (typeof navigator !== 'undefined' && typeof navigator.share === 'function' && typeof File !== 'undefined') {
            try {
                const file = new File([blob], filename, { type: 'application/zip' });
                if (!navigator.canShare || navigator.canShare({ files: [file] })) {
                    await navigator.share({ files: [file], title: filename });
                    return { method: 'share' };
                }
            } catch (err) {
                if (err && err.name === 'AbortError') {
                    return { method: 'cancelled' };
                }
            }
        }
        if (typeof document !== 'undefined' && typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function') {
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            a.remove();
            setTimeout(() => { try { URL.revokeObjectURL(url); } catch (_) {} }, 1000);
            return { method: 'download' };
        }
        return { method: 'none' };
    }

    function getPkg() {
        if (root.mnotesPackage) return root.mnotesPackage;
        if (typeof require === 'function') {
            return require('../modules/package.js');
        }
        throw new Error('Δεν βρέθηκε το mnotesPackage.');
    }

    function getAssetsApi() {
        if (root.SoloLocalAssets) return root.SoloLocalAssets;
        if (typeof require === 'function') {
            return require('./local-assets.js');
        }
        return null;
    }

    function getPolicyApi() {
        if (typeof root.soloImportSongs === 'function') return root;
        if (typeof require === 'function') {
            return require('./local-storage-policy.js');
        }
        return root;
    }

    function pad2(n) {
        return String(n).padStart(2, '0');
    }

    /**
     * Επιστρέφει όνομα αρχείου αντιγράφου με ημερομηνία και ώρα (Ε2):
     * mnotes-solo-YYYY-MM-DD-HHmm.mnotezip
     */
    function formatBackupFilename(date) {
        const d = date instanceof Date ? date : new Date();
        const yyyy = d.getFullYear();
        const mm = pad2(d.getMonth() + 1);
        const dd = pad2(d.getDate());
        const hh = pad2(d.getHours());
        const mi = pad2(d.getMinutes());
        return `mnotes-solo-${yyyy}-${mm}-${dd}-${hh}${mi}.mnotezip`;
    }

    async function blobToUint8Array(data) {
        if (!data) return null;
        if (data instanceof Uint8Array) return data;
        if (data instanceof ArrayBuffer) return new Uint8Array(data);
        if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
        if (typeof data.arrayBuffer === 'function') {
            const ab = await data.arrayBuffer();
            return new Uint8Array(ab);
        }
        return null;
    }

    function utf8Encode(str) {
        if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(String(str));
        return Uint8Array.from(Buffer.from(String(str), 'utf8'));
    }

    function utf8Decode(bytes) {
        if (typeof TextDecoder !== 'undefined') return new TextDecoder('utf-8').decode(bytes);
        return Buffer.from(bytes).toString('utf8');
    }

    function readLocalSetlists() {
        if (root.userSetlists && typeof root.userSetlists === 'object') {
            return root.userSetlists;
        }
        try {
            const raw = localStorage.getItem('mnotes_setlists');
            if (raw) return JSON.parse(raw);
        } catch (_) {}
        return {};
    }

    function writeLocalSetlists(next) {
        if (typeof root.userSetlists !== 'undefined') {
            root.userSetlists = next;
        }
        try {
            if (typeof root.safeSetLocal === 'function') {
                root.safeSetLocal('mnotes_setlists', JSON.stringify(next));
            } else if (typeof localStorage !== 'undefined') {
                localStorage.setItem('mnotes_setlists', JSON.stringify(next));
            }
        } catch (_) {}
        if (typeof root.saveSetlists === 'function') {
            try { root.saveSetlists(); } catch (_) {}
        }
    }

    function readLocalCustomRhythms() {
        try {
            const raw = localStorage.getItem(SOLO_CUSTOM_RHYTHMS_KEY);
            if (!raw) return [];
            const parsed = JSON.parse(raw);
            return Array.isArray(parsed) ? parsed : [];
        } catch (_) {
            return [];
        }
    }

    function writeLocalCustomRhythms(list) {
        try {
            if (typeof root.safeSetLocal === 'function') {
                root.safeSetLocal(SOLO_CUSTOM_RHYTHMS_KEY, JSON.stringify(list));
            } else if (typeof localStorage !== 'undefined') {
                localStorage.setItem(SOLO_CUSTOM_RHYTHMS_KEY, JSON.stringify(list));
            }
        } catch (_) {}
    }

    /**
     * Επιλογή τραγουδιών και setlists για εξαγωγή (§3):
     * mode: 'all' | 'setlist' | 'selected'
     */
    function selectSongsForExport(opts) {
        const o = opts || {};
        const mode = o.mode || 'all';
        const allSongs = Array.isArray(o.songs) ? o.songs : (Array.isArray(root.library) ? root.library : []);
        const allSetlists = o.setlists && typeof o.setlists === 'object' ? o.setlists : readLocalSetlists();
        const activeSongs = allSongs.filter(s => s && !s.is_deleted);

        let chosen = [];
        let chosenSetlists = {};

        if (mode === 'setlist' && o.setlistName) {
            const ids = new Set((allSetlists[o.setlistName] || []).map(String));
            chosen = activeSongs.filter(s => ids.has(String(s.id)));
            if (allSetlists[o.setlistName]) {
                chosenSetlists[o.setlistName] = [...allSetlists[o.setlistName]];
            }
        } else if (mode === 'selected') {
            const sel = new Set((o.selectedIds || []).map(String));
            chosen = activeSongs.filter(s => sel.has(String(s.id)));
            chosenSetlists = {};
        } else {
            chosen = activeSongs;
            chosenSetlists = { ...allSetlists };
        }

        return { songs: chosen, setlists: chosenSetlists };
    }

    /**
     * Δημιουργία .mnotezip στη Solo (τραγούδια, setlists, tombstones, παρτιτούρες IDB, custom ρυθμοί .mnr).
     */
    async function exportSoloPackage(opts) {
        const o = opts || {};
        const pkg = getPkg();
        const assetsApi = getAssetsApi();
        const policyApi = getPolicyApi();
        const db = o.dbAdapter || (assetsApi && assetsApi.getDbAdapter ? assetsApi.getDbAdapter() : null);

        const sel = selectSongsForExport(o);
        const rawSongs = sel.songs;
        const rawSetlists = sel.setlists;
        const tombstones = Array.isArray(o.tombstones)
            ? o.tombstones
            : (typeof policyApi.readSongTombstones === 'function' ? policyApi.readSongTombstones() : []);

        // Σειριακή ανάγνωση παρτιτουρών από IndexedDB (εξοικονόμηση RAM σε κινητά)
        const files = [];
        const assetsMeta = [];
        const seenAssetPath = new Map();
        const usedNames = new Set();

        const cleanSongs = [];
        for (const s of rawSongs) {
            const songClone = JSON.parse(JSON.stringify(s));
            if (Array.isArray(songClone.attachments)) {
                for (const att of songClone.attachments) {
                    if (!att || !att.url) continue;
                    const isLocal = assetsApi ? assetsApi.isLocalAssetUrl(att.url) : String(att.url).startsWith('local://asset/');
                    if (!isLocal) continue;

                    const assetId = assetsApi ? assetsApi.extractAssetId(att.url) : String(att.url).slice('local://asset/'.length);
                    if (!assetId) continue;

                    if (!seenAssetPath.has(assetId) && db && typeof db.get === 'function') {
                        const rec = await db.get(assetId);
                        if (rec && rec.blob) {
                            const bytes = await blobToUint8Array(rec.blob);
                            if (bytes && bytes.length > 0) {
                                const safeBase = pkg.makeSafePackageFilename(
                                    rec.name || att.name || assetId,
                                    bytes,
                                    rec.mime || att.mime || '',
                                    usedNames
                                );
                                usedNames.add(safeBase);
                                const pkgPath = `attachments/${safeBase}`;
                                files.push({ path: pkgPath, bytes });
                                const meta = {
                                    id: assetId,
                                    asset_id: assetId,
                                    original_url: att.url,
                                    package_path: pkgPath,
                                    name: rec.name || att.name || safeBase,
                                    mime_type: rec.mime || att.mime || pkg.deduceMimeType(safeBase),
                                    size: bytes.length,
                                    width: rec.width || null,
                                    height: rec.height || null,
                                    created_at: rec.created_at || new Date().toISOString()
                                };
                                assetsMeta.push(meta);
                                seenAssetPath.set(assetId, pkgPath);
                            }
                        }
                    }
                    if (seenAssetPath.has(assetId)) {
                        att.package_path = seenAssetPath.get(assetId);
                    }
                }
            }
            cleanSongs.push(songClone);
        }

        // Ε4: τοπικοί custom ρυθμοί (.mnr) στο rhythms/, αν υπάρχουν
        const rhythmList = Array.isArray(o.rhythms) ? o.rhythms : readLocalCustomRhythms();
        const rhythmFiles = [];
        const usedRhythmNames = new Set();
        for (const r of rhythmList) {
            if (!r || typeof r !== 'object') continue;
            const rawName = (r.metadata && r.metadata.name) || r.name || r.id || 'rhythm';
            const safeBase = String(rawName).replace(/[^\p{L}\p{N}_-]+/gu, '_').slice(0, 60) || 'rhythm';
            let finalName = `${safeBase}.mnr`;
            let n = 2;
            while (usedRhythmNames.has(finalName)) {
                finalName = `${safeBase}_${n++}.mnr`;
            }
            usedRhythmNames.add(finalName);
            rhythmFiles.push({
                path: `rhythms/${finalName}`,
                bytes: utf8Encode(JSON.stringify(r, null, 2))
            });
        }

        const exportedIds = new Set(cleanSongs.map(s => String(s.id)));
        const formattedSetlistsRes = pkg.buildSetlistsWithMissingRefs(rawSetlists, exportedIds);
        const formattedSetlists = Array.isArray(formattedSetlistsRes)
            ? formattedSetlistsRes
            : (formattedSetlistsRes && Array.isArray(formattedSetlistsRes.setlists) ? formattedSetlistsRes.setlists : []);

        const appVersion = o.appVersion || root.MNOTES_VERSION || '2.7.0';
        const bytes = pkg.buildPackage({
            app: 'solo',
            appVersion,
            songs: cleanSongs,
            setlists: formattedSetlists,
            tombstones,
            assets: assetsMeta,
            files,
            rhythms: rhythmFiles
        });

        const filename = formatBackupFilename(o.now instanceof Date ? o.now : new Date());
        return {
            bytes,
            filename,
            stats: {
                songs: cleanSongs.length,
                attachments: files.length,
                rhythms: rhythmFiles.length,
                bytesLength: bytes.length
            }
        };
    }

    /**
     * Επαναφορά / συγχώνευση .mnotezip στη Solo:
     * - Κανόνες Φάσης 2 (updated_at, χωρίς updated_at = παλαιότερο, tombstones, όριο 20 όλα-ή-τίποτα)
     * - Αποθήκευση παρτιτουρών σε IndexedDB (MNotesSoloAssetsDB) με local://asset/<id>
     * - Συγχώνευση setlists & τοπικών custom ρυθμών (.mnr)
     * - Επιστρέφει { ok, firstImportedSongId, report }
     */
    async function importSoloPackage(zipBytes, opts) {
        const o = opts || {};
        const pkg = getPkg();
        const assetsApi = getAssetsApi();
        const policyApi = getPolicyApi();
        const db = o.dbAdapter || (assetsApi && assetsApi.getDbAdapter ? assetsApi.getDbAdapter() : null);

        const parsed = pkg.readPackage(zipBytes);
        const incomingSongs = Array.isArray(parsed.songs) ? parsed.songs : [];
        const incomingTombstones = Array.isArray(parsed.tombstones) ? parsed.tombstones : [];
        const incomingAssets = Array.isArray(parsed.assets) ? parsed.assets : [];

        // Ένωση tombstones πακέτου με songs (ως is_deleted) για ενιαία επεξεργασία από soloImportSongs
        const tombAsDeleted = [];
        const songIdsInArr = new Set(incomingSongs.map(s => s && s.id ? String(s.id) : ''));
        for (const t of incomingTombstones) {
            if (!t || !t.id) continue;
            if (!songIdsInArr.has(String(t.id))) {
                tombAsDeleted.push({
                    id: String(t.id),
                    is_deleted: true,
                    deleted_at: t.deleted_at || new Date().toISOString(),
                    updated_at: t.deleted_at || new Date().toISOString()
                });
            }
        }

        const libBefore = Array.isArray(root.library)
            ? root.library.map(s => ({ id: String(s.id), updated_at: s.updated_at }))
            : [];
        const beforeIds = new Set(libBefore.map(s => s.id));
        const beforeUpdatedMap = new Map(libBefore.map(s => [s.id, s.updated_at]));

        // ΠΡΩΤΑ έλεγχος & συγχώνευση τραγουδιών (όριο 20 όλα-ή-τίποτα πριν γραφτεί οτιδήποτε στο IndexedDB!)
        const importRes = policyApi.soloImportSongs([...incomingSongs, ...tombAsDeleted], o);
        if (!importRes || importRes.blockedByLimit) {
            return {
                ok: false,
                blockedByLimit: true,
                firstImportedSongId: null,
                report: {
                    added: 0,
                    updated: 0,
                    skipped: importRes ? importRes.skippedCount : 0,
                    ignoredDeleted: importRes ? importRes.ignoredDeletedCount : 0,
                    attachmentsSaved: 0,
                    rhythmsSaved: 0
                }
            };
        }

        // Προσδιορισμός νέων & ενημερωμένων τραγουδιών
        const libAfter = Array.isArray(root.library) ? root.library : [];
        const touchedSongs = [];
        let firstImportedSongId = null;
        for (const s of libAfter) {
            if (!s || !s.id || s.is_deleted) continue;
            const sid = String(s.id);
            const isNew = !beforeIds.has(sid);
            const isUpdated = beforeIds.has(sid) && beforeUpdatedMap.get(sid) !== s.updated_at;
            if (isNew || isUpdated) {
                touchedSongs.push(s);
                if (!firstImportedSongId) firstImportedSongId = sid;
            }
        }

        // Χαρτογράφηση αρχείων πακέτου
        const fileByPath = new Map();
        for (const f of (parsed.files || [])) {
            if (f && f.path && f.bytes) fileByPath.set(f.path, f.bytes);
        }
        const metaByPath = new Map();
        const metaByOrigUrl = new Map();
        for (const a of incomingAssets) {
            if (!a) continue;
            if (a.package_path) metaByPath.set(a.package_path, a);
            if (a.original_url) metaByOrigUrl.set(a.original_url, a);
        }

        // Αποθήκευση συνημμένων στο IndexedDB (μόνο όσων αναφέρονται στα imported/updated τραγούδια)
        let attachmentsSaved = 0;
        const savedPathToLocalId = new Map();
        if (db && typeof db.put === 'function') {
            for (const s of touchedSongs) {
                if (!Array.isArray(s.attachments)) continue;
                for (const att of s.attachments) {
                    if (!att) continue;
                    const pkgPath = att.package_path || (metaByOrigUrl.get(att.url) && metaByOrigUrl.get(att.url).package_path);
                    if (!pkgPath || !fileByPath.has(pkgPath)) continue;

                    if (!savedPathToLocalId.has(pkgPath)) {
                        const rawBytes = fileByPath.get(pkgPath);
                        const meta = metaByPath.get(pkgPath) || metaByOrigUrl.get(att.url) || {};
                        const newId = `att_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
                        const mime = meta.mime_type || att.mime || pkg.deduceMimeType(pkgPath);
                        const ext = mime === 'application/pdf' ? 'pdf' : 'jpg';
                        const blobObj = (typeof Blob !== 'undefined')
                            ? new Blob([rawBytes], { type: mime })
                            : rawBytes;
                        await db.put({
                            id: newId,
                            name: meta.name || att.name || pkgPath.split('/').pop(),
                            mime,
                            ext,
                            size: rawBytes.length,
                            width: meta.width || null,
                            height: meta.height || null,
                            created_at: meta.created_at || new Date().toISOString(),
                            blob: blobObj
                        });
                        savedPathToLocalId.set(pkgPath, newId);
                        attachmentsSaved++;
                    }
                    const mappedId = savedPathToLocalId.get(pkgPath);
                    att.asset_id = mappedId;
                    att.url = `local://asset/${mappedId}`;
                    delete att.package_path;
                }
            }
            if (attachmentsSaved > 0) {
                if (typeof root.saveData === 'function') root.saveData();
                else if (typeof localStorage !== 'undefined') {
                    try { localStorage.setItem('mnotes_data', JSON.stringify(libAfter)); } catch (_) {}
                }
            }
        }

        // Συγχώνευση setlists (υποστηρίζει array από package.js: [{ name, songs }] και object map)
        if (parsed.setlists && typeof parsed.setlists === 'object') {
            const curSetlists = readLocalSetlists();
            const existingSongIds = new Set(libAfter.filter(s => s && !s.is_deleted).map(s => String(s.id)));
            const entries = Array.isArray(parsed.setlists)
                ? parsed.setlists.map(item => [item && item.name, item && (item.songs || item.songIds)])
                : Object.entries(parsed.setlists);
            for (const [name, entry] of entries) {
                if (!name || name === '__trash__') continue;
                const rawList = Array.isArray(entry) ? entry : (entry && Array.isArray(entry.songs) ? entry.songs : []);
                const validIds = rawList
                    .map(it => (it && typeof it === 'object' ? it.id : it))
                    .filter(Boolean)
                    .map(String)
                    .filter(id => existingSongIds.has(id));
                if (validIds.length === 0) continue;
                const prevIds = Array.isArray(curSetlists[name]) ? curSetlists[name].map(String) : [];
                curSetlists[name] = Array.from(new Set([...prevIds, ...validIds]));
            }
            writeLocalSetlists(curSetlists);
        }

        // Ε4: Επαναφορά τοπικών custom ρυθμών (.mnr) από rhythms/
        let rhythmsSaved = 0;
        if (Array.isArray(parsed.rhythms) && parsed.rhythms.length > 0) {
            const curRhythms = readLocalCustomRhythms();
            const seenRhythmIds = new Set(curRhythms.map(r => r && r.metadata && r.metadata.id).filter(Boolean));
            for (const rf of parsed.rhythms) {
                if (!rf || !rf.bytes) continue;
                try {
                    const obj = JSON.parse(utf8Decode(rf.bytes));
                    const rid = obj && obj.metadata && obj.metadata.id;
                    if (rid && seenRhythmIds.has(rid)) continue;
                    if (rid) seenRhythmIds.add(rid);
                    curRhythms.push(obj);
                    rhythmsSaved++;
                } catch (_) {}
            }
            if (rhythmsSaved > 0) {
                writeLocalCustomRhythms(curRhythms);
            }
        }

        return {
            ok: true,
            blockedByLimit: false,
            firstImportedSongId,
            report: {
                added: importRes.addedCount || 0,
                updated: importRes.updatedCount || 0,
                skipped: importRes.skippedCount || 0,
                ignoredDeleted: importRes.ignoredDeletedCount || 0,
                attachmentsSaved,
                rhythmsSaved
            }
        };
    }

    // ── Διάλογοι UI (ουδέτερη εμφάνιση, έτοιμοι για μετάβαση σε mDialog) ──

    function escapeHtml(str) {
        return String(str || '').replace(/[&<>"']/g, c => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        })[c]);
    }

    async function askConfirmNeutral(title, message) {
        if (typeof root.mConfirm === 'function') {
            return Boolean(await root.mConfirm(message, title));
        }
        return new Promise((resolve) => {
            const ov = document.createElement('div');
            ov.className = 'modal-overlay';
            ov.style.cssText = 'display:flex; z-index:4600;';
            ov.innerHTML = `
                <div class="modal-content" style="max-width:420px;">
                    <h3 style="margin-top:0; color:var(--accent);">${escapeHtml(title)}</h3>
                    <p style="line-height:1.5; color:var(--text-main); white-space:pre-line;">${escapeHtml(message)}</p>
                    <div style="display:flex; gap:10px; justify-content:flex-end; margin-top:18px;">
                        <button type="button" class="modal-btn" data-act="cancel">Άκυρο</button>
                        <button type="button" class="modal-btn accent" data-act="ok">Συνέχεια</button>
                    </div>
                </div>
            `;
            ov.querySelector('[data-act="cancel"]').onclick = () => { ov.remove(); resolve(false); };
            ov.querySelector('[data-act="ok"]').onclick = () => { ov.remove(); resolve(true); };
            document.body.appendChild(ov);
        });
    }

    async function showAlertNeutral(title, message) {
        if (typeof root.mAlert === 'function') {
            await root.mAlert(message, title);
            return;
        }
        return new Promise((resolve) => {
            const ov = document.createElement('div');
            ov.className = 'modal-overlay';
            ov.style.cssText = 'display:flex; z-index:4600;';
            ov.innerHTML = `
                <div class="modal-content" style="max-width:420px;">
                    <h3 style="margin-top:0; color:var(--accent);">${escapeHtml(title)}</h3>
                    <p style="line-height:1.5; color:var(--text-main); white-space:pre-line;">${escapeHtml(message)}</p>
                    <div style="display:flex; justify-content:flex-end; margin-top:18px;">
                        <button type="button" class="modal-btn accent" data-act="ok">OK</button>
                    </div>
                </div>
            `;
            ov.querySelector('[data-act="ok"]').onclick = () => { ov.remove(); resolve(); };
            document.body.appendChild(ov);
        });
    }

    function openExportDialog() {
        if (typeof document === 'undefined' || !document.body) return;
        const old = document.getElementById('soloBackupExportModal');
        if (old) old.remove();

        const songs = (Array.isArray(root.library) ? root.library : []).filter(s => s && !s.is_deleted);
        const setlists = readLocalSetlists();
        const setlistNames = Object.keys(setlists).filter(n => n && n !== '__trash__');

        const ov = document.createElement('div');
        ov.id = 'soloBackupExportModal';
        ov.className = 'modal-overlay';
        ov.style.cssText = 'display:flex; z-index:4600;';
        ov.innerHTML = `
            <div class="modal-content" style="max-width:460px;">
                <h3 style="margin-top:0; color:var(--accent);">Αντίγραφο ασφαλείας (.mnotezip)</h3>
                <p style="font-size:0.85rem; color:var(--text-muted); margin-top:0;">Τραγούδια, λίστες, παρτιτούρες και τοπικοί ρυθμοί.</p>
                <div style="display:flex; flex-direction:column; gap:8px; margin:12px 0;">
                    <label style="display:flex; align-items:center; gap:8px; cursor:pointer;">
                        <input type="radio" name="soloBackupScope" value="all" checked>
                        <span>Όλα τα τραγούδια (${songs.length})</span>
                    </label>
                    <label style="display:flex; align-items:center; gap:8px; cursor:pointer;">
                        <input type="radio" name="soloBackupScope" value="setlist" ${setlistNames.length === 0 ? 'disabled' : ''}>
                        <span>Συγκεκριμένη λίστα</span>
                    </label>
                    <select id="soloBackupSetlistSelect" style="display:none; padding:6px 8px; border-radius:6px; background:var(--bg-input); color:var(--text-main); border:1px solid var(--border-color);">
                        ${setlistNames.map(n => `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`).join('')}
                    </select>
                    <label style="display:flex; align-items:center; gap:8px; cursor:pointer;">
                        <input type="radio" name="soloBackupScope" value="selected" ${songs.length === 0 ? 'disabled' : ''}>
                        <span>Επιλεγμένα τραγούδια</span>
                    </label>
                    <div id="soloBackupSongList" style="display:none; max-height:180px; overflow-y:auto; border:1px solid var(--border-color); border-radius:6px; padding:8px;">
                        ${songs.map(s => `<label style="display:flex; align-items:center; gap:8px; padding:3px 0; font-size:0.85rem; cursor:pointer;"><input type="checkbox" value="${escapeHtml(s.id)}" checked><span>${escapeHtml(s.title || 'Χωρίς τίτλο')}</span></label>`).join('')}
                    </div>
                </div>
                <div style="display:flex; gap:10px; justify-content:flex-end; margin-top:16px; flex-wrap:wrap;">
                    <button type="button" class="modal-btn" id="soloBackupCancelBtn">Άκυρο</button>
                    <button type="button" class="modal-btn accent" id="soloBackupConfirmBtn" ${songs.length === 0 ? 'disabled' : ''}>Δημιουργία (.mnotezip)</button>
                </div>
            </div>
        `;

        const radios = ov.querySelectorAll('input[name="soloBackupScope"]');
        const selEl = ov.querySelector('#soloBackupSetlistSelect');
        const listEl = ov.querySelector('#soloBackupSongList');
        radios.forEach(r => {
            r.addEventListener('change', () => {
                selEl.style.display = r.value === 'setlist' && r.checked ? 'block' : 'none';
                listEl.style.display = r.value === 'selected' && r.checked ? 'block' : 'none';
            });
        });

        ov.querySelector('#soloBackupCancelBtn').onclick = () => ov.remove();
        ov.querySelector('#soloBackupConfirmBtn').onclick = async () => {
            const scope = (ov.querySelector('input[name="soloBackupScope"]:checked') || {}).value || 'all';
            const selectedIds = Array.from(listEl.querySelectorAll('input[type="checkbox"]:checked')).map(c => c.value);
            const setlistName = selEl.value;
            ov.remove();

            try {
                const res = await exportSoloPackage({ mode: scope, setlistName, selectedIds });
                const shareRes = await saveOrShareBackupFile(res.bytes, res.filename);
                if (shareRes.method !== 'cancelled') {
                    markBackupCompleted();
                    renderBackupReminder();
                    if (typeof root.showToast === 'function') {
                        root.showToast(`Αποθηκεύτηκε αντίγραφο (${res.stats.songs} τραγούδια, ${res.stats.attachments} παρτιτούρες)`, 'success');
                    }
                }
            } catch (err) {
                console.error('❌ [SOLO BACKUP EXPORT]', err);
                await showAlertNeutral('Σφάλμα εξαγωγής', err.message || 'Αποτυχία δημιουργίας αντιγράφου.');
            }
        };

        document.body.appendChild(ov);
    }

    async function handleImportFile(file) {
        if (!file) return false;
        const nameLower = String(file.name || '').toLowerCase();
        const isZipExt = nameLower.endsWith('.mnotezip') || nameLower.endsWith('.zip');
        const buf = await file.arrayBuffer();
        const bytes = new Uint8Array(buf);
        const pkg = getPkg();
        if (!isZipExt && !pkg.isPackage(bytes)) {
            return false;
        }
        if (!pkg.isPackage(bytes)) {
            await showAlertNeutral('Μη έγκυρο αρχείο', 'Το αρχείο δεν είναι έγκυρο πακέτο .mnotezip.');
            return true;
        }

        const preview = pkg.readPackage(bytes);
        const songCount = Array.isArray(preview.songs) ? preview.songs.filter(s => s && !s.is_deleted).length : 0;
        const attCount = Array.isArray(preview.files) ? preview.files.length : 0;
        const ok = await askConfirmNeutral(
            'Επαναφορά .mnotezip',
            `Βρέθηκαν ${songCount} τραγούδια και ${attCount} παρτιτούρες.\nΘα προστεθούν τα νέα και θα ενημερωθούν όσα είναι νεότερα.\nΣυνέχεια;`
        );
        if (!ok) return true;

        const res = await importSoloPackage(bytes);
        if (res.blockedByLimit) {
            await showAlertNeutral(
                'Όριο τραγουδιών',
                'Η επαναφορά ακυρώθηκε γιατί ξεπερνά το όριο των 20 τραγουδιών της δωρεάν έκδοσης.'
            );
            return true;
        }

        if (typeof root.updateSetlistDropdown === 'function') root.updateSetlistDropdown();
        if (typeof root.applyFilters === 'function') root.applyFilters();
        renderBackupReminder();

        const r = res.report;
        await showAlertNeutral(
            'Η επαναφορά ολοκληρώθηκε',
            `Νέα: ${r.added}\nΕνημερώθηκαν: ${r.updated}\nΠαραλείφθηκαν: ${r.skipped + r.ignoredDeleted}\nΠαρτιτούρες: ${r.attachmentsSaved}\nΡυθμοί: ${r.rhythmsSaved}`
        );

        // Ε3: άνοιγμα του 1ου νέου/ενημερωμένου τραγουδιού στη Σκηνή μετά το «OK»
        if (res.firstImportedSongId && typeof root.loadSong === 'function') {
            root.loadSong(res.firstImportedSongId);
        }
        return true;
    }

    function renderBackupReminder() {
        if (typeof document === 'undefined') return;
        const notice = document.getElementById('soloLocalNotice');
        if (!notice) return;
        let bar = document.getElementById('soloBackupReminderBar');
        const show = shouldShowBackupReminder();
        if (!show) {
            if (bar) bar.remove();
            return;
        }
        if (!bar) {
            bar = document.createElement('div');
            bar.id = 'soloBackupReminderBar';
            bar.style.cssText = 'margin-top:8px; padding:8px 10px; border-radius:8px; border:1px solid var(--accent); background:rgba(187,134,252,0.08); display:flex; align-items:center; justify-content:space-between; gap:8px; flex-wrap:wrap; font-size:0.78rem;';
            bar.innerHTML = `
                <span>Ώρα για αντίγραφο ασφαλείας (.mnotezip).</span>
                <div style="display:flex; gap:6px;">
                    <button type="button" class="modal-btn accent" style="padding:4px 9px; font-size:0.74rem;" data-act="now">Αντίγραφο τώρα</button>
                    <button type="button" class="modal-btn" style="padding:4px 9px; font-size:0.74rem;" data-act="later">Αργότερα</button>
                </div>
            `;
            bar.querySelector('[data-act="now"]').onclick = () => openExportDialog();
            bar.querySelector('[data-act="later"]').onclick = () => {
                snoozeBackupReminder();
                renderBackupReminder();
            };
            notice.appendChild(bar);
        }
    }

    if (typeof document !== 'undefined') {
        root.beforeImportFile = async function (file) {
            return handleImportFile(file);
        };
        document.addEventListener('DOMContentLoaded', () => {
            setTimeout(() => {
                renderBackupReminder();
                if (shouldShowBackupReminder() && typeof root.showToast === 'function') {
                    root.showToast('Υπενθύμιση: κράτησε ένα αντίγραφο ασφαλείας (.mnotezip) από τις Ρυθμίσεις.', 'info');
                }
            }, 2200);
        });
    }

    const api = {
        SOLO_CUSTOM_RHYTHMS_KEY,
        BACKUP_META_KEY,
        formatBackupFilename,
        selectSongsForExport,
        exportSoloPackage,
        importSoloPackage,
        readLocalCustomRhythms,
        writeLocalCustomRhythms,
        readBackupMeta,
        recordBackupChange,
        markBackupCompleted,
        snoozeBackupReminder,
        shouldShowBackupReminder,
        saveOrShareBackupFile,
        openExportDialog,
        handleImportFile,
        renderBackupReminder
    };

    root.SoloBackup = api;
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
})(typeof window !== 'undefined' ? window : globalThis);
