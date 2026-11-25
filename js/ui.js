/* ===========================================================
   mNotes Pro UI Logic v18.1 (MODULARIZED & CLEANED UP)
   =========================================================== */

// --- CUSTOM MODALS UI (Moved to utils.js - See Legacy section at EOF) ---

window.openMStudio = function() {
    if (typeof canUserPerform === 'function' && !canUserPerform('USE_MSTUDIO')) {
        const limits = typeof getUserLimits === 'function' ? getUserLimits() : { label: 'Guest' };
        const tierLabel = limits.label || 'Free';
        if (typeof currentUser !== 'undefined' && currentUser) {
            showToast((typeof t === 'function' ? t('msg_studio_no_access', `Το πακέτο σας (${tierLabel}) δεν περιλαμβάνει πρόσβαση στο Studio.`) : `Το πακέτο σας (${tierLabel}) δεν περιλαμβάνει πρόσβαση στο Studio.`).replace('{tier}', tierLabel), "warning");
            if (typeof promptUpgrade === 'function') promptUpgrade('mStudio Workspace');
        } else {
            showToast((typeof t === 'function' ? t('msg_studio_login_req', "Απαιτείται σύνδεση για το Studio.") : "Απαιτείται σύνδεση για το Studio."), "info");
            const authModal = document.getElementById('authModal');
            if (authModal) authModal.style.display = 'flex';
        }
        return;
    }
    console.log("🚀 [mStudio] Launching Workspace...");
    window.open('mstudio.html', '_blank');
};

window.refreshUIByTier = function() {
    const canStudio = (typeof canUserPerform === 'function' && canUserPerform('USE_MSTUDIO'));
    ['lockStudioIcon', 'lockStudioIconMobile'].forEach(id => {
        const lockIcon = document.getElementById(id);
        if (lockIcon) lockIcon.style.display = canStudio ? 'none' : 'inline-flex';
    });
};

// --- GLOBALS ---
if (typeof window.library === 'undefined') window.library = [];
window.library = window.library || [];
var library = window.library; 

window.songSplitOverride = null; // 🚀 [V2.1.8] Ephemeral split view override state

window.setLibrary = function(newArr) {
    window.library.length = 0;
    if (newArr && Array.isArray(newArr)) {
        window.library.push(...newArr);
    }
    if (typeof library !== 'undefined') library = window.library;
    console.log(`📚 [Library] Array updated in-place (${window.library.length} songs).`);
};
var state = window.state;

var currentSongId = window.currentSongId || null;
var visiblePlaylist = []; 
var viewMode = 'library'; 
var isLyricsMode = false; 
var wakeLock = null; 
var introSizeLevel = parseInt(localStorage.getItem('mnotes_intro_size')) || 0;
window.activeRhythmType = 'metronome'; 
var liveSetlist = []; // Populated by setlist-manager.js initSetlists()
var isSetlistLocked = false; 
var allSetlists = {}; 

var userSettings = JSON.parse(localStorage.getItem('mnotes_settings')) || {
    scrollSpeed: 50, maxCapo: 12, theme: (typeof document !== 'undefined' && document.body && document.body.classList.contains('theme-dark')) ? 'theme-dark' : 'theme-slate', introScale: 0, keepScreenOn: false, sortMethod: 'modified',
    chordSize: 1, chordDist: 0, chordColor: 'default', playDelay: 0
};
// Migration for accidentals
if (userSettings.forceSharps !== undefined && userSettings.accidentalMode === undefined) {
    userSettings.accidentalMode = userSettings.forceSharps ? 'sharps' : 'scale';
    delete userSettings.forceSharps;
    safeSetLocal('mnotes_settings', JSON.stringify(userSettings));
}
if (!userSettings.accidentalMode) userSettings.accidentalMode = 'scale';

function isMobileView() {
    return window.innerWidth <= 1024 || (typeof userSettings !== 'undefined' && userSettings.forceMobile);
}

// --- LIBRARY LOGIC ---
async function loadLibrary() {
    console.log("[LIBRARY] Loading library...");
    // ✅ Πρέπει να περιμένουμε το initSetlists (async) να τελειώσει ώστε 
    // το liveSetlist να είναι γεμάτο ΠΡΙΝ καλέσουμε renderSidebar
    if (typeof initSetlists === 'function') await initSetlists();
    // Αν η βιβλιοθήκη στη μνήμη είναι άδεια, προσπάθησε να φορτώσεις από το localStorage
    if (!window.library || window.library.length === 0) {
        const saved = localStorage.getItem('mnotes_data');
        if (saved) {
            try {
                window.library = JSON.parse(saved).map(s => {
                   if (typeof ensureSongStructure === 'function') return ensureSongStructure(s);
                   return s;
                });
            } catch (e) {
                console.error("Error parsing local library:", e);
                window.library = [];
            }
        }
    }
    
    if (typeof window.migrateOldDemoSongs === 'function') {
        await window.migrateOldDemoSongs();
    }

    library = window.library || [];
    
    if (library.length > 0) {
        if (typeof renderSidebar === 'function') renderSidebar();
    } else {
        window.library = [];
        library = [];
    }
    if (typeof sortLibrary === 'function') sortLibrary(userSettings.sortMethod || 'modified');
    if (typeof populateTags === 'function') populateTags();
    if (typeof renderSidebar === 'function') renderSidebar();
}

