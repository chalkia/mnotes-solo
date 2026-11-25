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

    logic.getActiveName = function() {
        const key = logic.getActiveNameKey();
        const raw = key ? localStorage.getItem(key) : null;
        if (typeof raw !== 'string' || !raw.trim() || raw === 'null' || raw === 'undefined') return null;
        if (typeof allSetlists !== 'object' || allSetlists === null || !Object.prototype.hasOwnProperty.call(allSetlists, raw)) return null;
        return raw;
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
        if (!currentSetlistName || !Object.prototype.hasOwnProperty.call(allSetlists, currentSetlistName) || currentSetlistName === "🗑️ Κάδος") {
            const keys = Object.keys(allSetlists);
            currentSetlistName = keys.find(k => k !== "🗑️ Κάδος") || keys[0];
            if (currentSetlistName) safeSetLocal(activeNameKey, currentSetlistName);
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
        var name = activeName || logic.getActiveName();
        if (name && Object.prototype.hasOwnProperty.call(allSetlists, name)) allSetlists[name].songs = liveSetlist;
        
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
        var currentSetlistName = logic.getActiveName();
        if (!currentSetlistName || currentSetlistName === "🗑️ Κάδος") {
            if (typeof showToast === 'function') showToast(t('msg_no_setlist_selected', 'Δεν υπάρχει ενεργή λίστα.'), 'error');
            return;
        }
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
        var currentSetlistName = logic.getActiveName();
        if (!currentSetlistName) {
            if (typeof showToast === 'function') showToast(t('msg_no_setlist_selected', 'Δεν υπάρχει ενεργή λίστα για διαγραφή.'), 'error');
            return;
        }
        if (currentSetlistName === "🗑️ Κάδος") {
            if (typeof showToast === 'function') showToast(t('msg_pick_valid_list', 'Επιλέξτε μια έγκυρη λίστα.'), 'warning');
            return;
        }
        if (Object.keys(allSetlists).length <= 1) { 
            showToast(t('msg_err_delete_last_list')); 
            return; 
        }
        const msg = t('msg_confirm_delete_list').replace('{name}', currentSetlistName);
        const confirmed = window.mDialog && typeof window.mDialog.dangerConfirm === 'function'
            ? await window.mDialog.dangerConfirm({
                title: t('btn_delete_title', 'Διαγραφή Λίστας'),
                message: msg,
                dangerText: t('btn_delete', 'Διαγραφή')
            })
            : (typeof mConfirm === 'function' ? await mConfirm(msg, true) : false);
        if (confirmed) {
            delete allSetlists[currentSetlistName]; 
            const keys = Object.keys(allSetlists);
            const fallbackName = keys.find(k => k !== "🗑️ Κάδος") || keys[0];
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
        const menuBtn = document.getElementById('btnSetlistMenu');
        
        if (isSetlistLocked) {
            if (menuBtn) menuBtn.classList.add('is-locked');
            showToast(t('msg_setlist_locked_on'));
        } else {
            if (menuBtn) menuBtn.classList.remove('is-locked');
            showToast(t('msg_setlist_locked_off'));
        }
        ui.updateButtons();
        renderSidebar();
    };

    logic.generateInvite = async function() {
        if (typeof currentUser === 'undefined' || !currentUser || window.activeGuestInvite) {
            showToast(t('msg_account_needed_to_invite', 'Πρέπει να έχετε δημιουργήσει λογαριασμό (τουλάχιστον solo_free) για να προσκαλέσετε άτομα.'), 'error');
            return;
        }

        const activeGroupId = (typeof currentGroupId !== 'undefined' && currentGroupId) ? currentGroupId : 'personal';
        if (activeGroupId === 'personal') {
            showToast(t('msg_share_requires_band', 'Η κοινοποίηση γίνεται από λίστα μπάντας — στείλε πρώτα τη λίστα στη μπάντα με ✈.'), 'warning');
            return;
        }

        const canShareBand = (typeof roleCan === 'function')
            ? (roleCan('EDIT_BAND_SETLIST') && roleCan('SHARE_SETLIST'))
            : false;
        if (!canShareBand) {
            showToast(t('msg_err_share_only_admins', 'Μόνο owner, maestro ή admin μπορεί να κοινοποιήσει λίστα της μπάντας.'), 'error');
            return;
        }

        if (!navigator.onLine) {
            showToast(t('msg_req_internet', 'Απαιτείται σύνδεση στο Internet'), 'error');
            return;
        }
        
        var currentSetlistName = logic.getActiveName();
        if (!currentSetlistName || currentSetlistName === "🗑️ Κάδος") {
            showToast(t('msg_pick_valid_list', 'Επιλέξτε μια έγκυρη λίστα.'), 'warning');
            return;
        }

        // Αυστηρά 48 ώρες για Guest Singers (Πρόσκληση Παρέας)
        let expiresAt = new Date();
        expiresAt.setHours(expiresAt.getHours() + 48);

        const btn = document.getElementById('btnSetlistMenu');
        if (btn) btn.classList.add('pulse-anim');

        try {
            const inviteData = {
                setlist_name: currentSetlistName,
                group_id: activeGroupId,
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
            const errMsg = String(err?.message || '');
            const isPermOrRls = err?.status === 403
                || String(err?.code || '') === '42501'
                || /row-level security|permission|forbidden|not authorized/i.test(errMsg);
            const msg = isPermOrRls
                ? t('msg_err_share_only_admins', 'Μόνο owner, maestro ή admin μπορεί να κοινοποιήσει λίστα της μπάντας.')
                : (t('msg_err_invite_create', 'Σφάλμα κατά τη δημιουργία πρόσκλησης') + (errMsg ? `: ${errMsg}` : ''));
            showToast(msg, 'error');
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
        
        var currentSetlistName = logic.getActiveName();
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
        if (!currentSetlistName) sel.selectedIndex = -1;
        sel.title = currentSetlistName || '';
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

    ui.getMenuItems = function() {
        const currentSetlistName = logic.getActiveName();
        const isTrash = (currentSetlistName === "🗑️ Κάδος");
        const isBand = (typeof currentGroupId !== 'undefined' && currentGroupId !== 'personal');
        const isSolo = (typeof window.currentEdition === 'function'
            ? window.currentEdition() === 'solo'
            : window.MNOTES_EDITION === 'solo');
        const canCreate = !isBand || (typeof roleCan === 'function' && roleCan('CREATE_BAND_SETLIST'));
        const canEdit = !isBand || (typeof roleCan === 'function' && roleCan('EDIT_BAND_SETLIST'));
        const canShare = isBand && (typeof roleCan === 'function'
            ? (roleCan('EDIT_BAND_SETLIST') && roleCan('SHARE_SETLIST'))
            : false);

        const items = [
            {
                id: 'new',
                icon: 'fas fa-plus',
                label: t('menu_setlist_new', 'Νέα λίστα'),
                disabled: !canCreate,
                reason: !canCreate ? t('msg_err_create_list_band', 'Δεν έχετε δικαίωμα δημιουργίας λίστας στη μπάντα.') : '',
                action: () => { if (typeof createSetlist === 'function') createSetlist(); }
            },
            {
                id: 'rename',
                icon: 'fas fa-edit',
                label: t('menu_setlist_rename', 'Μετονομασία'),
                hidden: isTrash,
                disabled: !canEdit,
                reason: !canEdit ? t('msg_err_edit_list_band', 'Δεν έχετε δικαίωμα επεξεργασίας λίστας στη μπάντα.') : '',
                action: () => { if (typeof renameSetlist === 'function') renameSetlist(); }
            },
            {
                id: 'lock',
                icon: isSetlistLocked ? 'fas fa-lock' : 'fas fa-lock-open',
                label: isSetlistLocked
                    ? t('menu_setlist_unlock', 'Ξεκλείδωμα')
                    : t('menu_setlist_lock', 'Κλείδωμα'),
                action: () => { if (typeof toggleSetlistLock === 'function') toggleSetlistLock(); }
            },
            {
                id: 'share',
                icon: 'fas fa-share-alt',
                label: t('menu_setlist_share', 'Κοινοποίηση'),
                hidden: isSolo || isTrash || !isBand || !canShare,
                disabled: !canShare,
                reason: !canShare ? t('msg_err_share_only_admins', 'Μόνο owner, maestro ή admin μπορεί να κοινοποιήσει λίστα της μπάντας.') : '',
                action: () => { if (typeof window.generateSetlistInvite === 'function') window.generateSetlistInvite(); }
            },
            {
                id: 'pdf',
                icon: 'fas fa-file-pdf',
                label: t('menu_setlist_pdf', 'Εξαγωγή PDF'),
                action: () => { if (typeof printSetlistPDF === 'function') printSetlistPDF(); }
            },
            {
                id: 'transfer',
                icon: 'fas fa-paper-plane',
                label: isBand
                    ? t('menu_setlist_to_personal', 'Αποστολή στα προσωπικά')
                    : t('menu_setlist_to_band', 'Αποστολή στη μπάντα'),
                hidden: isSolo || isTrash,
                disabled: !canEdit,
                reason: !canEdit ? t('msg_err_edit_list_band', 'Δεν έχετε δικαίωμα επεξεργασίας λίστας στη μπάντα.') : '',
                action: () => { if (typeof showTransferSetlistModal === 'function') showTransferSetlistModal(); }
            },
            { divider: true, hidden: isTrash },
            {
                id: 'delete',
                icon: 'fas fa-trash',
                label: t('menu_setlist_delete', 'Διαγραφή'),
                danger: true,
                hidden: isTrash,
                disabled: !canEdit,
                reason: !canEdit ? t('msg_err_edit_list_band', 'Δεν έχετε δικαίωμα επεξεργασίας λίστας στη μπάντα.') : '',
                action: () => { if (typeof deleteSetlist === 'function') deleteSetlist(); }
            }
        ];
        return items.filter(it => !it.hidden);
    };

    ui.renderMenu = function() {
        const dropdown = document.getElementById('setlistMenuDropdown');
        if (!dropdown) return;
        const items = ui.getMenuItems();
        dropdown.innerHTML = '';

        items.forEach(item => {
            if (item.divider) {
                const sep = document.createElement('div');
                sep.className = 'setlist-menu-divider';
                sep.setAttribute('role', 'separator');
                dropdown.appendChild(sep);
                return;
            }
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'setlist-menu-item'
                + (item.danger ? ' is-danger' : '')
                + (item.disabled ? ' is-disabled' : '');
            btn.setAttribute('role', 'menuitem');
            btn.dataset.menuAction = item.id;
            if (item.disabled) {
                btn.setAttribute('aria-disabled', 'true');
                if (item.reason) btn.title = item.reason;
            }
            const iconEl = document.createElement('i');
            iconEl.className = item.icon;
            iconEl.setAttribute('aria-hidden', 'true');
            const labelEl = document.createElement('span');
            labelEl.textContent = item.label;
            btn.appendChild(iconEl);
            btn.appendChild(labelEl);

            btn.addEventListener('click', (ev) => {
                ev.stopPropagation();
                if (item.disabled) {
                    if (item.reason && typeof showToast === 'function') showToast(item.reason, 'warning');
                    return;
                }
                ui.closeMenu();
                item.action();
            });
            dropdown.appendChild(btn);
        });
    };

    ui.closeMenu = function() {
        const dropdown = document.getElementById('setlistMenuDropdown');
        const btn = document.getElementById('btnSetlistMenu');
        if (dropdown) dropdown.hidden = true;
        if (btn) btn.setAttribute('aria-expanded', 'false');
    };

    ui.toggleMenu = function(e) {
        if (e) e.stopPropagation();
        const dropdown = document.getElementById('setlistMenuDropdown');
        const btn = document.getElementById('btnSetlistMenu');
        if (!dropdown || !btn) return;
        const willOpen = dropdown.hidden;
        if (willOpen) {
            ui.renderMenu();
            dropdown.hidden = false;
            btn.setAttribute('aria-expanded', 'true');
        } else {
            ui.closeMenu();
        }
    };

    if (!window._setlistMenuListenersBound) {
        window._setlistMenuListenersBound = true;
        document.addEventListener('click', (e) => {
            const wrap = document.querySelector('.setlist-menu-wrap');
            if (wrap && !wrap.contains(e.target)) ui.closeMenu();
        });
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') ui.closeMenu();
        });
    }

    ui.updateButtons = function() {
        const menuBtn = document.getElementById('btnSetlistMenu');
        if (menuBtn) {
            menuBtn.classList.toggle('is-locked', !!isSetlistLocked);
        }
        const dropdown = document.getElementById('setlistMenuDropdown');
        if (dropdown && !dropdown.hidden) {
            ui.renderMenu();
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
        const sel = document.getElementById('selSetlistName');
        if (sel && sel.value !== name) sel.value = name;
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
            if(libCtrl) libCtrl.style.display = 'none';
            if(setCtrl) { setCtrl.style.display = 'flex'; ui.updateDropdown(); }
            const sInp = document.getElementById('setlistSearchInp');
            const lInp = document.getElementById('searchInp');
            if (sInp && lInp && sInp.value !== lInp.value) sInp.value = lInp.value;
            if (typeof window.toggleClearSearchBtn === 'function') window.toggleClearSearchBtn();
        } else {
            if(libCtrl) libCtrl.style.display = 'flex';
            if(setCtrl) setCtrl.style.display = 'none';
            if (btnEmptyTrash) btnEmptyTrash.style.display = 'none';
        }
        renderSidebar();
    };

    // --- Aliases for backward compatibility ---
    window.initSetlists = logic.init;
    window.getActiveSetlistName = logic.getActiveName;
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
    window.toggleSetlistMenu = ui.toggleMenu;
    window.closeSetlistMenu = ui.closeMenu;

    logic.transferSetlist = async function(targetGroupId, action) {
        if (!canUserPerform('USE_SUPABASE')) {
            if(typeof promptUpgrade === 'function') promptUpgrade(t('msg_share_band', 'Κοινοποίηση σε Μπάντα'));
            return;
        }

        const currentSetlistName = logic.getActiveName();
        if (!currentSetlistName || currentSetlistName === 'Default' || currentSetlistName === '🗑️ Κάδος' || !allSetlists[currentSetlistName]) {
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
                const { data: pData, error: pErr } = await supabaseClient.from('profiles').select('setlists').eq('id', currentUser.id).single();
                if (pErr) throw pErr;
                if (pData && pData.setlists) targetSetlists = pData.setlists;
            } else {
                const { data: gData, error: gErr } = await supabaseClient.from('groups').select('setlists').eq('id', targetGroupId).single();
                if (gErr) throw gErr;
                if (gData && gData.setlists) targetSetlists = gData.setlists;
            }

            // Αποθηκεύουμε τα targetSongIds στο setlist (διατηρώντας τη σειρά)
            targetSetlists[currentSetlistName] = {
                type: 'local',
                songs: targetSongIds
            };

            if (targetGroupId === 'personal') {
                const { error: updErr } = await supabaseClient.from('profiles').update({ setlists: targetSetlists }).eq('id', currentUser.id);
                if (updErr) throw updErr;
            } else {
                const { error: updErr } = await supabaseClient.from('groups').update({ setlists: targetSetlists }).eq('id', targetGroupId);
                if (updErr) throw updErr;
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
