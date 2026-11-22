/* =========================================
   MAIN APPLICATION LOGIC - mNotes v18.1 (Modularized Entry Point)
   ========================================= */

var hasUnsavedChanges = false;
window.mRhythm = null;
window.isRhythmPlaying = false;

window.APP_CODENAME = 'Forte';

window.addEventListener('load', function() {
    console.log("π€ mNotes Pro Initializing...");
    
    setTimeout(() => {
        const appVer = (typeof window.MNOTES_VERSION === 'string' && window.MNOTES_VERSION) ? window.MNOTES_VERSION : '';
        const lastVer = localStorage.getItem('mnotes_last_version');
        if (typeof window.updateWhatsNewDot === 'function') window.updateWhatsNewDot();
        if (appVer && lastVer !== appVer) {
            if (lastVer) {
                // Ποτέ σε Play mode: παραλείπεται αν η Σκηνή είναι σε Play
                const inPlay = document.body && document.body.classList.contains('play-mode');
                if (!inPlay) {
                    safeSetLocal('mnotes_last_version', appVer);
                    if (typeof showToast === 'function') {
                        const msgPrefix = (typeof t === 'function')
                            ? t('msg_updated_to_version', 'Ενημερώθηκε στην v{ver}').replace('{ver}', appVer)
                            : `Ενημερώθηκε στην v${appVer}`;
                        const actionLbl = (typeof t === 'function') ? t('btn_whats_new_short', 'Τι νέο') : 'Τι νέο';
                        showToast(msgPrefix, 'info', {
                            durationMs: 8000,
                            actionLabel: actionLbl,
                            onAction: () => { if (typeof showWhatsNewModal === 'function') showWhatsNewModal(); }
                        });
                    }
                }
            } else {
                // New user or cleared cache, set silently to avoid popups on first use
                safeSetLocal('mnotes_last_version', appVer);
            }
        }
        window.__mnotesVersionCheckDone = true;
    }, 1500);

    // 0. Handle Setlist Invites (Guest Singers)
    const urlParams = new URLSearchParams(window.location.search);
    const inviteId = urlParams.get('invite');
    if (inviteId) {
        safeSetLocal('mnotes_pending_invite', inviteId);
        window.history.replaceState({}, document.title, window.location.pathname);
        console.log(`[INVITE] Detected invite ${inviteId}, saved to pending.`);
    }

    const joinCode = urlParams.get('join');
    if (joinCode) {
        safeSetLocal('mnotes_pending_join', joinCode.trim().toUpperCase());
        window.history.replaceState({}, document.title, window.location.pathname);
        console.log(`[JOIN] Detected band join code ${joinCode.trim().toUpperCase()}, saved to pending.`);
    }

    if (inviteId || joinCode) {
        (async () => {
            try {
                if (typeof supabaseClient !== 'undefined' && supabaseClient && supabaseClient.auth) {
                    const { data } = await supabaseClient.auth.getSession();
                    if (!data || !data.session) {
                        if (!window.__pendingLoginPrompted) {
                            window.__pendingLoginPrompted = true;
                            if (joinCode) {
                                if (typeof showToast === 'function') {
                                    showToast((typeof t === 'function' ? t('msg_login_to_join_band', "Συνδέσου για να μπεις στη μπάντα.") : "Συνδέσου για να μπεις στη μπάντα."), "warning");
                                }
                            } else if (inviteId) {
                                if (typeof showToast === 'function') {
                                    showToast((typeof t === 'function' ? t('auto_msg_103', "Απαιτείται σύνδεση ή εγγραφή για να προβάλετε την πρόσκληση.") : "Απαιτείται σύνδεση ή εγγραφή για να προβάλετε την πρόσκληση."), "warning");
                                }
                            }
                            setTimeout(() => {
                                if (typeof openAuthModal === 'function') openAuthModal();
                            }, 1000);
                        }
                    }
                }
            } catch (err) {
                console.warn("[AUTH] Error checking session for pending invite/join:", err);
            }
        })();
    }

    // 1. Core Logic Initialization
    if (typeof initMNotesUI === 'function') {
        initMNotesUI();
    }

    // 2. Rhythm Engine Setup
    if (typeof MNotesRhythmRuntime !== 'undefined') {
        window.mRhythm = new MNotesRhythmRuntime();
        window.mRhythm.onPlaybackStarted = () => { window.isRhythmPlaying = true; };
        window.mRhythm.onPlaybackStopped = () => { window.isRhythmPlaying = false; };
        console.log("πŸ¥  [RHYTHM] Engine initialized.");
    }

    // 3. Global Event Listeners
    window.addEventListener('online', () => {
        if (typeof updateOfflineState === 'function') updateOfflineState();
        if (typeof processSyncQueue === 'function') processSyncQueue();
    });

    /* Το offline event είναι αξιόπιστο (η διεπαφή όντως έπεσε). Το online
       ΔΕΝ σημαίνει ότι υπάρχει internet — γι' αυτό η κατάσταση «pending»
       κρίνεται από την ουρά, όχι από αυτό το event. (09/09/2026) */
    window.addEventListener('offline', () => {
        if (typeof updateOfflineState === 'function') updateOfflineState();
    });

    setupDirtyListeners();
    
    // 4. State Recovery
    appInitRestore();

    console.log("✅ App Ready");
});