function initDrawerPersistence() {
    const storageKey = 'mnotes_drawer_states';
    const savedStates = JSON.parse(localStorage.getItem(storageKey)) || {};
    document.querySelectorAll('details.tool-group').forEach(drawer => {
        const id = drawer.id;
        if (!id) return;
        if (savedStates[id] !== undefined) {
            if (savedStates[id] === true) drawer.setAttribute('open', '');
            else drawer.removeAttribute('open');
        }
        drawer.addEventListener('toggle', () => {
            const currentStates = JSON.parse(localStorage.getItem(storageKey)) || {};
            currentStates[id] = drawer.open; 
            safeSetLocal(storageKey, JSON.stringify(currentStates));
        });
    });
    console.log("[UI] Drawer persistence initialized.");
}

function populateTags() {
    const select = document.getElementById('tagFilter');
    if(!select) return;
    const currentVal = select.value;
    const allTagsText = (typeof t === 'function') ? t('opt_all_tags', 'All Tags') : "All Tags";
    select.innerHTML = `<option value="">${allTagsText}</option>`;
    const allTags = new Set();
    library.forEach(s => {
        let sTags = Array.isArray(s.tags) ? s.tags : (typeof s.tags === 'string' ? s.tags.split(',').map(t=>t.trim()) : []);
        sTags.forEach(tag => { if(tag) allTags.add(tag); });
    });
    Array.from(allTags).sort().forEach(tag => {
        const opt = document.createElement('option');
        opt.value = tag; opt.innerText = tag; select.appendChild(opt);
    });
    select.value = currentVal;
}

function applyFilters() { if (typeof renderSidebar === 'function') renderSidebar(); }

function sortLibrary(method) {
    if (!method) method = 'modified';
    if (typeof userSettings !== 'undefined') {
        userSettings.sortMethod = method;
        safeSetLocal('mnotes_settings', JSON.stringify(userSettings));
    }
    const sortSel = document.getElementById('sortFilter');
    if (sortSel) sortSel.value = method;
    if (typeof renderSidebar === 'function') renderSidebar();
}

function applySortAndRender() {
    const sortSel = document.getElementById('sortFilter');
    if(sortSel) sortLibrary(sortSel.value);
}

// --- IMPORT / EXPORT ---
function selectImport(type) { 
    const modal = document.getElementById('importChoiceModal'); 
    if(modal) modal.style.display = 'none'; 
    if(type === 'file') { 
        const fi = document.getElementById('hiddenFileInput'); 
        if(fi) fi.click(); 
    } else if(type === 'url') { 
        importFromURL(); 
    } 
}

async function importFromURL() { 
    const url = prompt(window.t ? t('ph_url_import', "Enter URL:") : "Enter URL:"); 
    if (!url) return; 
    try { 
        const res = await fetch(url); 
        if(!res.ok) throw new Error("Network Error"); 
        const data = await res.json(); 
        if (typeof processImportedData === 'function') processImportedData(data); 
    } catch (err) { 
        showToast(t('msg_err_import', "Import Failed: ") + err.message, "error"); 
    } 
}

