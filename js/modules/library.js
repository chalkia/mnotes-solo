/**
 * mNotes Library & Sidebar Module
 */

window.mNotes = window.mNotes || {};
window.mNotes.ui = window.mNotes.ui || {};
window.mNotes.ui.library = window.mNotes.ui.library || {};

(function(libraryMod) {

    libraryMod.renderSidebar = function() {
        var list = document.getElementById('songList');
        if(!list) return;
        
        list.innerHTML = "";
        window.visiblePlaylist = [];

        const myCloneParentIds = library
            .filter(s => s.group_id === currentGroupId && s.is_clone && s.user_id === currentUser?.id)
            .map(s => s.parent_id);

        const trashList = (typeof allSetlists !== 'undefined' && allSetlists["🗑️ Κάδος"]) ? allSetlists["🗑️ Κάδος"].songs || [] : [];
        // ✅ Fix: χρησιμοποιούμε το σωστό module API αντί για ανύπαρκτο global
        const _activeNameKey = (window.mNotes?.logic?.setlists?.getActiveNameKey) ? window.mNotes.logic.setlists.getActiveNameKey() : null;
        const currentSetlistName = _activeNameKey ? localStorage.getItem(_activeNameKey) : null;
        const isViewingTrash = (viewMode === 'setlist' && currentSetlistName === "🗑️ Κάδος");
        const activeSetlistObj = (currentSetlistName && allSetlists[currentSetlistName]) ? allSetlists[currentSetlistName] : null;

        const rawTxt = document.getElementById('searchInp') ? document.getElementById('searchInp').value : "";
        const cleanQuery = rawTxt.trim().normalize('NFD').replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/ς/g, 'σ');
        const searchTokens = cleanQuery.split(/\s+/).filter(t => t.length > 0);
        var tag = document.getElementById('tagFilter') ? document.getElementById('tagFilter').value : "";
        
        const normalizeForSearch = (str) => {
            if (!str) return "";
            let norm = str.normalize('NFD').replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/ς/g, 'σ');
            const mapPhonetic = {'α':'a','β':'v','γ':'g','δ':'d','ε':'e','ζ':'z','η':'i','θ':'th','ι':'i','κ':'k','λ':'l','μ':'m','ν':'n','ξ':'x','ο':'o','π':'p','ρ':'r','σ':'s','τ':'t','υ':'i','φ':'f','χ':'x','ψ':'ps','ω':'o'};
            const mapVisual = {'α':'a','β':'b','γ':'g','δ':'d','ε':'e','ζ':'z','η':'h','θ':'th','ι':'i','κ':'k','λ':'l','μ':'m','ν':'n','ξ':'x','ο':'o','π':'p','ρ':'r','σ':'s','τ':'t','υ':'y','φ':'f','χ':'ch','ψ':'ps','ω':'w'};
            let phonetic = "", visual = "";
            for(let i=0; i<norm.length; i++) {
                phonetic += mapPhonetic[norm[i]] || norm[i];
                visual += mapVisual[norm[i]] || norm[i];
            }
            return norm + " " + phonetic + " " + visual;
        };

        const matchesSearch = (s) => {
            if (searchTokens.length === 0) return true;
            const titleSearchable = normalizeForSearch(s.title);
            const artistSearchable = normalizeForSearch(s.artist);
            // Η αναζήτηση κοιτά την τονικότητα που ακούει ο χρήστης, όχι την
            // αποθηκευμένη: αν έχει μεταφέρει το τραγούδι, το βρίσκει στη νέα
            // τονικότητα και ΟΧΙ πια στην παλιά.
            const effKey = (typeof getEffectiveKey === 'function') ? getEffectiveKey(s) : s.key;
            const keyNorm = effKey ? String(effKey).toLowerCase() : "";

            return searchTokens.every(token => {
                if (token.startsWith('key:')) {
                    const targetKey = token.substring(4);
                    return keyNorm === targetKey;
                }
                return titleSearchable.includes(token) || 
                       artistSearchable.includes(token) || 
                       keyNorm === token;
            });
        };

        const matchesTag = (s) => {
            if (!tag) return true;
            let sTags = Array.isArray(s.tags) ? s.tags : (typeof s.tags === 'string' ? s.tags.split(',').map(t=>t.trim()) : []);
            if (sTags.length === 0 && s.playlists) {
                sTags = Array.isArray(s.playlists) ? s.playlists : [];
            }
            return sTags.includes(tag);
        };

        if (viewMode === 'setlist') {
            let seqCounter = 1;
            liveSetlist.forEach(id => {
                var s = library.find(x => x.id === id);
                
                // [NEW] Εξαγωγή τραγουδιών για τα Shared Setlists κατευθείαν από το αντικείμενο της λίστας
                if (!s && activeSetlistObj && activeSetlistObj.type === 'shared') {
                    s = activeSetlistObj.songs.find(x => typeof x === 'object' && x.id === id);
                }

                if (s && (!trashList.includes(s.id) || isViewingTrash)) {
                    s._originalSeq = seqCounter++;
                    if (matchesSearch(s) && matchesTag(s)) {
                        window.visiblePlaylist.push(s);
                    }
                }
            });
            // Πόσα τραγούδια έχει πραγματικά η λίστα, πριν το φίλτρο.
            window.setlistTotalCount = seqCounter - 1;
        } else {
            window.setlistTotalCount = 0;
            const candidates = library.filter(s => {
                if (s.is_deleted) return false;
                if (trashList.includes(s.id) && !isViewingTrash) return false; 
                
                if (currentGroupId === 'personal') {
                    // 🚀 [V2.1.9] Εμφάνιση αν δεν έχει group_id Ή αν το group_id είναι ορφανό (δεν ανήκει στις μπάντες μου)
                    let isPersonal = false;
                    if (!s.group_id) {
                        isPersonal = true;
                    } else {
                        /* Διάκριση «ορφανό» από «δεν το ξέρω ακόμα». Όταν δεν
                           ξέρουμε τις μπάντες (offline, πριν φορτώσει το
                           group_members και χωρίς cache), ΔΕΝ θεωρούμε ορφανά
                           όλα τα group_id: αυτό εμφάνιζε ολόκληρη τη μπάντα
                           μέσα στα προσωπικά. Καλύτερα να λείπει ένα σπάνιο
                           ορφανό, παρά να ξεχειλίζουν 66 ξένα στη σκηνή.
                           Το groupsKnown ΔΕΝ είναι το ίδιο με length > 0: ο
                           χρήστης χωρίς μπάντες ξέρει ότι δεν έχει.
                           (09/09/2026) */
                        const known = (typeof groupsKnown !== 'undefined')
                            ? groupsKnown
                            : (typeof myGroups !== 'undefined' && myGroups.length > 0);
                        if (!known) {
                            isPersonal = false;   // έχει group_id και δεν ξέρουμε: κρύψ' το
                        } else {
                            const isMyBand = myGroups.some(g => g.group_id === s.group_id);
                            if (!isMyBand) isPersonal = true;
                        }
                    }
                    if (!isPersonal) return false;
                } else {
                    if (s.group_id !== currentGroupId) return false; 
                    if (s.is_clone && s.user_id !== currentUser?.id) return false; 
                }

                return matchesSearch(s) && matchesTag(s);
            });

            // 2. Ομαδοποίηση ανά "Master ID" για να φαίνεται μόνο ένα τραγούδι στη λίστα
            const groups = {};
            candidates.forEach(s => {
                // Βρίσκουμε το Master ID (DNA)
                let masterId = s.id;
                if (typeof window.normalizeSongForEdition !== 'function') {
                    let curr = s;
                    let safety = 0;
                    while (curr && curr.parent_id && curr.parent_id !== curr.id && safety < 10) {
                        masterId = curr.parent_id;
                        let next = library.find(x => x.id === masterId);
                        if (!next) break;
                        curr = next;
                        safety++;
                    }
                }
                
                if (!groups[masterId]) groups[masterId] = [];
                groups[masterId].push(s);
            });

            // 3. Επιλογή αντιπροσώπου για κάθε ομάδα
            window.visiblePlaylist = Object.values(groups).map(group => {
                // Προτεραιότητα: 1. Το Master της ομάδας, 2. Το παλαιότερο Clone
                let representative = group.find(s => !s.parent_id && !s.is_clone) || 
                                    group.sort((a,b) => window.getCreationTimeFromId(a.id) - window.getCreationTimeFromId(b.id))[0];
                
                // Προσθήκη metadata για το UI (πόσες εκδόσεις υπάρχουν)
                representative._versionCount = group.length;
                return representative;
            });

            // 4. Τελική ταξινόμηση βάσει της επιλογής του χρήστη
            const sortSel = document.getElementById('sortFilter');
            const sortMethod = sortSel ? sortSel.value : 'modified';
            
            const getCreationTime = (s) => {
                if (s.created_at) return new Date(s.created_at).getTime();
                if (typeof window.getCreationTimeFromId === 'function') return window.getCreationTimeFromId(s.id);
                return 0;
            };
            const getModifiedTime = (s) => (s.updated_at || s.updatedAt) ? new Date(s.updated_at || s.updatedAt).getTime() : getCreationTime(s);
            const getLastEditTime = (s) => Math.max(getCreationTime(s), getModifiedTime(s));
            const getLastViewedTime = (s) => s.last_viewed || getLastEditTime(s);

            if (sortMethod === 'alpha') {
                window.visiblePlaylist.sort((a, b) => String(a.title).localeCompare(String(b.title), 'el', { sensitivity: 'base' }));
            } else if (sortMethod === 'created') {
                window.visiblePlaylist.sort((a, b) => getCreationTime(b) - getCreationTime(a));
            } else if (sortMethod === 'modified') {
                window.visiblePlaylist.sort((a, b) => getLastEditTime(b) - getLastEditTime(a));
            } else if (sortMethod === 'viewed') {
                window.visiblePlaylist.sort((a, b) => getLastViewedTime(b) - getLastViewedTime(a));
            }
        }

        const countEl = document.getElementById('songCount');
        if (countEl) {
            countEl.innerText = (typeof window.formatEditionSongCount === 'function')
                ? window.formatEditionSongCount(window.visiblePlaylist.length)
                : String(window.visiblePlaylist.length);
        }
        if (window.PlayedSet && typeof window.PlayedSet.paintCounters === 'function') {
            window.PlayedSet.paintCounters();
        }

        /* Το πεδίο αναζήτησης δεν φαίνεται στην καρτέλα Setlist, αλλά το
           φίλτρο εξακολουθεί να ισχύει. Χωρίς αυτή την ένδειξη ο χρήστης
           βλέπει μερική λίστα και νομίζει ότι έχασε τραγούδια — η ακριβής
           σύγχυση που αναφέρθηκε στις 05/09/2026. */
        const notice = document.getElementById('setlistFilterNotice');
        if (notice) {
            const total = window.setlistTotalCount || 0;
            const shown = window.visiblePlaylist.length;
            const hiding = (viewMode === 'setlist' && total > 0 && shown < total);
            notice.style.display = hiding ? 'flex' : 'none';
            const txt = document.getElementById('setlistFilterText');
            if (txt && hiding) txt.innerText = `🔍 ${shown} από ${total}`;
        }

        window.visiblePlaylist.forEach(s => {
            var li = document.createElement('li');
            
            let originClass = '';
            if (s.is_proposal) {
                originClass = 'proposal-item'; 
            } else if (s.group_id) {
                originClass = 'band-cloud';    
            } else {
                originClass = 'personal-cloud'; 
            }

            let isNew = (typeof lastImportedIds !== 'undefined' && lastImportedIds.has(s.id));
            let isPlayed = (window.PlayedSet && window.PlayedSet.has(s.id));
            let itemClass = `song-item ${currentSongId === s.id ? 'active' : ''} ${originClass} ${isNew ? 'new-import' : ''} ${isPlayed ? 'song-played' : ''}`;
            
            li.className = itemClass;
            li.setAttribute('data-id', s.id);

            // 🖍️ Long-press (500ms) για άμεση επισήμανση / μαρκάρισμα χωρίς άνοιγμα του τραγουδιού
            let pressTimer = null;
            let startX = 0, startY = 0;

            const cancelLongPress = () => {
                if (pressTimer) {
                    clearTimeout(pressTimer);
                    pressTimer = null;
                }
            };

            const startLongPress = (clientX, clientY) => {
                cancelLongPress();
                startX = clientX;
                startY = clientY;
                pressTimer = setTimeout(() => {
                    pressTimer = null;
                    li.dataset.longPressTriggered = '1';
                    if (window.PlayedSet) {
                        window.PlayedSet.toggle(s.id);
                        if (navigator.vibrate) {
                            try { navigator.vibrate(40); } catch (_) {}
                        }
                    }
                }, 750);
            };

            li.addEventListener('touchstart', (e) => {
                if (e.target.classList.contains('song-action') || e.target.classList.contains('song-key-badge')) return;
                if (e.touches && e.touches.length === 1) {
                    startLongPress(e.touches[0].clientX, e.touches[0].clientY);
                }
            }, { passive: true });

            li.addEventListener('touchmove', (e) => {
                if (pressTimer && e.touches && e.touches.length === 1) {
                    const dx = Math.abs(e.touches[0].clientX - startX);
                    const dy = Math.abs(e.touches[0].clientY - startY);
                    if (dx > 10 || dy > 10) {
                        cancelLongPress();
                    }
                }
            }, { passive: true });

            li.addEventListener('touchend', cancelLongPress, { passive: true });
            li.addEventListener('touchcancel', cancelLongPress, { passive: true });

            li.addEventListener('mousedown', (e) => {
                if (e.button === 0) {
                    if (e.target.classList.contains('song-action') || e.target.classList.contains('song-key-badge')) return;
                    startLongPress(e.clientX, e.clientY);
                }
            });
            li.addEventListener('mousemove', (e) => {
                if (pressTimer) {
                    const dx = Math.abs(e.clientX - startX);
                    const dy = Math.abs(e.clientY - startY);
                    if (dx > 10 || dy > 10) {
                        cancelLongPress();
                    }
                }
            });
            li.addEventListener('mouseup', cancelLongPress);
            li.addEventListener('mouseleave', cancelLongPress);

            li.onclick = (e) => {
                if (li.dataset.longPressTriggered === '1') {
                    delete li.dataset.longPressTriggered;
                    return;
                }
                if(e.target.classList.contains('song-action') || e.target.classList.contains('song-key-badge')) return;
                
                const isEditorOpen = document.getElementById('view-editor')?.classList.contains('active-view');
                if (isEditorOpen && currentSongId !== s.id) {
                    if (typeof exitEditor === 'function') exitEditor();
                }

                // 🔖 Αν είναι αποθηκευμένη επιλεγμένη έκδοση γι'αυτό το τραγούδι, φόρτωσέ την
                let targetId = s.id;
                if (typeof window.getVersionGroup === 'function') {
                    const group = window.getVersionGroup(s.id);
                    if (group.length > 1) {
                        const masterId = group[0].id;
                        const activeVersions = JSON.parse(localStorage.getItem('mnotes_active_version') || '{}');
                        const rememberedId = activeVersions[masterId];
                        if (rememberedId && library.find(x => x.id === rememberedId)) {
                            targetId = rememberedId;
                        }
                    }
                }

                if (typeof loadSong === 'function') loadSong(targetId);
                                    
                if(isMobileView()) {
                    
                    const rightDrawer = document.getElementById('rightDrawer');
                    if(rightDrawer && rightDrawer.classList.contains('open') && typeof toggleRightDrawer === 'function') {
                        toggleRightDrawer();
                    }
                }
            };

            // 🔖 [V2.1.7] Εύρεση της ΕΝΕΡΓΗΣ έκδοσης για την εμφάνιση (για το αστεράκι και την τονικότητα)
            let activeVersionId = s.id;
            if (typeof window.getVersionGroup === 'function') {
                const group = window.getVersionGroup(s.id);
                if (group.length > 1) {
                    const masterId = group[0].id;
                    const activeVersions = JSON.parse(localStorage.getItem('mnotes_active_version') || '{}');
                    const rememberedId = activeVersions[masterId];
                    if (rememberedId) activeVersionId = rememberedId;
                }
            }
            const activeSongObj = library.find(x => x.id === activeVersionId) || s;
            const isActiveMaster = (!activeSongObj.parent_id && !activeSongObj.is_clone);
            const totalVersions = s._versionCount || (typeof window.getVersionGroup === 'function' ? window.getVersionGroup(s.id).length : 1);

            var displayTitle = s.title;
            let seqNumBadge = "";
            if (viewMode === 'setlist' && s._originalSeq) {
                seqNumBadge = `<span style="font-size:0.75rem; background:rgba(255,255,255,0.1); color:var(--text-muted); padding:2px 6px; border-radius:4px; margin-right:8px; display:inline-block; min-width:20px; text-align:center;">${s._originalSeq}</span>`;
            }

            if (isActiveMaster && totalVersions > 1) {
                displayTitle = `<span style="color:var(--accent); margin-right:5px; font-weight:bold;">★</span>` + displayTitle;
            }

            if (s._versionCount > 1) {
                displayTitle += ` <span class="version-count-badge">+${s._versionCount - 1}</span>`;
            }

            // 🔖 Η τονικότητα που ακούει ο χρήστης — για ΚΑΘΕ τραγούδι, όχι μόνο
            // για το ανοιχτό. Παλιότερα η μεταφορά φαινόταν μόνο στο τρέχον, οπότε
            // μόλις άλλαζες τραγούδι η λίστα ξαναέδειχνε την παλιά τονικότητα.
            var displayKey = (typeof getEffectiveKey === 'function')
                ? (getEffectiveKey(activeSongObj) || "-")
                : (activeSongObj.key || "-");

            var actionIcon = "far fa-circle";
            if (viewMode === 'setlist') {
                actionIcon = "fas fa-minus-circle"; 
            } else if (liveSetlist.includes(s.id)) {
                actionIcon = "fas fa-check-circle in-setlist"; 
            }

            let badgesHTML = '';

            if (!String(s.id).includes('demo')) {
                 if (s.group_id || (typeof canUserPerform === 'function' && canUserPerform('CLOUD_SYNC'))) {
                      badgesHTML += `<i class="fas fa-cloud badge-cloud" title="${t('title_in_cloud')}" style="margin-left:8px; font-size:0.75rem; opacity:0.4;"></i>`;
                 }
            }
            if (s.personal_transpose && s.personal_transpose !== 0) {
                badgesHTML += `<i class="fas fa-music" title="${t('title_changed_key')}" style="margin-left:8px; font-size:0.75rem; color:var(--accent);"></i>`;
            }
            /* ΜΟΝΟ πραγματικοί κλώνοι. Το parent_id εδώ έπιανε και τα μεταφερμένα
               τραγούδια της μπάντας που είναι masters. (11/09/2026) */
            if (s.is_clone && typeof currentGroupId !== 'undefined' && currentGroupId !== 'personal') {
                badgesHTML += `<i class="fas fa-user-edit" title="${t('title_personal_clone')}" style="margin-left:8px; font-size:0.75rem; color:#ff4444;"></i>`;
            }
            if (s._diverged_bands && s._diverged_bands.length > 0) {
                const bandCount = s._diverged_bands.length;
                const tipText = bandCount === 1
                    ? t('title_diverged_one', 'Αποκλίνει από τη μπάντα — η έκδοσή σας διαφέρει')
                    : t('title_diverged_many', `Αποκλίνει από ${bandCount} μπάντες`);
                badgesHTML += `<span class="badge-diverged" title="${tipText}">⚠️${bandCount > 1 ? ' ' + bandCount : ''}</span>`;
            }

            if (s._versionCount && s._versionCount > 1) {
                badgesHTML += `<span title="${s._versionCount} ${t('lbl_versions', 'εκδόσεις')}" style="margin-left:8px; font-size:0.65rem; background: var(--accent); color: white; padding: 1px 4px; border-radius: 4px; display: inline-flex; align-items:center; gap:3px;">
                    <i class="fas fa-layers"></i>${s._versionCount}
                </span>`;
            }

            let tagsDisplay = "";
            if (s.tags && Array.isArray(s.tags) && s.tags.length > 0) {
                let displayTags = s.tags.slice(0, 3).join(', '); 
                let extra = s.tags.length > 3 ? "..." : "";
                tagsDisplay = `<div style="font-size:0.7rem; color:var(--accent); margin-top:4px; font-style:italic;">${displayTags}${extra}</div>`;
            }

            li.innerHTML = `
                <i class="${actionIcon} song-action" onclick="toggleSetlistSong(event, '${s.id}')"></i>
                <div class="song-info">
                    <div class="song-title" style="display:flex; align-items:center;">
                         <span style="flex-grow:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${seqNumBadge}${displayTitle}</span>
                         <span style="white-space:nowrap;">${badgesHTML}</span>
                    </div>
                    <div class="song-meta-row">
                        <span class="song-artist">${s.artist || "-"}</span>
                        <span class="song-key-badge" onclick="filterByKey(event, '${displayKey}')">${displayKey}</span>
                    </div>
                    ${tagsDisplay} </div>
                ${viewMode === 'setlist' ? `<i class="fas fa-grip-vertical song-handle" ${isSetlistLocked ? 'style="opacity:0.1; cursor:not-allowed;"' : ''}></i>` : ``}
            `;
            list.appendChild(li);  
        });

        if (window.sortableInstance) window.sortableInstance.destroy();
        if(typeof Sortable !== 'undefined') {
            const isBandViewer = (typeof currentGroupId !== 'undefined' && currentGroupId !== 'personal' && !roleCan('REORDER_BAND_SETLIST'));
            window.sortableInstance = new Sortable(list, {
                animation: 150,
                handle: '.song-handle', 
                delay: 200,
                delayOnTouchOnly: true,
                disabled: (viewMode !== 'setlist' || isSetlistLocked || isBandViewer), 
                onEnd: function (evt) {
                    if (viewMode !== 'setlist') return;

                    const items = list.querySelectorAll('.song-item');
                    const newOrder = Array.from(items).map(item => item.getAttribute('data-id'));

                    /* Το DOM περιέχει ΜΟΝΟ τα ορατά. Κρύβονται όσα κόβει το
                       φίλτρο, όσα είναι στον κάδο, και όσα δεν έχουν
                       συγχρονιστεί ακόμα. Το παλιό
                       `liveSetlist.splice(0, liveSetlist.length, ...newOrder)`
                       τα έσβηνε όλα αυτά μόνιμα, και στο Supabase.
                       Τώρα μετακινούνται μόνο τα ορατά, μέσα στις θέσεις που
                       ήδη κατείχαν· τα κρυμμένα μένουν ακίνητα. (05/09/2026) */
                    const visible = new Set(newOrder);
                    const slots = [];
                    liveSetlist.forEach((id, idx) => { if (visible.has(id)) slots.push(idx); });

                    if (slots.length !== newOrder.length) {
                        // Ποτέ σιωπηλή αποτυχία.
                        console.error('[Setlist] Αναδιάταξη ακυρώθηκε — ασυμφωνία:',
                            'θέσεις', slots.length, 'ορατά', newOrder.length);
                        libraryMod.renderSidebar();
                        return;
                    }

                    slots.forEach((pos, i) => { liveSetlist[pos] = newOrder[i]; });

                    if (typeof saveSetlists === 'function') saveSetlists();
                    setTimeout(() => { libraryMod.renderSidebar(); }, 50);
                }
            });
        }

        // --- AUTO-LOAD LOGIC (Integrated decorator) ---
        setTimeout(() => {
            if (window.visiblePlaylist.length > 0) {
                const isEditing = document.getElementById('view-editor')?.classList.contains('active-view');
                const isCurrentVisible = window.visiblePlaylist.some(s => {
                    if (s.id === currentSongId) return true;
                    // 🔖 [V2.1.7] Αν είναι έκδοση, θεωρείται ορατό αν το Master του είναι στη λίστα
                    if (typeof window.getVersionGroup === 'function') {
                        const group = window.getVersionGroup(s.id);
                        return group.some(v => v.id === currentSongId);
                    }
                    return false;
                });
                
                if (!isEditing && (!currentSongId || !isCurrentVisible)) {
                    const lastSavedId = localStorage.getItem('mnotes_last_song');
                    const isLastSavedVisible = lastSavedId ? window.visiblePlaylist.find(s => s.id === lastSavedId) : null;
                    const targetId = isLastSavedVisible ? lastSavedId : window.visiblePlaylist[0].id;

                    // ⚠️ ΦΡΑΓΜΑ ΑΤΕΡΜΟΝΟΥ ΒΡΟΧΟΥ — ΜΗΝ ΤΟ ΑΦΑΙΡΕΣΕΙΣ.
                    // Η loadSong καλεί renderPlayer -> renderSidebar -> ξανά εδώ. Αν μετά τη
                    // φόρτωση το currentSongId ΕΞΑΚΟΛΟΥΘΕΙ να μη θεωρείται ορατό, ο κύκλος
                    // δεν σταματά ποτέ: παρατηρήθηκε 31/08 να τρέχει επ' άπειρον και να
                    // ξαναζωγραφίζει τους δαχτυλισμούς εκατοντάδες φορές.
                    // Δεύτερη φορά για τον ΙΔΙΟ στόχο σημαίνει ότι η φόρτωση δεν έλυσε το
                    // πρόβλημα — άρα σταματάμε και το αναφέρουμε αντί να επιμένουμε.
                    if (window.__autoLoadLastTarget === targetId) {
                        if (!window.__autoLoadLoopReported) {
                            window.__autoLoadLoopReported = true;
                            const cs = library.find(x => x.id === currentSongId);
                            const grp = (typeof window.getVersionGroup === 'function')
                                ? window.getVersionGroup(currentSongId).map(v => v.id) : [];
                            console.warn(
                                '⚠️ [Auto-Load] ΒΡΟΧΟΣ — σταμάτησε.' +
                                '\n  στόχος:        ' + targetId +
                                '\n  currentSongId: ' + currentSongId +
                                '\n  στη library:   ' + !!cs +
                                '\n  is_clone:      ' + (cs ? cs.is_clone : '—') +
                                '\n  parent_id:     ' + (cs ? cs.parent_id : '—') +
                                '\n  context:       ' + (typeof currentGroupId !== 'undefined' ? currentGroupId : '—') +
                                '\n  αντιπρόσωποι:  ' + window.visiblePlaylist.length +
                                '\n  ομάδα εκδόσεων:' + JSON.stringify(grp)
                            );
                        }
                        return;
                    }
                    window.__autoLoadLastTarget = targetId;

                    console.log("🛡️ [Auto-Load] Αναγκαστική φόρτωση τραγουδιού στη σκηνή.");
                    if (typeof loadSong === 'function') loadSong(targetId, false, true);
                } else {
                    // Όλα καλά — καθαρίζουμε το φράγμα ώστε να ξαναλειτουργήσει η
                    // αυτόματη φόρτωση αργότερα, αν χρειαστεί πραγματικά.
                    window.__autoLoadLastTarget = null;
                }
            } else {
                const isEditing = document.getElementById('view-editor')?.classList.contains('active-view');
                if (!isEditing && typeof window.renderEmptyStage === 'function') {
                    window.__autoLoadLastTarget = null;
                    window.renderEmptyStage();
                }
            }
        }, 200);

        setTimeout(() => {
            const activeItem = list.querySelector('.song-item.active');
            if (activeItem) {
                activeItem.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }
        }, 100); 
    };

    libraryMod.saveData = function() {
        if (Array.isArray(library)) {
            const isPersonal = typeof currentGroupId !== 'undefined' ? currentGroupId === 'personal' : true;
            const storageKey = isPersonal ? 'mnotes_data' : 'mnotes_band_' + currentGroupId;
            const dataToSave = isPersonal ? library : library.filter(s => s.group_id === currentGroupId);
            localStorage.setItem(storageKey, JSON.stringify(dataToSave));
            console.log(`💾 LocalStorage (${storageKey}) Updated. Songs count:`, dataToSave.length);
        }
    };

    libraryMod.filterByTag = function(e, tag) { 
        e.stopPropagation(); 
        const tagSelect = document.getElementById('tagFilter'); 
        if(tagSelect) { 
            tagSelect.value = tag; 
            if (typeof switchSidebarTab === 'function') switchSidebarTab('library');
            if (typeof applyFilters === 'function') applyFilters(); 
            showToast(t('msg_filter_tag') + tag); 
            if (isMobileView() && typeof switchDrawerTab === 'function') {
                switchDrawerTab('library');
            }
        }
    };

    libraryMod.filterByKey = function(e, key) { 
        e.stopPropagation(); 
        var inp = document.getElementById('searchInp'); 
        if(inp) { 
            inp.value = 'key:' + key; 
            if (typeof applyFilters === 'function') applyFilters(); 
            showToast(t('msg_filter_key') + key); 
        } 
    };

    libraryMod.splitBody = function(body) {
        if (!body) return { fixed: "", scroll: "" };
        
        // 🚀 [V2.1.8] Ephemeral split view override check
        let disableSplit = typeof userSettings !== 'undefined' ? userSettings.disableSplit : false;
        if (window.songSplitOverride === 'force_single') {
            disableSplit = true;
        } else if (window.songSplitOverride === 'force_split') {
            disableSplit = false;
        }

        if (disableSplit) return { fixed: "", scroll: body }; 
        
        const stanzas = body.split(/\n\s*\n/);
        let splitIndex = -1;
        for (let i = 0; i < stanzas.length; i++) {
            if (stanzas[i].includes('[') || stanzas[i].includes('!')) splitIndex = i;
        }

        if (splitIndex === -1) return { fixed: "", scroll: body };

        // Ensure that if splitIndex falls inside an unclosed section, extend it to the closing tag
        let openChorus = false;
        let openTab = false;
        for (let i = 0; i <= splitIndex; i++) {
            if (/!(?:cho|soc)\b!?|\{(?:soc|start_of_chorus)\}/i.test(stanzas[i])) openChorus = true;
            if (/!\/|!(?:eoc)\b!?|\{(?:eoc|end_of_chorus)\}/i.test(stanzas[i])) openChorus = false;
            if (/!(?:tab|sot)\b!?|\{(?:sot|start_of_tab)\}/i.test(stanzas[i])) openTab = true;
            if (/!\/|!(?:eot)\b!?|\{(?:eot|end_of_tab)\}/i.test(stanzas[i])) openTab = false;
        }
        if (openChorus || openTab) {
            for (let i = splitIndex + 1; i < stanzas.length; i++) {
                if (openChorus && (/!\/|!(?:eoc)\b!?|\{(?:eoc|end_of_chorus)\}/i.test(stanzas[i]))) {
                    openChorus = false;
                    splitIndex = i;
                }
                if (openTab && (/!\/|!(?:eot)\b!?|\{(?:eot|end_of_tab)\}/i.test(stanzas[i]))) {
                    openTab = false;
                    splitIndex = i;
                }
                if (!openChorus && !openTab) break;
            }
        }
        
        const fixedPart = stanzas.slice(0, splitIndex + 1).join('\n\n');
        const scrollPart = stanzas.slice(splitIndex + 1).join('\n\n');
        return { fixed: fixedPart.trim(), scroll: scrollPart.trim() };
    };

    libraryMod.refreshHeader = function() {
        const titleEl = document.getElementById('mainAppTitle'); 
        if (!titleEl) return;

        if (currentGroupId === 'personal') {
            titleEl.innerText = t('lbl_my_songs');
            titleEl.style.color = "var(--accent)"; 
        } else {
            const group = (typeof myGroups !== 'undefined') ? myGroups.find(g => g.group_id === currentGroupId) : null;
            titleEl.innerText = group?.groups?.name || t('lbl_band_workspace');
            titleEl.style.color = "#ff9800"; 
        }
    };

    libraryMod.toEditor = function() { if (typeof switchToEditor === 'function') switchToEditor(); };
    
    libraryMod.toViewer = function(shouldLoad = true) { 
        if (typeof exitEditor === 'function') exitEditor(); 
        if (isMobileView()) {
            const drawerBtns = document.querySelectorAll('#rightDrawer .drawer-section .drawer-btn');
            if (drawerBtns.length > 0) {
                drawerBtns.forEach(btn => btn.classList.remove('active'));
                const stageBtn = Array.from(drawerBtns).find(btn => 
                    btn.getAttribute('onclick') && btn.getAttribute('onclick').includes("'stage'")
                );
                if (stageBtn) stageBtn.classList.add('active');
            }
        }
    };

    libraryMod.switchDrawerTab = function(tabName) {
        if (!isMobileView()) return;
        
        if (tabName === 'stage') {
            const titleEl = document.getElementById('mainAppTitle');
            const isStageEmpty = !titleEl || titleEl.innerText.trim() === '' || titleEl.innerText.trim() === 'mNotes';
            
            if (isStageEmpty) {
                console.log("🛡️ [Anti-Empty] Stage was empty. Loading...");
                if (currentSongId) {
                    if (typeof loadSong === 'function') loadSong(currentSongId);
                } else if (window.visiblePlaylist.length > 0) {
                    if (typeof loadSong === 'function') loadSong(window.visiblePlaylist[0].id);
                } else if (library.length > 0) {
                    if (typeof loadSong === 'function') loadSong(library[0].id);
                }
            }
        }
        
        if (typeof switchMobileTab === 'function') switchMobileTab(tabName);
        if (typeof toggleRightDrawer === 'function') toggleRightDrawer();
    };

    // --- Aliases ---
    window.renderSidebar = libraryMod.renderSidebar;
    window.saveData = libraryMod.saveData;
    window.filterByTag = libraryMod.filterByTag;
    window.filterByKey = libraryMod.filterByKey;
    window.splitSongBody = libraryMod.splitBody;
    window.refreshHeaderUI = libraryMod.refreshHeader;
    window.toEditor = libraryMod.toEditor;
    window.toViewer = libraryMod.toViewer;
    window.switchDrawerTab = libraryMod.switchDrawerTab;

    /* Καθαρίζει ΚΑΘΕ φίλτρο και ξαναζωγραφίζει. Καλείται από το ✕ της
       ένδειξης, που είναι ο μόνος τρόπος να ξεμπλοκάρει ο χρήστης όσο τα
       χειριστήρια είναι κρυμμένα στην καρτέλα Setlist. (05/09/2026) */
    window.clearSetlistFilter = function () {
        const inp = document.getElementById('searchInp');
        if (inp) inp.value = '';
        const tag = document.getElementById('tagFilter');
        if (tag) tag.value = '';
        if (typeof applyFilters === 'function') applyFilters();
    };

})(window.mNotes.ui.library);