async function appInitRestore() {
    const lastSongId = localStorage.getItem('mnotes_last_song');
    const viewState = localStorage.getItem('mnotes_view_state');

    if (lastSongId && typeof loadSong === 'function') {
        const preventMobileSwitch = (typeof isMobileView === 'function') && isMobileView();
        loadSong(lastSongId, false, preventMobileSwitch);
    }

    const savedStateRaw = localStorage.getItem('mnotes_app_state');
    if (!savedStateRaw) {
        // Ξ‘ΞΊΟŒΞΌΞ± ΞΊΞΉ Ξ±Ξ½ Ξ΄ΞµΞ½ Ο…Ο€Ξ¬Ο Ο‡ΞµΞΉ app_state, ΞµΞ»Ξ­Ξ³Ο‡Ο…Ο…Ξµ Ο„ΞΏ view state
        if (viewState === 'editor' && typeof switchToEditor === 'function') {
            // Μικρή καθυστέρηση για να τελειώσει το loadSong (που δεν είναι await)
            setTimeout(() => switchToEditor(), 50);
        }
        if (typeof updateOfflineState === 'function') updateOfflineState();
        return;
    }

    try {
        const state = JSON.parse(savedStateRaw);
        let targetGroup = state.groupId;
        
        // Anti-Corruption: Ξ‘Ξ½ Ο„ΞΏ Ξ±Ο€ΞΏΞΈΞ·ΞΊΞµΟ…Ο…ΞΌΞ­Ξ½ΞΏ groupId ΞµΞ―Ξ½Ξ±ΞΉ Song ID (s_...), Ξ³Ο Ο Ξ½Ξ± Ο„ΞΏ ΟƒΞµ personal
        if (targetGroup && targetGroup !== 'personal' && String(targetGroup).startsWith('s_')) {
            console.error("πŸ›΅οΈ  [Auto-Recovery] Invalid GroupID detected in AppState. Resetting to personal.");
            targetGroup = 'personal';
            if (typeof saveAppState === 'function') saveAppState('personal');
        }

        if (targetGroup && typeof switchContext === 'function') await switchContext(targetGroup);
        if (state.sidebarTab && typeof switchSidebarTab === 'function') switchSidebarTab(state.sidebarTab);
        
        // βœ… Ξ•Ο€Ξ±Ξ½Ξ±Ο†ΞΏΟ Ξ¬ editor ΞœΞ•Ξ¤Ξ‘ Ξ±Ο€ΟŒ loadSong ΞΌµ setTimeout Ξ³ΞΉΞ± Ξ½Ξ± ΞΌΞ·Ξ½ Ξ³Ξ―Ξ½ΞµΞΉ override
        if (viewState === 'editor' || state.viewMode === 'editor') {
            if (typeof switchToEditor === 'function') {
                setTimeout(() => switchToEditor(), 50);
            }
        }
    } catch (e) {
        console.error("β Œ [Restore Error]", e);
    }
    if (typeof updateOfflineState === 'function') updateOfflineState();
}

function setupDirtyListeners() {
    var inputs = document.querySelectorAll('#view-editor input, #view-editor textarea');
    inputs.forEach(el => { 
        el.addEventListener('input', () => { 
            hasUnsavedChanges = true; 
        });
    });
}

// --- Legacy Navigation Helpers (Redirected to Modules) ---
window.nextSong = () => { if (typeof navVisiblePlaylist === 'function') navVisiblePlaylist(1); };
window.prevSong = () => { if (typeof navVisiblePlaylist === 'function') navVisiblePlaylist(-1); };

window.addTrans = (n) => { if (typeof transUp === 'function') n > 0 ? transUp() : transDown(); };
window.addCapo = (n) => { if (typeof capoUp === 'function') n > 0 ? capoUp() : capoDown(); };
window.findSmartCapo = () => { if (typeof autoCapo === 'function') autoCapo(); };

// --- Admin Dashboard Access ---
let adminPressTimer;
function startAdminTimer(e) {
    if (e.type === 'contextmenu') e.preventDefault();
    adminPressTimer = setTimeout(() => {
        if (typeof currentUser === 'undefined' || !currentUser) return; 
        if (currentUser.email !== 'chalkia.duck@gmail.com') return; 
        
        // Ξ‘Ο†ΞΏΟ ΞµΟ€ΞΉΞ²ΞµΞ²Ξ±ΞΉΟΟƒΞΏΟ…ΞΌΞµ Ο„ΞΏ email, Ο€Ξ¬ΞΌΞµ ΟƒΟ„ΞΏ admin panel
        window.location.href = 'admin.html';
    }, 2000); // 2 Ξ΄ΞµΟ…Ο„ΞµΟΟΞ»ΞµΟ€Ο„Ξ± Ο€Ξ±ΟΞ±Ο„ΞµΟ„Ξ±ΞΌΞ­Ξ½ΞΏ Ο€Ξ¬Ο„Ξ·ΞΌΞ±
}
function cancelAdminTimer() { 
    clearTimeout(adminPressTimer); 
}

document.addEventListener('DOMContentLoaded', () => {
    const targets = ['btnAuthBottom', 'btnAuthDrawer'];
    targets.forEach(id => {
        const btn = document.getElementById(id);
        if (btn) {
            // Ξ“ΞΉΞ± Desktop (Ο€ΞΏΞ½Ο„Ξ―ΞΊΞΉ)
            btn.addEventListener('mousedown', startAdminTimer);
            btn.addEventListener('mouseup', cancelAdminTimer);
            btn.addEventListener('mouseleave', cancelAdminTimer);
            // Ξ“ΞΉΞ± Mobile (Ξ±Ο†Ξ®)
            btn.addEventListener('touchstart', startAdminTimer, {passive: true});
            btn.addEventListener('touchend', cancelAdminTimer);
            btn.addEventListener('touchcancel', cancelAdminTimer);
            
            btn.addEventListener('contextmenu', (e) => {
                if (typeof currentUser !== 'undefined' && currentUser && currentUser.email === 'chalkia.duck@gmail.com') {
                    e.preventDefault();
                    window.location.href = 'admin.html';
                }
            });
        }
    });
});



