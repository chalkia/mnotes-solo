/**
 * mNotes Setlist Manager Module
 */

window.mNotes = window.mNotes || {};
window.mNotes.logic = window.mNotes.logic || {};
window.mNotes.logic.setlists = window.mNotes.logic.setlists || {};
window.mNotes.ui = window.mNotes.ui || {};
window.mNotes.ui.setlists = window.mNotes.ui.setlists || {};

(function(logic, ui) {

    // --- LOGIC SECTION ---

    logic.getStorageKey = function() {
        return currentGroupId === 'personal' ? 'mnotes_personal_setlists' : `mnotes_band_setlists_${currentGroupId}`;
    };

    logic.getActiveNameKey = function() {
        return currentGroupId === 'personal' ? 'mnotes_active_personal_setlist' : `mnotes_active_band_setlist_${currentGroupId}`;
    };

    logic.init = async function() {
        console.log(`[SETLISTS] Αρχικοποίηση λιστών για context: ${currentGroupId}`);
        const storageKey = logic.getStorageKey();
        
        allSetlists = JSON.parse(localStorage.getItem(storageKey)) || {};
        
        if (typeof currentUser !== 'undefined' && currentUser && navigator.onLine) {
            try {
                if (currentGroupId === 'personal') {
                    const { data } = await supabaseClient.from('profiles').select('setlists').eq('id', currentUser.id).maybeSingle();
                    if (data && data.setlists) {
                        let hasChanges = false;
                        const now = new Date();
                        for (const listName in data.setlists) {
                            const list = data.setlists[listName];
                            if (list.type === 'shared' && list.expires_at) {
                                if (new Date(list.expires_at) <= now) {
                                    delete data.setlists[listName];
                                    hasChanges = true;
                                    console.log(`[SETLISTS] Η shared λίστα ${listName} έληξε και διαγράφηκε.`);
                                }
                            }
                        }
                        allSetlists = data.setlists;
                        safeSetLocal(storageKey, JSON.stringify(allSetlists));
                        if (hasChanges) {
                            await supabaseClient.from('profiles').update({ setlists: allSetlists }).eq('id', currentUser.id);
                        }
                        console.log("[SETLISTS] Οι προσωπικές λίστες συγχρονίστηκαν από το Cloud.");
                    }
                } else {
                    const { data } = await supabaseClient.from('groups').select('setlists').eq('id', currentGroupId).maybeSingle();
                    if (data && data.setlists && Object.keys(data.setlists).length > 0) {
                        allSetlists = data.setlists;
                        // Διασφάλιση ότι ο Κάδος υπάρχει και είναι στη σωστή μορφή
                        if (!allSetlists["🗑️ Κάδος"]) allSetlists["🗑️ Κάδος"] = { type: 'local', songs: [] };
                        
                        safeSetLocal(storageKey, JSON.stringify(allSetlists));
                        console.log(`[SETLISTS] Οι λίστες της μπάντας (${currentGroupId}) συγχρονίστηκαν από το Cloud.`);
                        
                        // Επανεκτίμηση της ενεργής λίστας μετά το συγχρονισμό για αποφυγή του Κάδου
                        const activeNameKey = logic.getActiveNameKey();
                        let currentName = localStorage.getItem(activeNameKey);
                        if (!currentName || !allSetlists[currentName] || currentName === "🗑️ Κάδος") {
                             const keys = Object.keys(allSetlists);
                             currentName = keys.find(k => k !== "🗑️ Κάδος") || keys[0];
                             safeSetLocal(activeNameKey, currentName);
                        }
                    }
                }
            } catch (err) { 
                console.error("[SETLISTS] Σφάλμα κατά το συγχρονισμό:", err); 
            }
        }
            
        if (Object.keys(allSetlists).length === 0) { 
            allSetlists["Default Setlist"] = { type: 'local', songs: [] }; 
        }
            
        if (!window.activeGuestInvite && !allSetlists["🗑️ Κάδος"]) {
            allSetlists["🗑️ Κάδος"] = { type: 'local', songs: [] };
        }
        
        Object.keys(allSetlists).forEach(key => { 
            if (Array.isArray(allSetlists[key])) allSetlists[key] = { type: 'local', songs: allSetlists[key] }; 
        });
        
        const activeNameKey = logic.getActiveNameKey();
        var currentSetlistName = localStorage.getItem(activeNameKey);
        
        // Αν δεν υπάρχει αποθηκευμένη ή αν είναι ο Κάδος, προσπάθησε να βρεις μια άλλη
        if (!currentSetlistName || !allSetlists[currentSetlistName] || currentSetlistName === "🗑️ Κάδος") {
            const keys = Object.keys(allSetlists);
            currentSetlistName = keys.find(k => k !== "🗑️ Κάδος") || keys[0];
        }
        
        let rawSongs = allSetlists[currentSetlistName].songs || [];
        liveSetlist = rawSongs.map(item => {
            if (typeof item === 'object' && item !== null) {
                return item.id;
            }
            return item; 
        }).filter(Boolean); 
        
        ui.updateDropdown();
    };

    logic.save = async function(activeName) {
        const activeNameKey = logic.getActiveNameKey();
        var name = activeName || localStorage.getItem(activeNameKey);
        if(allSetlists[name]) allSetlists[name].songs = liveSetlist;
        
        safeSetLocal(logic.getStorageKey(), JSON.stringify(allSetlists));
        if (activeName) safeSetLocal(activeNameKey, activeName);
        
        if (typeof currentUser !== 'undefined' && currentUser && navigator.onLine) {
            if (currentGroupId === 'personal') {
                supabaseClient.from('profiles').update({ setlists: allSetlists }).eq('id', currentUser.id).then(({error}) => {
                    if (error) console.error("[SETLISTS] Cloud Setlist Update Error:", error);
                });
            } else {
                const isGod = roleCan('UPDATE_BAND_SETLIST');
                if (isGod) {
                    supabaseClient.from('groups').update({ setlists: allSetlists }).eq('id', currentGroupId).then(({error}) => {
                        if (error) console.error("[SETLISTS] Band Setlist Update Error:", error);
                    });
                }
            }
        }
    };

    logic.create = async function() {
        const isBandViewer = (currentGroupId !== 'personal' && !roleCan('CREATE_BAND_SETLIST'));
        if (isBandViewer) {
            showToast(t('msg_err_create_list_band'), "error");
            return;
        }

        if (currentGroupId === 'personal') {
            const customListsCount = Object.keys(allSetlists).length - 1; 
            if (typeof canUserPerform === 'function' && !canUserPerform('CREATE_SETLIST', customListsCount)) {
                if (typeof promptUpgrade === 'function') promptUpgrade(t('msg_create_multi_lists'));
                else if (window.mDialog) await window.mDialog.alert({ message: t('msg_err_max_lists'), tone: 'warning' });
                else alert(t('msg_err_max_lists'));
                return; 
            }
        }

        const rawName = window.mDialog
            ? await window.mDialog.prompt({
                title: t('btn_new_list_title', 'Νέα Λίστα'),
                message: t('msg_new_setlist_name'),
                defaultValue: '',
                okText: t('btn_save', 'Αποθήκευση')
            })
            : prompt(t('msg_new_setlist_name'));
        const name = rawName ? rawName.trim() : '';
        if (name && !allSetlists[name]) {
            allSetlists[name] = { type: 'local', songs: [] }; 
            liveSetlist = []; 
            ui.switch(name);
            logic.save(name);
            ui.updateDropdown();
        } else if (name && allSetlists[name]) {
            showToast(t('msg_err_list_exists'), 'warning');
        }
    };

    logic.rename = async function() {
        var currentSetlistName = localStorage.getItem(logic.getActiveNameKey());
        const rawNewName = window.mDialog
            ? await window.mDialog.prompt({
                title: t('btn_rename_title', 'Μετονομασία Λίστας'),
                message: t('msg_rename_setlist_prompt'),
                defaultValue: currentSetlistName || '',
                selectOnOpen: true,
                okText: t('btn_save', 'Αποθήκευση')
            })
            : prompt(t('msg_rename_setlist_prompt'), currentSetlistName);
        const newName = rawNewName ? rawNewName.trim() : '';
        if (newName && newName !== currentSetlistName && !allSetlists[newName]) {
            allSetlists[newName] = allSetlists[currentSetlistName]; 
            delete allSetlists[currentSetlistName];
            safeSetLocal(logic.getActiveNameKey(), newName); 
            logic.save(newName); 
            ui.updateDropdown();
        }
    };

    logic.delete = async function() {
        var currentSetlistName = localStorage.getItem(logic.getActiveNameKey());
        if (Object.keys(allSetlists).length <= 1) { 
            showToast(t('msg_err_delete_last_list')); 
            return; 
        }
        const msg = t('msg_confirm_delete_list').replace('{name}', currentSetlistName);
        const confirmed = window.mDialog
            ? await window.mDialog.dangerConfirm({
                title: t('btn_delete_title', 'Διαγραφή Λίστας'),
                message: msg,
                dangerText: t('btn_delete', 'Διαγραφή')
            })
            : confirm(msg);
        if (confirmed) {
            delete allSetlists[currentSetlistName]; 
            const fallbackName = Object.keys(allSetlists)[0];
            ui.switch(fallbackName); 
            logic.save(fallbackName); 
            ui.updateDropdown();
        }
    };

    logic.toggleSong = function(e, id) { 
        if (e) e.stopPropagation(); 
        
        if (isSetlistLocked) {
            showToast(t('msg_setlist_locked'), "warning");
            return;
        }
        
        const isBandViewer = (currentGroupId !== 'personal' && !roleCan('EDIT_BAND_SETLIST'));
        if (isBandViewer) {
            showToast(t('msg_err_edit_list_band'), "error");
            return;
        }

        var i = liveSetlist.indexOf(id);
        if (i > -1) {
            const sel = document.getElementById('selSetlistName');
            if (sel && sel.value === '🗑️ Κάδος' && typeof window.canRestoreFromTrash === 'function' && !window.canRestoreFromTrash(id)) {
                return;
            }
            liveSetlist.splice(i, 1);
        } else {
            liveSetlist.push(id);
        }
        logic.save();
        renderSidebar();
        // Ανανεώνεται πάντα, όχι μόνο σε προβολή λίστας: το μενού ρυθμίζει και
        // την κατάσταση των κουμπιών (διαγραφή, μετονομασία, μοίρασμα) μέσω του
        // updateButtons, που πρέπει να ακολουθεί την τρέχουσα λίστα.
        ui.updateDropdown();
    };

    logic.toggleLock = function() {
        isSetlistLocked = !isSetlistLocked;
        const icon = document.getElementById('setlistLockIcon');
        const btn = document.getElementById('btnLockSetlist');
        
        if (isSetlistLocked) {
            if (icon) icon.className = "fas fa-lock";
            if (btn) btn.classList.add('active');
            showToast(t('msg_setlist_locked_on'));
        } else {
            if (icon) icon.className = "fas fa-lock-open";
            if (btn) btn.classList.remove('active');
            showToast(t('msg_setlist_locked_off'));
        }
        renderSidebar();
    };

    logic.generateInvite = async function() {
        if (typeof currentUser === 'undefined' || !currentUser || window.activeGuestInvite) {
            showToast(t('msg_account_needed_to_invite', 'Πρέπει να έχετε δημιουργήσει λογαριασμό (τουλάχιστον solo_free) για να προσκαλέσετε άτομα.'), 'error');
            return;
        }

        if (!navigator.onLine) {
            showToast(t('msg_req_internet', 'Απαιτείται σύνδεση στο Internet'), 'error');
            return;
        }
        
        var currentSetlistName = localStorage.getItem(logic.getActiveNameKey());
        if (!currentSetlistName || currentSetlistName === "🗑️ Κάδος") {
            showToast(t('msg_pick_valid_list', 'Επιλέξτε μια έγκυρη λίστα.'), 'warning');
            return;
        }

        // Αυστηρά 48 ώρες για Guest Singers (Πρόσκληση Παρέας)
        let expiresAt = new Date();
        expiresAt.setHours(expiresAt.getHours() + 48);

        const btn = document.getElementById('btnShareSetlist');
        if (btn) btn.classList.add('pulse-anim');

        try {
            const inviteData = {
                setlist_name: currentSetlistName,
                group_id: currentGroupId === 'personal' ? null : currentGroupId,
                created_by: currentUser.id,
                expires_at: expiresAt.toISOString()
            };

            const { data, error } = await supabaseClient
                .from('setlist_invites')
                .insert([inviteData])
                .select('id')
                .single();

            if (error) throw error;

            const inviteId = data.id;
            const inviteUrl = new URL('index.html?invite=' + encodeURIComponent(inviteId), window.location.href).href;
            const qrUrl = 'https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=' + encodeURIComponent(inviteUrl);

            document.getElementById('inviteSetlistName').innerText = currentSetlistName;
            document.getElementById('inviteLinkInput').value = inviteUrl;
            document.getElementById('inviteQrImage').src = qrUrl;
            document.getElementById('setlistInviteModal').style.display = 'flex';
        } catch (err) {
            console.error('Error generating invite:', err);
            showToast(t('msg_err_invite_create', 'Σφάλμα κατά τη δημιουργία πρόσκλησης'), 'error');
        } finally {
            if (btn) btn.classList.remove('pulse-anim');
        }
    };

    logic.navigate = function(dir) {
        if (!visiblePlaylist || visiblePlaylist.length === 0) { 
            showToast(t('msg_list_empty_toast')); 
            return; 
        }
        let currentIndex = visiblePlaylist.findIndex(s => s.id === currentSongId);
        let newIndex = currentIndex + dir;
        
        if (newIndex >= 0 && newIndex < visiblePlaylist.length) { 
            loadSong(visiblePlaylist[newIndex].id); 
        } else { 
            showToast(dir > 0 ? t('msg_list_end') : t('msg_list_start')); 
        }
    };

    // --- UI SECTION ---

    ui.updateDropdown = function() {
        const sel = document.getElementById('selSetlistName'); 
        if(!sel) return; 
        sel.innerHTML = "";
        
        var currentSetlistName = localStorage.getItem(logic.getActiveNameKey());
        Object.keys(allSetlists).forEach(name => {
            const opt = document.createElement('option'); opt.value = name;
            let icon = (currentGroupId !== 'personal') ? '👥' : '📝';
            if (name === "🗑️ Κάδος") icon = '🗑️';
            // Χωρίς πλήθος δίπλα στο όνομα. Το πλήθος υπάρχει ήδη στην κορυφή,
            // και τα δύο νούμερα μετρούσαν ΔΙΑΦΟΡΕΤΙΚΑ πράγματα: εδώ τα ωμά
            // αναγνωριστικά της λίστας, εκεί όσα τραγούδια πραγματικά
            // εμφανίζονται. Όταν η λίστα κρατούσε αναγνωριστικό τραγουδιού που
            // δεν υπάρχει πια, τα δύο διαφωνούσαν — και το «λάθος» ήταν εδώ.
            opt.innerText = name === "🗑️ Κάδος" ? name : `${icon} ${name}`;
            if(name === currentSetlistName) opt.selected = true;
            sel.appendChild(opt);
        });
        ui.updateButtons();

        const btnEmptyTrash = document.getElementById('btnEmptyTrash');
        const setlistArea = document.getElementById('setlist-controls');
        const isTrash = (viewMode === 'setlist' && currentSetlistName === "🗑️ Κάδος");
        if (btnEmptyTrash) btnEmptyTrash.style.display = isTrash ? 'inline-flex' : 'none'; 
        if (setlistArea) {
            if (isTrash) setlistArea.classList.add('trash-mode');
            else setlistArea.classList.remove('trash-mode');
        }
    };

    ui.updateButtons = function() {
        var currentSetlistName = localStorage.getItem(logic.getActiveNameKey());
        const isTrash = (currentSetlistName === "🗑️ Κάδος");
        const isBandViewer = (currentGroupId !== 'personal' && !roleCan('EDIT_BAND_SETLIST'));
        const btnDel = document.getElementById('btnDelSetlist'); 
        const btnRen = document.getElementById('btnRenSetlist');
        const btnShare = document.getElementById('btnShareSetlist');
        const btnTransfer = document.getElementById('btnTransferSetlist');

        if(btnDel) { 
            btnDel.style.display = isTrash ? 'none' : 'inline-flex';
            btnDel.disabled = isBandViewer; 
            btnDel.style.opacity = isBandViewer ? '0.3' : '1'; 
        }
        if(btnRen) { 
            btnRen.style.display = isTrash ? 'none' : 'inline-flex';
            btnRen.disabled = isBandViewer; 
            btnRen.style.opacity = isBandViewer ? '0.3' : '1'; 
        }
        if (btnShare) {
            const canShare = roleCan('SHARE_SETLIST') && !isTrash;
            btnShare.style.display = canShare ? 'inline-flex' : 'none';

            if (btnTransfer) {
                // To perfectly align the btnTransferSetlist (flex:0.5) with the trash button below (flex:0.5),
                // we need to dynamically adjust selSetlistName's flex based on how many buttons are visible below.
                // If canShare is true, there are 6 buttons below (5 * flex:1 + 1 * flex:0.5 = 5.5 total).
                // If canShare is false, there are 5 buttons below (4 * flex:1 + 1 * flex:0.5 = 4.5 total).
                const selSetlistName = document.getElementById('selSetlistName');
                if (selSetlistName) {
                    selSetlistName.style.flex = canShare ? '5' : '4';
                }
            }
        }
        if (btnTransfer) {
            // Transfer logic follows rename logic: you need permission to manage setlists
            btnTransfer.style.display = isTrash ? 'none' : 'flex';
            btnTransfer.disabled = isBandViewer;
            btnTransfer.style.opacity = isBandViewer ? '0.3' : '1';
        }
    };

    ui.switch = function(name) {
        if(!allSetlists[name]) return;
        let rawSongs = allSetlists[name].songs || [];
        liveSetlist = rawSongs.map(item => {
            if (typeof item === 'object' && item !== null) {
                return item.id;
            }
            return item;
        }).filter(Boolean);
        safeSetLocal(logic.getActiveNameKey(), name);
        if (typeof renderSidebar === 'function') renderSidebar(); 
        ui.updateButtons();
    };

    ui.switchTab = function(mode) {
        viewMode = mode;
        if (typeof saveAppState === 'function') saveAppState(null, null, mode);
        document.querySelectorAll('.sidebar-tabs .tab-btn').forEach(b => b.classList.remove('active'));
        const tabBtn = document.getElementById(`tab-${mode}`);
        if(tabBtn) tabBtn.classList.add('active');
        
        const libCtrl = document.getElementById('library-controls');
        const setCtrl = document.getElementById('setlist-controls');
        const btnEmptyTrash = document.getElementById('btnEmptyTrash');

        if (mode === 'setlist') {
            // Τα φίλτρα ζουν μόνο στη βιβλιοθήκη. Στη λίστα έπιαναν ~95px στη
            // σκηνή, και τα dropdowns tag/sort είναι ούτως ή άλλως άχρηστα εκεί
            // (η λίστα έχει δική της σειρά εκτέλεσης). Ένα ενεργό φίλτρο
            // ΕΞΑΚΟΛΟΥΘΕΙ να ισχύει — το δηλώνει το #setlistFilterNotice. (05/09/2026)
            if(libCtrl) libCtrl.style.display = 'none';
            if(setCtrl) { setCtrl.style.display = 'flex'; ui.updateDropdown(); }
        } else {
            if(libCtrl) libCtrl.style.display = 'flex';
            if(setCtrl) setCtrl.style.display = 'none';
            if (btnEmptyTrash) btnEmptyTrash.style.display = 'none';
        }
        renderSidebar();
    };

    // --- Aliases for backward compatibility ---
    window.initSetlists = logic.init;
    window.updateSetlistDropdown = ui.updateDropdown;
    window.updateSetlistButtons = ui.updateButtons;
    window.switchSetlist = ui.switch;
    window.createSetlist = logic.create;
    window.renameSetlist = logic.rename;
    window.deleteSetlist = logic.delete;
    window.saveSetlists = logic.save;
    window.toggleSetlistSong = logic.toggleSong;
    window.toggleSetlistLock = logic.toggleLock;
    window.switchSidebarTab = ui.switchTab;
    window.navSetlist = logic.navigate;
    window.generateSetlistInvite = logic.generateInvite;

    logic.transferSetlist = async function(targetGroupId, action) {
        if (!canUserPerform('USE_SUPABASE')) {
            if(typeof promptUpgrade === 'function') promptUpgrade(t('msg_share_band', 'Κοινοποίηση σε Μπάντα'));
            return;
        }

        const currentSetlistName = localStorage.getItem(logic.getActiveNameKey());
        if (!currentSetlistName || currentSetlistName === 'Default' || !allSetlists[currentSetlistName]) {
            showToast(t('msg_no_setlist_selected', "Δεν υπάρχει ενεργό Setlist για μεταφορά."), "error");
            return;
        }

        const sourceList = allSetlists[currentSetlistName];
        if (!sourceList.songs || sourceList.songs.length === 0) {
            showToast(t('msg_transfer_empty', "Το Setlist είναι άδειο."), "warning");
            return;
        }

        // --- Βήμα 1: Συλλογή πληροφοριών για τα τραγούδια του Setlist ---
        const missingSongs = [];
        const outOfSyncSongs = [];
        const targetSongIds = [];

        // Φέρνουμε ΟΛΑ τα τραγούδια του προορισμού μια φορά για να κάνουμε match
        const { data: targetSongs, error: fetchErr } = await supabaseClient
            .from('songs')
            .select('id, parent_id, title, artist, updated_at')
            .eq('group_id', targetGroupId);

        if (fetchErr) {
            showToast(t('msg_cloud_err', "Σφάλμα σύνδεσης με το Cloud."), "error");
            return;
        }

        for (const rawItem of sourceList.songs) {
            const songId = typeof rawItem === 'object' ? rawItem.id : rawItem;
            const sourceSong = library.find(s => s.id === songId);
            
            if (!sourceSong) continue; // Αν λείπει τοπικά, το προσπερνάμε απλά
            const masterId = sourceSong.parent_id || sourceSong.id;

            // --- Βήμα 2: Εύρεση στον προορισμό (DNA / Fallback) ---
            let match = targetSongs.find(ts => ts.id === masterId || ts.parent_id === masterId);
            
            if (!match) {
                // Fallback by title and artist
                match = targetSongs.find(ts => 
                    ts.title.trim().toLowerCase() === sourceSong.title.trim().toLowerCase() && 
                    ((!ts.artist && !sourceSong.artist) || (ts.artist && sourceSong.artist && ts.artist.trim().toLowerCase() === sourceSong.artist.trim().toLowerCase()))
                );
            }

            if (!match) {
                missingSongs.push(sourceSong.title);
                continue;
            }

            // --- Βήμα 3: Έλεγχος Συγχρονισμού ---
            const sourceDate = new Date(sourceSong.updated_at).getTime();
            const targetDate = new Date(match.updated_at).getTime();

            // Αν η διαφορά είναι > 5 δευτερόλεπτα, θεωρούμε ότι είναι διαφορετικές εκδόσεις
            if (Math.abs(sourceDate - targetDate) > 5000) {
                outOfSyncSongs.push(sourceSong.title);
            }

            targetSongIds.push(match.id);
        }

        // --- Βήμα 4: Αξιολόγηση Αποτελεσμάτων ---
        if (missingSongs.length > 0) {
            const errBase = t('msg_transfer_missing', "Λείπουν τραγούδια από τον προορισμό: ");
            const errInst = t('msg_transfer_missing_inst', "Παρακαλώ μεταφέρετε τα τραγούδια πρώτα.");
            showToast(`${errBase}${missingSongs.slice(0,3).join(', ')}${missingSongs.length>3?'...':''}\n\n${errInst}`, "error");
            return;
        }

        if (outOfSyncSongs.length > 0) {
            const warnBase = t('msg_transfer_sync', "Υπάρχουν ασυμφωνίες εκδόσεων στα: ");
            const warnInst = t('msg_transfer_sync_inst', "Χρησιμοποιήστε το mStudio (Auditor) για συγχρονισμό.");
            showToast(`${warnBase}${outOfSyncSongs.slice(0,3).join(', ')}${outOfSyncSongs.length>3?'...':''}\n\n${warnInst}`, "warning");
            return;
        }

        // Όλα καλά, αποθήκευση του νέου setlist στον προορισμό
        try {
            let targetSetlists = {};
            if (targetGroupId === 'personal') {
                const { data: pData } = await supabaseClient.from('profiles').select('setlists').eq('id', currentUser.id).single();
                if (pData && pData.setlists) targetSetlists = pData.setlists;
            } else {
                const { data: gData } = await supabaseClient.from('groups').select('setlists').eq('id', targetGroupId).single();
                if (gData && gData.setlists) targetSetlists = gData.setlists;
            }

            // Αποθηκεύουμε τα targetSongIds στο setlist (διατηρώντας τη σειρά)
            targetSetlists[currentSetlistName] = {
                type: 'local',
                songs: targetSongIds
            };

            if (targetGroupId === 'personal') {
                await supabaseClient.from('profiles').update({ setlists: targetSetlists }).eq('id', currentUser.id);
            } else {
                await supabaseClient.from('groups').update({ setlists: targetSetlists }).eq('id', targetGroupId);
            }
            
            // Notify Main Library to reload
            if(typeof forceReloadAndMaintainState === 'function') {
                window.location.reload();
            }

            const succMsg = t('msg_transfer_success', "Η μεταφορά της λίστας ολοκληρώθηκε επιτυχώς!");
            showToast(`${succMsg} ('${currentSetlistName}')`, "success");
        } catch (err) {
            showToast(t('msg_err_save', "Σφάλμα κατά την αποθήκευση: ") + err.message, "error");
        }
    };

    window.transferSetlist = logic.transferSetlist;

})(window.mNotes.logic.setlists, window.mNotes.ui.setlists);