function showTransferModal() {
    if (!currentSongId) return;
    
    const currentSong = library.find(s => s.id === currentSongId);
    if (!currentSong) return;

    let destinations = [];
    
    if (currentGroupId !== 'personal') {
        // Αν είμαστε μέσα σε μπάντα, όλοι μπορούν να το στείλουν στα Προσωπικά τους
        destinations.push({ id: 'personal', name: (typeof t === 'function') ? t('lbl_personal_library', 'Προσωπική Βιβλιοθήκη') : 'Προσωπική Βιβλιοθήκη', icon: 'fa-home', action: 'transfer_personal' });
    } else {
        // Αν είμαστε στα Προσωπικά, έχει νόημα η αποστολή σε μπάντες
        if (typeof myGroups !== 'undefined' && myGroups) {
            myGroups.forEach(g => {
                const bandName = g.groups?.name || 'Άγνωστη Μπάντα';
                const role = g.role;
                
                // Αν είμαι admin/owner/maestro -> μπορώ να το μεταφέρω στην κοινόχρηστη βιβλιοθήκη της μπάντας
                if (['admin', 'owner', 'maestro'].includes(role)) {
                    destinations.push({
                        id: g.group_id,
                        name: `Βιβλιοθήκη: ${bandName}`,
                        icon: 'fa-users',
                        action: 'transfer_band'
                    });
                }
                
                // Ανεξαρτήτως ρόλου -> μπορώ να στείλω πρόταση (proposal) στα μέλη της μπάντας
                destinations.push({
                    id: g.group_id,
                    name: `Μέλη: ${bandName}`,
                    icon: 'fa-envelope',
                    action: 'propose_members'
                });
            });
        }
    }

    if (destinations.length === 0) {
        showToast((typeof t === 'function') ? t('msg_no_destinations', "Δεν υπάρχουν άλλοι διαθέσιμοι προορισμοί.") : "Δεν υπάρχουν άλλοι διαθέσιμοι προορισμοί.", "info");
        return;
    }

    let optionsHtml = destinations.map(dest => 
        `<button onclick="if(typeof transferSong==='function') transferSong('${dest.id}', '${dest.action}'); document.body.removeChild(this.closest('.modal-overlay'));" 
                 style="display:flex; align-items:center; gap:12px; width:100%; margin-bottom:12px; padding:14px; background:var(--accent); color:#000; font-weight:bold; border:none; border-radius:10px; cursor:pointer; font-size:1rem; transition: transform 0.1s;"
                 onmouseover="this.style.transform='scale(1.02)'" onmouseout="this.style.transform='scale(1)'">
            <i class="fas ${dest.icon}" style="width:20px;"></i> <span>Προς: ${dest.name}</span>
        </button>`
    ).join('');

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.style.cssText = 'position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.85); display:flex; align-items:center; justify-content:center; z-index:5000; backdrop-filter: blur(4px);';
    
    overlay.innerHTML = `${typeof t === 'function' ? t('auto_msg_124', "\n        <div style=\"background:var(--bg-panel); padding:30px; border-radius:16px; width:340px; text-align:center; border: 1px solid var(--border-color); box-shadow: 0 10px 40px rgba(0,0,0,0.5);\">\n            <i class=\"fas fa-paper-plane\" style=\"font-size:2rem; color:var(--accent); margin-bottom:15px;\"></i>\n            <h3 style=\"margin-top:0; color:var(--text-main); font-size:1.4rem;\">Μεταφορά / Κοινοποίηση</h3>\n            <p style=\"font-size:0.95rem; color:var(--text-muted); margin-bottom:25px;\">Πού θέλετε να στείλετε το:<br><b style=\"color:var(--text-main)\">\"") : "\n        <div style=\"background:var(--bg-panel); padding:30px; border-radius:16px; width:340px; text-align:center; border: 1px solid var(--border-color); box-shadow: 0 10px 40px rgba(0,0,0,0.5);\">\n            <i class=\"fas fa-paper-plane\" style=\"font-size:2rem; color:var(--accent); margin-bottom:15px;\"></i>\n            <h3 style=\"margin-top:0; color:var(--text-main); font-size:1.4rem;\">Μεταφορά / Κοινοποίηση</h3>\n            <p style=\"font-size:0.95rem; color:var(--text-muted); margin-bottom:25px;\">Πού θέλετε να στείλετε το:<br><b style=\"color:var(--text-main)\">\""}${currentSong.title}"</b>;</p>
            <div style="max-height: 350px; overflow-y: auto; padding: 2px;">
                ${optionsHtml}${typeof t === 'function' ? t('auto_msg_123', "\n            </div>\n            <button onclick=\"document.body.removeChild(this.closest('.modal-overlay'));\" style=\"margin-top:15px; padding:12px; width:100%; background:transparent; border:1px solid var(--border-color); color:var(--text-muted); border-radius:10px; cursor:pointer; font-weight:500;\">Ακύρωση</button>\n        </div>\n    ") : "\n            </div>\n            <button onclick=\"document.body.removeChild(this.closest('.modal-overlay'));\" style=\"margin-top:15px; padding:12px; width:100%; background:transparent; border:1px solid var(--border-color); color:var(--text-muted); border-radius:10px; cursor:pointer; font-weight:500;\">Ακύρωση</button>\n        </div>\n    "}`;
    document.body.appendChild(overlay);
}

