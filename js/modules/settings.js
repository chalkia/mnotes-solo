/**
 * mNotes Settings & i18n Module
 */

window.mNotes = window.mNotes || {};
window.mNotes.ui = window.mNotes.ui || {};
window.mNotes.ui.settings = window.mNotes.ui.settings || {};

(function(settingsMod) {

    // ⚠️ Το currentLang δεν δηλωνόταν ΠΟΥΘΕΝΑ. Γεννιόταν μόνο την πρώτη φορά που
    // ο χρήστης πατούσε αλλαγή γλώσσας (toggleLanguage), με σιωπηρή ανάθεση σε
    // καθολική μεταβλητή. Όμως το applyTranslations το ΔΙΑΒΑΖΕΙ στην εκκίνηση —
    // οπότε σε κάθε φόρτωση έσκαγε "Uncaught ReferenceError: currentLang is not
    // defined", διακόπτοντας το initMNotesUI στη μέση: ό,τι αρχικοποιούνταν μετά
    // από εκείνο το σημείο δεν έτρεχε ποτέ.
    //
    // Σειρά προτεραιότητας ώστε να μη χαθεί επιλογή που έχει ήδη κάνει ο χρήστης:
    // η αποθηκευμένη γλώσσα, μετά η ρύθμιση του προφίλ, και τέλος τα ελληνικά —
    // που είναι και η προεπιλογή του ίδιου του userSettings.
    if (typeof window.currentLang === 'undefined' || !window.currentLang) {
        var _lang = null;
        try { _lang = localStorage.getItem('mnotes_lang'); } catch (e) { /* αποκλεισμένη αποθήκευση */ }
        if (!_lang) {
            try {
                var _saved = JSON.parse(localStorage.getItem('mnotes_settings') || '{}');
                _lang = _saved && _saved.lang;
            } catch (e) { /* κατεστραμμένες ρυθμίσεις */ }
        }
        window.currentLang = _lang || 'el';
    }

    settingsMod.open = function() {
        const modal = document.getElementById('settingsModal');
        if (!modal) return;

        if (typeof userSettings === 'undefined' || !userSettings) {
            userSettings = JSON.parse(localStorage.getItem('mnotes_settings')) || { theme: 'theme-slate', lang: 'el' };
        }

        const checkboxes = {
            'setWakeLock': userSettings.wakeLock,
            'setDisableSplit': userSettings.disableSplit,
            'setPrintLyricsOnly': userSettings.printLyricsOnly,
            'setShowScrollBtn': (typeof userSettings.showScrollBtn !== 'undefined') ? userSettings.showScrollBtn : true,
            /* removed setOnlySharps */
            'setForceMobile': userSettings.forceMobile || false,
            'setHideIntroInter': userSettings.hideIntroInter || false,
            'inpPermanentDeviceLock': userSettings.permanentDeviceLock || false,
            'pdfTableOfContents': (typeof userSettings.pdfTableOfContents !== 'undefined') ? userSettings.pdfTableOfContents : true,
            'pdfPageNumbers': (typeof userSettings.pdfPageNumbers !== 'undefined') ? userSettings.pdfPageNumbers : true,
            'pdfCoverPage': (typeof userSettings.pdfCoverPage !== 'undefined') ? userSettings.pdfCoverPage : true,
            'setShowChords': (typeof userSettings.showChords !== 'undefined') ? userSettings.showChords : true
        };

        for (let id in checkboxes) {
            const el = document.getElementById(id);
            if (el) el.checked = checkboxes[id] || false;
        }

        const values = {
            'setTheme': userSettings.theme || 'theme-dark',
            'setChordSize': userSettings.chordSize || 1,
            'setChordDist': userSettings.chordDist || 0,
            'setScrollSpeed': userSettings.scrollSpeed || 50,
            'setScrollDelay': userSettings.scrollDelay || 10,
            'setPlayDelay': (typeof userSettings.playDelay !== 'undefined') ? userSettings.playDelay : 0,
            'setRefFreq': userSettings.refFreq || 440,
            'setMaxCapo': userSettings.maxCapo || 12,
            'setAccidentalMode': userSettings.accidentalMode || 'scale'
        };

        for (let id in values) {
            const el = document.getElementById(id);
            if (el) el.value = values[id];
        }

        /* Ετοιμότητα offline, με μια ματιά. Χωρίς αυτό ο χρήστης μαθαίνει
           ότι δεν είναι έτοιμος τη στιγμή που δεν έχει δίκτυο. (07/09/2026) */
        (async function () {
            const el = document.getElementById('offlineStatusText');
            if (!el) return;
            try {
                if (!('serviceWorker' in navigator) || !navigator.serviceWorker.controller) {
                    el.innerHTML = '⚠️ Offline: <span style="color:var(--danger);">δεν είναι έτοιμο</span>';
                    return;
                }
                let mb = '';
                if (navigator.storage && navigator.storage.estimate) {
                    const est = await navigator.storage.estimate();
                    if (est && est.usage) mb = ' · ' + (est.usage / 1048576).toFixed(1) + ' MB';
                }
                let lock = '';
                if (navigator.storage && navigator.storage.persisted) {
                    lock = (await navigator.storage.persisted()) ? ' 🔒' : '';
                }
                el.innerHTML = '✅ Offline: <span style="color:var(--accent);">έτοιμο</span>' + mb + lock;
                if (typeof window.soloUpdateSettingsAssetsStatus === 'function') {
                    window.soloUpdateSettingsAssetsStatus(el);
                }
            } catch (err) {
                console.warn('[SETTINGS] Έλεγχος offline απέτυχε:', err);
                el.innerText = 'Offline: άγνωστο';
            }
        })();

        if (typeof window.renderFailedSyncList === 'function') {
            window.renderFailedSyncList();
        }

        // Το κουμπί εγκατάστασης δεν έχει νόημα αν τρέχουμε ήδη ως εφαρμογή.
        const instBtn = document.getElementById('btnInstallApp');
        if (instBtn && typeof isStandalone === 'function' && isStandalone()) {
            instBtn.style.display = 'none';
        }

        // Το κουμπί αναγκαστικού συγχρονισμού φαίνεται μόνο σε χρήστες με δικαίωμα CLOUD_SYNC.
        const forceSyncRow = document.getElementById('forceSyncContainer');
        if (forceSyncRow) {
            const canCloudSync = (typeof canUserPerform === 'function') && canUserPerform('CLOUD_SYNC');
            forceSyncRow.style.display = canCloudSync ? 'block' : 'none';
        }

        fetch('sw.js?t=' + Date.now())
            .then(response => response.text())
            .then(text => {
                const match = text.match(/(?:CACHE_NAME|version|VERSION)\s*[:=]\s*['"]([^'"]+)['"]/i);
                const verDisplay = document.getElementById('appVersionDisplay');
                if (match && verDisplay) {
                    verDisplay.innerText = "Build: " + match[1];
                } else {
                    if (verDisplay) verDisplay.innerText = "Build: " + t('msg_build_unknown');
                }
            })
            .catch(err => {
                console.error("❌ [SETTINGS] SW Fetch Error:", err);
                const verDisplay = document.getElementById('appVersionDisplay');
                if (verDisplay) verDisplay.innerText = "Build: " + t('msg_build_offline');
            });

        modal.style.display = 'flex';
    };

    settingsMod.close = function() {
        const modal = document.getElementById('settingsModal');
        if (modal) modal.style.display = 'none';
        settingsMod.applyTheme();
    };

    settingsMod.saveDeviceLock = function() {
        const isChecked = document.getElementById('inpPermanentDeviceLock').checked;
        const currentSettings = JSON.parse(localStorage.getItem('mnotes_settings') || "{}");
        currentSettings.permanentDeviceLock = isChecked;
        safeSetLocal('mnotes_settings', JSON.stringify(currentSettings));
        
        if (typeof registerDevice === 'function' && typeof currentUser !== 'undefined' && currentUser) {
            registerDevice(currentUser.id);
            showToast(t('msg_device_settings_updated'));
        }
    };

    settingsMod.save = async function() {
        userSettings.wakeLock = document.getElementById('setWakeLock')?.checked || false;
        userSettings.disableSplit = document.getElementById('setDisableSplit')?.checked || false;
        userSettings.printLyricsOnly = document.getElementById('setPrintLyricsOnly')?.checked || false;
        userSettings.accidentalMode = document.getElementById('setAccidentalMode')?.value || 'scale';
        userSettings.forceMobile = document.getElementById('setForceMobile')?.checked || false;
        userSettings.hideIntroInter = document.getElementById('setHideIntroInter')?.checked || false;
        userSettings.pdfTableOfContents = document.getElementById('pdfTableOfContents')?.checked ?? true;
        userSettings.pdfPageNumbers = document.getElementById('pdfPageNumbers')?.checked ?? true;
        userSettings.pdfCoverPage = document.getElementById('pdfCoverPage')?.checked ?? true;
        userSettings.showChords = document.getElementById('setShowChords')?.checked ?? true;
        
        const btnChk = document.getElementById('setShowScrollBtn');
        if (btnChk) userSettings.showScrollBtn = btnChk.checked;

        if (typeof requestWakeLock === 'function') requestWakeLock();

        const themeSel = document.getElementById('setTheme');
        if (themeSel) userSettings.theme = themeSel.value;



        const sizeInp = document.getElementById('setChordSize');
        const distInp = document.getElementById('setChordDist');
        const speedInp = document.getElementById('setScrollSpeed');
        const refFreqInp = document.getElementById('setRefFreq');

        if (sizeInp) userSettings.chordSize = parseFloat(sizeInp.value);
        if (distInp) userSettings.chordDist = parseInt(distInp.value);
        if (speedInp) userSettings.scrollSpeed = parseInt(speedInp.value);
        const delayInp = document.getElementById('setScrollDelay');
        if (delayInp) userSettings.scrollDelay = parseInt(delayInp.value);
        const playDelayInp = document.getElementById('setPlayDelay');
        if (playDelayInp) userSettings.playDelay = parseInt(playDelayInp.value) || 0;
        if (refFreqInp) userSettings.refFreq = parseInt(refFreqInp.value) || 440;
        
        const maxCapoInp = document.getElementById('setMaxCapo');
        if (maxCapoInp) userSettings.maxCapo = parseInt(maxCapoInp.value) || 12;

        safeSetLocal('mnotes_settings', JSON.stringify(userSettings));

        settingsMod.applyTheme();
        if (typeof applyScrollBtnVisibility === 'function') applyScrollBtnVisibility();
        settingsMod.applyMobileForce();
        
        settingsMod.close();

        if (typeof applySortAndRender === 'function') applySortAndRender();

        if (currentSongId && typeof library !== 'undefined') {
            const s = library.find(x => x.id === currentSongId);
            if (s && typeof renderPlayer === 'function') renderPlayer(s);
        }

        if (typeof window.updateIntroInterVisibility === 'function') {
            window.updateIntroInterVisibility();
        }

        showToast(t('msg_settings_saved'));
    };

    settingsMod.applyTheme = function(previewTheme) {
        if (typeof userSettings === 'undefined' || !userSettings) {
            try { userSettings = JSON.parse(localStorage.getItem('mnotes_settings')) || { theme: 'theme-slate', lang: 'el' }; }
            catch (e) { userSettings = { theme: 'theme-slate', lang: 'el' }; }
        }
        const toRemove = [...document.body.classList].filter(c => c.startsWith('theme-'));
        if (toRemove.length) document.body.classList.remove(...toRemove);
        const themeClass = (typeof previewTheme === 'string' && previewTheme) ? previewTheme : (userSettings.theme || 'theme-slate');
        if (themeClass) document.body.classList.add(themeClass);
        

        const root = document.documentElement; 
        ['--bg-main','--bg-panel','--text-main','--accent','--chord-color'].forEach(k => root.style.removeProperty(k)); 
        
        settingsMod.applyMobileForce();
        var newSize = 1.1 + ((userSettings.introScale || 0) * 0.11); 
        root.style.setProperty('--intro-size', newSize.toFixed(2) + "rem"); 
        document.body.style.setProperty('--chord-scale', userSettings.chordSize || 1);
        document.body.style.setProperty('--chord-mb', (userSettings.chordDist || 0) + "px");
        
        if (userSettings.chordColor && userSettings.chordColor !== 'default') {
            document.body.style.setProperty('--chord-color', userSettings.chordColor);
        } else {
            document.body.style.removeProperty('--chord-color'); 
        }
    };

    settingsMod.toggleLanguage = function() { 
        currentLang = (currentLang === 'en') ? 'el' : 'en'; 
        window.currentLang = currentLang; 
        safeSetLocal('mnotes_lang', currentLang); 
        console.log(`[i18n] Language switched to: ${currentLang}`);
        settingsMod.applyTranslations(); 
        if (typeof renderSidebar === 'function') renderSidebar(); 
        if (typeof populateTags === 'function') populateTags(); 
        if(currentSongId && String(currentSongId).includes('demo')) loadSong(currentSongId); 
    };

    settingsMod.applyTranslations = function() {
        if(typeof TRANSLATIONS === 'undefined') return; 
        
        document.querySelectorAll('[data-i18n]').forEach(el => { 
            var key = el.getAttribute('data-i18n'); 
            let transText = null;
            if (TRANSLATIONS[currentLang] && TRANSLATIONS[currentLang][key]) {
                transText = TRANSLATIONS[currentLang][key];
            } else {
                let otherLang = currentLang === 'en' ? 'el' : 'en';
                if (TRANSLATIONS[otherLang] && TRANSLATIONS[otherLang][key]) transText = TRANSLATIONS[otherLang][key];
            }

            if (transText) {
                if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
                    el.placeholder = transText;
                } else if (el.tagName === 'OPTION') {
                    el.innerText = transText;
                } else {
                    let icon = el.querySelector('i');
                    if (icon) {
                        el.innerHTML = '';
                        el.appendChild(icon);
                        el.appendChild(document.createTextNode(' ' + transText));
                    } else {
                        el.innerText = transText;
                    }
                }
            } 
        }); 

        document.querySelectorAll('[data-i18n-html]').forEach(el => { 
            var key = el.getAttribute('data-i18n-html'); 
            let transText = null;
            if (TRANSLATIONS[currentLang] && TRANSLATIONS[currentLang][key]) transText = TRANSLATIONS[currentLang][key];
            else {
                let otherLang = currentLang === 'en' ? 'el' : 'en';
                if (TRANSLATIONS[otherLang] && TRANSLATIONS[otherLang][key]) transText = TRANSLATIONS[otherLang][key];
            }
            if (transText) el.innerHTML = transText;
        });

        document.querySelectorAll('[data-i18n-title]').forEach(el => {
            var key = el.getAttribute('data-i18n-title');
            let transText = null;
            if (TRANSLATIONS[currentLang] && TRANSLATIONS[currentLang][key]) transText = TRANSLATIONS[currentLang][key];
            else {
                let otherLang = currentLang === 'en' ? 'el' : 'en';
                if (TRANSLATIONS[otherLang] && TRANSLATIONS[otherLang][key]) transText = TRANSLATIONS[otherLang][key];
            }
            if (transText) el.title = transText;
        });    
        var btn = document.getElementById('btnLang'); 
        if(btn) btn.innerHTML = (currentLang === 'en') ? '<i class="fas fa-globe"></i> EN' : '<i class="fas fa-globe"></i> EL'; 
    };

    settingsMod.applyMobileForce = function() {
        const chk = document.getElementById('setForceMobile');
        if (typeof userSettings !== 'undefined' && chk) {
            userSettings.forceMobile = chk.checked;
        }

        if (isMobileView()) {
            document.body.classList.add('mobile-layout-active');
            const d = document.getElementById('rightDrawer');
            if (d) d.classList.remove('open');

            const activeCol = document.querySelector('.col-nav.mobile-view-active, .col-stage.mobile-view-active, .col-tools.mobile-view-active');
            if (!activeCol) {
                if (typeof switchMobileTab === 'function') switchMobileTab('stage');
            }
        } else {
            document.body.classList.remove('mobile-layout-active');
            if (window.innerWidth > 1024) {
                document.querySelectorAll('.col-nav, .col-tools, .col-stage').forEach(el => el.classList.remove('mobile-view-active'));
                if (typeof toViewer === 'function') toViewer(true);
            }
        }

        if (typeof applyDrawerHandlePos === 'function') {
            applyDrawerHandlePos(typeof userSettings !== 'undefined' ? userSettings.drawerHandlePos : null);
        }
    };

    /**
     * Εμφάνιση του Account Modal με τα στοιχεία του χρήστη
     */
    window.openAccountModal = function() {
        console.log('🚀 openAccountModal was called!');
        const modal = document.getElementById('accountModal');
        if (modal && modal.parentElement !== document.body) { document.body.appendChild(modal); }
        if (!modal) {
            console.error('❌ openAccountModal: accountModal element not found!');
            return;
        }

        // Στοιχεία Χρήστη
        const emailEl = document.getElementById('accUserEmail');
        if (emailEl) emailEl.innerText = (typeof currentUser !== 'undefined' && currentUser) ? currentUser.email : "Guest User";

        const tierEl = document.getElementById('accUserTier');
        if (tierEl) {
            const limits = typeof getUserLimits === 'function' ? getUserLimits() : { label: 'Free' };
            tierEl.innerText = (limits.label || 'Free').toUpperCase();
        }

        const syncEl = document.getElementById('accSyncStatus');
        if (syncEl) {
            const canCloudSync = (typeof canUserPerform === 'function') && canUserPerform('CLOUD_SYNC');
            if (!canCloudSync) {
                syncEl.innerText = typeof t === 'function' ? t('lbl_local_only_sync', 'Μόνο στη συσκευή') : 'Μόνο στη συσκευή';
                syncEl.style.color = '#9e9e9e';
            } else {
                const isOnline = navigator.onLine;
                syncEl.innerText = isOnline ? (typeof t === 'function' ? t('lbl_active', 'Ενεργό') : 'Ενεργό') : (typeof t === 'function' ? t('lbl_offline', 'Offline') : 'Offline');
                syncEl.style.color = isOnline ? "#4db6ac" : "#ff5252";
            }
        }

        const countEl = document.getElementById('accSongCount');
        if (countEl) {
            const personalSongs = (typeof library !== 'undefined' && Array.isArray(library)) 
                ? library.filter(s => s && !s.group_id).length 
                : 0;
            countEl.innerText = personalSongs;
        }

        // Υπολογισμός Storage (ίδια πραγματική μέτρηση με το auth.js από bucket audio_files)
        if (typeof updateStorageUI === 'function') {
            updateStorageUI();
        }

        modal.style.display = 'flex';
        console.log('✅ openAccountModal: Set display=flex on accountModal', modal);
    };

    // --- Aliases ---
    window.openSettings = settingsMod.open;
    window.closeSettings = settingsMod.close;
    window.saveDeviceLockSetting = settingsMod.saveDeviceLock;
    window.saveSettings = settingsMod.save;
    window.applyTheme = settingsMod.applyTheme;
    window.toggleLanguage = settingsMod.toggleLanguage;
    window.applyTranslations = settingsMod.applyTranslations;
    window.applyMobileForce = settingsMod.applyMobileForce;

    // Εφαρμογή αποθηκευμένου θέματος στην εκκίνηση (μαζί με CSS variables)
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => settingsMod.applyTheme());
    } else {
        settingsMod.applyTheme();
    }

})(window.mNotes.ui.settings);
