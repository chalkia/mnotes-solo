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

    // --- Core Functions ---

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
        const typeInp = document.getElementById('assetManagerCurrentType');
        if (typeInp) typeInp.value = type;
        
        const modal = document.getElementById('assetManagerModal');
        if (modal) modal.style.display = 'flex';
        
        assets.loadUserAssets(type);
    };

    assets.closeManager = function() {
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
        listContainer.innerHTML = `<div class="empty-state">Φόρτωση αρχείων... / Loading...</div>`;

        const isReadOnly = (typeof canUserPerform === 'function' && !canUserPerform('SAVE_ATTACHMENTS'));

        try {
            const { data: { session } } = await supabaseClient.auth.getSession();
            if (!session) {
                listContainer.innerHTML = `<div class="empty-state">Παρακαλώ συνδεθείτε / Please login.</div>`;
                return;
            }
            const uid = session.user.id;

            console.log(`[AssetManager] Querying for user: ${uid}`);
            
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
            
            console.log(`[AssetManager] DB returned ${userData ? userData.length : 0} total assets for this user.`);

            // 2. Φιλτράρισμα βάσει τύπου στο frontend για μέγιστη σιγουριά
            let filtered = (userData || []).filter(asset => {
                const fType = (asset.file_type || "").toLowerCase();
                if (type === 'visuals') {
                    return ['document', 'score', 'image'].includes(fType) || (asset.file_url && asset.file_url.toLowerCase().includes('.abc'));
                }
                return fType === type.toLowerCase();
            });

            console.log(`[AssetManager] Filtered ${filtered.length} assets for type: ${type}`);

            // Ταξινόμηση
            filtered.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
            const data = filtered;

            let vaultBanner = '';
            const uploadSection = document.getElementById('assetUploadSection'); 

            if (isReadOnly && data && data.length > 0) {
                vaultBanner = `
                    <div style="background: rgba(255, 193, 7, 0.15); border: 1px solid #ffc107; color: #ffc107; padding: 10px; border-radius: 6px; margin-bottom: 15px; font-size: 0.85rem; text-align: center;">
                        <i class="fas fa-snowflake"></i> <b>Παγωμένος Χώρος:</b> Το πακέτο σας άλλαξε σε Free. 
                        Τα αρχεία σας είναι ασφαλή, μπορείτε να τα κατεβάσετε, αλλά δεν μπορείτε να τα προσθέσετε σε νέα τραγούδια.
                    </div>
                `;
                if (uploadSection) uploadSection.style.display = 'none';
            } else {
                if (uploadSection) uploadSection.style.display = 'block';
            }

            if (!data || data.length === 0) {
                listContainer.innerHTML = vaultBanner + `<div class="empty-state">Δεν βρέθηκαν αρχεία / No files found.</div>`;
                return;
            }

            const listHtml = data.map(asset => {
                let itemIcon = 'fas fa-file';
                if (asset.file_type === 'audio') itemIcon = 'fas fa-music';
                else if (asset.file_type === 'rhythm') itemIcon = 'fas fa-drum';
                else if (asset.file_type === 'score' || asset.file_url.toLowerCase().includes('.abc?') || asset.file_url.toLowerCase().endsWith('.abc')) itemIcon = 'fas fa-file-musical';
                else if (asset.file_type === 'document') itemIcon = 'fas fa-image';

                const ownerTag = (currentGroupId !== 'personal' && asset.user_id === currentUser.id) 
                    ? '<span style="font-size:0.65rem; color:var(--accent); margin-left:5px;">(Εσύ)</span>' : '';

                const attachBtn = isReadOnly ? '' : `
                    <button onclick="attachExistingAsset('${asset.custom_name.replace(/'/g, "\\'")}', '${asset.file_url}')" class="add-mini-btn" title="Σύνδεση με το τραγούδι / Attach to song">
                        <i class="fas fa-link"></i>
                    </button>
                `;

                const canDelete = asset.user_id === currentUser.id || roleCan('DELETE_LIBRARY_ASSET');
                const deleteBtn = canDelete ? `
                    <button onclick="deleteAssetFromLibrary('${asset.id}', '${asset.file_url}', '${asset.custom_name.replace(/'/g, "\\'")}')" class="play-mini-btn" style="color: #dc3545; border-color: #dc3545;" title="Οριστική Διαγραφή / Delete">
                        <i class="fas fa-trash"></i>
                    </button>
                ` : '';

                const playBtn = (asset.file_type === 'audio') ? `
                    <button onclick="playAudio('${asset.file_url}', '${asset.custom_name.replace(/'/g, "\\'")}')" class="play-mini-btn" title="Προεπισκόπηση / Preview">
                        <i class="fas fa-play"></i>
                    </button>
                ` : '';

                return `
                <div style="display:flex; justify-content:space-between; align-items:center; padding:8px; border-bottom:1px solid var(--border-color);">
                    <span style="font-size:0.85rem; word-break:break-all;">
                        <i class="${itemIcon}" style="margin-right:5px; color:var(--accent);"></i> ${asset.custom_name} ${ownerTag}
                    </span>
                    <div style="display:flex; gap: 8px;">
                        ${playBtn}
                        <button onclick="downloadAssetLocal('${asset.file_url}', '${asset.custom_name.replace(/'/g, "\\'")}')" class="play-mini-btn" title="Λήψη / Download" style="color: #28a745; border-color: #28a745;">
                            <i class="fas fa-download"></i>
                        </button>
                        ${attachBtn}
                        ${deleteBtn}
                    </div>
                </div>
            `}).join('');

            listContainer.innerHTML = vaultBanner + listHtml;

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
            const allowedVisuals = ['pdf', 'png', 'jpg', 'jpeg', 'abc', 'webp'];
            if (!allowedVisuals.includes(fileExt)) {
                showToast(t('msg_err_format_image_abc', "⚠️ Μη υποστηριζόμενη μορφή. Παρακαλώ επιλέξτε Εικόνα ή ABC."), "error");
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

        let currentBpm = 100;
        const bpmSlider = document.getElementById('rngBpm');
        if (bpmSlider) currentBpm = parseInt(bpmSlider.value);

        const newAssetObj = { id: Date.now(), name: name, url: url, date: Date.now(), bpm: currentBpm };
       
        if (type === 'audio') {
            if (!targetSong.recordings) targetSong.recordings = [];
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
            if (type === 'score') {
                newAssetObj.category = 'score';
            }
            targetSong.attachments.push(newAssetObj);
            
            if(typeof saveSong === 'function') saveSong(targetSong);
            
            if (currentSongId === targetSongId && typeof renderAttachmentsList === 'function') {
                renderAttachmentsList(targetSong.attachments);
            }
        }
    };

    assets.deleteFromLibrary = async function(assetId, fileUrl, assetName) {
        if (typeof window.soloDeleteFromLibrary === 'function') {
            return window.soloDeleteFromLibrary(assetId, fileUrl, assetName);
        }
        if (!(await window.mConfirm(`Διαγραφή του "${assetName}" (Μεταφορά στον κάδο);`, true))) return;

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

    assets.detachFromSong = async function(songId, listType, index) {
        if (!songId || typeof library === 'undefined') return;
        const song = library.find(s => s.id === songId);
        if (!song) return;

        if (currentGroupId !== 'personal' && !song.is_clone) {
            if (!roleCan('REMOVE_MASTER_ASSET')) {
                if (typeof showToast === 'function') showToast(t('msg_admins_only_remove_files', "Μόνο οι διαχειριστές μπορούν να αφαιρέσουν αρχεία από το κεντρικό τραγούδι."), "error");
                return;
            }
        }

        if (confirm(t('msg_remove_file_confirm', "Σίγουρα θέλετε να αφαιρέσετε αυτό το αρχείο από το τραγούδι;"))) {
            let list = typeof window.safeParse === 'function' ? window.safeParse(song[listType]) : song[listType] || [];
            if (typeof list === 'string') list = JSON.parse(list); // just in case
            
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
            }
        }
    };

    assets.renderRecordings = function(recs = []) {
        const listEl = document.getElementById('sideRecList'); 
        if (!listEl) return;
        
        listEl.innerHTML = ''; 
        let hasItems = false;
        
        recs.forEach((rec, index) => {
            const el = document.createElement('div'); 
            el.className = 'track-item'; 
            
            const isPrivate = (rec.origin === 'private' || !rec.origin);
            const colorVar = isPrivate ? '#ffb74d' : '#4db6ac'; 
            const iconClass = isPrivate ? 'fas fa-lock' : 'fas fa-globe';
            const tooltip = isPrivate ? t('ttl_private_track') : t('ttl_public_track');
            
            el.style.cssText = `display:flex; justify-content:space-between; align-items:center; background:var(--input-bg); padding:8px; margin-bottom:5px; border-radius:4px; border-left: 3px solid ${colorVar};`;
            
            const safeObjStr = encodeURIComponent(JSON.stringify(rec));
            


            const isOwnerOrAdmin = roleCan('DELETE_BAND_RECORDING');
            const canDelete = isPrivate || currentGroupId === 'personal' || isOwnerOrAdmin;

            let deleteBtnHtml = '';
            if (canDelete) {
                deleteBtnHtml = `<button onclick="deleteMediaItem('${currentSongId}', 'recordings', ${index})" style="background:none; border:none; color:var(--danger); cursor:pointer; padding:0 5px;" title="${t('btn_delete')}"><i class="fas fa-times"></i></button>`;
            }
             
            let downloadBtnHtml = '';
            const urlLower = (rec.url || "").toLowerCase();
            const isWebMedia = urlLower.includes("youtube.com") || urlLower.includes("youtu.be") || 
                               urlLower.includes("soundcloud.com") || urlLower.includes("spotify.com") || 
                               urlLower.includes("music.apple.com");
                               
            if (isWebMedia) {
                downloadBtnHtml = `<button onclick="window.open('${rec.url}', '_blank')" style="background:none; border:none; color:var(--accent); cursor:pointer; padding:0 8px; font-size:1rem;" title="${t('btn_open_external', 'Άνοιγμα Συνδέσμου / Open Link')}"><i class="fas fa-external-link-alt"></i></button>`;
            } else {
                downloadBtnHtml = `<button onclick="downloadAssetLocal('${rec.url}', '${rec.name || rec.label}')" style="background:none; border:none; color:#28a745; cursor:pointer; padding:0 8px; font-size:1rem;" title="${t('btn_download')}"><i class="fas fa-download"></i></button>`;
            }
            
           el.innerHTML = `
                <div onclick="playAudio('${rec.url}', '${(rec.name || rec.label || 'Unnamed Track').replace(/'/g, "\\'")}')" style="cursor:pointer; flex:1; display:flex; align-items:center; overflow:hidden;" title="${tooltip}">
                    <i class="${iconClass}" style="color:${colorVar}; margin-right:8px;"></i>
                    <span style="font-size:0.85rem; color:var(--text-main); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${rec.name || rec.label}</span>
                </div>
                <div style="display:flex; align-items:center;">
                    ${downloadBtnHtml}
                    ${deleteBtnHtml}
                </div>
            `;
            listEl.appendChild(el); 
            hasItems = true;
        });
        
        if (!hasItems) listEl.innerHTML = `<div class="empty-state">${t('msg_no_recordings')}</div>`;
    };

    assets.renderAttachments = function(docs = []) {
        const listEl = document.getElementById('list-visuals'); 
        if (!listEl) return;
        
        listEl.innerHTML = ''; 
        let hasItems = false;
        
        docs.forEach((doc, index) => {
            const el = document.createElement('div'); 
            el.className = 'track-item'; 
            
            const isPrivate = (doc.origin === 'private' || !doc.origin);
            const borderColor = isPrivate ? '#ffb74d' : '#9c27b0';
            const tooltip = isPrivate ? t('ttl_private_file') : t('ttl_public_file');
            
            el.style.cssText = `display:flex; justify-content:space-between; align-items:center; background:var(--input-bg); padding:8px; margin-bottom:5px; border-radius:4px; border-left: 3px solid ${borderColor};`;
            
            const isImage = (doc.type && doc.type.toLowerCase().includes('image')) || (doc.url && /\.(jpg|jpeg|png|webp|gif)(\?|$)/i.test(doc.url));
            const isABC = doc.url && (doc.url.toLowerCase().includes('.abc?') || doc.url.toLowerCase().endsWith('.abc'));
            const iconClass = isImage ? 'fas fa-image' : (isABC ? 'fas fa-file-musical' : 'fas fa-file-pdf');
            
            const safeObjStr = encodeURIComponent(JSON.stringify(doc));



            const isOwnerOrAdmin = roleCan('DELETE_BAND_ATTACHMENT');
            const canDelete = isPrivate || currentGroupId === 'personal' || isOwnerOrAdmin;

            let deleteBtnHtml = '';
            if (canDelete) {
                deleteBtnHtml = `<button onclick="deleteMediaItem('${currentSongId}', 'attachments', ${index})" style="background:none; border:none; color:var(--danger); cursor:pointer; padding:0 5px;" title="${t('btn_delete')}"><i class="fas fa-times"></i></button>`;
            }

            let downloadBtnHtml = `<button onclick="downloadAssetLocal('${doc.url}', '${doc.name}')" style="background:none; border:none; color:#28a745; cursor:pointer; padding:0 8px; font-size:1rem;" title="${t('btn_download')}"><i class="fas fa-download"></i></button>`;

            let clickAction = "";
            if (isABC) clickAction = `showScoreInLayer('${doc.url}', '${doc.name}')`;
            else if (isImage) clickAction = `showImageInLayer('${doc.url}', '${doc.name}')`;
            else clickAction = `FloatingTools.loadContent('${doc.url}', 'pdf')`;

            el.innerHTML = `
                <div onclick="${clickAction}" style="cursor:pointer; flex:1; display:flex; align-items:center; overflow:hidden;" title="${tooltip}">
                    <i class="${iconClass}" style="color:${borderColor}; margin-right:8px;"></i>
                    <span style="font-size:0.85rem; color:var(--text-main); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${doc.name}</span>
                </div>
                <div style="display:flex; align-items:center;">
                    ${downloadBtnHtml}
                    ${deleteBtnHtml}
                </div>
            `;
            listEl.appendChild(el);
            hasItems = true;
        });

        if (!hasItems) listEl.innerHTML = `<div class="empty-state">${t('msg_no_attachments')}</div>`;
    };

    assets.playAudio = function(url, title = "Playing Audio...") { 
        const audio = document.getElementById('masterAudio'); 
        
        const urlLower = (url || "").toLowerCase();
        const isWebMedia = urlLower.includes("youtube.com") || urlLower.includes("youtu.be") || 
                           urlLower.includes("soundcloud.com") || urlLower.includes("spotify.com") || 
                           urlLower.includes("music.apple.com");
                           
        if (isWebMedia) {
            if (audio) {
                audio.pause();
                audio.src = "";
            }
            
            const customUI = document.getElementById('customPlayerUI');
            if (customUI) customUI.style.display = 'none';
            
            const tools = document.getElementById('audio-tools-panel');
            if (tools) tools.style.display = 'none';
            
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

        if(audio) { 
            audio.src = url; 
            
            const customUI = document.getElementById('customPlayerUI');
            if (customUI) customUI.style.display = 'flex';
            
            const titleEl = document.getElementById('cpTitle');
            if (titleEl) titleEl.innerText = title;

            const icon = document.getElementById('cpPlayIcon');
            if (icon) { icon.classList.remove('fa-pause'); icon.classList.add('fa-play'); }
            
            const tools = document.getElementById('audio-tools-panel');
            if (tools) tools.style.display = 'block';

            const delay = (typeof userSettings !== 'undefined' && typeof userSettings.playDelay !== 'undefined') ? parseInt(userSettings.playDelay) : 0;
            if (delay > 0 && typeof window.runPlayCountdown === 'function') {
                window.runPlayCountdown(delay, () => {
                    assets.initAudioTools();
                    audio.play(); 
                    if (icon) { icon.classList.remove('fa-play'); icon.classList.add('fa-pause'); }
                }, () => {
                    audio.pause();
                    if (icon) { icon.classList.remove('fa-pause'); icon.classList.add('fa-play'); }
                });
            } else {
                assets.initAudioTools();
                audio.play(); 
                if (icon) { icon.classList.remove('fa-play'); icon.classList.add('fa-pause'); }
            }
        } 
    };

    assets.skipAudio = function(seconds) {
        const audio = document.getElementById('masterAudio');
        if (!audio) return;
        audio.currentTime = Math.max(0, Math.min(audio.duration, audio.currentTime + seconds));
    };

    assets.closeCustomPlayer = function() {
        const audio = document.getElementById('masterAudio');
        if (audio) {
            audio.pause();
            audio.src = "";
        }
        const customUI = document.getElementById('customPlayerUI');
        if (customUI) customUI.style.display = 'none';
        
        const tools = document.getElementById('audio-tools-panel');
        if (tools) tools.style.display = 'none';

        // Reset audio tools values
        activeSemitones = 0;
        const disp = document.getElementById('audioPitchDisplay');
        if (disp) disp.innerText = "0";
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
        if (typeof canUserPerform === 'function' && !canUserPerform('SAVE_ATTACHMENTS')) {
            if (typeof promptUpgrade === 'function') promptUpgrade(t('msg_record_save_audio', 'Εγγραφή & Αποθήκευση Ήχου'));
            return; 
        }

        const btn = document.getElementById('btnRecord');
        const timer = document.getElementById('recTimer');
        const btnLink = document.getElementById('btnLinkRec');

        if (assets.mediaRecorder && assets.mediaRecorder.state === 'recording') {
            assets.mediaRecorder.stop();
            btn.innerHTML = '<i class="fas fa-microphone"></i>';
            btn.classList.remove('recording-active');
            timer.style.color = "var(--text-muted)";
            clearInterval(assets.recTimerInterval);
            return;
        }
        
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ 
                audio: {
                    echoCancellation: false,
                    noiseSuppression: false,
                    autoGainControl: false
                    } 
            });
            assets.mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
            assets.audioChunks = []; assets.currentRecordedBlob = null;
            if(btnLink) btnLink.style.display = 'none';

            assets.mediaRecorder.ondataavailable = event => { assets.audioChunks.push(event.data); };
            assets.mediaRecorder.onstop = () => {
                assets.currentRecordedBlob = new Blob(assets.audioChunks, { type: 'audio/webm' });
                
                const audioUrl = URL.createObjectURL(assets.currentRecordedBlob);
                const masterPlayer = document.getElementById('masterAudio');
                if (masterPlayer) {
                    masterPlayer.src = audioUrl;
                    const customUI = document.getElementById('customPlayerUI');
                    if (customUI) customUI.style.display = 'flex'; 
                    const titleEl = document.getElementById('cpTitle');
                    if (titleEl) titleEl.innerText = t('msg_new_recording', "Νέα Εγγραφή...");
                }

                const btnLink = document.getElementById('btnLinkRec');
                const btnDiscard = document.getElementById('btnDiscardRec');
                
                if (currentSongId && typeof currentUser !== 'undefined' && currentUser) { 
                    if (btnLink) btnLink.style.display = 'flex'; 
                }
                
                if (btnDiscard) btnDiscard.style.display = 'flex';
            };
            assets.mediaRecorder.start();
            btn.classList.add('recording-active'); btn.innerHTML = '<i class="fas fa-stop"></i>'; timer.style.color = "var(--danger)"; 
            assets.recStartTime = Date.now(); 
            assets.recTimerInterval = setInterval(() => { 
                const diff = Math.floor((Date.now() - assets.recStartTime) / 1000); 
                const m = Math.floor(diff / 60).toString().padStart(2,'0'); 
                const s = (diff % 60).toString().padStart(2,'0'); 
                timer.innerText = `${m}:${s}`; 
            }, 1000);
        } catch (err) { alert(t('msg_mic_error', "Microphone Error: ") + err.message); }
    };

    assets.discardRecording = function() {
        const masterPlayer = document.getElementById('masterAudio');
        if (masterPlayer) {
            masterPlayer.src = "";
        }
        const customUI = document.getElementById('customPlayerUI');
        if (customUI) customUI.style.display = 'none';
        
        const btnLink = document.getElementById('btnLinkRec');
        const btnDiscard = document.getElementById('btnDiscardRec');
        if (btnLink) btnLink.style.display = 'none';
        if (btnDiscard) btnDiscard.style.display = 'none';
        
        const recTimer = document.getElementById('recTimer');
        if (recTimer) recTimer.innerText = "00:00";
        
        assets.audioChunks = [];
        assets.currentRecordedBlob = null;
        
        if (typeof showToast === 'function') showToast(t('msg_record_cancelled', "Η εγγραφή ακυρώθηκε. Δεν ανέβηκε τίποτα."));
    };

    assets.uploadRecording = async function() {
        if (!assets.currentRecordedBlob) { showToast(t('msg_no_recording', "No recording!")); return; }
        if (!currentSongId) { showToast(t('msg_select_song_first', "Select song first!")); return; }
        if (typeof currentUser === 'undefined' || !currentUser) { document.getElementById('authModal').style.display='flex'; return; }
        
        const targetSongId = currentSongId;
        const s = library.find(x => x.id === targetSongId);
        if (!s) return;

        if (!confirm(t('msg_save_rec_cloud', 'Save to "{title}" in Cloud?').replace('{title}', s.title))) return;
        
        const btnLink = document.getElementById('btnLinkRec');
        btnLink.innerHTML = '<i class="fas fa-spinner fa-spin"></i>'; 
        btnLink.style.opacity = '0.7';
        
        if (!s.recordings) s.recordings = [];
        const takeNum = s.recordings.length + 1;
        
        const assetLibraryName = `Mic Take ${takeNum} - ${s.title}`;
        const filename = `Mic_${targetSongId}_Take${takeNum}_${Date.now()}.webm`;

        try {
            const { error } = await supabaseClient.storage.from('audio_files').upload(`${currentUser.id}/${filename}`, assets.currentRecordedBlob);
            if (error) throw error; 

            const { data: { publicUrl } } = supabaseClient.storage.from('audio_files').getPublicUrl(`${currentUser.id}/${filename}`);
            
            const { error: dbErr } = await supabaseClient
                .from('user_assets')
                .insert([{
                    user_id: currentUser.id,
                    custom_name: assetLibraryName,
                    file_url: publicUrl,
                    file_type: 'audio'
                }]);
            if (dbErr) console.warn("Asset Library Warning:", dbErr); 

            const newRec = { id: Date.now(), name: `Take ${takeNum}`, url: publicUrl, date: Date.now() };
            
            await assets.processAttachment(targetSongId, 'audio', newRec.name, newRec.url);
            
            showToast(t('msg_take_saved', "Take {num} Saved! ☁️").replace('{num}', takeNum));
            btnLink.style.display = 'none'; 
            
        } catch(e) {
             console.error("Upload Error:", e);
             showToast(t('msg_upload_error', "Upload Error: ") + e.message, "error");
        } finally {
            assets.currentRecordedBlob = null;
            btnLink.innerHTML = '<i class="fas fa-cloud-upload-alt"></i>';
            btnLink.style.opacity = '1';
            
            const btnDiscard = document.getElementById('btnDiscardRec');
            if (btnDiscard) btnDiscard.style.display = 'none';
            
            const masterPlayer = document.getElementById('masterAudio');
            if (masterPlayer) {
                masterPlayer.src = "";
                const customUI = document.getElementById('customPlayerUI');
                if (customUI) customUI.style.display = 'none';
            }
        }
    };
    assets.initAudioTools = function() {
        const audio = document.getElementById('masterAudio');
        if (!audio || audioCtx) return;

        try {
            const Ctx = window.AudioContext || window.webkitAudioContext;
            audioCtx = new Ctx();
            
            // Connect audio element
            audio.crossOrigin = "anonymous"; 
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
        const btnDown = document.getElementById('btnAudioPitchDown');
        const btnUp = document.getElementById('btnAudioPitchUp');
        const btnReset = document.getElementById('btnAudioPitchReset');
        const disp = document.getElementById('audioPitchDisplay');
        
        if (btnDown) {
            btnDown.onclick = function() {
                assets.initAudioTools();
                if (activeSemitones > -6) {
                    activeSemitones--;
                    if (disp) disp.innerText = (activeSemitones > 0 ? "+" : "") + activeSemitones;
                    if (pitchNode && typeof pitchNode.setPitch === 'function') {
                        pitchNode.setPitch(activeSemitones);
                    }
                }
            };
        }
        
        if (btnUp) {
            btnUp.onclick = function() {
                assets.initAudioTools();
                if (activeSemitones < 6) {
                    activeSemitones++;
                    if (disp) disp.innerText = (activeSemitones > 0 ? "+" : "") + activeSemitones;
                    if (pitchNode && typeof pitchNode.setPitch === 'function') {
                        pitchNode.setPitch(activeSemitones);
                    }
                }
            };
        }
        
        if (btnReset) {
            btnReset.onclick = function() {
                assets.initAudioTools();
                activeSemitones = 0;
                if (disp) disp.innerText = "0";
                if (pitchNode && typeof pitchNode.setPitch === 'function') {
                    pitchNode.setPitch(0);
                }
            };
        }
    };

    // Initialize listeners when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', assets.setupAudioToolsListeners);
    } else {
        assets.setupAudioToolsListeners();
    }

    // --- Aliases ---
    window.openAssetManager = assets.openManager;
    window.closeAssetManager = assets.closeManager;
    window.switchAssetManagerTab = assets.switchTab;
    window.loadUserAssets = assets.loadUserAssets;
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

})(window.mNotes.ui.assets);