function showTransferSetlistModal() {
    const activeName = (typeof getActiveSetlistName === 'function')
        ? getActiveSetlistName()
        : document.getElementById('selSetlistName')?.value;
    if (!activeName || activeName === 'Default' || activeName === '🗑️ Κάδος') {
        showToast((typeof t === 'function') ? t('msg_no_setlist_selected', "Δεν έχετε επιλέξει κάποιο ενεργό Setlist.") : "Δεν έχετε επιλέξει κάποιο ενεργό Setlist.", "warning");
        return;
    }
    const setlistName = activeName;

    let destinations = [];
    
    if (currentGroupId !== 'personal') {
        destinations.push({ id: 'personal', name: (typeof t === 'function') ? t('lbl_personal_library', 'Προσωπική Βιβλιοθήκη') : 'Προσωπική Βιβλιοθήκη', icon: 'fa-home', action: 'transfer_personal' });
    } else {
        if (typeof myGroups !== 'undefined' && myGroups) {
            myGroups.forEach(g => {
                const bandName = g.groups?.name || t('lbl_unknown_band', 'Άγνωστη Μπάντα');
                const role = g.role;
                if (['admin', 'owner', 'maestro'].includes(role)) {
                    destinations.push({
                        id: g.group_id,
                        name: `${t('lbl_library', 'Βιβλιοθήκη')}: ${bandName}`,
                        icon: 'fa-users',
                        action: 'transfer_band'
                    });
                }
            });
        }
    }

    if (destinations.length === 0) {
        showToast((typeof t === 'function') ? t('msg_no_destinations', "Δεν υπάρχουν άλλοι διαθέσιμοι προορισμοί.") : "Δεν υπάρχουν άλλοι διαθέσιμοι προορισμοί.", "info");
        return;
    }

    let optionsHtml = destinations.map(dest => 
        `<button onclick="if(typeof mNotes.logic.setlists.transferSetlist==='function') { mNotes.logic.setlists.transferSetlist('${dest.id}', '${dest.action}'); } else if (typeof transferSetlist==='function') { transferSetlist('${dest.id}', '${dest.action}'); } document.body.removeChild(this.closest('.modal-overlay'));" 
                 style="display:flex; align-items:center; gap:12px; width:100%; margin-bottom:12px; padding:14px; background:var(--accent); color:#000; font-weight:bold; border:none; border-radius:10px; cursor:pointer; font-size:1rem; transition: transform 0.1s;"
                 onmouseover="this.style.transform='scale(1.02)'" onmouseout="this.style.transform='scale(1)'">
            <i class="fas ${dest.icon}" style="width:20px;"></i> <span>${t('lbl_to', 'Προς')}: ${dest.name}</span>
        </button>`
    ).join('');

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.style.cssText = 'position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.85); display:flex; align-items:center; justify-content:center; z-index:5000; backdrop-filter: blur(4px);';
    
    overlay.innerHTML = `
        <div style="background:var(--bg-panel); padding:30px; border-radius:16px; width:340px; text-align:center; border: 1px solid var(--border-color); box-shadow: 0 10px 40px rgba(0,0,0,0.5);">
            <i class="fas fa-list" style="font-size:2rem; color:var(--accent); margin-bottom:15px;"></i>
            <h3 style="margin-top:0; color:var(--text-main); font-size:1.4rem;">${t('lbl_transfer_setlist', 'Μεταφορά Setlist')}</h3>
            <p style="font-size:0.95rem; color:var(--text-muted); margin-bottom:25px;">${t('msg_transfer_where', 'Πού θέλετε να στείλετε τη λίστα:')}<br><b style="color:var(--text-main)">"${setlistName}"</b>;</p>
            <div style="max-height: 350px; overflow-y: auto; padding: 2px;">
                ${optionsHtml}
            </div>
            <button onclick="document.body.removeChild(this.closest('.modal-overlay'));" style="margin-top:15px; padding:12px; width:100%; background:transparent; border:1px solid var(--border-color); color:var(--text-muted); border-radius:10px; cursor:pointer; font-weight:500;">${t('btn_cancel', 'Ακύρωση')}</button>
        </div>
    `;
    document.body.appendChild(overlay);
}
function loadSong(id, forceMaster = false, preventMobileSwitch = false) {
    window.songSplitOverride = null; // 🚀 [V2.1.8] Reset override on song switch
    if (window.mRhythm && window.isRhythmPlaying) window.mRhythm.stop();
    if (typeof BasicMetronome !== 'undefined' && BasicMetronome.isPlaying) BasicMetronome.toggle();
    const icon = document.getElementById('iconPlayRhythm');
    if (icon) { icon.classList.remove('fa-stop'); icon.classList.add('fa-play'); }
    window.activeRhythmType = 'metronome';
    const nameDisplay = document.getElementById('seq-current-name');
    if (nameDisplay) {
        nameDisplay.innerText = (typeof t === 'function') ? t('sum_metronome', "Metronome") : "Metronome";
        nameDisplay.style.color = "var(--text-muted)";
    }
    if (typeof toggleAutoScroll === 'function') {
        const isScrolling = (window.mNotes.ui.utils.scrollTimer || window.mNotes.ui.utils.scrollStartTimeout);
        if (isScrolling) toggleAutoScroll();
    }
    
    const prevId = currentSongId;
    currentSongId = id; 
    safeSetLocal('mnotes_last_song', id);
    var s = library.find(x => x.id === id); 
    
    // [NEW] Fallback για Shared Setlists που έχουν απομονωμένα (isolated) τραγούδια
    if (!s && typeof window.visiblePlaylist !== 'undefined') {
        s = window.visiblePlaylist.find(x => x.id === id);
    }
    
    if(!s) return;
    
    if (prevId && prevId !== id) {
        if (window.mNotes?.ui?.assets?.stopActiveRecordingAndTeardown) {
            window.mNotes.ui.assets.stopActiveRecordingAndTeardown(true);
        }
        if (window.mNotes?.ui?.assets?.closeCustomPlayer) {
            window.mNotes.ui.assets.closeCustomPlayer();
        }
        // Κλείνουμε τον editor ΜΟΝΟ αν ο χρήστης αλλάζει τραγούδι χειροκίνητα
        // (ΟΧΙ κατά την αρχική φόρτωση/restore όπου prevId είναι null)
        const isEditorOpen = document.getElementById('view-editor')?.classList.contains('active-view');
        if (isEditorOpen && typeof exitEditor === 'function') {
            exitEditor();
        }
    }

    if (!s.is_clone && currentGroupId !== 'personal' && !forceMaster) {
        // ⚠️ Ο κλώνος πρέπει να είναι ΟΡΑΤΟΣ, όχι απλώς να υπάρχει.
        // Οι ίδιοι όροι με την getVersionGroup: όχι διεγραμμένος, και είτε
        // προσωπικός (group_id κενό) είτε αυτής της ομάδας. Χωρίς αυτό, η
        // loadSong άνοιγε κλώνο που η βιβλιοθήκη ΔΕΝ δέχεται στην ομάδα
        // εκδόσεων — οπότε ο φύλακας ορατότητας του library.js τον έβλεπε
        // ως «μη ορατό», ξαναφόρτωνε, και ο κύκλος δεν σταματούσε ποτέ
        // (ατέρμονος βρόχος, 31/08).
        const myClone = library.find(c =>
            c.parent_id === s.id &&
            c.is_clone &&
            c.user_id === currentUser?.id &&
            !c.is_deleted &&
            (!c.group_id || c.group_id === currentGroupId)
        );

        if (myClone) {
            s = myClone;
            currentSongId = myClone.id;
        } else if (!window.__cloneSkipReported) {
            // Υπάρχει κλώνος αλλά απορρίφθηκε; Πες ΓΙΑΤΙ — μία φορά.
            const bad = library.find(c => c.parent_id === s.id && c.is_clone && c.user_id === currentUser?.id);
            if (bad) {
                window.__cloneSkipReported = true;
                console.warn('[loadSong] Ο κλώνος ' + bad.id + ' αγνοήθηκε — ' +
                    'is_deleted=' + bad.is_deleted + ' group_id=' + JSON.stringify(bad.group_id) +
                    ' (context=' + currentGroupId + ')');
            }
        }
    }
    
    s.last_viewed = Date.now();
    // Removed heavy save on open (F2)

    if (typeof autoLoadAttachmentsForSong === 'function') autoLoadAttachmentsForSong(s);
    state.t = (s.personal_transpose !== undefined && s.personal_transpose !== null) ? s.personal_transpose : (s.transpose || 0);
    state.c = (s.personal_capo !== undefined && s.personal_capo !== null && s.personal_capo !== 0) ? s.personal_capo : (parseInt(s.capo, 10) || 0);
    if(typeof parseSongLogic === 'function') parseSongLogic(s);
    renderPlayer(s);
    if (s.rhythm && s.rhythm.bpm && typeof BasicMetronome !== 'undefined') {
        BasicMetronome.setBpm(s.rhythm.bpm);
        const txtBpm = document.getElementById('txtBpm');
        if (txtBpm) txtBpm.value = s.rhythm.bpm;
    }
    if(typeof requestWakeLock === 'function') requestWakeLock();
    if (isMobileView() && typeof switchMobileTab === 'function' && !preventMobileSwitch) switchMobileTab('stage');
    if (typeof applyScrollBtnVisibility === 'function') applyScrollBtnVisibility();

    // 🚀 [V2.1.7] Ολική ανανέωση της λίστας για να συγχρονιστούν τονικότητες και versions
    if (typeof renderSidebar === 'function') renderSidebar();
    if (typeof window.fitToolsSections === 'function') window.fitToolsSections();
}

