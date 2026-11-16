/**
 * mNotes Solo — Local Assets Policy & IndexedDB Storage (Phase 3)
 *
 * Manages local score attachments (images & PDFs) in IndexedDB ('MNotesSoloAssetsDB')
 * without any cloud/Supabase dependency. Loaded only in Solo builds.
 */
(function (root) {
    'use strict';

    const DB_NAME = 'MNotesSoloAssetsDB';
    const DB_VERSION = 1;
    const STORE_NAME = 'assets';
    const INDEX_CREATED = 'by_created';

    const MAX_IMAGE_DIM = 1600;
    const IMAGE_QUALITY = 0.80;
    const IMAGE_OUTPUT_MIME = 'image/jpeg';

    const MAX_IMAGE_INPUT_BYTES = 25 * 1024 * 1024; // 25 MB
    const MAX_PDF_BYTES = 10 * 1024 * 1024;         // 10 MB
    const MAX_ATTACHMENTS_PER_SONG = 5;

    const LOCAL_URI_PREFIX = 'local://asset/';
    const ORPHAN_GRACE_MS = 5 * 60 * 1000;

    const QUOTA_ERROR_MSG = 'Ο διαθέσιμος χώρος αποθήκευσης της συσκευής/φυλλομετρητή γέμισε. Δεν αποθηκεύτηκε το αρχείο. Διαγράψτε παλιά συνημμένα ή ελευθερώστε χώρο στη συσκευή.';

    let customDbAdapter = null;
    let customImageCompressor = null;
    let persistRequested = false;
    const activeObjectUrls = new Map();

    function notify(msg, type) {
        if (typeof root.showToast === 'function') {
            root.showToast(msg, type || 'info');
        }
    }

    function isSupabaseUrl(url) {
        return /\.supabase\.co\b/i.test(String(url || ''));
    }

    function isLocalAssetUrl(url) {
        return typeof url === 'string' && url.startsWith(LOCAL_URI_PREFIX);
    }

    function extractAssetId(url) {
        if (!isLocalAssetUrl(url)) return null;
        const id = url.slice(LOCAL_URI_PREFIX.length).trim();
        return id || null;
    }

    function isQuotaError(err) {
        if (!err) return false;
        const name = String(err.name || '');
        const msg = String(err.message || '');
        return name === 'QuotaExceededError' ||
            name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
            err.code === 22 ||
            err.code === 1014 ||
            /quota/i.test(msg);
    }

    function generateAssetId() {
        const rand = Math.random().toString(36).slice(2, 7);
        return `att_${Date.now()}_${rand}`;
    }

    function escapeHtml(str) {
        return String(str || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function escapeJsStr(str) {
        return String(str || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    }

    // --- IndexedDB Adapter ---

    function openBrowserDb() {
        return new Promise((resolve, reject) => {
            if (typeof indexedDB === 'undefined') {
                reject(new Error('IndexedDB is not supported in this environment.'));
                return;
            }
            const req = indexedDB.open(DB_NAME, DB_VERSION);
            req.onupgradeneeded = function (e) {
                const db = e.target.result;
                if (!db.objectStoreNames.contains(STORE_NAME)) {
                    const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
                    store.createIndex(INDEX_CREATED, 'created_at', { unique: false });
                }
            };
            req.onsuccess = function (e) {
                resolve(e.target.result);
            };
            req.onerror = function (e) {
                reject(e.target.error || new Error('Failed to open IndexedDB'));
            };
        });
    }

    const browserDbAdapter = {
        async put(record) {
            const db = await openBrowserDb();
            return new Promise((resolve, reject) => {
                const tx = db.transaction([STORE_NAME], 'readwrite');
                tx.oncomplete = () => { db.close(); resolve(record); };
                tx.onerror = (e) => {
                    const err = (tx.error || (e && e.target && e.target.error) || new Error('IDB write error'));
                    db.close();
                    reject(err);
                };
                tx.onabort = () => {
                    const err = tx.error || new Error('IDB transaction aborted');
                    db.close();
                    reject(err);
                };
                try {
                    tx.objectStore(STORE_NAME).put(record);
                } catch (err) {
                    db.close();
                    reject(err);
                }
            });
        },
        async get(id) {
            const db = await openBrowserDb();
            return new Promise((resolve, reject) => {
                const tx = db.transaction([STORE_NAME], 'readonly');
                const req = tx.objectStore(STORE_NAME).get(id);
                req.onsuccess = () => { db.close(); resolve(req.result || null); };
                req.onerror = () => { const err = req.error; db.close(); reject(err); };
            });
        },
        async delete(id) {
            const db = await openBrowserDb();
            return new Promise((resolve, reject) => {
                const tx = db.transaction([STORE_NAME], 'readwrite');
                tx.oncomplete = () => { db.close(); resolve(true); };
                tx.onerror = () => { const err = tx.error; db.close(); reject(err); };
                tx.objectStore(STORE_NAME).delete(id);
            });
        },
        async getAll() {
            const db = await openBrowserDb();
            return new Promise((resolve, reject) => {
                const tx = db.transaction([STORE_NAME], 'readonly');
                const req = tx.objectStore(STORE_NAME).getAll();
                req.onsuccess = () => { db.close(); resolve(req.result || []); };
                req.onerror = () => { const err = req.error; db.close(); reject(err); };
            });
        },
        async getAllKeys() {
            const db = await openBrowserDb();
            return new Promise((resolve, reject) => {
                const tx = db.transaction([STORE_NAME], 'readonly');
                const req = tx.objectStore(STORE_NAME).getAllKeys();
                req.onsuccess = () => { db.close(); resolve(req.result || []); };
                req.onerror = () => { const err = req.error; db.close(); reject(err); };
            });
        }
    };

    function getDb() {
        return customDbAdapter || browserDbAdapter;
    }

    function setDbAdapter(adapter) {
        customDbAdapter = adapter;
    }

    function resetDbAdapter() {
        customDbAdapter = null;
    }

    function setImageCompressor(fn) {
        customImageCompressor = fn;
    }

    function resetImageCompressor() {
        customImageCompressor = null;
    }

    // --- Image Compression (1600px, JPEG 0.80, White Background) ---

    function compressImageBrowser(file, opts) {
        const maxDim = (opts && opts.maxDim) || MAX_IMAGE_DIM;
        const quality = (opts && opts.quality) || IMAGE_QUALITY;

        return new Promise((resolve, reject) => {
            if (typeof Image === 'undefined' || typeof document === 'undefined') {
                reject(new Error('Canvas/Image API unavailable.'));
                return;
            }

            const reader = new FileReader();
            reader.onerror = () => reject(new Error('Αποτυχία ανάγνωσης αρχείου εικόνας.'));
            reader.onload = function (e) {
                const img = new Image();
                img.onerror = () => reject(new Error('Το αρχείο εικόνας είναι κατεστραμμένο ή μη έγκυρο.'));
                img.onload = function () {
                    const srcW = img.naturalWidth || img.width;
                    const srcH = img.naturalHeight || img.height;
                    if (!srcW || !srcH) {
                        reject(new Error('Μη έγκυρες διαστάσεις εικόνας.'));
                        return;
                    }

                    const scale = Math.min(1, maxDim / Math.max(srcW, srcH));
                    const targetW = Math.max(1, Math.round(srcW * scale));
                    const targetH = Math.max(1, Math.round(srcH * scale));

                    const canvas = document.createElement('canvas');
                    canvas.width = targetW;
                    canvas.height = targetH;
                    const ctx = canvas.getContext('2d');
                    if (!ctx) {
                        canvas.width = 0;
                        canvas.height = 0;
                        reject(new Error('Αποτυχία δημιουργίας canvas context.'));
                        return;
                    }

                    // Λευκό φόντο πριν το drawImage για διάφανα PNG/WebP
                    ctx.fillStyle = '#FFFFFF';
                    ctx.fillRect(0, 0, targetW, targetH);
                    ctx.drawImage(img, 0, 0, targetW, targetH);

                    canvas.toBlob(function (blob) {
                        canvas.width = 0;
                        canvas.height = 0;
                        if (!blob) {
                            reject(new Error('Αποτυχία συμπίεσης εικόνας (canvas.toBlob null).'));
                            return;
                        }
                        resolve({
                            blob,
                            mime: IMAGE_OUTPUT_MIME,
                            ext: 'jpg',
                            width: targetW,
                            height: targetH,
                            size: blob.size
                        });
                    }, IMAGE_OUTPUT_MIME, quality);
                };
                img.src = e.target.result;
            };
            reader.readAsDataURL(file);
        });
    }

    async function compressImage(file, opts) {
        if (typeof customImageCompressor === 'function') {
            return customImageCompressor(file, opts || { maxDim: MAX_IMAGE_DIM, quality: IMAGE_QUALITY });
        }
        return compressImageBrowser(file, opts);
    }

    async function ensurePersistentStorage() {
        if (persistRequested) return;
        persistRequested = true;
        try {
            if (typeof navigator !== 'undefined' && navigator.storage &&
                typeof navigator.storage.persisted === 'function' &&
                typeof navigator.storage.persist === 'function') {
                const already = await navigator.storage.persisted();
                if (!already) {
                    await navigator.storage.persist();
                }
            }
        } catch (_) { /* best-effort */ }
    }

    // --- Core Save with Limits & Atomic Rollback ---

    async function saveLocalAttachmentForSong(params) {
        const { file, name, song, saveSongFn } = params || {};
        if (!song) throw new Error('Επιλέξτε τραγούδι πρώτα!');
        if (!file) throw new Error('Δεν επιλέχθηκε αρχείο.');

        const currentAttachments = Array.isArray(song.attachments) ? song.attachments : [];
        if (currentAttachments.length >= MAX_ATTACHMENTS_PER_SONG) {
            throw new Error(`Έχετε φτάσει το μέγιστο όριο των ${MAX_ATTACHMENTS_PER_SONG} συνημμένων ανά τραγούδι.`);
        }

        const fileName = String(file.name || 'file');
        const ext = fileName.includes('.') ? fileName.split('.').pop().toLowerCase() : '';
        const isPdf = ext === 'pdf' || file.type === 'application/pdf';
        const isImage = ['png', 'jpg', 'jpeg', 'webp'].includes(ext) ||
            (typeof file.type === 'string' && file.type.startsWith('image/'));

        if (!isPdf && !isImage) {
            throw new Error('Μη υποστηριζόμενη μορφή αρχείου. Επιλέξτε εικόνα (PNG, JPG, WebP) ή PDF.');
        }

        let recordBlob;
        let recordMime;
        let recordExt;
        let recordSize;
        let recordWidth = null;
        let recordHeight = null;

        if (isPdf) {
            if (file.size > MAX_PDF_BYTES) {
                const mb = (file.size / (1024 * 1024)).toFixed(1);
                throw new Error(`Το αρχείο PDF είναι πολύ μεγάλο (${mb} MB). Το μέγιστο επιτρεπτό μέγεθος είναι 10 MB.`);
            }
            recordBlob = file;
            recordMime = 'application/pdf';
            recordExt = 'pdf';
            recordSize = file.size;
        } else {
            if (file.size > MAX_IMAGE_INPUT_BYTES) {
                const mb = (file.size / (1024 * 1024)).toFixed(1);
                throw new Error(`Η εικόνα είναι πολύ μεγάλη (${mb} MB). Το μέγιστο επιτρεπτό μέγεθος εισόδου είναι 25 MB.`);
            }
            const compressed = await compressImage(file, { maxDim: MAX_IMAGE_DIM, quality: IMAGE_QUALITY });
            recordBlob = compressed.blob;
            recordMime = compressed.mime || IMAGE_OUTPUT_MIME;
            recordExt = compressed.ext || 'jpg';
            recordSize = compressed.size != null ? compressed.size : (recordBlob.size || 0);
            recordWidth = compressed.width || null;
            recordHeight = compressed.height || null;
        }

        await ensurePersistentStorage();

        const id = generateAssetId();
        const nowIso = new Date().toISOString();
        const displayName = (name && String(name).trim()) || fileName.replace(/\.[^/.]+$/, '') || 'Untitled Asset';

        const record = {
            id,
            name: displayName,
            mime: recordMime,
            ext: recordExt,
            size: recordSize,
            width: recordWidth,
            height: recordHeight,
            created_at: nowIso,
            blob: recordBlob
        };

        const db = getDb();
        try {
            await db.put(record);
        } catch (err) {
            if (isQuotaError(err)) {
                throw new Error(QUOTA_ERROR_MSG);
            }
            throw err;
        }

        const assetUri = `${LOCAL_URI_PREFIX}${id}`;
        const attachmentMeta = {
            id: Date.now(),
            asset_id: id,
            name: displayName,
            url: assetUri,
            type: recordMime,
            size: recordSize,
            date: Date.now(),
            origin: 'private'
        };

        if (!Array.isArray(song.attachments)) song.attachments = [];
        song.attachments.push(attachmentMeta);

        try {
            const saveFn = saveSongFn || root.saveSong;
            if (typeof saveFn === 'function') {
                const res = await saveFn(song);
                if (res === false) {
                    throw new Error('Αποτυχία αποθήκευσης τραγουδιού.');
                }
            }
        } catch (err) {
            // Rollback: τίποτα μισό
            song.attachments = song.attachments.filter(a => a.asset_id !== id && a.url !== assetUri);
            try { await db.delete(id); } catch (_) { /* ignore cleanup error */ }
            if (isQuotaError(err)) {
                throw new Error(QUOTA_ERROR_MSG);
            }
            throw err;
        }

        return { record, attachment: attachmentMeta };
    }

    // --- Reference Counting & Cleanup ---

    function collectReferencedAssetIds(songs) {
        const refs = new Set();
        (songs || []).forEach(song => {
            if (!song || !Array.isArray(song.attachments)) return;
            song.attachments.forEach(att => {
                if (!att) return;
                const id = att.asset_id || extractAssetId(att.url);
                if (id) refs.add(id);
            });
        });
        return refs;
    }

    async function cleanupUnreferencedAssets(assetIdsToCheck, remainingLibrary) {
        const ids = (assetIdsToCheck || []).filter(Boolean);
        if (ids.length === 0) return [];

        const refs = collectReferencedAssetIds(remainingLibrary);
        const db = getDb();
        const deleted = [];
        for (const id of ids) {
            if (!refs.has(id)) {
                try {
                    await db.delete(id);
                    revokeCachedUrl(id);
                    deleted.push(id);
                } catch (_) { /* ignore */ }
            }
        }
        return deleted;
    }

    async function soloCleanupSongAssets(removedSongs, remainingLibrary) {
        const candidateIds = Array.from(collectReferencedAssetIds(removedSongs));
        if (candidateIds.length === 0) return [];
        const lib = remainingLibrary || (Array.isArray(root.library) ? root.library : []);
        return cleanupUnreferencedAssets(candidateIds, lib);
    }

    async function soloOnDetachAttachment(removedItem, remainingLibrary) {
        if (!removedItem) return [];
        const id = removedItem.asset_id || extractAssetId(removedItem.url);
        if (!id) return [];
        const lib = remainingLibrary || (Array.isArray(root.library) ? root.library : []);
        return cleanupUnreferencedAssets([id], lib);
    }

    async function soloPruneOrphanAssets(options) {
        const opts = options || {};
        const lib = opts.library || (Array.isArray(root.library) ? root.library : []);
        const refs = collectReferencedAssetIds(lib);
        const db = getDb();
        const all = await db.getAll();
        const now = typeof opts.now === 'number' ? opts.now : Date.now();
        const deleted = [];

        for (const rec of all) {
            if (!rec || !rec.id) continue;
            if (refs.has(rec.id)) continue;
            const createdMs = rec.created_at ? Date.parse(rec.created_at) : 0;
            if (!opts.force && createdMs && (now - createdMs) < ORPHAN_GRACE_MS) {
                continue;
            }
            try {
                await db.delete(rec.id);
                revokeCachedUrl(rec.id);
                deleted.push(rec.id);
            } catch (_) { /* ignore */ }
        }
        return deleted;
    }

    // --- Blocking supabase.co & Resolving local://asset/<id> ---

    function revokeCachedUrl(id) {
        const cached = activeObjectUrls.get(id);
        if (cached && typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
            try { URL.revokeObjectURL(cached); } catch (_) {}
        }
        activeObjectUrls.delete(id);
    }

    function beforeOpenAttachmentUrl(url, name) {
        if (isSupabaseUrl(url)) {
            const label = name || 'αρχείο';
            notify(`Η παρτιτούρα "${label}" είναι αποθηκευμένη στο Cloud της έκδοσης mNotes Pro. Για να εμφανίζεται στη Solo, προσθέστε το αρχείο τοπικά.`, 'warning');
            return false;
        }
        return true;
    }

    async function resolveAttachmentUrl(url, name) {
        if (!beforeOpenAttachmentUrl(url, name)) {
            return null;
        }
        if (!isLocalAssetUrl(url)) {
            return { url, isLocal: false };
        }
        const id = extractAssetId(url);
        const db = getDb();
        const record = id ? await db.get(id) : null;
        if (!record || !record.blob) {
            const label = name || id || 'αρχείο';
            notify(`Το αρχείο "${label}" δεν βρέθηκε σε αυτή τη συσκευή (τα αρχεία .mnote περιέχουν μόνο τους στίχους και τις συγχορδίες, όχι τις παρτιτούρες).`, 'warning');
            return null;
        }
        let objectUrl = activeObjectUrls.get(id);
        if (!objectUrl && typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function') {
            objectUrl = URL.createObjectURL(record.blob);
            activeObjectUrls.set(id, objectUrl);
        }
        return {
            url: objectUrl || url,
            mime: record.mime,
            blob: record.blob,
            name: record.name,
            isLocal: true
        };
    }

    // --- UI Hooks for js/modules/assets.js & js/modules/settings.js ---

    function soloOpenAssetManager(type) {
        const targetType = type || 'visuals';
        if (root.mNotes && root.mNotes.ui && root.mNotes.ui.assets) {
            root.mNotes.ui.assets.currentType = targetType;
        }
        const typeInp = document.getElementById('assetManagerCurrentType');
        if (typeInp) typeInp.value = targetType;

        const tabs = document.getElementById('assetManagerTabs');
        if (tabs) tabs.style.display = 'none';

        const modal = document.getElementById('assetManagerModal');
        if (modal) modal.style.display = 'flex';

        soloLoadUserAssets(targetType);
    }

    async function soloLoadUserAssets(type) {
        const listContainer = document.getElementById('assetManagerList');
        if (!listContainer) return;

        const uploadSection = document.getElementById('assetUploadSection');
        if (uploadSection) uploadSection.style.display = 'block';

        try {
            const all = await getDb().getAll();
            all.sort((a, b) => Date.parse(b.created_at || 0) - Date.parse(a.created_at || 0));

            if (all.length === 0) {
                listContainer.innerHTML = `<div class="empty-state">Δεν βρέθηκαν τοπικές παρτιτούρες / No local files found.</div>`;
                return;
            }

            listContainer.innerHTML = all.map(asset => {
                const isImg = asset.mime && asset.mime.startsWith('image/');
                const iconClass = isImg ? 'fas fa-image' : 'fas fa-file-pdf';
                const sizeKB = asset.size ? ` (${Math.max(1, Math.round(asset.size / 1024))} KB)` : '';
                const uri = `${LOCAL_URI_PREFIX}${asset.id}`;
                const safeNameJs = escapeJsStr(asset.name);
                const safeUriJs = escapeJsStr(uri);
                const safeIdJs = escapeJsStr(asset.id);

                return `
                    <div style="display:flex; justify-content:space-between; align-items:center; padding:8px; border-bottom:1px solid var(--border-color);">
                        <span style="font-size:0.85rem; word-break:break-all;">
                            <i class="${iconClass}" style="margin-right:5px; color:var(--accent);"></i> ${escapeHtml(asset.name)}<span style="opacity:0.6; font-size:0.75rem;">${sizeKB}</span>
                        </span>
                        <div style="display:flex; gap: 8px;">
                            <button onclick="downloadAssetLocal('${safeUriJs}', '${safeNameJs}')" class="play-mini-btn" title="Λήψη / Download" style="color: #28a745; border-color: #28a745;">
                                <i class="fas fa-download"></i>
                            </button>
                            <button onclick="attachExistingAsset('${safeNameJs}', '${safeUriJs}')" class="add-mini-btn" title="Σύνδεση με το τραγούδι / Attach to song">
                                <i class="fas fa-link"></i>
                            </button>
                            <button onclick="deleteAssetFromLibrary('${safeIdJs}', '${safeUriJs}', '${safeNameJs}')" class="play-mini-btn" style="color: #dc3545; border-color: #dc3545;" title="Οριστική Διαγραφή / Delete">
                                <i class="fas fa-trash"></i>
                            </button>
                        </div>
                    </div>
                `;
            }).join('');
        } catch (err) {
            listContainer.innerHTML = `<div class="empty-state" style="color:red;">Σφάλμα / Error: ${escapeHtml(err.message)}</div>`;
        }
    }

    async function soloHandleUpload(inputElement) {
        const file = inputElement && inputElement.files && inputElement.files[0];
        if (!file) return;

        const targetSongId = root.currentSongId;
        const lib = Array.isArray(root.library) ? root.library : [];
        const targetSong = lib.find(s => s.id === targetSongId);
        if (!targetSong) {
            notify('Επιλέξτε τραγούδι πρώτα! / Select a song first!', 'warning');
            inputElement.value = '';
            return;
        }

        const currentAttachments = Array.isArray(targetSong.attachments) ? targetSong.attachments : [];
        if (currentAttachments.length >= MAX_ATTACHMENTS_PER_SONG) {
            notify(`Έχετε φτάσει το μέγιστο όριο των ${MAX_ATTACHMENTS_PER_SONG} συνημμένων ανά τραγούδι.`, 'error');
            inputElement.value = '';
            return;
        }

        const defaultName = file.name.replace(/\.[^/.]+$/, '');
        let customName = defaultName;
        if (typeof root.mPrompt === 'function') {
            customName = await root.mPrompt('Όνομα Αρχείου / File Name:', defaultName);
            if (customName === null) {
                inputElement.value = '';
                return;
            }
        }
        if (String(customName).trim() === '') customName = 'Untitled Asset';

        if (root.mNotes && root.mNotes.ui && root.mNotes.ui.assets &&
            typeof root.mNotes.ui.assets.closeManager === 'function') {
            root.mNotes.ui.assets.closeManager();
        }

        try {
            await saveLocalAttachmentForSong({
                file,
                name: customName,
                song: targetSong,
                saveSongFn: root.saveSong
            });

            if (root.currentSongId === targetSongId && typeof root.renderAttachmentsList === 'function') {
                root.renderAttachmentsList(targetSong.attachments);
            }
            notify(`Επιτυχία! Το '${customName}' αποθηκεύτηκε τοπικά.`, 'success');
        } catch (err) {
            notify(err.message || 'Αποτυχία αποθήκευσης αρχείου.', 'error');
        } finally {
            inputElement.value = '';
        }
    }

    async function soloDeleteFromLibrary(assetId, fileUrl, assetName) {
        const msg = `Οριστική διαγραφή του "${assetName || assetId}" από τη συσκευή;`;
        const confirmed = typeof root.mConfirm === 'function'
            ? await root.mConfirm(msg, true)
            : (typeof confirm === 'function' ? confirm(msg) : false);
        if (!confirmed) return;

        try {
            await getDb().delete(assetId);
            revokeCachedUrl(assetId);

            const targetUri = fileUrl || `${LOCAL_URI_PREFIX}${assetId}`;
            const lib = Array.isArray(root.library) ? root.library : [];
            let changed = false;
            lib.forEach(song => {
                if (!song || !Array.isArray(song.attachments)) return;
                const before = song.attachments.length;
                song.attachments = song.attachments.filter(a => a && a.asset_id !== assetId && a.url !== targetUri);
                if (song.attachments.length !== before) {
                    changed = true;
                    if (typeof root.saveSong === 'function') root.saveSong(song);
                }
            });

            if (changed && root.currentSongId) {
                const cur = lib.find(s => s.id === root.currentSongId);
                if (cur && typeof root.renderAttachmentsList === 'function') {
                    root.renderAttachmentsList(cur.attachments || []);
                }
            }

            notify('Το αρχείο διαγράφηκε.', 'success');
            soloLoadUserAssets('visuals');
        } catch (err) {
            notify('Αποτυχία διαγραφής.', 'error');
        }
    }

    async function soloDownloadAsset(fileUrl, fileName) {
        if (!fileUrl) return;
        if (!beforeOpenAttachmentUrl(fileUrl, fileName)) return;
        if (!isLocalAssetUrl(fileUrl)) return;

        try {
            const id = extractAssetId(fileUrl);
            const record = id ? await getDb().get(id) : null;
            if (!record || !record.blob) {
                notify(`Το αρχείο "${fileName || id}" δεν βρέθηκε σε αυτή τη συσκευή.`, 'warning');
                return;
            }
            const ext = record.ext ? `.${record.ext}` : '';
            const base = fileName || record.name || 'attachment';
            const finalName = base.endsWith(ext) ? base : `${base}${ext}`;

            const blobUrl = URL.createObjectURL(record.blob);
            const a = document.createElement('a');
            a.style.display = 'none';
            a.href = blobUrl;
            a.download = finalName;
            document.body.appendChild(a);
            a.click();
            setTimeout(() => {
                URL.revokeObjectURL(blobUrl);
                if (a.parentNode) a.parentNode.removeChild(a);
            }, 100);
        } catch (err) {
            notify('Αποτυχία λήψης αρχείου.', 'error');
        }
    }

    async function soloGetAssetsStats() {
        try {
            const all = await getDb().getAll();
            let totalBytes = 0;
            for (const rec of all) {
                totalBytes += Number(rec && rec.size) || 0;
            }
            return { count: all.length, totalBytes };
        } catch (_) {
            return { count: 0, totalBytes: 0 };
        }
    }

    async function soloUpdateSettingsAssetsStatus(el) {
        if (!el) return;
        const stats = await soloGetAssetsStats();
        const mb = (stats.totalBytes / 1048576).toFixed(1);
        const existing = el.querySelector('.solo-assets-stat');
        const label = ` · Παρτιτούρες: ${stats.count} αρχεία (${mb} MB)`;
        if (existing) {
            existing.textContent = label;
        } else {
            const span = document.createElement('span');
            span.className = 'solo-assets-stat';
            span.textContent = label;
            el.appendChild(span);
        }
    }

    // Export hooks onto root (window) and CommonJS
    const api = {
        DB_NAME,
        DB_VERSION,
        STORE_NAME,
        MAX_IMAGE_DIM,
        IMAGE_QUALITY,
        IMAGE_OUTPUT_MIME,
        MAX_IMAGE_INPUT_BYTES,
        MAX_PDF_BYTES,
        MAX_ATTACHMENTS_PER_SONG,
        LOCAL_URI_PREFIX,
        QUOTA_ERROR_MSG,
        isSupabaseUrl,
        isLocalAssetUrl,
        extractAssetId,
        isQuotaError,
        setDbAdapter,
        resetDbAdapter,
        setImageCompressor,
        resetImageCompressor,
        compressImage,
        saveLocalAttachmentForSong,
        collectReferencedAssetIds,
        cleanupUnreferencedAssets,
        soloCleanupSongAssets,
        soloOnDetachAttachment,
        soloPruneOrphanAssets,
        beforeOpenAttachmentUrl,
        resolveAttachmentUrl,
        soloOpenAssetManager,
        soloLoadUserAssets,
        soloHandleUpload,
        soloDeleteFromLibrary,
        soloDownloadAsset,
        soloGetAssetsStats,
        soloUpdateSettingsAssetsStatus
    };

    root.SoloLocalAssets = api;
    root.beforeOpenAttachmentUrl = beforeOpenAttachmentUrl;
    root.resolveAttachmentUrl = resolveAttachmentUrl;
    root.soloOpenAssetManager = soloOpenAssetManager;
    root.soloLoadUserAssets = soloLoadUserAssets;
    root.soloHandleUpload = soloHandleUpload;
    root.soloDeleteFromLibrary = soloDeleteFromLibrary;
    root.soloOnDetachAttachment = soloOnDetachAttachment;
    root.soloDownloadAsset = soloDownloadAsset;
    root.soloCleanupSongAssets = soloCleanupSongAssets;
    root.soloPruneOrphanAssets = soloPruneOrphanAssets;
    root.soloGetAssetsStats = soloGetAssetsStats;
    root.soloUpdateSettingsAssetsStatus = soloUpdateSettingsAssetsStatus;

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
})(typeof window !== 'undefined' ? window : globalThis);
