/**
 * mNotes Assets Module
 * Handles Media Library, Uploads, and Attachment management
 */

window.mNotes = window.mNotes || {};
window.mNotes.ui = window.mNotes.ui || {};
window.mNotes.ui.assets = window.mNotes.ui.assets || {};

(function(assets) {

    // --- State & Constants ---
    assets.currentType = 'audio';
    assets.mediaRecorder = null;
    assets.audioChunks = [];
    assets.currentRecordedBlob = null;
    assets.recTimerInterval = null;
    assets.recStartTime = 0;

    let audioCtx = null;
    let audioSource = null;
    let pitchNode = null;
    let activeSemitones = 0;

    let _amCachedAssets = [];
    let _amFilter = 'all';
    let _amIsReadOnly = false;
    let _amVaultBanner = '';
    const _amSelectedIds = new Set();
    let _amPreviewAudio = null;
    let _amPreviewUrl = null;

    function trAsset(key, fallback) {
        return typeof t === 'function' ? t(key, fallback) : fallback;
    }

    function cleanAssetUrl(url) {
        return String(url || '').split('?')[0];
    }

    function stopAmPreview() {
        if (_amPreviewAudio) {
            try { _amPreviewAudio.pause(); } catch (_) {}
            _amPreviewAudio = null;
        }
        _amPreviewUrl = null;
        document.querySelectorAll('#assetManagerList .am-preview-btn.is-playing').forEach(btn => {
            btn.classList.remove('is-playing');
            btn.innerHTML = '<i class="fas fa-play"></i>';
        });
    }

    function toggleAmAudioPreview(url, btnEl) {
        const clean = cleanAssetUrl(url);
        if (_amPreviewUrl === clean && _amPreviewAudio && !_amPreviewAudio.paused) {
            stopAmPreview();
            return;
        }
        stopAmPreview();
        try {
            _amPreviewAudio = new Audio(url);
            _amPreviewUrl = clean;
            if (btnEl) {
                btnEl.classList.add('is-playing');
                btnEl.innerHTML = '<i class="fas fa-stop"></i>';
            }
            _amPreviewAudio.onended = () => stopAmPreview();
            _amPreviewAudio.onerror = () => stopAmPreview();
            const p = _amPreviewAudio.play();
            if (p && typeof p.catch === 'function') p.catch(() => stopAmPreview());
        } catch (_) {
            stopAmPreview();
        }
    }

    function getSongAttachedUrlsForManager() {
        const set = new Set();
        const song = (typeof library !== 'undefined' && Array.isArray(library) && typeof currentSongId !== 'undefined')
            ? library.find(x => x.id === currentSongId)
            : null;
        if (!song) return set;
        ['recordings', 'rhythms', 'attachments'].forEach(field => {
            const arr = Array.isArray(song[field]) ? song[field] : [];
            arr.forEach(item => {
                const u = typeof item === 'string' ? item : item?.url;
                if (u) set.add(cleanAssetUrl(u));
            });
        });
        return set;
    }

    function updateAmFooterCount() {
        const btn = document.getElementById('btnAmAttachSelected');
        const countEl = document.getElementById('amSelectedCount');
        const cnt = _amSelectedIds.size;
        if (countEl) countEl.textContent = String(cnt);
        if (btn) btn.disabled = cnt === 0 || _amIsReadOnly;
    }

    function getAmFilterChipsForType(type) {
        if (type === 'audio') {
            return [
                { id: 'all', label: trAsset('am_chip_all', 'Όλα') },
                { id: 'recordings', label: trAsset('am_chip_recordings', 'Ηχογραφήσεις') },
                { id: 'files', label: trAsset('am_chip_audio_files', 'MP3 / WAV') }
            ];
        }
        if (type === 'visuals' || type === 'score' || type === 'document') {
            const canAbc = (typeof canUserPerform === 'function') ? canUserPerform('CREATE_ABC_SCORE') : true;
            const chips = [{ id: 'all', label: trAsset('am_chip_all', 'Όλα') }];
            if (canAbc) chips.push({ id: 'score', label: trAsset('am_chip_abc', 'ABC') });
            chips.push({ id: 'pdf', label: trAsset('am_chip_pdf', 'PDF') });
            chips.push({ id: 'image', label: trAsset('am_chip_images', 'Εικόνες') });
            return chips;
        }
        return [{ id: 'all', label: trAsset('am_chip_all', 'Όλα') }];
    }

    function renderAmFilterChips(type) {
        const host = document.getElementById('amFilterChips');
        if (!host) return;
        host.dataset.amType = type || 'audio';
        const chips = getAmFilterChipsForType(type);
        if (!chips.some(c => c.id === _amFilter)) _amFilter = 'all';
        host.innerHTML = '';
        if (chips.length <= 1) {
            host.style.display = 'none';
            return;
        }
        host.style.display = 'flex';
        chips.forEach(ch => {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'f-chip' + (_amFilter === ch.id ? ' active' : '');
            b.dataset.filter = ch.id;
            b.textContent = ch.label;
            b.addEventListener('click', () => {
                _amFilter = ch.id;
                host.querySelectorAll('.f-chip').forEach(el => el.classList.toggle('active', el.dataset.filter === ch.id));
                assets.renderManagerList();
            });
            host.appendChild(b);
        });
    }

    function matchesAmFilter(asset, type) {
        const searchTerm = (document.getElementById('amSearch')?.value || '').trim().toLowerCase();
        if (searchTerm && !(asset.custom_name || '').toLowerCase().includes(searchTerm)) return false;

        if (_amFilter === 'all') return true;
        const urlClean = cleanAssetUrl(asset.file_url).toLowerCase();
        const fType = (asset.file_type || '').toLowerCase();

        if (type === 'audio') {
            const isRec = urlClean.includes('rec_') || urlClean.endsWith('.webm') || (asset.custom_name || '').toLowerCase().includes('rec');
            if (_amFilter === 'recordings') return isRec;
            if (_amFilter === 'files') return !isRec;
            return true;
        }

        const mimeLow = (asset.mime || '').toLowerCase();
        const extLow = (asset.ext || '').toLowerCase();
        const isAbc = fType === 'score' || urlClean.endsWith('.abc');
        const isPdf = urlClean.endsWith('.pdf') || mimeLow === 'application/pdf' || extLow === 'pdf';
        if (_amFilter === 'score') return isAbc;
        if (_amFilter === 'pdf') return isPdf;
        if (_amFilter === 'image') return !isPdf && !isAbc;
        return true;
    }

    assets.renderManagerList = function(items) {
        if (Array.isArray(items)) _amCachedAssets = items;
        const listContainer = document.getElementById('assetManagerList');
        if (!listContainer) return;
        const chipHost = document.getElementById('amFilterChips');
        if (chipHost && chipHost.dataset.amType !== assets.currentType) {
            renderAmFilterChips(assets.currentType);
        }

        const filtered = _amCachedAssets.filter(a => matchesAmFilter(a, assets.currentType));
        if (filtered.length === 0) {
            listContainer.innerHTML = _amVaultBanner + `<div class="empty-state" style="padding:24px; text-align:center;">Δεν βρέθηκαν αρχεία / No files found.</div>`;
            updateAmFooterCount();
            return;
        }

        const attachedUrls = getSongAttachedUrlsForManager();
        listContainer.innerHTML = _amVaultBanner;

        filtered.forEach(asset => {
            const row = document.createElement('div');
            row.className = 'modal-row';
            row.dataset.assetId = asset.id;

            const isAttached = attachedUrls.has(cleanAssetUrl(asset.file_url));

            if (!_amIsReadOnly) {
                const cb = document.createElement('input');
                cb.type = 'checkbox';
                cb.className = 'am-row-check';
                cb.checked = _amSelectedIds.has(asset.id);
                cb.setAttribute('aria-label', asset.custom_name || 'Select');
                cb.addEventListener('change', () => {
                    if (cb.checked) _amSelectedIds.add(asset.id);
                    else _amSelectedIds.delete(asset.id);
                    updateAmFooterCount();
                });
                row.appendChild(cb);
            }

            let itemIcon = 'fas fa-file';
            const urlLow = cleanAssetUrl(asset.file_url).toLowerCase();
            const mimeLow = (asset.mime || '').toLowerCase();
            const extLow = (asset.ext || '').toLowerCase();
            if (asset.file_type === 'audio') itemIcon = 'fas fa-music';
            else if (asset.file_type === 'rhythm' || urlLow.endsWith('.mnr')) itemIcon = 'fas fa-drum';
            else if (asset.file_type === 'score' || urlLow.endsWith('.abc')) itemIcon = 'fas fa-file-code';
            else if (urlLow.endsWith('.pdf') || mimeLow === 'application/pdf' || extLow === 'pdf') itemIcon = 'fas fa-file-pdf';
            else if (asset.file_type === 'document' || asset.file_type === 'image') itemIcon = 'fas fa-image';

            const iconSpan = document.createElement('span');
            iconSpan.className = 'am-row-icon';
            iconSpan.innerHTML = `<i class="${itemIcon}"></i>`;
            row.appendChild(iconSpan);

            const nameSpan = document.createElement('span');
            nameSpan.className = 'am-row-name';
            nameSpan.textContent = asset.custom_name || 'Untitled';
            nameSpan.title = asset.custom_name || '';
            if (!_amIsReadOnly) {
                nameSpan.style.cursor = 'pointer';
                nameSpan.addEventListener('click', () => {
                    const cb = row.querySelector('.am-row-check');
                    if (cb) {
                        cb.checked = !cb.checked;
                        cb.dispatchEvent(new Event('change'));
                    }
                });
            }
            row.appendChild(nameSpan);

            if (isAttached) {
                const pill = document.createElement('span');
                pill.className = 'linked-pill';
                pill.title = trAsset('am_linked_badge', 'Συνδεδεμένο');
                pill.innerHTML = `✓ <span class="lp-text">${trAsset('am_linked_badge', 'Συνδεδεμένο')}</span>`;
                row.appendChild(pill);
            }

            const actionsDiv = document.createElement('div');
            actionsDiv.className = 'am-row-actions';

            if (asset.file_type === 'audio') {
                const playBtn = document.createElement('button');
                playBtn.type = 'button';
                playBtn.className = 'play-mini-btn am-preview-btn';
                playBtn.title = 'Προεπισκόπηση / Preview';
                playBtn.innerHTML = '<i class="fas fa-play"></i>';
                playBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    toggleAmAudioPreview(asset.file_url, playBtn);
                });
                actionsDiv.appendChild(playBtn);
            }

            const dlBtn = document.createElement('button');
            dlBtn.type = 'button';
            dlBtn.className = 'play-mini-btn am-btn-dl am-btn-outline';
            dlBtn.title = 'Λήψη / Download';
            dlBtn.style.cssText = 'color: #28a745; border-color: #28a745;';
            dlBtn.innerHTML = '<i class="fas fa-download"></i>';
            dlBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                assets.downloadLocal(asset.file_url, asset.custom_name || 'file');
            });
            actionsDiv.appendChild(dlBtn);

            const canDelete = Boolean(asset.is_local_solo) || (typeof currentUser !== 'undefined' && currentUser && asset.user_id === currentUser.id) || (typeof roleCan === 'function' && roleCan('DELETE_LIBRARY_ASSET'));
            if (canDelete) {
                const delBtn = document.createElement('button');
                delBtn.type = 'button';
                delBtn.className = 'play-mini-btn am-btn-outline';
                delBtn.style.cssText = 'color: #dc3545; border-color: #dc3545;';
                delBtn.title = 'Οριστική Διαγραφή / Delete';
                delBtn.innerHTML = '<i class="fas fa-trash"></i>';
                delBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    assets.deleteFromLibrary(asset.id, asset.file_url, asset.custom_name || '');
                });
                actionsDiv.appendChild(delBtn);
            }

            row.appendChild(actionsDiv);
            listContainer.appendChild(row);
        });

        updateAmFooterCount();
    };

    assets.attachSelected = async function() {
        if (!currentSongId) {
            showToast(trAsset('msg_select_song_first', "Επιλέξτε τραγούδι πρώτα! / Select a song first!"));
            return;
        }
        const selected = _amCachedAssets.filter(a => _amSelectedIds.has(a.id));
        if (selected.length === 0) return;

        let addedCount = 0;
        for (const asset of selected) {
            let assetType = assets.currentType;
            if (assetType === 'visuals') {
                const uLow = cleanAssetUrl(asset.file_url).toLowerCase();
                assetType = (uLow.endsWith('.abc') || asset.file_type === 'score') ? 'score' : 'document';
            }
            const ok = await assets.processAttachment(currentSongId, assetType, asset.custom_name, asset.file_url);
            if (ok !== false) addedCount++;
        }

        _amSelectedIds.clear();
        assets.closeManager();
        if (addedCount > 0) {
            showToast(addedCount === 1
                ? `Το αρχείο συνδέθηκε επιτυχώς!`
                : `Συνδέθηκαν ${addedCount} αρχεία επιτυχώς!`);
        }
    };

    // --- Core Functions ---

    assets.resetManagerUiForSolo = function(type) {
        assets.currentType = type || 'visuals';
        _amFilter = 'all';
        _amSelectedIds.clear();
        _amIsReadOnly = false;
        _amVaultBanner = '';
        stopAmPreview();
        const searchEl = document.getElementById('amSearch');
        if (searchEl) {
            searchEl.value = '';
            if (!searchEl.dataset.amBound) {
                searchEl.addEventListener('input', () => assets.renderManagerList());
                searchEl.dataset.amBound = '1';
            }
        }
        renderAmFilterChips(assets.currentType);
        updateAmFooterCount();
    };

    assets.openManager = function(type) {
        if (typeof window.soloOpenAssetManager === 'function') {
            return window.soloOpenAssetManager(type);
        }
        if (!currentUser) {
            const authModal = document.getElementById('authModal');
            if (authModal) authModal.style.display = 'flex';
            return;
        }
        assets.currentType = type;
        _amFilter = 'all';
        _amSelectedIds.clear();
        stopAmPreview();
        const searchEl = document.getElementById('amSearch');
        if (searchEl) {
            searchEl.value = '';
            if (!searchEl.dataset.amBound) {
                searchEl.addEventListener('input', () => assets.renderManagerList());
                searchEl.dataset.amBound = '1';
            }
        }
        renderAmFilterChips(type);
        updateAmFooterCount();

        const typeInp = document.getElementById('assetManagerCurrentType');
        if (typeInp) typeInp.value = type;
        
        const modal = document.getElementById('assetManagerModal');
        if (modal) modal.style.display = 'flex';
        
        assets.loadUserAssets(type);
    };

    assets.closeManager = function() {
        stopAmPreview();
        const modal = document.getElementById('assetManagerModal');
        if (modal) modal.style.display = 'none';
    };

    assets.switchTab = function(type) {
        const tabs = document.querySelectorAll('#assetManagerTabs .tab-btn');
        tabs.forEach(btn => {
            const btnOnClick = btn.getAttribute('onclick');
            if (btnOnClick && btnOnClick.includes(type)) btn.classList.add('active');
            else btn.classList.remove('active');
        });
        assets.currentType = type;
        _amFilter = 'all';
        _amSelectedIds.clear();
        renderAmFilterChips(type);
        updateAmFooterCount();
        const typeInp = document.getElementById('assetManagerCurrentType');
        if (typeInp) typeInp.value = type;
        assets.loadUserAssets(type);
    };

    assets.loadUserAssets = async function(type) {
        if (typeof window.soloLoadUserAssets === 'function') {
            return window.soloLoadUserAssets(type);
        }
        const listContainer = document.getElementById('assetManagerList');
        if (!listContainer) return;
        listContainer.innerHTML = `<div class="empty-state" style="padding:24px; text-align:center;">Φόρτωση αρχείων... / Loading...</div>`;

        _amIsReadOnly = (typeof canUserPerform === 'function' && !canUserPerform('SAVE_ATTACHMENTS'));
        renderAmFilterChips(type);
        updateAmFooterCount();

        try {
            const { data: { session } } = await supabaseClient.auth.getSession();
            if (!session) {
                listContainer.innerHTML = `<div class="empty-state">Παρακαλώ συνδεθείτε / Please login.</div>`;
                return;
            }
            const uid = session.user.id;

            // 1. Φέρνουμε ΟΛΑ τα αρχεία που ανήκουν στον χρήστη (ανεξαρτήτως group_id)
            const { data: userData, error: uError } = await supabaseClient
                .from('user_assets')
                .select('*')
                .eq('user_id', uid)
                .neq('is_deleted', true);
            
            if (uError) {
                console.error("[AssetManager] DB Error:", uError);
                throw uError;
            }

            // 2. Φιλτράρισμα βάσει τύπου στο frontend για μέγιστη σιγουριά
            let filtered = (userData || []).filter(asset => {
                const fType = (asset.file_type || "").toLowerCase();
                if (type === 'visuals') {
                    return ['document', 'score', 'image'].includes(fType) || (asset.file_url && asset.file_url.toLowerCase().includes('.abc'));
                }
                return fType === type.toLowerCase();
            });

            // Ταξινόμηση
            filtered.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

            _amVaultBanner = '';
            const uploadSection = document.getElementById('assetUploadSection'); 

            if (_amIsReadOnly && filtered.length > 0) {
                _amVaultBanner = `
                    <div style="background: rgba(255, 193, 7, 0.15); border: 1px solid #ffc107; color: #ffc107; padding: 10px; border-radius: 6px; margin: 8px; font-size: 0.85rem; text-align: center;">
                        <i class="fas fa-snowflake"></i> <b>Παγωμένος Χώρος:</b> Το πακέτο σας άλλαξε σε Free. 
                        Τα αρχεία σας είναι ασφαλή, μπορείτε να τα κατεβάσετε, αλλά δεν μπορείτε να τα προσθέσετε σε νέα τραγούδια.
                    </div>
                `;
                if (uploadSection) uploadSection.style.display = 'none';
            } else {
                if (uploadSection) uploadSection.style.display = 'block';
            }

            assets.renderManagerList(filtered);

        } catch (err) {
            console.error("[AssetManager] Σφάλμα φόρτωσης αρχείων:", err);
            listContainer.innerHTML = `<div class="empty-state" style="color:red;">Σφάλμα / Error: ${err.message}</div>`;
        }
    };

    assets.handleUpload = async function(inputElement) {
        if (typeof window.soloHandleUpload === 'function') {
            return window.soloHandleUpload(inputElement);
        }
        if (typeof canUserPerform === 'function' && !canUserPerform('SAVE_ATTACHMENTS')) {
            if (typeof promptUpgrade === 'function') promptUpgrade('Αποθήκευση Αρχείων / Save Files');
            inputElement.value = ""; 
            return; 
        }

        const file = inputElement.files[0];
        if (!file) return;

        const limits = typeof getUserLimits === 'function' ? getUserLimits() : { storageLimitMB: 50 };
        const fileSizeMB = file.size / (1024 * 1024);
        
        if (fileSizeMB > limits.storageLimitMB) {
            showToast(`Το αρχείο είναι πολύ μεγάλο (${fileSizeMB.toFixed(1)}MB). Το όριό σας είναι ${limits.storageLimitMB}MB.`, "error");
            inputElement.value = ""; 
            return;
        }

        const fileExt = file.name.split('.').pop().toLowerCase();
        const currentType = assets.currentType || 'audio';
        
        if (currentType === 'audio') {
            const allowedAudio = ['mp3', 'wav', 'm4a', 'webm'];
            if (!allowedAudio.includes(fileExt)) {
                showToast(t('msg_err_format_audio', "⚠️ Μη υποστηριζόμενη μορφή. Παρακαλώ επιλέξτε MP3, WAV ή M4A."), "error");
                inputElement.value = ''; return; 
            }
        } else if (currentType === 'rhythm') {
            if (fileExt !== 'mnr' && fileExt !== 'mnrythm') {
                showToast(t('msg_err_format_rhythm', "⚠️ Παρακαλώ επιλέξτε ένα αρχείο ρυθμού mNotes (.mnr, .mnrythm)."), "error");
                inputElement.value = ''; return; 
            }
        } else { 
            const allowAbc = (typeof canUserPerform === 'function') ? canUserPerform('CREATE_ABC_SCORE') : true;
            const allowedVisuals = allowAbc ? ['pdf', 'png', 'jpg', 'jpeg', 'abc', 'webp'] : ['pdf', 'png', 'jpg', 'jpeg', 'webp'];
            if (!allowedVisuals.includes(fileExt)) {
                showToast(fileExt === 'abc'
                    ? t('msg_err_abc_pro_only', "Η προσθήκη αρχείων .abc διατίθεται στο mNotes Pro.")
                    : t('msg_err_format_image_abc', "⚠️ Μη υποστηριζόμενη μορφή. Παρακαλώ επιλέξτε Εικόνα ή ABC."), "error");
                inputElement.value = ''; return; 
            }
        }

        const targetSongId = currentSongId;
        if (!targetSongId) { showToast(t('msg_select_song_first', "Επιλέξτε τραγούδι πρώτα! / Select a song first!")); inputElement.value = ""; return; }

        const assetType = assets.currentType;
        const defaultName = file.name.replace(/\.[^/.]+$/, ""); 
        
        let customTrackName = defaultName;
        let isShared = false;

        const canShare = currentGroupId !== 'personal' && roleCan('UPLOAD_SHARED_ASSET');
        
        if (canShare) {
            const result = await window.mPrompt("Όνομα Αρχείου / File Name:", defaultName, {
                label: "Κοινόχρηστο (ορατό σε όλη τη Μπάντα)",
                defaultChecked: false
            });
            if (result === null) { inputElement.value = ""; return; }
            customTrackName = result.value;
            isShared = result.checked;
        } else {
            customTrackName = await window.mPrompt("Όνομα Αρχείου / File Name:", defaultName);
            if (customTrackName === null) { inputElement.value = ""; return; }
        }
        
        if (customTrackName.trim() === "") customTrackName = "Untitled Asset";

        assets.closeManager();
        showToast(`Uploading '${customTrackName}'... Μπορείτε να συνεχίσετε την εργασία σας!`, "info");

        const safeNameForStorage = customTrackName.replace(/[^a-zA-Z0-9]/g, '_');
        const filename = `Asset_${Date.now()}_${safeNameForStorage}`;

        try {
            const { error: uploadErr } = await supabaseClient.storage.from('audio_files').upload(`${currentUser.id}/${filename}`, file);
            if (uploadErr) throw uploadErr;

            const { data: { publicUrl } } = supabaseClient.storage.from('audio_files').getPublicUrl(`${currentUser.id}/${filename}`);

            const { error: dbErr } = await supabaseClient
                .from('user_assets')
                .insert([{
                    user_id: currentUser.id,
                    group_id: isShared ? currentGroupId : null,
                    custom_name: customTrackName,
                    file_url: publicUrl,
                    file_type: (assetType === 'visuals') ? (fileExt === 'abc' ? 'score' : 'document') : assetType
                }]);
            if (dbErr) throw dbErr;

            await assets.processAttachment(targetSongId, assetType, customTrackName, publicUrl);
            showToast(`Επιτυχία! Το '${customTrackName}' συνδέθηκε στο τραγούδι.`);
        } catch (err) {
            console.error("[AssetManager] Αποτυχία Upload:", err);
            showToast(t('msg_upload_failed_generic', "Αποτυχία Upload / Upload Failed: ") + err.message, "error");
        } finally {
            inputElement.value = ""; 
        }
    };

    assets.attachExisting = async function(assetName, assetUrl) {
        if (!currentSongId) { showToast(t('msg_select_song_first', "Επιλέξτε τραγούδι πρώτα! / Select a song first!")); return; }
        
        let assetType = assets.currentType;
        if (assetType === 'visuals') {
            assetType = (assetUrl.toLowerCase().includes('.abc?') || assetUrl.toLowerCase().endsWith('.abc')) ? 'score' : 'document';
        }
        
        await assets.processAttachment(currentSongId, assetType, assetName, assetUrl);
        assets.closeManager();
        showToast(`Το αρχείο '${assetName}' συνδέθηκε επιτυχώς!`);
    };

    assets.processAttachment = async function(targetSongId, type, name, url) {
        const targetSong = library.find(x => x.id === targetSongId);
        if (!targetSong) return;

        const txtBpm = document.getElementById('txtBpm');
        let currentBpm = (txtBpm && parseInt(txtBpm.value, 10)) || 100;
        if (type === 'rhythm' && url && !String(url).startsWith('local://')) {
            try {
                const res = await fetch(url);
                if (res.ok) {
                    const data = await res.json();
                    const fileBpm = parseInt(data?.metadata?.defaultBpm, 10);
                    if (fileBpm >= 20 && fileBpm <= 240) currentBpm = fileBpm;
                }
            } catch (_) {}
        }

        const newAssetObj = { id: Date.now(), name: name, url: url, date: Date.now(), bpm: currentBpm };
        const cleanU = cleanAssetUrl(url);
        const alreadyHasUrl = (arr) => Array.isArray(arr) && arr.some(x => cleanAssetUrl(typeof x === 'string' ? x : x?.url) === cleanU);
       
        if (type === 'audio') {
            if (!targetSong.recordings) targetSong.recordings = [];
            if (alreadyHasUrl(targetSong.recordings)) return false;
            targetSong.recordings.push(newAssetObj);
            
            if (typeof addRecordingToCurrentSong === 'function' && targetSongId === currentSongId) {
                 await addRecordingToCurrentSong(newAssetObj);
            } else {
                 if(typeof saveSong === 'function') saveSong(targetSong);
            }

            if (currentSongId === targetSongId && typeof renderRecordingsList === 'function') {
                renderRecordingsList(targetSong.recordings);
            }

        } else if (type === 'rhythm') { 
            if (!targetSong.rhythms) targetSong.rhythms = [];
            if (alreadyHasUrl(targetSong.rhythms)) return false;
            targetSong.rhythms.push(newAssetObj);
            
            if(typeof saveSong === 'function') saveSong(targetSong);
            if (currentSongId === targetSongId && typeof renderRhythmsList === 'function') {
                renderRhythmsList(targetSong.rhythms);
                if (typeof activateSongRhythm === 'function') {
                    activateSongRhythm(newAssetObj.url, newAssetObj.name);
                }
            }
            
        } else { 
            if (!targetSong.attachments) targetSong.attachments = [];
            if (alreadyHasUrl(targetSong.attachments)) return false;
            if (type === 'score') {
                newAssetObj.category = 'score';
            }
            targetSong.attachments.push(newAssetObj);
            
            if(typeof saveSong === 'function') saveSong(targetSong);
            
            if (currentSongId === targetSongId && typeof renderAttachmentsList === 'function') {
                renderAttachmentsList(targetSong.attachments);
            }
        }
        return true;
    };

    assets.deleteFromLibrary = async function(assetId, fileUrl, assetName) {
        if (typeof window.soloDeleteFromLibrary === 'function') {
            return window.soloDeleteFromLibrary(assetId, fileUrl, assetName);
        }
        let confirmMsg = `Διαγραφή του "${assetName}" (Μεταφορά στον κάδο);`;
        if (typeof window.formatLinkedSongsDeleteWarning === 'function') {
            let allLocalSongs = [];
            try {
                if (typeof library !== 'undefined' && Array.isArray(library)) allLocalSongs = allLocalSongs.concat(library);
                const pRaw = localStorage.getItem('mnotes_data');
                if (pRaw) allLocalSongs = allLocalSongs.concat(JSON.parse(pRaw) || []);
                if (typeof currentGroupId !== 'undefined' && currentGroupId && currentGroupId !== 'personal') {
                    const bRaw = localStorage.getItem(`mnotes_band_${currentGroupId}`);
                    if (bRaw) allLocalSongs = allLocalSongs.concat(JSON.parse(bRaw) || []);
                }
            } catch (_) {}
            const dedup = Array.from(new Map(allLocalSongs.filter(s => s && s.id).map(s => [s.id, s])).values());
            confirmMsg = window.formatLinkedSongsDeleteWarning({ id: assetId, file_url: fileUrl, custom_name: assetName }, dedup, []);
        }
        if (!(await window.mConfirm(confirmMsg, true))) return;

        try {
            // Soft delete
            const { error: dbErr } = await supabaseClient.from('user_assets').update({ is_deleted: true }).eq('id', assetId);
            if (dbErr) throw dbErr;

            // Ελευθέρωση χώρου. Κοινή συνάρτηση με το mStudio (js/asset-manager.js)
            // ώστε οι δύο διαδρομές διαγραφής να μην αποκλίνουν ποτέ.
            if (typeof window.removeOrphanStorageFile === 'function') {
                await window.removeOrphanStorageFile(fileUrl, currentUser ? currentUser.id : null);
            }

            showToast(t('msg_file_removed', "Το αρχείο αφαιρέθηκε."));
            assets.loadUserAssets(assets.currentType);
        } catch (err) {
            console.error("Delete error:", err);
            showToast(t('msg_delete_failed', "Αποτυχία διαγραφής."), "error");
        }
    };

    assets.downloadLocal = async function(fileUrl, fileName) {
        if (typeof window.soloDownloadAsset === 'function') {
            return window.soloDownloadAsset(fileUrl, fileName);
        }
        if (!fileUrl) return;
        showToast(t('msg_download_started', "Η λήψη ξεκίνησε... / Downloading..."), "info");

        try {
            const response = await fetch(fileUrl);
            if (!response.ok) throw new Error("Αποτυχία δικτύου κατά τη λήψη.");
            
            const blob = await response.blob();
            const extMatch = fileUrl.match(/\.([a-zA-Z0-9]+)(?:\?|$)/);
            const ext = extMatch ? `.${extMatch[1]}` : '';
            const finalName = fileName.endsWith(ext) ? fileName : `${fileName}${ext}`;

            const blobUrl = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.style.display = 'none';
            a.href = blobUrl;
            a.download = finalName;
            document.body.appendChild(a);
            a.click();
            
            setTimeout(() => {
                window.URL.revokeObjectURL(blobUrl);
                document.body.removeChild(a);
            }, 100);
            
        } catch (err) {
            console.error("[AssetManager] Σφάλμα λήψης:", err);
            showToast(t('msg_open_new_tab', "Αποτυχία. Άνοιγμα σε νέα καρτέλα... / Opening in new tab..."), "warning");
            window.open(fileUrl, '_blank');
        }
    };

    function escHtml(str) {
        return String(str ?? '').replace(/[&<>"']/g, function(ch) {
            return ch === '&' ? '&amp;' : ch === '<' ? '&lt;' : ch === '>' ? '&gt;' : ch === '"' ? '&quot;' : '&#39;';
        });
    }

    assets.detachFromSong = async function(songId, listType, index) {
        if (!songId || typeof library === 'undefined') return false;
        const song = library.find(s => s.id === songId);
        if (!song) return false;

        if (currentGroupId !== 'personal' && !song.is_clone) {
            if (!roleCan('REMOVE_MASTER_ASSET')) {
                if (typeof showToast === 'function') showToast(t('msg_admins_only_remove_files', "Μόνο οι διαχειριστές μπορούν να αφαιρέσουν αρχεία από το κεντρικό τραγούδι."), "error");
                return false;
            }
        }

        let list = typeof window.safeParse === 'function' ? window.safeParse(song[listType]) : song[listType] || [];
        if (typeof list === 'string') list = JSON.parse(list); // just in case
        const item = Array.isArray(list) ? list[index] : null;
        const itemName = item && item.name ? item.name : '';
        const confirmMsg = itemName
            ? (listType === 'rhythms'
                ? t('msg_confirm_remove_rhythm', "Αφαίρεση του '{name}' από το τραγούδι;").replace('{name}', itemName)
                : t('msg_confirm_detach_file', "Αποσύνδεση του '{name}' από το τραγούδι; (Θα παραμείνει στη Βιβλιοθήκη σας)").replace('{name}', itemName))
            : t('msg_remove_file_confirm', "Σίγουρα θέλετε να αφαιρέσετε αυτό το αρχείο από το τραγούδι;");

        const isNativeConfirm = typeof window.confirm === 'function' && /\[native code\]/.test(Function.prototype.toString.call(window.confirm));
        let confirmed = false;
        if (isNativeConfirm && window.mDialog && typeof window.mDialog.dangerConfirm === 'function') {
            confirmed = await window.mDialog.dangerConfirm({
                title: t('btn_remove_from_song', 'Αφαίρεση από το τραγούδι'),
                message: confirmMsg,
                dangerText: t('btn_remove', 'Αφαίρεση')
            });
        } else {
            confirmed = window.confirm(confirmMsg);
        }

        if (confirmed) {
            if (Array.isArray(list) && list.length > index) {
                const removedItem = list.splice(index, 1)[0];
                song[listType] = list; // MUST be an array, not a string
                
                if (typeof window.saveSong === 'function') {
                    window.saveSong(song);
                }

                if (listType === 'attachments' && typeof window.soloOnDetachAttachment === 'function') {
                    window.soloOnDetachAttachment(removedItem, window.library);
                }
                
                if (listType === 'recordings') assets.renderRecordings(list);
                else if (listType === 'attachments') assets.renderAttachments(list);
                else if (listType === 'rhythms' && window.mNotes && window.mNotes.ui.rhythm) window.mNotes.ui.rhythm.renderRhythmsList(list);
                return true;
            }
        }
        return false;
    };

    let _playingRecIndex = -1;
    let _playingRecUrl = '';
    let _masterAudioBound = false;
    let _recStream = null;
    let _recAudioCtx = null;
    let _recSourceNode = null;
    let _recAnalyser = null;
    let _recLevelRaf = null;
    let _recElapsedSecs = 0;
    let _recPreviewUrl = '';
    let _suppressPostRecOnStop = false;
    let _recLifecycleBound = false;
    const _recDurationsCache = new Map();

    function formatMMSS(totalSeconds) {
        const s = Math.max(0, Math.floor(Number(totalSeconds) || 0));
        const m = Math.floor(s / 60).toString().padStart(2, '0');
        const rem = (s % 60).toString().padStart(2, '0');
        return `${m}:${rem}`;
    }

    function setRecStateUi(mode) {
        const drawer = document.getElementById('drawerAudioHub');
        const btn = document.getElementById('btnRecord');
        const tag = document.getElementById('recStateTag');
        const postBar = document.getElementById('postRecBar');
        const postDur = document.getElementById('postRecDur');
        const upBox = document.getElementById('uploadProgressBox');

        if (drawer) drawer.classList.toggle('is-recording', mode === 'recording');
        if (btn) {
            const lbl = mode === 'recording'
                ? trAsset('ttl_rec_stop', 'Διακοπή εγγραφής')
                : trAsset('ttl_rec_start', 'Εγγραφή');
            btn.setAttribute('title', lbl);
            btn.setAttribute('aria-label', lbl);
            btn.classList.toggle('recording-active', mode === 'recording');
        }
        if (tag) {
            if (mode === 'recording') tag.textContent = trAsset('rec_state_recording', 'ΕΓΓΡΑΦΗ');
            else if (mode === 'postrec') tag.textContent = trAsset('rec_state_ready', 'ΕΤΟΙΜΟ');
            else if (mode === 'uploading') tag.textContent = trAsset('rec_state_uploading', 'ΑΝΕΒΑΣΜΑ');
            else tag.textContent = trAsset('rec_state_idle', 'ΑΝΑΜΟΝΗ');
        }
        if (postBar) postBar.classList.toggle('is-hidden', mode !== 'postrec');
        if (mode === 'postrec' && postDur) postDur.textContent = formatMMSS(_recElapsedSecs);
        if (upBox) {
            upBox.classList.toggle('is-hidden', mode !== 'uploading');
            upBox.style.display = '';
        }
        if (typeof window.fitToolsSections === 'function') window.fitToolsSections();
    }

    function resetRecLevelMeter() {
        document.querySelectorAll('#recLevelMeter .lvl-bar').forEach(bar => {
            bar.classList.remove('on-green', 'on-amber', 'on-red');
        });
    }

    function updateRecLevelBars(level01) {
        const bars = document.querySelectorAll('#recLevelMeter .lvl-bar');
        if (!bars.length) return;
        const lit = Math.round(Math.max(0, Math.min(1, level01)) * bars.length);
        bars.forEach((bar, i) => {
            bar.classList.remove('on-green', 'on-amber', 'on-red');
            if (i < lit) {
                if (i < 6) bar.classList.add('on-green');
                else if (i < 8) bar.classList.add('on-amber');
                else bar.classList.add('on-red');
            }
        });
    }

    function teardownRecordingHardware() {
        if (_recLevelRaf) {
            cancelAnimationFrame(_recLevelRaf);
            _recLevelRaf = null;
        }
        if (assets.recTimerInterval) {
            clearInterval(assets.recTimerInterval);
            assets.recTimerInterval = null;
        }
        if (_recSourceNode) {
            try { _recSourceNode.disconnect(); } catch (_) {}
            _recSourceNode = null;
        }
        if (_recAnalyser) {
            try { _recAnalyser.disconnect(); } catch (_) {}
            _recAnalyser = null;
        }
        if (_recAudioCtx) {
            try {
                if (typeof _recAudioCtx.close === 'function' && _recAudioCtx.state !== 'closed') {
                    _recAudioCtx.close().catch(() => {});
                }
            } catch (_) {}
            _recAudioCtx = null;
        }
        if (_recStream && typeof _recStream.getTracks === 'function') {
            _recStream.getTracks().forEach(track => {
                try { track.stop(); } catch (_) {}
            });
        }
        if (assets.mediaRecorder && assets.mediaRecorder.stream && typeof assets.mediaRecorder.stream.getTracks === 'function') {
            assets.mediaRecorder.stream.getTracks().forEach(track => {
                try { track.stop(); } catch (_) {}
            });
        }
        _recStream = null;
        resetRecLevelMeter();
    }

    assets.stopActiveRecordingAndTeardown = function(discardDraft = false) {
        _suppressPostRecOnStop = !!discardDraft;
        if (assets.mediaRecorder && assets.mediaRecorder.state === 'recording') {
            try { assets.mediaRecorder.stop(); } catch (_) {}
        }
        teardownRecordingHardware();
        if (discardDraft) {
            assets.audioChunks = [];
            assets.currentRecordedBlob = null;
            if (_recPreviewUrl) {
                try { URL.revokeObjectURL(_recPreviewUrl); } catch (_) {}
                _recPreviewUrl = '';
            }
            const timer = document.getElementById('recTimer');
            if (timer) timer.textContent = '00:00';
            setRecStateUi('idle');
        }
    };

    function bindRecLifecycleOnce() {
        if (_recLifecycleBound) return;
        _recLifecycleBound = true;
        const drawer = document.getElementById('drawerAudioHub');
        if (drawer) {
            drawer.addEventListener('toggle', () => {
                if (!drawer.open) assets.stopActiveRecordingAndTeardown(false);
            });
        }
    }

    function syncRecPlayingDom() {
        const listEl = document.getElementById('sideRecList');
        if (!listEl) return;
        const audio = document.getElementById('masterAudio');
        const isActuallyPlaying = !!(audio && !audio.paused && _playingRecUrl);
        listEl.querySelectorAll('.track-item').forEach((row, idx) => {
            const rowUrl = cleanAssetUrl(row.dataset.url || '');
            const active = isActuallyPlaying && (idx === _playingRecIndex || (rowUrl && rowUrl === _playingRecUrl));
            row.classList.toggle('is-playing', active);
            const btn = row.querySelector('.rec-play-btn');
            if (btn) {
                const lbl = active ? trAsset('ttl_stop_rec_play', 'Διακοπή') : trAsset('ttl_play_rec', 'Αναπαραγωγή');
                btn.setAttribute('title', lbl);
                btn.setAttribute('aria-label', lbl);
                btn.innerHTML = active
                    ? '<i class="fas fa-stop" aria-hidden="true"></i>'
                    : '<i class="fas fa-play" aria-hidden="true"></i>';
            }
            if (!active) {
                const fill = row.querySelector('.rec-progress-fill');
                if (fill) fill.style.width = '0%';
            }
        });
    }

    function updateRecPreviewBtnUi(playing) {
        const btn = document.getElementById('btnPreviewRec');
        if (!btn) return;
        const icon = btn.querySelector('i');
        if (icon) {
            icon.className = playing ? 'fas fa-stop' : 'fas fa-play';
        }
    }

    function bindMasterAudioEvents() {
        const audio = document.getElementById('masterAudio');
        if (!audio || _masterAudioBound) return;
        _masterAudioBound = true;

        audio.addEventListener('timeupdate', () => {
            if (!audio.duration || !Number.isFinite(audio.duration) || audio.duration <= 0) return;
            const pct = Math.max(0, Math.min(100, (audio.currentTime / audio.duration) * 100));
            const listEl = document.getElementById('sideRecList');
            if (listEl) {
                const activeRow = listEl.querySelector('.track-item.is-playing .rec-progress-fill');
                if (activeRow) activeRow.style.width = `${pct.toFixed(1)}%`;
            }
        });

        audio.addEventListener('loadedmetadata', () => {
            if (!audio.duration || !Number.isFinite(audio.duration) || audio.duration <= 0) return;
            const formatted = formatMMSS(audio.duration);
            if (_playingRecUrl) _recDurationsCache.set(_playingRecUrl, formatted);
            const listEl = document.getElementById('sideRecList');
            if (listEl) {
                const durEl = listEl.querySelector('.track-item.is-playing .rec-dur');
                if (durEl) durEl.textContent = formatted;
            }
        });

        const onStopOrPause = () => {
            updateRecPreviewBtnUi(false);
            if (audio.ended || audio.paused) {
                if (audio.ended) {
                    _playingRecIndex = -1;
                    _playingRecUrl = '';
                }
                syncRecPlayingDom();
            }
        };
        audio.addEventListener('ended', onStopOrPause);
        audio.addEventListener('pause', onStopOrPause);
        audio.addEventListener('play', () => {
            if (_recPreviewUrl && audio.src === _recPreviewUrl) {
                updateRecPreviewBtnUi(true);
            }
            syncRecPlayingDom();
        });
    }

    assets.renameRecording = async function(songId, index) {
        if (!songId || typeof library === 'undefined') return false;
        const song = library.find(s => s.id === songId);
        if (!song || !Array.isArray(song.recordings) || !song.recordings[index]) return false;

        const rec = song.recordings[index];
        const isPrivate = (rec.origin === 'private' || !rec.origin);
        if (!isPrivate && typeof currentGroupId !== 'undefined' && currentGroupId !== 'personal' && typeof roleCan === 'function' && !roleCan('DELETE_BAND_RECORDING')) {
            if (typeof showToast === 'function') showToast(t('msg_admins_only_remove_files', "Μόνο οι διαχειριστές μπορούν να τροποποιήσουν αρχεία της μπάντας."), "error");
            return false;
        }

        const oldName = rec.name || rec.label || '';
        const newName = window.mDialog && typeof window.mDialog.prompt === 'function'
            ? await window.mDialog.prompt({
                title: trAsset('btn_rename_rec', 'Μετονομασία'),
                message: trAsset('msg_rename_recording', 'Όνομα ηχογράφησης:'),
                defaultValue: oldName,
                selectOnOpen: true
            })
            : (typeof window.mPrompt === 'function' ? await window.mPrompt(trAsset('msg_rename_recording', 'Όνομα ηχογράφησης:'), oldName) : prompt(trAsset('msg_rename_recording', 'Όνομα ηχογράφησης:'), oldName));

        if (!newName || !String(newName).trim()) return false;
        const trimmed = String(newName).trim();
        rec.name = trimmed;
        if (rec.label) rec.label = trimmed;
        if (typeof window.saveSong === 'function') window.saveSong(song);
        assets.renderRecordings(song.recordings);
        return true;
    };

    const BAND_USERS_SVG = '<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"/></svg>';

    function getRecTypeBadge(rec) {
        const urlClean = cleanAssetUrl(rec && rec.url).toLowerCase();
        const isWebMedia = urlClean.includes("youtube.com") || urlClean.includes("youtu.be") ||
            urlClean.includes("soundcloud.com") || urlClean.includes("spotify.com") ||
            urlClean.includes("music.apple.com");
        if (isWebMedia) return 'WEB';
        if (urlClean.endsWith('.wav')) return 'WAV';
        if (urlClean.endsWith('.mp3') || urlClean.endsWith('.m4a')) return 'MP3';
        return 'REC';
    }

    assets.renderRecordings = function(recs = []) {
        const listEl = document.getElementById('sideRecList');
        if (!listEl) return;

        bindRecLifecycleOnce();
        bindMasterAudioEvents();
        listEl.innerHTML = '';

        const validRecs = Array.isArray(recs) ? recs : [];
        if (validRecs.length === 0) {
            listEl.classList.add('is-hidden');
            if (typeof window.fitToolsSections === 'function') window.fitToolsSections();
            return;
        }
        listEl.classList.remove('is-hidden');

        const audio = document.getElementById('masterAudio');
        const isAudioPlaying = !!(audio && !audio.paused && _playingRecUrl);

        validRecs.forEach((rec, index) => {
            const el = document.createElement('div');
            const recUrlClean = cleanAssetUrl(rec.url || '');
            const isPlayingThis = isAudioPlaying && (index === _playingRecIndex || (recUrlClean && recUrlClean === _playingRecUrl));
            el.className = 'track-item' + (isPlayingThis ? ' is-playing' : '');
            el.dataset.url = rec.url || '';
            el.dataset.index = String(index);

            const isPrivate = (rec.origin === 'private' || !rec.origin);
            const tooltip = isPrivate ? t('ttl_private_track') : t('ttl_public_track');
            const nameText = rec.name || rec.label || 'Unnamed Track';
            const badgeText = getRecTypeBadge(rec);
            const durText = rec.duration || _recDurationsCache.get(recUrlClean) || '';

            const isOwnerOrAdmin = typeof roleCan === 'function' ? roleCan('DELETE_BAND_RECORDING') : true;
            const canModify = isPrivate || currentGroupId === 'personal' || isOwnerOrAdmin;

            const urlLower = (rec.url || '').toLowerCase();
            const isWebMedia = urlLower.includes("youtube.com") || urlLower.includes("youtu.be") ||
                urlLower.includes("soundcloud.com") || urlLower.includes("spotify.com") ||
                urlLower.includes("music.apple.com");

            const topRow = document.createElement('div');
            topRow.className = 'rec-row-top';

            const playBtn = document.createElement('button');
            playBtn.type = 'button';
            playBtn.className = 'rec-play-btn';
            const playLbl = isPlayingThis ? trAsset('ttl_stop_rec_play', 'Διακοπή') : trAsset('ttl_play_rec', 'Αναπαραγωγή');
            playBtn.setAttribute('title', playLbl);
            playBtn.setAttribute('aria-label', playLbl);
            playBtn.innerHTML = isPlayingThis
                ? '<i class="fas fa-stop" aria-hidden="true"></i>'
                : '<i class="fas fa-play" aria-hidden="true"></i>';
            playBtn.addEventListener('click', (ev) => {
                ev.stopPropagation();
                assets.playAudio(rec.url, nameText, index);
            });

            const badgeSpan = document.createElement('span');
            badgeSpan.className = 'rec-type-badge';
            badgeSpan.textContent = badgeText;

            const infoDiv = document.createElement('div');
            infoDiv.className = 'rec-main-info';
            infoDiv.setAttribute('title', `${nameText}${tooltip ? ' — ' + tooltip : ''}`);
            infoDiv.innerHTML = `
                <span class="rec-name">${escHtml(nameText)}</span>
                ${!isPrivate ? `<span class="vis-band-ico" title="${escHtml(t('ttl_public_track', 'Public (Band common)'))}" aria-label="${escHtml(t('ttl_public_track', 'Public (Band common)'))}">${BAND_USERS_SVG}</span>` : ''}
                ${durText ? `<span class="rec-dur">${escHtml(durText)}</span>` : '<span class="rec-dur"></span>'}
            `;
            infoDiv.addEventListener('click', () => {
                assets.playAudio(rec.url, nameText, index);
            });

            const moreBtn = document.createElement('button');
            moreBtn.type = 'button';
            moreBtn.className = 'rec-more-btn';
            const moreLbl = t('ttl_file_actions', 'Ενέργειες αρχείου');
            moreBtn.setAttribute('aria-expanded', 'false');
            moreBtn.setAttribute('title', moreLbl);
            moreBtn.setAttribute('aria-label', moreLbl);
            moreBtn.textContent = '⋯';

            const progTrack = document.createElement('div');
            progTrack.className = 'rec-progress-track';
            progTrack.innerHTML = '<div class="rec-progress-fill"></div>';

            topRow.appendChild(playBtn);
            topRow.appendChild(badgeSpan);
            topRow.appendChild(infoDiv);
            topRow.appendChild(moreBtn);
            topRow.appendChild(progTrack);

            const strip = document.createElement('div');
            strip.className = 'rec-action-strip';
            strip.hidden = true;

            if (canModify) {
                const renBtn = document.createElement('button');
                renBtn.type = 'button';
                renBtn.className = 'rec-act-btn rec-act-rename';
                renBtn.innerHTML = `<i class="fas fa-pen" aria-hidden="true"></i> <span>${escHtml(trAsset('btn_rename_rec', 'Μετονομασία'))}</span>`;
                renBtn.addEventListener('click', (ev) => {
                    ev.stopPropagation();
                    strip.hidden = true;
                    moreBtn.setAttribute('aria-expanded', 'false');
                    assets.renameRecording(currentSongId, index);
                });
                strip.appendChild(renBtn);
            }

            const dlBtn = document.createElement('button');
            dlBtn.type = 'button';
            dlBtn.className = 'rec-act-btn rec-act-download';
            if (isWebMedia) {
                dlBtn.innerHTML = `<i class="fas fa-external-link-alt" aria-hidden="true"></i> <span>${escHtml(t('btn_open_external', 'Άνοιγμα'))}</span>`;
                dlBtn.addEventListener('click', (ev) => {
                    ev.stopPropagation();
                    strip.hidden = true;
                    moreBtn.setAttribute('aria-expanded', 'false');
                    window.open(rec.url, '_blank');
                });
            } else {
                dlBtn.innerHTML = `<i class="fas fa-download" aria-hidden="true"></i> <span>${escHtml(t('btn_download', 'Λήψη'))}</span>`;
                dlBtn.addEventListener('click', (ev) => {
                    ev.stopPropagation();
                    strip.hidden = true;
                    moreBtn.setAttribute('aria-expanded', 'false');
                    assets.downloadLocal(rec.url, nameText);
                });
            }
            strip.appendChild(dlBtn);

            if (canModify) {
                const rmBtn = document.createElement('button');
                rmBtn.type = 'button';
                rmBtn.className = 'rec-act-btn danger rec-act-delete';
                rmBtn.innerHTML = `<i class="fas fa-times" aria-hidden="true"></i> <span>${escHtml(t('btn_remove', 'Αφαίρεση'))}</span>`;
                rmBtn.addEventListener('click', (ev) => {
                    ev.stopPropagation();
                    assets.detachFromSong(currentSongId, 'recordings', index);
                });
                strip.appendChild(rmBtn);
            }

            moreBtn.addEventListener('click', (ev) => {
                ev.stopPropagation();
                const willOpen = strip.hidden;
                listEl.querySelectorAll('.track-item').forEach(other => {
                    if (other === el) return;
                    const s2 = other.querySelector('.rec-action-strip');
                    const b2 = other.querySelector('.rec-more-btn');
                    if (s2) s2.hidden = true;
                    if (b2) b2.setAttribute('aria-expanded', 'false');
                });
                strip.hidden = !willOpen;
                moreBtn.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
            });

            el.appendChild(topRow);
            el.appendChild(strip);
            listEl.appendChild(el);
        });

        if (typeof window.fitToolsSections === 'function') window.fitToolsSections();
    };

    assets.renderAttachments = function(docs = []) {
        const listEl = document.getElementById('list-visuals'); 
        if (!listEl) return;
        
        listEl.innerHTML = ''; 
        let hasItems = false;
        const activeUrl = (typeof window !== 'undefined' && window.activeVisualDocUrl) ? window.activeVisualDocUrl : null;
        
        docs.forEach((doc, index) => {
            const el = document.createElement('div'); 
            const isViewing = !!(activeUrl && doc.url && activeUrl === doc.url);
            el.className = 'track-item vis-row' + (isViewing ? ' is-viewing' : '');
            if (doc.url) el.setAttribute('data-url', doc.url);
            
            const isPrivate = (doc.origin === 'private' || !doc.origin);
            const tooltip = isPrivate ? t('ttl_private_file') : t('ttl_public_file');
            
            const isImage = (doc.type && doc.type.toLowerCase().includes('image')) || (doc.url && /\.(jpg|jpeg|png|webp|gif)(\?|$)/i.test(doc.url));
            const isABC = doc.url && (doc.url.toLowerCase().includes('.abc?') || doc.url.toLowerCase().endsWith('.abc'));
            const kind = isABC ? 'abc' : (isImage ? 'img' : 'pdf');
            const badgeText = isABC ? 'ABC' : (isImage ? 'IMG' : 'PDF');

            const isOwnerOrAdmin = roleCan('DELETE_BAND_ATTACHMENT');
            const canDelete = isPrivate || currentGroupId === 'personal' || isOwnerOrAdmin;
            const moreLabel = t('ttl_file_actions', 'Ενέργειες αρχείου');
            const dlLabel = t('btn_download_file', 'Λήψη αρχείου');
            const rmLabel = t('btn_remove_from_song', 'Αφαίρεση από το τραγούδι');

            const mainDiv = document.createElement('div');
            mainDiv.className = 'track-main vis-main';
            mainDiv.setAttribute('title', tooltip || doc.name || '');
            mainDiv.innerHTML = `
                <span class="vis-type-badge vis-type-${kind}">${badgeText}</span>
                <span class="vis-name">${escHtml(doc.name)}</span>
                ${!isPrivate ? `<span class="vis-band-ico" title="${escHtml(t('ttl_public_file', 'Public (Band common)'))}" aria-label="${escHtml(t('ttl_public_file', 'Public (Band common)'))}">👥</span>` : ''}
                <span class="vis-active-dot" aria-hidden="true"></span>
            `;
            mainDiv.addEventListener('click', () => {
                if (isABC && typeof window.showScoreInLayer === 'function') window.showScoreInLayer(doc.url, doc.name);
                else if (isImage && typeof window.showImageInLayer === 'function') window.showImageInLayer(doc.url, doc.name);
                else if (typeof window.showPdfInLayer === 'function') window.showPdfInLayer(doc.url, doc.name);
            });

            const moreBtn = document.createElement('button');
            moreBtn.type = 'button';
            moreBtn.className = 'vis-more-btn';
            moreBtn.setAttribute('aria-expanded', 'false');
            moreBtn.setAttribute('title', moreLabel);
            moreBtn.setAttribute('aria-label', moreLabel);
            moreBtn.textContent = '⋯';

            const strip = document.createElement('div');
            strip.className = 'vis-action-strip';
            strip.hidden = true;

            const dlBtn = document.createElement('button');
            dlBtn.type = 'button';
            dlBtn.className = 'vis-act-btn vis-act-download';
            dlBtn.innerHTML = `<i class="fas fa-download" aria-hidden="true"></i> <span>${escHtml(dlLabel)}</span>`;
            dlBtn.addEventListener('click', (ev) => {
                ev.stopPropagation();
                strip.hidden = true;
                moreBtn.setAttribute('aria-expanded', 'false');
                el.classList.remove('is-more-open');
                if (typeof window.downloadAssetLocal === 'function') {
                    window.downloadAssetLocal(doc.url, doc.name);
                }
            });
            strip.appendChild(dlBtn);

            if (canDelete) {
                const delBtn = document.createElement('button');
                delBtn.type = 'button';
                delBtn.className = 'vis-act-btn danger vis-act-delete';
                delBtn.innerHTML = `<i class="fas fa-times" aria-hidden="true"></i> <span>${escHtml(rmLabel)}</span>`;
                delBtn.addEventListener('click', (ev) => {
                    ev.stopPropagation();
                    if (typeof window.deleteMediaItem === 'function') {
                        window.deleteMediaItem(currentSongId, 'attachments', index);
                    }
                });
                strip.appendChild(delBtn);
            }

            moreBtn.addEventListener('click', (ev) => {
                ev.stopPropagation();
                const willOpen = strip.hidden;
                listEl.querySelectorAll('.vis-row').forEach(otherRow => {
                    if (otherRow === el) return;
                    const otherStrip = otherRow.querySelector('.vis-action-strip');
                    const otherBtn = otherRow.querySelector('.vis-more-btn');
                    if (otherStrip) otherStrip.hidden = true;
                    if (otherBtn) otherBtn.setAttribute('aria-expanded', 'false');
                    otherRow.classList.remove('is-more-open');
                });
                strip.hidden = !willOpen;
                moreBtn.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
                el.classList.toggle('is-more-open', willOpen);
            });

            el.appendChild(mainDiv);
            el.appendChild(moreBtn);
            el.appendChild(strip);
            listEl.appendChild(el);
            hasItems = true;
        });

        if (!hasItems) listEl.innerHTML = `<div class="empty-state">${escHtml(t('msg_no_attachments'))}</div>`;
        if (typeof window.fitToolsSections === 'function') window.fitToolsSections();
    };

    assets.playAudio = async function(url, title = "Playing Audio...", index = -1) {
        const audio = document.getElementById('masterAudio');
        bindMasterAudioEvents();

        const urlLower = (url || "").toLowerCase();
        const isWebMedia = urlLower.includes("youtube.com") || urlLower.includes("youtu.be") ||
                           urlLower.includes("soundcloud.com") || urlLower.includes("spotify.com") ||
                           urlLower.includes("music.apple.com");

        if (isWebMedia) {
            if (audio) {
                audio.pause();
                audio.src = "";
            }
            _playingRecIndex = -1;
            _playingRecUrl = '';
            syncRecPlayingDom();

            const vidBox = document.getElementById('video-sidebar-container');
            const embedBox = document.getElementById('video-embed-box');
            const drawerVideo = document.getElementById('drawerVideo');

            if (vidBox && embedBox) {
                if (drawerVideo) drawerVideo.open = true;

                const ytId = (typeof getYoutubeId === 'function') ? getYoutubeId(url) : null;
                if (ytId && window.mNotes && window.mNotes.ui && window.mNotes.ui.player && typeof window.mNotes.ui.player.loadYoutubeVideo === 'function') {
                    window.mNotes.ui.player.loadYoutubeVideo(ytId);
                } else if (typeof window.getMediaEmbedHtml === 'function') {
                    embedBox.innerHTML = window.getMediaEmbedHtml(url);
                } else {
                    embedBox.innerHTML = `<iframe src="${url}" frameborder="0" allowfullscreen style="width:100%; height:100%; position:absolute; top:0; left:0; border-radius: 8px;"></iframe>`;
                }

                vidBox.style.display = 'block';

                const isEn = (typeof currentLang !== 'undefined' && currentLang === 'en');
                if (typeof showToast === 'function') {
                    showToast(isEn ? `Playing link: ${title}` : `Αναπαραγωγή συνδέσμου: ${title}`, "info");
                }
            }
            return;
        }

        if (!audio) return;

        const cleanTarget = cleanAssetUrl(url);
        const sameTrack = (_playingRecIndex >= 0 && index >= 0 && _playingRecIndex === index) ||
                          (_playingRecUrl && cleanTarget && _playingRecUrl === cleanTarget);
        if (sameTrack && !audio.paused) {
            audio.pause();
            audio.currentTime = 0;
            _playingRecIndex = -1;
            _playingRecUrl = '';
            syncRecPlayingDom();
            return;
        }

        let resolvedUrl = url;
        if (String(url || '').startsWith('local://') && typeof window.resolveAttachmentUrl === 'function') {
            try {
                const res = await window.resolveAttachmentUrl(url, title);
                if (!res) return;
                resolvedUrl = res;
            } catch (_) { return; }
        }

        _playingRecIndex = index;
        _playingRecUrl = cleanTarget;
        if (String(resolvedUrl || '').startsWith('http') && !String(resolvedUrl || '').startsWith(window.location.origin)) {
            audio.crossOrigin = "anonymous";
        } else {
            audio.removeAttribute('crossorigin');
        }
        audio.src = resolvedUrl;
        syncRecPlayingDom();

        const startPlay = () => {
            assets.initAudioTools();
            if (audioCtx && audioCtx.state === 'suspended' && typeof audioCtx.resume === 'function') {
                audioCtx.resume().catch(() => {});
            }
            const p = audio.play();
            if (p && typeof p.catch === 'function') p.catch(() => {});
            syncRecPlayingDom();
        };

        const delay = (typeof userSettings !== 'undefined' && typeof userSettings.playDelay !== 'undefined') ? parseInt(userSettings.playDelay, 10) : 0;
        if (delay > 0 && typeof window.runPlayCountdown === 'function') {
            window.runPlayCountdown(delay, startPlay, () => {
                audio.pause();
                syncRecPlayingDom();
            });
        } else {
            startPlay();
        }
    };

    assets.skipAudio = function(seconds) {
        const audio = document.getElementById('masterAudio');
        if (!audio || !audio.duration) return;
        audio.currentTime = Math.max(0, Math.min(audio.duration, audio.currentTime + seconds));
    };

    assets.closeCustomPlayer = function() {
        const audio = document.getElementById('masterAudio');
        if (audio) {
            audio.pause();
            audio.src = "";
        }
        _playingRecIndex = -1;
        _playingRecUrl = '';
        updateRecPreviewBtnUi(false);
        syncRecPlayingDom();

        activeSemitones = 0;
        if (pitchNode && typeof pitchNode.setPitch === 'function') {
            pitchNode.setPitch(0);
        }
    };
    assets.promptAddWebLink = async function() {
        if (typeof canUserPerform === 'function' && !canUserPerform('SAVE_ATTACHMENTS')) {
            if (typeof promptUpgrade === 'function') promptUpgrade(t('msg_record_save_audio', 'Εγγραφή & Αποθήκευση Ήχου'));
            return; 
        }

        if (!currentSongId) {
            showToast(t('msg_select_song_first', "Επιλέξτε τραγούδι πρώτα! / Select a song first!"), "error");
            return;
        }

        const isEn = (typeof currentLang !== 'undefined' && currentLang === 'en');

        // Step 1: Prompt for the Web Link URL
        const url = await window.mPrompt(
            isEn 
            ? "Enter Web Link URL (YouTube, SoundCloud, Spotify, Apple Music, or direct audio/video URL):" 
            : "Εισάγετε τη διεύθυνση Web Link (YouTube, SoundCloud, Spotify, Apple Music, ή απευθείας URL ήχου/βίντεο):"
        );
        if (!url || !url.trim()) return;

        // Step 2: Guess default name based on domain
        const urlLower = url.toLowerCase();
        let defaultName = isEn ? "Web Track" : "Σύνδεσμος Web";
        if (urlLower.includes("youtube.com") || urlLower.includes("youtu.be")) {
            defaultName = "YouTube Track";
        } else if (urlLower.includes("soundcloud.com")) {
            defaultName = "SoundCloud Track";
        } else if (urlLower.includes("spotify.com")) {
            defaultName = "Spotify Track";
        } else if (urlLower.includes("music.apple.com")) {
            defaultName = "Apple Music Track";
        }

        // Step 3: Prompt for the Track Name
        const trackName = await window.mPrompt(
            isEn 
            ? "Enter a name/label for this track:" 
            : "Δώστε ένα όνομα/ετικέτα για αυτό το track:",
            defaultName
        );
        if (!trackName || !trackName.trim()) return;

        // Step 4: Add as recording attachment via assets.processAttachment
        try {
            await assets.processAttachment(currentSongId, 'audio', trackName.trim(), url.trim());
            showToast(isEn ? "Link added successfully!" : "Ο σύνδεσμος προστέθηκε με επιτυχία!", "success");
        } catch (err) {
            console.error("[MediaHub] Error adding link:", err);
            showToast(isEn ? "Failed to add link." : "Αποτυχία προσθήκης συνδέσμου.", "error");
        }
    };

    assets.toggleRecording = async function() {
        const isSolo = (typeof window.currentEdition === 'function' && window.currentEdition() === 'solo');
        if (!isSolo && typeof canUserPerform === 'function' && !canUserPerform('SAVE_ATTACHMENTS')) {
            if (typeof promptUpgrade === 'function') promptUpgrade(t('msg_record_save_audio', 'Εγγραφή & Αποθήκευση Ήχου'));
            return;
        }

        bindRecLifecycleOnce();
        bindMasterAudioEvents();
        const timer = document.getElementById('recTimer');

        if (assets.mediaRecorder && assets.mediaRecorder.state === 'recording') {
            _suppressPostRecOnStop = false;
            try { assets.mediaRecorder.stop(); } catch (_) {}
            teardownRecordingHardware();
            return;
        }

        try {
            if (_recPreviewUrl) {
                try { URL.revokeObjectURL(_recPreviewUrl); } catch (_) {}
                _recPreviewUrl = '';
            }
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: false,
                    noiseSuppression: false,
                    autoGainControl: false
                }
            });
            _recStream = stream;

            const recOpts = (typeof MediaRecorder !== 'undefined' && typeof MediaRecorder.isTypeSupported === 'function' && !MediaRecorder.isTypeSupported('audio/webm'))
                ? undefined
                : { mimeType: 'audio/webm' };
            assets.mediaRecorder = recOpts ? new MediaRecorder(stream, recOpts) : new MediaRecorder(stream);
            assets.audioChunks = [];
            assets.currentRecordedBlob = null;
            _recElapsedSecs = 0;
            _suppressPostRecOnStop = false;

            // Χρήση του ΙΔΙΟΥ stream για AnalyserNode (καμία 2η κλήση getUserMedia)
            try {
                const Ctx = window.AudioContext || window.webkitAudioContext;
                if (Ctx) {
                    _recAudioCtx = new Ctx();
                    _recSourceNode = _recAudioCtx.createMediaStreamSource(stream);
                    _recAnalyser = _recAudioCtx.createAnalyser();
                    _recAnalyser.fftSize = 256;
                    _recSourceNode.connect(_recAnalyser);
                    const buf = new Uint8Array(_recAnalyser.fftSize);
                    const tickMeter = () => {
                        if (!_recAnalyser) return;
                        _recAnalyser.getByteTimeDomainData(buf);
                        let sumSq = 0;
                        for (let i = 0; i < buf.length; i++) {
                            const v = (buf[i] - 128) / 128;
                            sumSq += v * v;
                        }
                        const rms = Math.sqrt(sumSq / buf.length);
                        updateRecLevelBars(Math.min(1, rms * 3.2));
                        _recLevelRaf = requestAnimationFrame(tickMeter);
                    };
                    _recLevelRaf = requestAnimationFrame(tickMeter);
                }
            } catch (_) {}

            assets.mediaRecorder.ondataavailable = event => {
                if (event && event.data && event.data.size > 0) assets.audioChunks.push(event.data);
            };
            assets.mediaRecorder.onstop = () => {
                teardownRecordingHardware();
                if (_suppressPostRecOnStop) {
                    _suppressPostRecOnStop = false;
                    assets.audioChunks = [];
                    assets.currentRecordedBlob = null;
                    setRecStateUi('idle');
                    return;
                }
                assets.currentRecordedBlob = new Blob(assets.audioChunks, { type: 'audio/webm' });
                const audioUrl = URL.createObjectURL(assets.currentRecordedBlob);
                _recPreviewUrl = audioUrl;
                const masterPlayer = document.getElementById('masterAudio');
                if (masterPlayer) {
                    masterPlayer.pause();
                    masterPlayer.src = audioUrl;
                }
                setRecStateUi('postrec');
            };

            assets.mediaRecorder.start();
            if (timer) timer.textContent = '00:00';
            setRecStateUi('recording');
            assets.recStartTime = Date.now();
            assets.recTimerInterval = setInterval(() => {
                const diff = Math.floor((Date.now() - assets.recStartTime) / 1000);
                _recElapsedSecs = diff;
                if (timer) timer.textContent = formatMMSS(diff);
            }, 250);
        } catch (err) {
            teardownRecordingHardware();
            setRecStateUi('idle');
            const msg = t('msg_mic_error', "Microphone Error: ") + (err && err.message ? err.message : '');
            if (window.mDialog && typeof window.mDialog.alert === 'function') window.mDialog.alert({ message: msg, tone: 'error' });
            else if (typeof showToast === 'function') showToast(msg, 'error');
        }
    };

    assets.togglePreviewRecording = function() {
        const masterPlayer = document.getElementById('masterAudio');
        if (!masterPlayer || !_recPreviewUrl) return;
        bindMasterAudioEvents();
        if (masterPlayer.src !== _recPreviewUrl) masterPlayer.src = _recPreviewUrl;
        if (!masterPlayer.paused) {
            masterPlayer.pause();
            masterPlayer.currentTime = 0;
            updateRecPreviewBtnUi(false);
        } else {
            _playingRecIndex = -1;
            _playingRecUrl = '';
            syncRecPlayingDom();
            const p = masterPlayer.play();
            if (p && typeof p.catch === 'function') p.catch(() => {});
            updateRecPreviewBtnUi(true);
        }
    };

    assets.discardRecording = function() {
        _suppressPostRecOnStop = true;
        if (assets.mediaRecorder && assets.mediaRecorder.state === 'recording') {
            try { assets.mediaRecorder.stop(); } catch (_) {}
        }
        teardownRecordingHardware();

        const masterPlayer = document.getElementById('masterAudio');
        if (masterPlayer) {
            masterPlayer.pause();
            masterPlayer.src = "";
        }
        updateRecPreviewBtnUi(false);
        if (_recPreviewUrl) {
            try { URL.revokeObjectURL(_recPreviewUrl); } catch (_) {}
            _recPreviewUrl = '';
        }

        const recTimer = document.getElementById('recTimer');
        if (recTimer) recTimer.textContent = "00:00";

        assets.audioChunks = [];
        assets.currentRecordedBlob = null;
        _recElapsedSecs = 0;
        setRecStateUi('idle');

        if (typeof showToast === 'function') showToast(t('msg_record_cancelled', "Η εγγραφή ακυρώθηκε. Δεν ανέβηκε τίποτα."));
    };

    assets.uploadRecording = async function() {
        if (!assets.currentRecordedBlob) { showToast(t('msg_no_recording', "No recording!")); return; }
        if (!currentSongId) { showToast(t('msg_select_song_first', "Select song first!")); return; }
        const isSolo = (typeof window.currentEdition === 'function' && window.currentEdition() === 'solo');
        if (!isSolo && (typeof currentUser === 'undefined' || !currentUser)) {
            const authModal = document.getElementById('authModal');
            if (authModal) authModal.style.display = 'flex';
            return;
        }

        const targetSongId = currentSongId;
        const s = library.find(x => x.id === targetSongId);
        if (!s) return;

        const msgConfirm = isSolo
            ? t('msg_save_rec_local', 'Αποθήκευση ηχογράφησης στο "{title}" στη συσκευή;').replace('{title}', s.title)
            : t('msg_save_rec_cloud', 'Save to "{title}" in Cloud?').replace('{title}', s.title);
        const okSave = window.mDialog && typeof window.mDialog.confirm === 'function'
            ? await window.mDialog.confirm({ title: trAsset('btn_link_rec', 'Σύνδεση στο τραγούδι'), message: msgConfirm })
            : confirm(msgConfirm);
        if (!okSave) return;

        const barEl = document.getElementById('uploadBar');
        const pctEl = document.getElementById('uploadPct');
        const setUploadPct = (pct) => {
            if (barEl) barEl.style.width = `${pct}%`;
            if (pctEl) pctEl.textContent = `${pct}%`;
        };

        setRecStateUi('uploading');
        setUploadPct(25);

        if (!s.recordings) s.recordings = [];
        const takeNum = s.recordings.length + 1;
        const durStr = formatMMSS(_recElapsedSecs);

        const assetLibraryName = `Mic Take ${takeNum} - ${s.title}`;
        const filename = `Mic_${targetSongId}_Take${takeNum}_${Date.now()}.webm`;

        try {
            let publicUrl = '';
            if (isSolo && window.SoloLocalAssets && typeof window.SoloLocalAssets.getDbAdapter === 'function') {
                const db = window.SoloLocalAssets.getDbAdapter();
                const assetId = `rec_${targetSongId}_${Date.now()}`;
                await db.put({
                    id: assetId,
                    name: `${assetLibraryName}.webm`,
                    mime: 'audio/webm',
                    ext: 'webm',
                    size: assets.currentRecordedBlob.size || 0,
                    created_at: new Date().toISOString(),
                    blob: assets.currentRecordedBlob
                });
                publicUrl = `local://asset/${assetId}`;
                setUploadPct(85);
            } else {
                const { error } = await supabaseClient.storage.from('audio_files').upload(`${currentUser.id}/${filename}`, assets.currentRecordedBlob);
                if (error) throw error;
                setUploadPct(65);

                const { data: { publicUrl: pUrl } } = supabaseClient.storage.from('audio_files').getPublicUrl(`${currentUser.id}/${filename}`);
                publicUrl = pUrl;

                const { error: dbErr } = await supabaseClient
                    .from('user_assets')
                    .insert([{
                        user_id: currentUser.id,
                        custom_name: assetLibraryName,
                        file_url: publicUrl,
                        file_type: 'audio'
                    }]);
                if (dbErr) console.warn("Asset Library Warning:", dbErr);
                setUploadPct(90);
            }

            await assets.processAttachment(targetSongId, 'audio', `Take ${takeNum}`, publicUrl);
            const curSong = library.find(x => x.id === targetSongId);
            if (curSong && Array.isArray(curSong.recordings) && durStr !== '00:00') {
                const added = curSong.recordings.find(r => r && r.url === publicUrl);
                if (added && !added.duration) {
                    added.duration = durStr;
                    if (typeof saveSong === 'function') saveSong(curSong);
                    assets.renderRecordings(curSong.recordings);
                }
            }
            setUploadPct(100);
            showToast(t('msg_take_saved', "Take {num} Saved! ☁️").replace('{num}', takeNum));
        } catch (e) {
            console.error("Upload Error:", e);
            showToast(t('msg_upload_error', "Upload Error: ") + (e && e.message ? e.message : e), "error");
        } finally {
            assets.currentRecordedBlob = null;
            _recElapsedSecs = 0;
            const masterPlayer = document.getElementById('masterAudio');
            if (masterPlayer) {
                masterPlayer.pause();
                masterPlayer.src = "";
            }
            if (_recPreviewUrl) {
                try { URL.revokeObjectURL(_recPreviewUrl); } catch (_) {}
                _recPreviewUrl = '';
            }
            const recTimer = document.getElementById('recTimer');
            if (recTimer) recTimer.textContent = "00:00";
            setUploadPct(0);
            setRecStateUi('idle');
        }
    };
    assets.initAudioTools = function() {
        const audio = document.getElementById('masterAudio');
        if (!audio || audioCtx) return;

        try {
            const Ctx = window.AudioContext || window.webkitAudioContext;
            audioCtx = new Ctx();

            audioSource = audioCtx.createMediaElementSource(audio);

            // Create the pitch shifter
            pitchNode = createJunglePitchShifter(audioCtx);

            audioSource.connect(pitchNode.input);
            pitchNode.output.connect(audioCtx.destination);

            console.log("🔊 [AUDIO TOOLS] Web Audio Pitch Shifter initialized.");
        } catch(e) {
            console.warn("⚠️ Web Audio Context not allowed or blocked:", e);
        }
    };

    function createJunglePitchShifter(context) {
        const input = context.createGain();
        const output = context.createGain();
        
        const delayTime = 0.100; 
        const baseDelay = delayTime / 2;
        
        const delay1 = context.createDelay(delayTime);
        const delay2 = context.createDelay(delayTime);
        
        delay1.delayTime.value = baseDelay;
        delay2.delayTime.value = baseDelay;
        
        const gain1 = context.createGain();
        const gain2 = context.createGain();
        
        const mod1 = context.createOscillator();
        const mod2 = context.createOscillator();
        mod1.type = 'sawtooth';
        mod2.type = 'sawtooth';
        
        const modGain1 = context.createGain();
        const modGain2 = context.createGain();
        
        modGain1.gain.value = 0;
        modGain2.gain.value = 0;
        
        mod1.connect(modGain1);
        modGain1.connect(delay1.delayTime);
        
        mod2.connect(modGain2);
        modGain2.connect(delay2.delayTime);
        
        input.connect(delay1);
        input.connect(delay2);
        
        delay1.connect(gain1);
        delay2.connect(gain2);
        
        gain1.connect(output);
        gain2.connect(output);
        
        const now = context.currentTime;
        mod1.start(now);
        mod2.start(now);
        
        mod1.frequency.value = 0;
        mod2.frequency.value = 0;
        gain1.gain.value = 1.0;
        gain2.gain.value = 0.0;

        return {
            input: input,
            output: output,
            setPitch: function(semitones) {
                if (semitones === 0) {
                    mod1.frequency.value = 0;
                    mod2.frequency.value = 0;
                    modGain1.gain.value = 0;
                    modGain2.gain.value = 0;
                    gain1.gain.value = 1.0;
                    gain2.gain.value = 0.0;
                    return;
                }
                
                const factor = Math.pow(2, semitones / 12);
                const pitchMultiplier = factor - 1;
                const frequency = -pitchMultiplier / delayTime;
                
                mod1.frequency.value = frequency;
                mod2.frequency.value = frequency;
                
                modGain1.gain.value = baseDelay;
                modGain2.gain.value = baseDelay;
                
                gain1.gain.value = 0.5;
                gain2.gain.value = 0.5;
            }
        };
    }

    assets.setupAudioToolsListeners = function() {
        bindRecLifecycleOnce();
        bindMasterAudioEvents();
    };

    // Initialize listeners when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', assets.setupAudioToolsListeners);
    } else {
        assets.setupAudioToolsListeners();
    }

    assets.renameAttachment = function(songId, assetId, newName) {
        if (!assetId || !newName) return false;
        const cleanName = String(newName).trim();
        if (!cleanName) return false;
        if (typeof library !== 'undefined' && Array.isArray(library)) {
            library.forEach(s => {
                if (!s || (songId && s.id !== songId)) return;
                if (Array.isArray(s.attachments)) {
                    s.attachments.forEach(att => {
                        if (att && String(att.id) === String(assetId)) att.name = cleanName;
                    });
                }
            });
        }
        if (typeof window.syncScoreTagsOnAssetRename === 'function') {
            window.syncScoreTagsOnAssetRename(assetId, cleanName);
        }
        if (typeof assets.renderAttachments === 'function') assets.renderAttachments();
        return true;
    };

    // --- Aliases ---
    window.renameAttachment = assets.renameAttachment;
    window.openAssetManager = assets.openManager;
    window.closeAssetManager = assets.closeManager;
    window.switchAssetManagerTab = assets.switchTab;
    window.loadUserAssets = assets.loadUserAssets;
    window.renderAssetManagerList = assets.renderManagerList;
    window.attachSelectedAssets = assets.attachSelected;
    window.handleGlobalUpload = assets.handleUpload;
    window.attachExistingAsset = assets.attachExisting;
    window.deleteAssetFromLibrary = assets.deleteFromLibrary;
    window.downloadAssetLocal = assets.downloadLocal;
    window.deleteMediaItem = assets.detachFromSong;
    window.renderRecordingsList = assets.renderRecordings;
    window.renderAttachmentsList = assets.renderAttachments;
    window.playAudio = assets.playAudio;
    window.skipAudio = assets.skipAudio;
    window.closeCustomPlayer = assets.closeCustomPlayer;
    window.toggleRecording = assets.toggleRecording;
    window.discardCurrentRecording = assets.discardRecording;
    window.uploadAndLinkCurrent = assets.uploadRecording;
    window.promptAddWebLink = assets.promptAddWebLink;
    window.togglePreviewRecording = assets.togglePreviewRecording;
    window.renameRecordingItem = assets.renameRecording;

})(window.mNotes.ui.assets);