function navVisiblePlaylist(dir) {
    if (!visiblePlaylist || visiblePlaylist.length === 0) return;
    let currentIndex = visiblePlaylist.findIndex(s => s.id === currentSongId);
    let newIndex = currentIndex + dir;
    if (newIndex >= 0 && newIndex < visiblePlaylist.length) loadSong(visiblePlaylist[newIndex].id);
    else showToast(dir > 0 ? t('msg_list_end') : t('msg_list_start'));
}

function renderPlayer(s) {
    if (!s) return;
    var header = document.querySelector('.player-header-container');
    if (header) header.style.display = 'block';
    var mainHeaderContent = document.querySelector('.header-main-content');
    if (mainHeaderContent) mainHeaderContent.style.display = 'block';
    var metaInfoBox = document.querySelector('.meta-info-box');
    if (metaInfoBox) {
        metaInfoBox.style.display = 'block';
        metaInfoBox.style.borderTop = '';
        metaInfoBox.style.marginTop = '';
    }
    if (typeof window.mNotes.ui.player.render === 'function') window.mNotes.ui.player.render(s);
}


function setupEvents() {
    document.addEventListener('click', function(e) {
        var wrap = document.querySelector('.tag-wrapper');
        var sugg = document.getElementById('tagSuggestions');
        if (wrap && sugg && !wrap.contains(e.target) && !sugg.contains(e.target)) sugg.style.display = 'none';
    });
}

// Initializers that run on start
//
// ⚠️ ΚΑΘΕ ΒΗΜΑ ΑΠΟΜΟΝΩΜΕΝΟ. Παλιότερα ήταν απλή ακολουθία: μια εξαίρεση στο
// πρώτο βήμα σταματούσε ΟΛΑ τα υπόλοιπα — και ακριβώς αυτό συνέβαινε, με το
// applyTranslations να σκάει σε "currentLang is not defined". Αποτέλεσμα: το
// setupEvents() δεν έτρεχε ποτέ, άρα κανένας χειριστής συμβάντων της διεπαφής
// δεν συνδεόταν. Η εφαρμογή φαινόταν να δουλεύει επειδή τα περισσότερα κουμπιά
// έχουν inline onclick — αλλά ό,τι εξαρτιόταν από το setupEvents ήταν νεκρό,
// σιωπηλά.
//
// Τώρα ένα σπασμένο βήμα δεν παρασύρει τα υπόλοιπα, και το σφάλμα φαίνεται
// ονομαστικά αντί να κρύβεται πίσω από μια γενική διακοπή.
window.initMNotesUI = function() {
    var steps = [
        ['applyTranslations',     function(){ if (typeof applyTranslations === 'function') applyTranslations(); }],
        ['loadLibrary',           function(){ loadLibrary(); }],
        ['initDrawerPersistence', function(){ initDrawerPersistence(); }],
        ['setupEvents',           function(){ setupEvents(); }],
        ['initUIUtils',           function(){ if (typeof initUIUtils === 'function') initUIUtils(); }],
        ['setupBluetoothPedals',  function(){ if (typeof setupBluetoothPedals === 'function') setupBluetoothPedals(); }]
    ];

    var failed = [];
    steps.forEach(function(step) {
        try {
            step[1]();
        } catch (err) {
            failed.push(step[0]);
            console.error('❌ [INIT] Απέτυχε το βήμα «' + step[0] + '»:', err);
        }
    });

    if (failed.length === 0) {
        console.log("✅ mNotes UI Initialized (Modularized)");
    } else {
        console.warn("⚠️ mNotes UI ξεκίνησε με " + failed.length +
                     " αποτυχημένα βήματα: " + failed.join(', '));
    }
};

/* ===========================================================
   LEGACY REFERENCE (FOR DEBUGGING / REVERT)
   ===========================================================
   The following functions were moved to js/modules/utils.js
   during the "Babushka" refactoring.

window.mConfirm = function(msg, isDanger = false) {
    return new Promise((resolve) => {
        const modal = document.getElementById('mConfirmModal');
        if (!modal) { resolve(confirm(msg)); return; }
        document.getElementById('mConfirmMsg').innerText = msg;
        const icon = document.getElementById('mConfirmIcon');
        const okBtn = document.getElementById('btnMConfirmOk');
        if (isDanger) {
            icon.className = 'fas fa-exclamation-triangle';
            icon.style.color = 'var(--danger, #ff4444)';
            okBtn.style.background = 'var(--danger, #ff4444)';
            okBtn.style.color = '#fff';
        } else {
            icon.className = 'fas fa-question-circle';
            icon.style.color = 'var(--accent, #ff9800)';
            okBtn.style.background = 'var(--accent, #ff9800)';
            okBtn.style.color = '#000';
        }
        modal.style.display = 'flex';
        const btnCancel = document.getElementById('btnMConfirmCancel');
        const cleanup = () => {
            modal.style.display = 'none';
            btnCancel.removeEventListener('click', onCancel);
            okBtn.removeEventListener('click', onOk);
        };
        const onCancel = () => { cleanup(); resolve(false); };
        const onOk = () => { cleanup(); resolve(true); };
        btnCancel.addEventListener('click', onCancel);
        okBtn.addEventListener('click', onOk);
    });
};

window.mPrompt = function(msg, defaultVal = '') {
    return new Promise((resolve) => {
        const modal = document.getElementById('mPromptModal');
        if (!modal) { resolve(prompt(msg, defaultVal)); return; }
        document.getElementById('mPromptMsg').innerText = msg;
        const input = document.getElementById('mPromptInput');
        input.value = defaultVal;
        modal.style.display = 'flex';
        input.focus();
        const btnCancel = document.getElementById('btnMPromptCancel');
        const btnOk = document.getElementById('btnMPromptOk');
        const cleanup = () => {
            modal.style.display = 'none';
            btnCancel.removeEventListener('click', onCancel);
            btnOk.removeEventListener('click', onOk);
            input.removeEventListener('keyup', onEnter);
        };
        const onCancel = () => { cleanup(); resolve(null); };
        const onOk = () => { cleanup(); resolve(input.value); };
        const onEnter = (e) => { if (e.key === 'Enter') onOk(); };
        btnCancel.addEventListener('click', onCancel);
        btnOk.addEventListener('click', onOk);
        input.addEventListener('keyup', onEnter);
    });
};
*/

// --- Editor Syntax Highlighting ---
function formatHighlightsHTML(rawText, includeSections = true) {
    if (!rawText) return "";
    let text = rawText.replace(/&/g, '&amp;')
                       .replace(/</g, '&lt;')
                       .replace(/>/g, '&gt;');

    const placeholders = {};
    let counter = 0;

    // 0. Custom Chord Definitions: {define: ...} (§Σ11.1)
    text = text.replace(/\{define\s*:[^}]*\}/gi, (match) => {
        const id = `__DEFINE_${counter++}__`;
        placeholders[id] = `<span class="define-highlight">${match}</span>`;
        return id;
    });

    // 1. Comments: !com ... !/ or {c: ...} / {comment: ...} (§Σ7.1)
    text = text.replace(/(?:!com\s*(?::\s*)?([\s\S]*?)(?:!\/|$)|\{(?:comment|c):\s*([\s\S]*?)\})/gi, (match) => {
        const id = `__COM_${counter++}__`;
        placeholders[id] = `<span class="com-highlight">${match}</span>`;
        return id;
    });

    // 2. Strumming: !str ... !/ or !strum ... !/ or {strum: ...} (§Σ7.1)
    text = text.replace(/(?:!(?:strum|str)\s*(?::\s*)?([^\n!]*?)(?:!\/|!|$|\n)|\{strum:\s*([^}]*?)\})/gi, (match) => {
        const id = `__STRUM_${counter++}__`;
        placeholders[id] = `<span class="strum-highlight">${match}</span>`;
        return id;
    });

    if (includeSections) {
        // 3. Sections
        // 3a. Chorus (!cho, !soc!, !eoc!, {soc}, {eoc})
        text = text.replace(/(?:!(?:cho|soc)\b!?|\{(?:soc|start_of_chorus)\}|!eoc!?|\{(?:eoc|end_of_chorus)\})/gi, (match) => {
            const id = `__CHORUS_TAG_${counter++}__`;
            placeholders[id] = `<span class="chorus-highlight">${match}</span>`;
            return id;
        });

        // 3b. Verse (!ver, !sov!, !eov!, {sov}, {eov})
        text = text.replace(/(?:!(?:ver|sov)\b!?|\{(?:sov|start_of_verse)\}|!eov!?|\{(?:eov|end_of_verse)\})/gi, (match) => {
            const id = `__VERSE_TAG_${counter++}__`;
            placeholders[id] = `<span class="verse-highlight">${match}</span>`;
            return id;
        });

        // 3c. Bridge (!bri, !sob!, !eob!, {sob}, {eob})
        text = text.replace(/(?:!(?:bri|sob)\b!?|\{(?:sob|start_of_bridge)\}|!eob!?|\{(?:eob|end_of_bridge)\})/gi, (match) => {
            const id = `__BRIDGE_TAG_${counter++}__`;
            placeholders[id] = `<span class="bridge-highlight">${match}</span>`;
            return id;
        });

        // 3d. Tab (!tab, !sot!, !eot!, {sot}, {eot})
        text = text.replace(/(?:!(?:tab|sot)\b!?|\{(?:sot|start_of_tab)\}|!eot!?|\{(?:eot|end_of_tab)\})/gi, (match) => {
            const id = `__TAB_TAG_${counter++}__`;
            placeholders[id] = `<span class="tab-highlight">${match}</span>`;
            return id;
        });

        // 3d-score. Inline ABC score tags: !score Name @id !/
        text = text.replace(/(!score\s+[^\n]*?\s*!\/)/gi, (match) => {
            const id = `__SCORE_${counter++}__`;
            const inner = match.replace(/(@[^\s@!]+)/g, '<span class="score-id-dim">$1</span>');
            placeholders[id] = `<span class="score-tag-highlight">${inner}</span>`;
            return id;
        });

        // 3e. Universal Closer (!/)
        let closeTagCounter = 0;
        text = text.replace(/!\//g, (match) => {
            const id = `__CLOSE_TAG_${counter++}__`;
            const tagIdx = closeTagCounter++;
            placeholders[id] = `<span class="close-tag-highlight" title="Κλείσιμο (!/) - Tag ${tagIdx}">${match}</span>`;
            return id;
        });
    }

    const chordBase = "([A-G][b#]?[a-zA-Z0-9#\\/\\+\\-]*|[a-g][b#]?)(?![a-z])";

    // 4. Chords [Am]
    text = text.replace(new RegExp(`(\\[${chordBase}\\])`, 'g'), (match) => {
        const id = `__CHORD_${counter++}__`;
        placeholders[id] = `<span class="chord-highlight">${match}</span>`;
        return id;
    });
    
    // 5. Chords !Am!
    text = text.replace(new RegExp(`(!${chordBase}!)`, 'g'), (match) => {
        const id = `__CHORD_${counter++}__`;
        placeholders[id] = `<span class="chord-highlight">${match}</span>`;
        return id;
    });

    // 6. Chords !Am
    text = text.replace(new RegExp(`(!${chordBase})`, 'g'), (match) => {
        const id = `__CHORD_${counter++}__`;
        placeholders[id] = `<span class="chord-highlight">${match}</span>`;
        return id;
    });

    // Restore placeholders (multi-pass to guarantee no nested placeholder tokens remain)
    let hasPlaceholder = true;
    let safety = 0;
    while (hasPlaceholder && safety < 5) {
        hasPlaceholder = false;
        safety++;
        for (const id in placeholders) {
            if (text.includes(id)) {
                text = text.replace(id, placeholders[id]);
                hasPlaceholder = true;
            }
        }
    }

    return text;
}

window.updateHighlights = function() {
    const inp = document.getElementById('inpBody');
    const highlights = document.getElementById('inpBodyBackdrop');
    if (inp && highlights) {
        highlights.innerHTML = formatHighlightsHTML(inp.value, true) + '\n';
    }

    const inpIntro = document.getElementById('inpIntro');
    const introHighlights = document.getElementById('inpIntroBackdrop');
    if (inpIntro && introHighlights) {
        introHighlights.innerHTML = formatHighlightsHTML(inpIntro.value, false);
    }

    const inpInter = document.getElementById('inpInter');
    const interHighlights = document.getElementById('inpInterBackdrop');
    if (inpInter && interHighlights) {
        interHighlights.innerHTML = formatHighlightsHTML(inpInter.value, false);
    }

    if (typeof window.updateEditorFormatButtonState === 'function') {
        window.updateEditorFormatButtonState();
    }
};

document.addEventListener('DOMContentLoaded', () => {
    const inpBody = document.getElementById('inpBody');
    const inpBodyBackdrop = document.getElementById('inpBodyBackdrop');
    if (inpBody && inpBodyBackdrop) {
        inpBody.addEventListener('scroll', () => {
            inpBodyBackdrop.scrollTop = inpBody.scrollTop;
            inpBodyBackdrop.scrollLeft = inpBody.scrollLeft;
        });
    }

    const inpIntro = document.getElementById('inpIntro');
    const inpIntroBackdrop = document.getElementById('inpIntroBackdrop');
    if (inpIntro && inpIntroBackdrop) {
        inpIntro.addEventListener('scroll', () => {
            inpIntroBackdrop.scrollLeft = inpIntro.scrollLeft;
        });
    }

    const inpInter = document.getElementById('inpInter');
    const inpInterBackdrop = document.getElementById('inpInterBackdrop');
    if (inpInter && inpInterBackdrop) {
        inpInter.addEventListener('scroll', () => {
            inpInterBackdrop.scrollLeft = inpInter.scrollLeft;
        });
    }

    // Ensure initial highlight if there's text
    setTimeout(window.updateHighlights, 100);
});
/* =========================================
   WHAT'S NEW MODAL LOGIC
   ========================================= */
window.updateWhatsNewDot = function() {
    const dot = document.getElementById('settingsWhatsNewDot');
    if (!dot) return;
    const appVer = (typeof window.MNOTES_VERSION === 'string' && window.MNOTES_VERSION) ? window.MNOTES_VERSION : '';
    let seenVer = '';
    try { seenVer = localStorage.getItem('mnotes_seen_release') || ''; } catch (e) {}
    dot.style.display = (appVer && seenVer !== appVer) ? 'inline-block' : 'none';
};

window.showWhatsNewModal = function() {
    const modal = document.getElementById('whatsNewModal');
    if (!modal) return;
    
    const appVer = (typeof window.MNOTES_VERSION === 'string' && window.MNOTES_VERSION) ? window.MNOTES_VERSION : '';
    const versionEl = document.getElementById('wnVersion');
    if (versionEl) versionEl.innerText = appVer ? ('v' + appVer) : '';
    const codenameEl = document.getElementById('wnCodename');
    if (codenameEl) codenameEl.innerText = window.APP_CODENAME || '';
    
    const list = document.getElementById('wnChangelogList');
    if (list && typeof window.renderWhatsNewReleaseNotes === 'function') {
        window.renderWhatsNewReleaseNotes(list, versionEl);
    }

    if (appVer && typeof safeSetLocal === 'function') {
        safeSetLocal('mnotes_seen_release', appVer);
    }
    window.updateWhatsNewDot();
    
    modal.style.display = 'flex';
};

window.closeWhatsNewModal = function() {
    const modal = document.getElementById('whatsNewModal');
    if (modal) modal.style.display = 'none';
    const appVer = (typeof window.MNOTES_VERSION === 'string' && window.MNOTES_VERSION) ? window.MNOTES_VERSION : '';
    if (appVer) safeSetLocal('mnotes_last_version', appVer);
};

document.addEventListener('DOMContentLoaded', () => {
    window.updateWhatsNewDot();
    const modal = document.getElementById('whatsNewModal');
    if (modal) {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) window.closeWhatsNewModal();
        });
    }
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            const m = document.getElementById('whatsNewModal');
            if (m && m.style.display !== 'none') window.closeWhatsNewModal();
        }
    });
});


document.addEventListener('DOMContentLoaded', () => {
    const inp = document.getElementById('inpBody');
    if (inp) {
        const updateCursor = () => { window.chordAssistantCursor = inp.selectionStart; };
        inp.addEventListener('keyup', updateCursor);
        inp.addEventListener('mouseup', updateCursor);
        inp.addEventListener('touchend', updateCursor, { passive: true });
        inp.addEventListener('click', updateCursor);
        inp.addEventListener('input', updateCursor);
    }
    const tagInp = document.getElementById('tagInput');
    if (tagInp) {
        tagInp.addEventListener('focus', () => {
            if (typeof isMobileView === 'function' && isMobileView()) {
                setTimeout(() => { try { tagInp.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (_) {} }, 150);
            }
        });
    }
});
