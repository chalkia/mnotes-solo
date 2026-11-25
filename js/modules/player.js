/**
 * mNotes Player Module
 * Handles Song Rendering, Chords/Lyrics display, and Playback controls
 */

window.mNotes = window.mNotes || {};
window.mNotes.ui = window.mNotes.ui || {};
window.mNotes.ui.player = window.mNotes.ui.player || {};

(function(player) {

    function splitIntoWords(str) {
        if (!str) return [];
        let matches = str.match(/\S+\s*/g);
        if (!matches) return [str];
        let leadingSpaces = str.match(/^\s+/);
        if (leadingSpaces) {
            matches.unshift(leadingSpaces[0]);
        }
        return matches;
    }

    // --- State ---
    let strumDictionary = {};
    let strumCounter = 0;
    let markupDictionary = {};
    let markupCounter = 0;
    let ytPlayerInstance = null;
    let allowedYtPlay = false;

    // Key badge (+1 tap / -1 long-press or right-click) transient indicator state
    let keyBadgeArrow = null;
    let keyBadgeFadeTimer = null;
    let keyBadgeClearTimer = null;

    player.getKeyBadgeArrowHtml = function() {
        if (!keyBadgeArrow || Date.now() >= keyBadgeArrow.expiresAt) return '';
        const up = keyBadgeArrow.dir > 0;
        return `<span class="key-badge-dir ${up ? 'is-up' : 'is-down'}" aria-hidden="true">${up ? '▲' : '▼'}</span>`;
    };

    let _lastAutoHeaderSongId = null;
    let _preserveStageHeaderState = false;

    player.refreshPreserveHeader = function() {
        _preserveStageHeaderState = true;
        try {
            if (typeof refreshPlayerUI === 'function') refreshPlayerUI();
        } finally {
            _preserveStageHeaderState = false;
        }
    };

    player.triggerKeyBadge = function(dir) {
        const up = dir > 0;
        const isCapoMode = typeof userSettings !== 'undefined' && userSettings && userSettings.keyBadgeAction === 'capo';

        if (isCapoMode) {
            const curCapo = (typeof state !== 'undefined' && typeof state.c === 'number') ? state.c : 0;
            const rawMax = (typeof userSettings !== 'undefined' && userSettings.maxCapo !== undefined && userSettings.maxCapo !== '')
                ? parseInt(userSettings.maxCapo, 10)
                : 12;
            const maxCapo = Number.isFinite(rawMax) && rawMax >= 0 ? rawMax : 12;
            if ((!up && curCapo <= 0) || (up && curCapo >= maxCapo)) {
                return;
            }
        }

        clearTimeout(keyBadgeFadeTimer);
        clearTimeout(keyBadgeClearTimer);
        keyBadgeArrow = { dir: up ? 1 : -1, expiresAt: Date.now() + 700 };

        if (!up && typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
            navigator.vibrate(20);
        }
        _preserveStageHeaderState = true;
        try {
            if (isCapoMode) {
                if (up && typeof capoUp === 'function') capoUp();
                else if (!up && typeof capoDown === 'function') capoDown();
            } else {
                if (up && typeof transUp === 'function') transUp();
                else if (!up && typeof transDown === 'function') transDown();
            }
        } finally {
            _preserveStageHeaderState = false;
        }

        keyBadgeFadeTimer = setTimeout(() => {
            document.querySelectorAll('.player-header .key-badge .key-badge-dir').forEach(el => {
                el.classList.add('fading');
            });
        }, 380);
        keyBadgeClearTimer = setTimeout(() => {
            keyBadgeArrow = null;
            document.querySelectorAll('.player-header .key-badge .key-badge-dir').forEach(el => el.remove());
        }, 700);
    };

    const SPLIT_HORIZ_SVG = '<svg class="split-horiz-icon" width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="18" height="6.5" rx="1.5" fill="currentColor" opacity="0.9"/><rect x="3" y="13" width="12" height="2" rx="1" fill="currentColor"/><rect x="3" y="17" width="12" height="2" rx="1" fill="currentColor"/><rect x="3" y="21" width="10" height="2" rx="1" fill="currentColor"/><path d="M18.5 13v7m0 0-2.5-2.5m2.5 2.5 2.5-2.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>';

    player.getSplitState = function() {
        const isSplit = (window.songSplitOverride === 'force_split') ||
                        (window.songSplitOverride !== 'force_single' && (typeof userSettings !== 'undefined' ? !userSettings.disableSplit : true));
        const isOverridden = window.songSplitOverride !== null && window.songSplitOverride !== undefined;
        const iconHtml = isSplit ? SPLIT_HORIZ_SVG : '<i class="fas fa-align-justify" aria-hidden="true"></i>';
        const titleKey = isSplit ? 'title_split_active' : 'title_split_single';
        const fallbackTitle = isSplit
            ? 'Σταθερές συγχορδίες πάνω, κυλιόμενοι στίχοι'
            : 'Ενιαία κύλιση όλου του τραγουδιού';
        const title = (typeof t === 'function') ? t(titleKey, fallbackTitle) : fallbackTitle;
        return { isSplit, isOverridden, iconHtml, titleKey, title };
    };

    player.syncSplitButtons = function() {
        const info = player.getSplitState();
        ['btnToggleSplit', 'btnToggleSplitDesktop'].forEach(id => {
            const btn = document.getElementById(id);
            if (!btn) return;
            btn.innerHTML = info.iconHtml;
            btn.setAttribute('data-i18n-title', info.titleKey);
            btn.setAttribute('title', info.title);
            btn.setAttribute('aria-label', info.title);
            btn.setAttribute('aria-pressed', info.isSplit ? 'true' : 'false');
            btn.classList.toggle('active-btn', !!info.isSplit);
            btn.classList.toggle('split-overridden', !!info.isOverridden);
        });
    };

    player.syncViewModeButtons = function() {
        const mode = window.stageViewMode || 'full';
        const labelKey = mode === 'lyrics' ? 'mode_lyrics_only' : (mode === 'cues' ? 'mode_cues_only' : 'btn_lyrics_mode');
        const labelFallback = mode === 'lyrics' ? 'Μόνο στίχοι' : (mode === 'cues' ? 'Λέξεις-οδηγοί' : 'Λειτουργία Στίχων');
        const labelTxt = (typeof t === 'function') ? t(labelKey, labelFallback) : labelFallback;
        const isActive = mode !== 'full';

        const btnLyrics = document.getElementById('btnLyrics');
        if (btnLyrics) {
            btnLyrics.classList.toggle('active-btn', isActive);
            btnLyrics.setAttribute('aria-pressed', isActive ? 'true' : 'false');
            btnLyrics.setAttribute('data-i18n-title', labelKey);
            btnLyrics.setAttribute('title', labelTxt);
            btnLyrics.setAttribute('aria-label', labelTxt);
        }

        const drawerBtn = document.getElementById('viewModeToggle');
        if (drawerBtn) {
            drawerBtn.classList.toggle('active-btn', isActive);
            drawerBtn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
            drawerBtn.dataset.viewMode = mode;
            const span = drawerBtn.querySelector('span');
            if (span) {
                span.setAttribute('data-i18n', labelKey);
                span.textContent = labelTxt;
            }
        }
    };

    // --- Core Rendering ---

    player.renderEmptyState = function() {
        currentSongId = null;
        window.currentSongId = null;

        const headerContainer = document.querySelector('.player-header-container');
        if (headerContainer) headerContainer.innerHTML = '';
        const introBox = document.getElementById('intro-container');
        if (introBox) { introBox.innerHTML = ''; introBox.style.display = 'none'; }
        const stickyArea = document.getElementById('stickyNotesArea');
        if (stickyArea) stickyArea.style.display = 'none';
        const scrollBox = document.getElementById('scroll-container');
        if (scrollBox) scrollBox.innerHTML = '';

        const fixedBox = document.getElementById('fixed-container');
        if (fixedBox) {
            const searchVal = (document.getElementById('searchInp')?.value || '').trim();
            const tagVal = document.getElementById('tagFilter')?.value || '';
            const hasActiveLibrarySongs = Array.isArray(window.library) && window.library.some(s => s && !s.is_deleted);
            if ((searchVal !== '' || tagVal !== '') && hasActiveLibrarySongs) {
                const filterMsg = typeof t === 'function' ? t('msg_no_songs_filter', 'Κανένα τραγούδι με αυτό το φίλτρο') : 'Κανένα τραγούδι με αυτό το φίλτρο';
                const clearLbl = typeof t === 'function' ? t('btn_clear_filter', 'Καθαρισμός φίλτρου') : 'Καθαρισμός φίλτρου';
                fixedBox.innerHTML = `
                    <div id="emptyFilterStage" style="text-align:center; padding:60px 20px; color:var(--text-muted); max-width:420px; margin:0 auto;">
                        <i class="fas fa-filter" style="font-size:3rem; color:var(--accent); opacity:0.6; margin-bottom:18px; display:block;"></i>
                        <h3 style="margin:0 0 18px 0; color:var(--text-main); font-weight:600;">${filterMsg}</h3>
                        <button type="button" id="btnClearStageFilter" class="modal-btn accent" onclick="if(typeof clearLibraryFilters==='function') clearLibraryFilters()">
                            <i class="fas fa-times"></i> ${clearLbl}
                        </button>
                    </div>
                `;
                return;
            }
            const emptyMsg = typeof t === 'function' ? t('msg_library_empty_stage', 'Η βιβλιοθήκη σου είναι άδεια') : 'Η βιβλιοθήκη σου είναι άδεια';
            const btnNewLbl = typeof t === 'function' ? t('btn_new_song', 'Νέο τραγούδι') : 'Νέο τραγούδι';
            const btnImpLbl = typeof t === 'function' ? t('btn_import_short', 'Εισαγωγή') : 'Εισαγωγή';
            const btnSampleLbl = typeof t === 'function' ? t('btn_load_sample_songs', 'Φόρτωσε δοκιμαστικά τραγούδια') : 'Φόρτωσε δοκιμαστικά τραγούδια';
            fixedBox.innerHTML = `
                <div style="text-align:center; padding:60px 20px; color:var(--text-muted); max-width:420px; margin:0 auto;">
                    <i class="fas fa-music" style="font-size:3rem; color:var(--accent); opacity:0.6; margin-bottom:18px; display:block;"></i>
                    <h3 style="margin:0 0 18px 0; color:var(--text-main); font-weight:600;">${emptyMsg}</h3>
                    <div style="display:flex; justify-content:center; gap:12px; flex-wrap:wrap;">
                        <button type="button" class="modal-btn accent" onclick="if(typeof createNewSong==='function') createNewSong()">
                            <i class="fas fa-plus"></i> ${btnNewLbl}
                        </button>
                        <button type="button" class="modal-btn" onclick="document.getElementById('hiddenFileInput')?.click()">
                            <i class="fas fa-file-import"></i> ${btnImpLbl}
                        </button>
                    </div>
                    <div style="margin-top:16px;">
                        <a href="#" onclick="event.preventDefault(); if(typeof loadSampleSongs==='function') loadSampleSongs();" style="color:var(--text-muted); font-size:0.85rem; text-decoration:underline; cursor:pointer;">${btnSampleLbl}</a>
                    </div>
                </div>
            `;
        }
    };
    window.renderEmptyStage = player.renderEmptyState;

    player.render = function(s) {
        if (!s) return;
        currentSongId = s.id;
        
        if (typeof saveAppState === 'function') saveAppState(currentGroupId, 'player');
        
        const sizeClass = `intro-size-${window.introSizeLevel || 0}`; 
        let pNote = s.notes || ""; 
        const bNote = s.conductorNotes || "";
        
        if (typeof currentGroupId !== 'undefined' && currentGroupId !== 'personal') {
            let myClone = library.find(x => x.is_clone && x.parent_id === s.id && x.user_id === currentUser?.id);
            if (myClone && myClone.notes && myClone.notes.trim() !== "") {
                pNote = myClone.notes; 
            }
        }

        const hasNotes = (bNote.trim().length > 0) || (pNote.trim().length > 0);
        const stickyArea = document.getElementById('stickyNotesArea');
        const cNoteText = document.getElementById('conductorNoteText');
        const pNoteText = document.getElementById('personalNoteText');
        
        if (stickyArea) {
            if (hasNotes) {
                stickyArea.style.display = 'none';
                if (cNoteText) cNoteText.innerText = bNote ? t('lbl_maestro') + bNote : "";
                if (pNoteText) pNoteText.innerText = pNote ? t('lbl_me') + pNote : "";
            } else {
                stickyArea.style.display = 'none';
            }
        }

        if (typeof updateBandHubUI === 'function') updateBandHubUI();

        const introContainer = document.getElementById('intro-container');
        const introText = s.intro;
        const interText = s.inter || s.interlude;

        if (introContainer) {
            const hasIntro = Boolean(introText && introText.trim().length > 0);
            const hasInter = Boolean(interText && interText.trim().length > 0);

            if (hasIntro || hasInter) {
                let introHtml = '';
                if (hasIntro) {
                    introHtml += `<div class="intro-row"><span class="intro-label">Intro:</span> <span class="intro-content">${parseMetaLine(introText)}</span></div>`;
                }
                if (hasInter) {
                    introHtml += `<div class="intro-row"><span class="intro-label">Inter:</span> <span class="intro-content">${parseMetaLine(interText)}</span></div>`;
                }
                introContainer.innerHTML = introHtml;
                introContainer.style.display = '';
            } else {
                introContainer.innerHTML = '';
                introContainer.style.display = 'none';
            }
        }
        
        let noteBtnHtml = '';
        if (hasNotes) {
            noteBtnHtml = `<button type="button" id="btnStageStickyNote" class="stage-note-pin-btn" onclick="toggleStickyNotes()" title="${t('title_show_notes')}"><i class="fas fa-thumbtack"></i></button>`;
        }

        let tagsHtml = "";
        if (s.tags && Array.isArray(s.tags) && s.tags.length > 0) {
            tagsHtml = `<div class="stage-tags-row">` + s.tags.map(tagVal => `
                <span class="stage-tag-btn" onclick="filterByTag(event, '${tagVal}')" title="${t('title_filter_tag')}${tagVal}">#${tagVal}</span>`).join('') + `</div>`;
        }

        const isSolo = (typeof window.currentEdition === 'function' ? window.currentEdition() === 'solo' : window.MNOTES_EDITION === 'solo');
        const isBandCtx = !isSolo && typeof currentGroupId !== 'undefined' && currentGroupId !== 'personal';
        const activeGroup = isBandCtx && typeof myGroups !== 'undefined' && Array.isArray(myGroups)
            ? myGroups.find(g => String(g.id) === String(currentGroupId))
            : null;
        const _isSoloMode = (typeof isSolo !== 'undefined' && isSolo) || (typeof window.currentEdition === 'function' && window.currentEdition() === 'solo');
        const _escBadge = (str) => String(str || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        let bandBadgeHtml = '';
        if (!_isSoloMode) {
            if (isBandCtx && activeGroup && activeGroup.name) {
                const fullName = _escBadge(activeGroup.name);
                bandBadgeHtml = `<span class="stage-band-badge" title="${fullName}"><span class="sbb-ico" aria-hidden="true">👥</span><span class="sbb-name">${fullName}</span></span>`;
            } else {
                const persLbl = _escBadge(t('stage_personal_badge', 'Προσωπικό'));
                bandBadgeHtml = `<span class="stage-band-badge is-personal" title="${persLbl}"><span class="sbb-name">${persLbl}</span></span>`;
            }
        }

        let versionClusterParts = [];
        if (typeof window.getVersionGroup === 'function') {
            const vGroup = window.getVersionGroup(s.id);
            if (vGroup.length > 1 || (!isSolo && s.is_clone)) {
                const isMaster = !s.parent_id && !s.is_clone;
                const extraCount = Math.max(0, vGroup.length - 1);
                const ts = typeof window.getCreationTimeFromId === 'function' ? window.getCreationTimeFromId(s.id) : 0;
                const dateStr = ts ? new Date(ts).toLocaleDateString('el-GR', { day: '2-digit', month: 'short' }) : '';
                const verTip = s.is_clone
                    ? t('title_personal_clone', 'Προσωπική έκδοση')
                    : `${vGroup.length} ${t('lbl_versions', 'εκδόσεις')}${dateStr ? ' · ' + dateStr : ''}`;
                const starTxt = isMaster ? '★' : '';
                const countTxt = extraCount > 0 ? `+${extraCount}` : '';
                const cloneTxt = s.is_clone ? '✎' : '';
                const pillLabel = [starTxt, t('lbl_my_version', 'Η έκδοσή μου'), countTxt, cloneTxt].filter(Boolean).join(' ');
                if (vGroup.length > 1) {
                    versionClusterParts.push(`
                        <span class="ver-switch-pill" title="${verTip}">
                            <button type="button" class="ver-nav-btn" onclick="window.switchVersion(-1)" title="${t('btn_prev', 'Προηγούμενη')}">◀</button>
                            <span class="ver-label" onclick="window.switchVersion(1)">${pillLabel}</span>
                            <button type="button" class="ver-nav-btn" onclick="window.switchVersion(1)" title="${t('btn_next', 'Επόμενη')}">▶</button>
                        </span>`);
                } else {
                    versionClusterParts.push(`<span class="ver-switch-pill" title="${verTip}"><span class="ver-label">${pillLabel}</span></span>`);
                }
            }
        }
        const hasTwinDiff = !isSolo && ((s._diverged_bands && s._diverged_bands.length > 0) || s._personal_twin === 'diff');
        const hasTwinSame = !isSolo && !hasTwinDiff && s._personal_twin === 'same';
        if (hasTwinDiff) {
            const diffTip = (s._diverged_bands && s._diverged_bands.length > 1)
                ? t('title_diverged_many', `Αποκλίνει από ${s._diverged_bands.length} μπάντες`).replace('${bandCount}', s._diverged_bands.length)
                : t('title_diverged_one', 'Αποκλίνει από τη μπάντα — η έκδοσή σας διαφέρει');
            versionClusterParts.push(`<span class="badge-twin-stage diff" title="${diffTip}">📖 ${t('lbl_twin_diff', '! Διαφέρει')}</span>`);
        } else if (hasTwinSame) {
            versionClusterParts.push(`<span class="badge-twin-stage same" title="${t('title_twin_same', 'Ίδια έκδοση με τα προσωπικά σας')}">📖 ${t('lbl_twin_same', 'Ίδιο στα προσωπικά')}</span>`);
        }
        const versionClusterHtml = versionClusterParts.length > 0
            ? `<span id="stageVersionCluster" class="stage-version-cluster">${versionClusterParts.join('')}</span>`
            : '';

        const headerContainer = document.querySelector('.player-header-container');
        if (headerContainer) {
            // 🚀 [V2.1.8] Prepare split button variables
            const splitInfo = player.getSplitState();

            const isPlayed = (window.PlayedSet && window.PlayedSet.has(s.id));
            const isCapoMode = typeof userSettings !== 'undefined' && userSettings && userSettings.keyBadgeAction === 'capo';
            const curCapo = (typeof state !== 'undefined' && typeof state.c === 'number') ? state.c : 0;
            const badgeTitleKey = isCapoMode ? 'ttl_key_badge_capo' : 'title_change_key';
            const badgeTitleTxt = isCapoMode
                ? t('ttl_key_badge_capo', 'Πάτημα: +1 Capo · Παρατεταμένο / δεξί κλικ: −1')
                : t('title_change_key', 'Πάτημα: +1 ημιτόνιο · Παρατεταμένο / δεξί κλικ: −1');
            const badgeCapoHtml = isCapoMode
                ? `<span class="key-badge-capo${curCapo > 0 ? '' : ' is-zero'}">Capo ${curCapo}</span>`
                : '';

            headerContainer.innerHTML = `
            <div class="player-header" style="position: relative;">
                <div id="stagePlayedBookmark" class="stage-played-bookmark ${isPlayed ? 'active' : ''}" title="${typeof t === 'function' ? t('lbl_song_highlight', 'Επισήμανση τραγουδιού (Μαρκάρισμα)') : 'Επισήμανση τραγουδιού (Μαρκάρισμα)'}" onclick="if(window.PlayedSet && typeof currentSongId !== 'undefined') { window.PlayedSet.toggle(currentSongId); if(navigator.vibrate) navigator.vibrate(40); }"></div>
                <div class="header-main-content">
                    <div class="stage-header-top-row" style="display: flex; justify-content: space-between; align-items: flex-start; gap: 8px; margin-bottom: 3px;">
                        <h2 id="mainAppTitle" class="${isPlayed ? 'title-marked' : ''}" style="margin:0; color:var(--text-main); display:flex; align-items:center; flex-wrap:nowrap; flex:1; min-width:0; overflow:hidden;">
                             <span>${s.title} ${s.artist ? `<span class="stage-artist-sub">- ${s.artist}</span>` : ''}</span>
                        </h2>
                        <div class="stage-nav-buttons" style="display: flex; gap: 6px; align-items: center; flex-shrink: 0; z-index: 10;">
                            <span id="stagePendingBadge" class="stage-pending-badge" title="Αλλαγές που δεν έχουν σταλεί" style="display:none;"></span>
                            <span id="stagePlayedBadge" style="display:none;"></span>
                            <button id="btnToggleSplit" onclick="toggleSongSplit()" class="round-btn ${splitInfo.isSplit ? 'active-btn' : ''}${splitInfo.isOverridden ? ' split-overridden' : ''}" data-i18n-title="${splitInfo.titleKey}" title="${splitInfo.title}" aria-label="${splitInfo.title}" aria-pressed="${splitInfo.isSplit ? 'true' : 'false'}" style="width: 44px; height: 44px; font-size: 1.1rem; display: flex; align-items: center; justify-content: center; cursor: pointer;">${splitInfo.iconHtml}</button>
                            <button id="btnEditSong" onclick="switchToEditor()" class="round-btn btn-edit-stage" title="${t('btn_edit', 'Επεξεργασία')}" style="width: 44px; height: 44px; font-size: 1.1rem; display: flex; align-items: center; justify-content: center; cursor: pointer;"><i class="fas fa-pen"></i></button>
                            <button onclick="navSetlist(-1)" class="round-btn" title="Προηγούμενο" style="width: 44px; height: 44px; font-size: 1.1rem; display: flex; align-items: center; justify-content: center; cursor: pointer;"><i class="fas fa-step-backward"></i></button>
                            <button onclick="navSetlist(1)" class="round-btn" title="Επόμενο" style="width: 44px; height: 44px; font-size: 1.1rem; display: flex; align-items: center; justify-content: center; cursor: pointer;"><i class="fas fa-step-forward"></i></button>
                        </div>
                    </div>
                     ${tagsHtml}
                     <div class="stage-header-meta-row" style="display:flex; justify-content:space-between; align-items:center; gap:8px;">
                         <div class="stage-key-cluster" style="display:flex; align-items:center; gap: 8px; flex-wrap:wrap;">
                            <button type="button" class="key-badge" data-i18n-title="${badgeTitleKey}" data-i18n-aria="${badgeTitleKey}" title="${badgeTitleTxt}" aria-label="${badgeTitleTxt}">${typeof getNote === 'function' ? getNote(s.key || "-", state.t, { baseKey: s.key, keyTranspose: state.t }) : s.key}${badgeCapoHtml}${player.getKeyBadgeArrowHtml()}</button>
                             <span id="stageCapoInfo" style="display:${state.c > 0 ? 'inline-block' : 'none'}; background-color:#e74c3c; color:#fff; padding:2px 6px; border-radius:4px; font-size:0.8rem; font-weight:bold; letter-spacing: 0.5px;">CAPO ${state.c}</span>
                             <button id="btnToggleView" onclick="toggleViewMode()"></button>
                             ${bandBadgeHtml}
                             ${versionClusterHtml}
                         </div>
                         ${noteBtnHtml}
                    </div>
                </div>
            </div>`;

            const compactBand = document.getElementById('compactBarBand');
            if (compactBand) {
                compactBand.textContent = (isBandCtx && activeGroup && activeGroup.name) ? `👥 ${activeGroup.name}` : '';
                compactBand.style.display = (isBandCtx && activeGroup && activeGroup.name) ? 'inline-flex' : 'none';
            }
            const compactTwinWarn = document.getElementById('compactBarTwinWarn');
            if (compactTwinWarn) {
                compactTwinWarn.style.display = hasTwinDiff ? 'inline-flex' : 'none';
                if (hasTwinDiff) compactTwinWarn.title = t('title_diverged_one', 'Αποκλίνει από τη μπάντα — η έκδοσή σας διαφέρει');
            }
            const compactTitle = document.getElementById('compactBarTitle');
            if (compactTitle) compactTitle.textContent = s.title || '';
            const compactKey = document.getElementById('compactBarKey');
            if (compactKey) {
                const keyTxt = (typeof getNote === 'function' && s.key) ? getNote(s.key, state.t, { baseKey: s.key, keyTranspose: state.t }) : (s.key || '');
                compactKey.textContent = keyTxt;
                compactKey.style.display = keyTxt ? 'inline-block' : 'none';
            }
            const compactBpm = document.getElementById('compactBarBpm');
            if (compactBpm) {
                const bpmParts = [];
                if (s.meter || s.time_signature) bpmParts.push(s.meter || s.time_signature);
                if (s.bpm) bpmParts.push(s.bpm);
                const bpmTxt = bpmParts.join(' · ');
                compactBpm.textContent = bpmTxt;
                compactBpm.style.display = bpmTxt ? 'inline-block' : 'none';
            }
        }

        const vidBox = document.getElementById('video-sidebar-container');
        const embedBox = document.getElementById('video-embed-box');
        if (vidBox && embedBox) {
            if (s.video && s.video.trim() !== '') {
                const ytId = (typeof getYoutubeId === 'function') ? getYoutubeId(s.video) : null;
                if (ytId) {
                    player.loadYoutubeVideo(ytId);
                } else {
                    if (ytPlayerInstance && typeof ytPlayerInstance.destroy === 'function') {
                        try { ytPlayerInstance.destroy(); } catch(e) {}
                        ytPlayerInstance = null;
                    }
                    embedBox.innerHTML = player.getMediaEmbedHtml(s.video);
                }
                vidBox.style.display = 'block';
            } else { 
                vidBox.style.display = 'none'; 
                if (ytPlayerInstance && typeof ytPlayerInstance.destroy === 'function') {
                    try { ytPlayerInstance.destroy(); } catch(e) {}
                    ytPlayerInstance = null;
                }
            }
        }

        if(typeof renderRecordingsList === 'function') renderRecordingsList(s.recordings || []); 
        if(typeof renderAttachmentsList === 'function') renderAttachmentsList(s.attachments || []);
        if(typeof renderRhythmsList === 'function') renderRhythmsList(s.rhythms || []);
       
        if (typeof updateTransDisplay === 'function') {
            updateTransDisplay();
        } else {
            const dValT = document.getElementById('val-t'); const dValC = document.getElementById('val-c');
            if(dValT) dValT.innerText = (state.t > 0 ? "+" : "") + state.t; if(dValC) dValC.innerText = state.c;
            const mValT = document.getElementById('drawer-val-t'); const mValC = document.getElementById('drawer-val-c');
            if(mValT) mValT.innerText = (state.t > 0 ? "+" : "") + state.t; if(mValC) mValC.innerText = state.c;
        }
        player.syncSplitButtons();
        player.syncViewModeButtons();

        var split = { fixed: "", scroll: s.body || "" }; 
        if (!isLyricsMode && typeof splitSongBody === 'function') {
            split = splitSongBody(s.body || "");
        }
        
        // Το τραγούδι περνιέται ρητά: η renderArea χρειάζεται την τονικότητά του
        // για να ορθογραφήσει σωστά τις μεταφερμένες συγχορδίες (δίεση ή ύφεση).
        player.renderArea('fixed-container', split.fixed, s);
        player.renderArea('scroll-container', split.scroll, s);
        
        const fixedEl = document.getElementById('fixed-container');
        if (fixedEl) {
            fixedEl.style.display = split.fixed ? 'block' : 'none';
        }
        updateToggleButton(s); 
        if (typeof GuitarChordsUI !== 'undefined') {
            GuitarChordsUI.scanAndRender(s);
        }
        if (window.PlayedSet) {
            window.PlayedSet.paintCounters();
        }
        if (typeof updateOfflineState === 'function') updateOfflineState();
        if (typeof player.applyAutoFit === 'function') {
            player.applyAutoFit();
        }
        // Αν το τραγούδι χωράει ολόκληρο στην οθόνη (χωρίς κύλιση), ανοίγουμε την κεφαλίδα· αλλιώς συμπαγής μπάρα.
        // Εξαίρεση: όταν γίνεται ανανέωση επί τόπου στο ίδιο τραγούδι (π.χ. πάτημα .key-badge για key/capo),
        // ΔΕΝ κλείνουμε την κεφαλίδα αν την έχει ανοίξει ο χρήστης.
        if (typeof isMobileView === 'function' && isMobileView() && !document.body.classList.contains('play-mode')) {
            if (!_preserveStageHeaderState && s.id !== _lastAutoHeaderSongId) {
                _lastAutoHeaderSongId = s.id;
                document.body.classList.add('stage-tools-open');
                const sc = document.getElementById('scroll-container');
                const fc = document.getElementById('fixed-container');
                const scFits = !sc || sc.scrollHeight <= sc.clientHeight + 2;
                const fcFits = !fc || fc.style.display === 'none' || fc.scrollHeight <= fc.clientHeight + 2;
                if (!scFits || !fcFits) {
                    document.body.classList.remove('stage-tools-open');
                }
            }
            if (typeof window.updateCompactExpandArrow === 'function') window.updateCompactExpandArrow();
        }
    };

    player.getMediaEmbedHtml = function(url) {
        if (!url) return '';
        if (typeof getYoutubeId === 'function') {
            const ytId = getYoutubeId(url);
            if (ytId) {
                return `<iframe src="https://www.youtube.com/embed/${ytId}" frameborder="0" allowfullscreen style="width:100%; height:100%; position:absolute; top:0; left:0; border-radius: 8px;"></iframe>`;
            }
        }
        const spotifyRegex = /spotify\.com\/(track|album|playlist)\/([a-zA-Z0-9]+)/;
        const spotMatch = url.match(spotifyRegex);
        if (spotMatch) {
            const type = spotMatch[1];
            const id = spotMatch[2];
            return `<iframe src="https://open.spotify.com/embed/${type}/${id}" width="100%" height="100%" frameborder="0" allowtransparency="true" allow="encrypted-media" style="border-radius: 8px; position:absolute; top:0; left:0;"></iframe>`;
        }
        if (url.includes('soundcloud.com')) {
            const encodedUrl = encodeURIComponent(url);
            return `<iframe width="100%" height="100%" scrolling="no" frameborder="no" allow="autoplay" src="https://w.soundcloud.com/player/?url=${encodedUrl}&color=%23ff5500&auto_play=false&hide_related=true&show_comments=false&show_user=false&show_reposts=false&show_teaser=false&visual=true" style="border-radius: 8px; position:absolute; top:0; left:0;"></iframe>`;
        }
        if (url.includes('music.apple.com')) {
            const appleUrl = url.replace('music.apple.com', 'embed.music.apple.com');
            return `<iframe allow="autoplay *; encrypted-media *; fullscreen *; clipboard-write" frameborder="0" height="100%" style="width:100%; overflow:hidden; background:transparent; border-radius:8px; position:absolute; top:0; left:0;" sandbox="allow-forms allow-popups allow-same-origin allow-scripts allow-storage-access-by-user-activation allow-top-navigation-by-user-activation" src="${appleUrl}"></iframe>`;
        }
        return `
            <div style="display:flex; align-items:center; justify-content:center; height:100%; width:100%; position:absolute; top:0; left:0; background:rgba(0,0,0,0.2); border-radius:8px; border: 1px dashed var(--border-color);">
                <a href="${url}" target="_blank" style="color:var(--accent); text-decoration:none; font-weight:bold; font-size: 0.9rem; padding: 10px 20px; border: 1px solid var(--accent); border-radius: 20px; transition: 0.2s transform;" onmouseover="this.style.transform='scale(1.05)'" onmouseout="this.style.transform='scale(1)'">
                    <i class="fas fa-external-link-alt"></i> ${t('btn_open_external')}
                </a>
            </div>
        `;
    };

    player.toggleCustomPlayer = function() {
        const audioCore = document.getElementById('masterAudio');
        if (!audioCore) return;
        
        if (audioCore.paused) {
            const delay = (typeof userSettings !== 'undefined' && typeof userSettings.playDelay !== 'undefined') ? parseInt(userSettings.playDelay) : 0;
            if (delay > 0 && typeof window.runPlayCountdown === 'function') {
                window.runPlayCountdown(delay, () => {
                    audioCore.play();
                }, () => {
                    audioCore.pause();
                });
            } else {
                audioCore.play();
            }
        } else {
            if (window.activePlayCountdown) {
                window.activePlayCountdown.cancel();
            }
            audioCore.pause();
        }
    };

    player.seekCustomPlayer = function(val) {
        const audioCore = document.getElementById('masterAudio');
        if (!audioCore || !audioCore.duration) return;
        audioCore.currentTime = audioCore.duration * (val / 100);
    };

    player.formatMarkup = function(text, song) {
        if (!text) return text;
        markupDictionary = {};
        markupCounter = 0;
        strumDictionary = {};
        strumCounter = 0;
        let transposeVal = (typeof state !== 'undefined' && state.t !== undefined) ? (state.t - state.c) : 0;
        let baseKey = (song && song.key) ? song.key : "-";
        const cRx = "([A-G][b#]?[a-zA-Z0-9#\\/+-]*|[a-g][b#]?)(?![a-z])";

        // 0. Clean any {define: ...} directives from rendered lyrics (§Σ7.2)
        text = text.replace(/\{define:.*?\}/gi, '');

        // 1. Comments: !com ... !/ or ChordPro {c: ...} / {comment: ...} (§Σ7.1)
        text = text.replace(/(?:!com\s*(?::\s*)?([\s\S]*?)(?:!\/|$)|\{(?:comment|c):\s*([\s\S]*?)\})/gi, function(match, p1, p2) {
            let commentText = (p1 !== undefined ? p1 : p2) || "";
            commentText = commentText.trim();
            if (!commentText) return "";

            // Transpose any chords inside comment (e.g. [Am] or !Am!)
            commentText = commentText.replace(new RegExp(`\\[(${cRx})\\]`, 'g'), (m, chord) => {
                let noteDisp = chord;
                if (typeof getNote === 'function') {
                    try { noteDisp = getNote(chord, transposeVal, { baseKey: baseKey, keyTranspose: transposeVal }); } catch(e) {}
                }
                return `<span class="chord inline-chord" style="margin:0 3px;">${noteDisp}</span>`;
            });
            commentText = commentText.replace(new RegExp(`!(${cRx})!`, 'g'), (m, chord) => {
                let noteDisp = chord;
                if (typeof getNote === 'function') {
                    try { noteDisp = getNote(chord, transposeVal, { baseKey: baseKey, keyTranspose: transposeVal }); } catch(e) {}
                }
                return `<span class="chord inline-chord" style="margin:0 3px;">${noteDisp}</span>`;
            });

            let finalHtml = `<span class="stage-cue-pill"><i class="fas fa-info-circle"></i> <span>${commentText}</span></span>`;
            let placeholderId = `___CUE_${markupCounter++}___`;
            markupDictionary[placeholderId] = finalHtml;
            let isOwnLine = match.endsWith('\n');
            return placeholderId + (isOwnLine ? "\n" : " ");
        });

        // 2. Strumming: !str: ... !/ or !str ... !/ or !strum: ... !/ (§Σ7.1)
        text = text.replace(/(?:!(?:strum|str)\s*(?::\s*)?([^\n!]*?)(?:!\/|!|$|\n)|\{strum:\s*([^}]*?)\})/gi, function(match, p1, p2) {
            let pattern = (p1 !== undefined ? p1 : p2) || "";
            let visualStrum = (pattern || "").trim().toUpperCase().split('').map(char => {
                if (char === 'D') return '<span style="margin:0 2px; font-weight:900;">↓</span>';
                if (char === 'U') return '<span style="margin:0 2px; font-weight:900;">↑</span>';
                if (char === 'X' || char === '*') return '<span style="margin:0 2px; color:var(--danger, #dc3545); font-weight:900;">✖</span>';
                if (char === ' ') return '<span style="margin:0 4px;"></span>'; 
                return `<span style="margin:0 2px; font-weight:bold;">${char}</span>`;
            }).join('');
            
            let finalHtml = `<span class="strum-inline" style="display:inline-block; background:var(--bg-panel, #eee); border:1px solid var(--border-color, #ccc); padding:2px 8px; border-radius:6px; margin:2px 5px; color:var(--text-main, #000); font-size:0.9rem; font-family:sans-serif; transform:translateY(-2px);"><i class="fas fa-guitar" style="color:var(--accent, #00ff00); margin-right:5px;"></i>${visualStrum}</span>`;
            
            let placeholderId = `___STRUM_${markupCounter++}___`;
            markupDictionary[placeholderId] = finalHtml;
            strumDictionary[placeholderId] = finalHtml;
            let isOwnLine = match.endsWith('\n');
            return placeholderId + (isOwnLine ? "\n" : " ");
        });

        text = text.replace(/___STRUM_\d+___!/g, match => match.slice(0, -1));

        // 3. Inline ABC Scores: !score Name @id !/
        const escHtml = (str) => String(str == null ? '' : str)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
        const atts = (song && Array.isArray(song.attachments)) ? song.attachments : [];
        const abcInlineEnabled = (typeof userSettings === 'undefined' || userSettings.abcInline !== false);

        text = text.replace(/!score\s+([\s\S]*?)\s*!\//gi, function(match, innerRaw) {
            const raw = (innerRaw || '').trim();
            if (!raw) return '';
            const atMatch = raw.match(/^(.*?)\s+@([^\s@]+)$/);
            const scoreName = (atMatch ? atMatch[1] : raw).trim();
            const scoreId = atMatch ? atMatch[2].trim() : '';

            let matched = null;
            if (scoreId) {
                matched = atts.find(a => a && String(a.id || '') === scoreId);
            }
            if (!matched && scoreName) {
                const targetLower = scoreName.toLowerCase();
                matched = atts.find(a => {
                    if (!a || !a.name) return false;
                    const n = String(a.name).trim().toLowerCase();
                    return n === targetLower || n.replace(/\.abc$/i, '') === targetLower;
                });
            }

            let finalHtml = '';
            if (!matched) {
                const disp = scoreName || scoreId || 'ABC';
                const missingMsg = (typeof t === 'function')
                    ? t('msg_missing_score', 'Λείπει η παρτιτούρα «{name}»').replace('{name}', escHtml(disp))
                    : `Λείπει η παρτιτούρα «${escHtml(disp)}»`;
                finalHtml = `<div class="stage-inline-abc stage-inline-abc-missing"><i class="fas fa-exclamation-triangle"></i> <span>${missingMsg}</span></div>`;
            } else if (!abcInlineEnabled) {
                const dispName = escHtml(String(matched.name || scoreName || 'ABC').replace(/\.abc$/i, ''));
                const safeUrl = String(matched.url || '').replace(/'/g, "\\'");
                const safeTitle = String(matched.name || scoreName || 'ABC').replace(/'/g, "\\'");
                finalHtml = `<button type="button" class="stage-inline-abc stage-inline-abc-link" onclick="if(typeof showScoreInLayer==='function') showScoreInLayer('${safeUrl}','${safeTitle}')"><i class="fas fa-music"></i> <span>${dispName}</span></button>`;
            } else {
                const dispName = escHtml(String(matched.name || scoreName || 'ABC').replace(/\.abc$/i, ''));
                const safeUrl = escHtml(matched.url || '');
                const safeId = escHtml(matched.id || scoreId || '');
                const inlineAttr = matched.content ? ` data-abc-inline="${escHtml(matched.content)}"` : '';
                finalHtml = `<div class="stage-inline-abc" data-abc-url="${safeUrl}" data-abc-id="${safeId}"${inlineAttr}><div class="stage-inline-abc-title"><i class="fas fa-music"></i> <span>${dispName}</span></div><div class="stage-inline-abc-paper"></div></div>`;
            }

            const placeholderId = `___SCORE_${markupCounter++}___`;
            markupDictionary[placeholderId] = finalHtml;
            return placeholderId + (match.endsWith('\n') ? '\n' : ' ');
        });

        return text;
    };

    player.formatStrumming = function(text) {
        return player.formatMarkup(text, null);
    };

    player.renderArea = function(elemId, text, song) {
        var container = document.getElementById(elemId);
        if (!container) return;

        container.innerHTML = ""; 
        if (!text) return;
        text = player.formatMarkup(text, song);
        const chordRx = "([A-G][b#]?[a-zA-Z0-9#\\/+-]*|[a-g][b#]?)(?![a-z])";

        var lines = text.split('\n'); 
        let currentSection = null;
        let currentSectionType = null;

        function renderRow(line, index, parent) {
            var row = document.createElement('div');
            let trimmed = line.trim();

            if (trimmed === '') {
                row.className = 'line-row'; 
                row.innerHTML = `<span class="lyric"> </span>`;
                parent.appendChild(row);
                return;
            }

            // Cue pill placeholder check (render directly without lyric wrapper)
            if (trimmed.startsWith('___CUE_') && trimmed.endsWith('___')) {
                row.className = 'line-row cue-row';
                row.innerHTML = trimmed;
                parent.appendChild(row);
                return;
            }

            let rawLyrics = line
                .replace(new RegExp(`\\[${chordRx}\\]`, 'g'), '')
                .replace(new RegExp(`!${chordRx}!?`, 'g'), '');
            let hasText = /[\p{L}]/u.test(rawLyrics); 
            let isChordsOnly = !hasText;
            let rowClass = isChordsOnly ? 'line-row chords-only-row' : 'line-row';
            if (line.includes('|') && isChordsOnly) rowClass += ' chords-grid-row';
            row.className = rowClass;

            if ((line.indexOf('!') === -1 && line.indexOf('[') === -1) || (typeof isLyricsMode !== 'undefined' && isLyricsMode)) { 
                if (window.stageViewMode === 'cues') return;
                let pureText = line;
                if (typeof isLyricsMode !== 'undefined' && isLyricsMode) {
                    pureText = rawLyrics.replace(/\s{2,}/g, ' ').trim(); 
                }
                let safeText = pureText;
                row.innerHTML = `<span class="lyric">${(safeText && safeText.length > 0) ? safeText : " "}</span>`; 
            } else { 
                line = line.replace(new RegExp(`\\[${chordRx}\\]`, 'g'), "!$1 ");
                line = line.replace(new RegExp(`!${chordRx}!`, 'g'), "!$1 ");
                var parts = line.split('!'); 
                let rawTokens = [];
                if (parts[0]) {
                    let words = splitIntoWords(parts[0]);
                    words.forEach(w => rawTokens.push({ chord: "", lyric: w }));
                }
                
                for (var i = 1; i < parts.length; i++) { 
                    var m = parts[i].match(new RegExp(`^${chordRx}\\s?(.*)`)); 
                    if (m) {
                        let chordRaw = m[1];
                        let lyricsRaw = m[2] || ""; 
                        let noteDisp = chordRaw;
                        try {
                            if (typeof getNote === 'function' && typeof state !== 'undefined') {
                                var _baseKey = (song && song.key) ? song.key : "-";
                                noteDisp = getNote(chordRaw, state.t - state.c, { baseKey: _baseKey, keyTranspose: state.t - state.c });
                            }
                        } catch (err) {
                            console.error(
                                '[RENDER] Αποτυχία μεταφοράς συγχορδίας «' + chordRaw + '» ' +
                                '(γραμμή ' + (index + 1) + '):', err
                            );
                        }
                        
                        let words = splitIntoWords(lyricsRaw);
                        if (words.length === 0) {
                            rawTokens.push({ chord: noteDisp, lyric: "" });
                        } else {
                            rawTokens.push({ chord: noteDisp, lyric: words[0] });
                            for (let j = 1; j < words.length; j++) {
                                rawTokens.push({ chord: "", lyric: words[j] });
                            }
                        }
                    } else {
                        let words = splitIntoWords(parts[i] || "");
                        words.forEach(w => rawTokens.push({ chord: "", lyric: w }));
                    }
                }

                // Group adjacent tokens into word groups
                let groups = [];
                let currentGroup = [];
                rawTokens.forEach(t => {
                    if (currentGroup.length === 0) {
                        currentGroup.push(t);
                    } else {
                        let prev = currentGroup[currentGroup.length - 1];
                        let endsWithSpace = /\s$/.test(prev.lyric);
                        let startsWithSpace = /^\s/.test(t.lyric);
                        if (!endsWithSpace && !startsWithSpace) {
                            currentGroup.push(t);
                        } else {
                            groups.push(currentGroup);
                            currentGroup = [t];
                        }
                    }
                });
                if (currentGroup.length > 0) {
                    groups.push(currentGroup);
                }

                // Append groups to the row (with optional Cue-Words filtering: Ε3)
                const isCuesMode = (window.stageViewMode === 'cues' && !isChordsOnly);
                const renderGroups = isCuesMode
                    ? groups.filter(g => g.some(tok => tok.chord && tok.chord.trim() !== ''))
                    : groups;
                if (isCuesMode && renderGroups.length === 0) return;

                renderGroups.forEach((g, gIdx) => {
                    if (isCuesMode && gIdx > 0) {
                        const sep = document.createElement('span');
                        sep.className = 'cue-ellipsis';
                        sep.textContent = ' … ';
                        row.appendChild(sep);
                    }
                    if (g.length === 1) {
                        row.appendChild(player.createToken(g[0].chord, g[0].lyric, isChordsOnly));
                    } else {
                        let grpDiv = document.createElement('div');
                        grpDiv.className = 'token-group';
                        g.forEach(t => {
                            grpDiv.appendChild(player.createToken(t.chord, t.lyric, isChordsOnly));
                        });
                        row.appendChild(grpDiv);
                    }
                });
            } 
            parent.appendChild(row);
        }

        lines.forEach((line, index) => { 
            // Section tags checking
            // 1. Check Start of section: !cho, !ver, !bri, !tab (and legacy !soc, !sov, !sob, !sot or ChordPro)
            let startMatch = line.match(/(?:!(cho|ver|bri|tab)\b|!(soc|sov|sob|sot)\b!?|\{(soc|sov|sob|sot|start_of_chorus|start_of_verse|start_of_bridge|start_of_tab)\})/i);
            if (startMatch) {
                let rawTag = (startMatch[1] || startMatch[2] || startMatch[3] || '').toLowerCase();
                let sectionType = 'chorus';
                let sectionClass = 'chorus-section';
                let labelText = (typeof t === 'function' ? t('lbl_chorus') : null) || 'ΡΕΦΡΕΝ';
                let labelIcon = 'fa-redo';

                if (rawTag.includes('v') || rawTag.includes('verse')) {
                    sectionType = 'verse';
                    sectionClass = 'verse-section';
                    labelText = (typeof t === 'function' ? t('lbl_verse') : null) || 'ΚΟΥΠΛΕ';
                    labelIcon = 'fa-paragraph';
                } else if (rawTag.includes('b') || rawTag.includes('bridge')) {
                    sectionType = 'bridge';
                    sectionClass = 'bridge-section';
                    labelText = (typeof t === 'function' ? t('lbl_bridge') : null) || 'ΓΕΦΥΡΑ';
                    labelIcon = 'fa-link';
                } else if (rawTag.includes('t') || rawTag.includes('tab')) {
                    sectionType = 'tab';
                    sectionClass = 'tab-section';
                    labelText = 'TAB';
                    labelIcon = 'fa-bars';
                }

                currentSection = document.createElement('div');
                currentSection.className = `song-section ${sectionClass}`;
                if (sectionType === 'chorus') {
                    let lbl = document.createElement('div');
                    lbl.className = 'section-label';
                    lbl.innerHTML = `<i class="fas ${labelIcon}"></i> ${labelText}`;
                    currentSection.appendChild(lbl);
                }
                container.appendChild(currentSection);
                currentSectionType = sectionType;

                line = line.replace(/(?:!(?:cho|ver|bri|tab)\b\s*|!(?:soc|sov|sob|sot)\b!?\s*|\{(?:soc|sov|sob|sot|start_of_chorus|start_of_verse|start_of_bridge|start_of_tab)\}\s*)/gi, '').trim();
                if (line.length === 0) {
                    return;
                }
            }

            // 2. Check End of section: !/ or legacy !eoc!, !eov!, !eob!, !eot! or ChordPro
            if (/!\/|!(?:eoc|eov|eob|eot)\b!?|\{(?:eoc|eov|eob|eot|end_of_chorus|end_of_verse|end_of_bridge|end_of_tab)\}/i.test(line)) {
                let stripped = line.replace(/\s*(!\/|!(?:eoc|eov|eob|eot)\b!?|\{(?:eoc|eov|eob|eot|end_of_chorus|end_of_verse|end_of_bridge|end_of_tab)\})\s*$/gi, '').trim();
                if (stripped.length > 0) {
                    renderRow(stripped, index, currentSection || container);
                }
                currentSection = null;
                currentSectionType = null;
                return;
            }

            renderRow(line, index, currentSection || container);
        }); 

        let finalHtmlContent = container.innerHTML;
        Object.keys(markupDictionary).forEach(placeholder => {
            finalHtmlContent = finalHtmlContent.replace(placeholder, markupDictionary[placeholder]);
        });
        container.innerHTML = finalHtmlContent;
        if (typeof player.renderInlineAbcScores === 'function') {
            player.renderInlineAbcScores(container);
        }
    };

    const _inlineAbcTextCache = {};
    player.renderInlineAbcScores = function(container) {
        if (!container || typeof container.querySelectorAll !== 'function') return;
        const nodes = container.querySelectorAll('.stage-inline-abc[data-abc-url], .stage-inline-abc[data-abc-inline]');
        if (!nodes.length) return;
        const vt = (typeof state !== 'undefined' && state) ? ((state.t || 0) - (state.c || 0)) : 0;

        nodes.forEach((el, idx) => {
            const paper = el.querySelector('.stage-inline-abc-paper');
            if (!paper) return;
            if (!paper.id) paper.id = `stage-inline-abc-paper-${Date.now()}-${idx}`;
            const inlineText = el.getAttribute('data-abc-inline');
            const url = el.getAttribute('data-abc-url') || '';

            const paintAbc = (abcText) => {
                if (typeof ABCJS !== 'undefined') {
                    ABCJS.renderAbc(paper.id, abcText, {
                        responsive: 'resize',
                        add_classes: true,
                        staffwidth: 680,
                        visualTranspose: vt
                    });
                } else {
                    paper.textContent = abcText;
                }
            };

            if (inlineText) {
                paintAbc(inlineText);
            } else if (url) {
                if (_inlineAbcTextCache[url]) {
                    paintAbc(_inlineAbcTextCache[url]);
                } else if (url.startsWith('local://') && typeof window.soloGetLocalAssetText === 'function') {
                    window.soloGetLocalAssetText(url).then(txt => {
                        if (txt) { _inlineAbcTextCache[url] = txt; paintAbc(txt); }
                    }).catch(() => {});
                } else {
                    fetch(url).then(r => {
                        if (!r.ok) throw new Error('HTTP ' + r.status);
                        return r.text();
                    }).then(txt => {
                        _inlineAbcTextCache[url] = txt;
                        paintAbc(txt);
                    }).catch(err => {
                        console.warn('[InlineABC] Failed to load score:', url, err);
                    });
                }
            }
        });
    };

    player.createToken = function(c, l, isChordsOnly) { 
        var d = document.createElement('div'); 
        d.className = 'token'; 
        let safeLyric = l || "";
        if (isChordsOnly) {
            d.innerHTML = `<span class="chord inline-chord">${c || ""}${safeLyric}</span>`;
        } else {
            let chordHtml = (c && c.trim() !== "") ? `<span class="chord">${c}</span>` : `<span class="chord empty"> </span>`;
            let lyricHtml = `<span class="lyric">${safeLyric !== "" ? safeLyric : " "}</span>`;
            d.innerHTML = chordHtml + lyricHtml; 
        }
        return d; 
    };

    player.applyAutoFit = function() {
        const enabled = (typeof userSettings !== 'undefined' && !!userSettings.autoFitLyrics);
        if (!enabled) {
            if (document.documentElement.dataset.autoFitApplied === '1') {
                document.documentElement.style.removeProperty('--lyric-size');
                delete document.documentElement.dataset.autoFitApplied;
            }
            return;
        }
        const containers = ['scroll-container', 'fixed-container']
            .map(id => document.getElementById(id))
            .filter(el => el && el.clientWidth > 0);
        if (containers.length === 0) return;

        let px = 20.8;
        const minPx = 13;
        document.documentElement.dataset.autoFitApplied = '1';

        function anyRowWraps() {
            for (const c of containers) {
                const rows = c.querySelectorAll('.line-row');
                for (const row of rows) {
                    const tokens = row.querySelectorAll('.token, .token-group');
                    if (tokens.length < 2) continue;
                    const firstTop = tokens[0].getBoundingClientRect().top;
                    const lastTop = tokens[tokens.length - 1].getBoundingClientRect().top;
                    if (lastTop - firstTop > 6) return true;
                }
            }
            return false;
        }

        document.documentElement.style.setProperty('--lyric-size', px + 'px');
        while (px > minPx && anyRowWraps()) {
            px = Math.max(minPx, px - 0.5);
            document.documentElement.style.setProperty('--lyric-size', px + 'px');
        }
    };

    window.stageViewMode = window.stageViewMode || 'full';

    player.toggleLyricsMode = function() {
        const order = ['full', 'lyrics', 'cues'];
        const curIdx = order.indexOf(window.stageViewMode || 'full');
        const nextMode = order[(curIdx + 1) % order.length];
        window.stageViewMode = nextMode;
        isLyricsMode = (nextMode === 'lyrics');

        document.body.classList.toggle('lyrics-only', nextMode === 'lyrics');
        document.body.classList.toggle('cues-only', nextMode === 'cues');

        if (typeof showToast === 'function') {
            if (nextMode === 'lyrics') showToast(t('msg_lyrics_on', 'Μόνο στίχοι'));
            else if (nextMode === 'cues') showToast(t('mode_cues_only', 'Λέξεις-οδηγοί'));
            else showToast(t('msg_lyrics_off', 'Πλήρες'));
        }
        player.syncViewModeButtons();
        if (currentSongId && typeof library !== 'undefined') {
            const s = library.find(x => x.id === currentSongId);
            if (s) player.render(s);
        }
    };


    // 🚀 [V2.1.8] Ephemeral per-song split override toggle
    player.toggleSongSplit = function() {
        const isSplit = player.getSplitState().isSplit;
        
        if (isSplit) {
            window.songSplitOverride = 'force_single';
            showToast(typeof t === 'function' ? t('msg_view_single', "Ενιαία προβολή (Προσωρινά) 📄") : "Ενιαία προβολή (Προσωρινά) 📄");
        } else {
            window.songSplitOverride = 'force_split';
            showToast(typeof t === 'function' ? t('msg_view_split', "Προβολή στηλών (Προσωρινά) 🗂️") : "Προβολή στηλών (Προσωρινά) 🗂️");
        }
        
        player.syncSplitButtons();
        if (currentSongId) {
            const s = library.find(x => x.id === currentSongId);
            if (s) player.render(s);
        }
    };

    player.loadYoutubeVideo = function(ytId) {
        if (ytPlayerInstance && typeof ytPlayerInstance.destroy === 'function') {
            try {
                ytPlayerInstance.destroy();
            } catch(e) { console.warn("[YT] Destroy error:", e); }
            ytPlayerInstance = null;
        }
        allowedYtPlay = false;

        const container = document.getElementById('video-embed-box');
        if (!container) return;

        container.innerHTML = '<div id="yt-player-element" style="width:100%; height:100%; position:absolute; top:0; left:0; border-radius: 8px;"></div>';

        const initPlayer = () => {
            ytPlayerInstance = new YT.Player('yt-player-element', {
                videoId: ytId,
                playerVars: {
                    'autoplay': 0,
                    'controls': 1,
                    'rel': 0,
                    'showinfo': 0
                },
                events: {
                    'onStateChange': onPlayerStateChange
                }
            });
        };

        function onPlayerStateChange(event) {
            if (event.data === 1) {
                const delay = (typeof userSettings !== 'undefined' && typeof userSettings.playDelay !== 'undefined') ? parseInt(userSettings.playDelay) : 0;
                if (delay > 0 && !allowedYtPlay) {
                    try {
                        ytPlayerInstance.pauseVideo();
                    } catch(e) { console.warn("[YT] Pause error:", e); }
                    
                    if (typeof window.runPlayCountdown === 'function') {
                        window.runPlayCountdown(delay, () => {
                            allowedYtPlay = true;
                            try {
                                ytPlayerInstance.playVideo();
                            } catch(e) { console.warn("[YT] Play error:", e); }
                        }, () => {
                            try {
                                ytPlayerInstance.pauseVideo();
                            } catch(e) { console.warn("[YT] Pause error:", e); }
                            allowedYtPlay = false;
                        });
                    }
                } else {
                    allowedYtPlay = false;
                }
            } else if (event.data === 2) {
                allowedYtPlay = false;
            }
        }

        if (window.YT && window.YT.Player) {
            initPlayer();
        } else {
            if (!document.getElementById('yt-iframe-api-script')) {
                const tag = document.createElement('script');
                tag.id = 'yt-iframe-api-script';
                tag.src = "https://www.youtube.com/iframe_api";
                const firstScriptTag = document.getElementsByTagName('script')[0];
                firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);
            }
            
            const checkYTApi = setInterval(() => {
                if (window.YT && window.YT.Player) {
                    clearInterval(checkYTApi);
                    initPlayer();
                }
            }, 100);
        }
    };

    // --- Aliases ---
    window.renderPlayer = player.render;
    window.getMediaEmbedHtml = player.getMediaEmbedHtml;
    window.toggleCustomPlayer = player.toggleCustomPlayer;
    window.seekCustomPlayer = player.seekCustomPlayer;
    window.formatStrumming = player.formatStrumming;
    window.renderArea = player.renderArea;
    window.createToken = player.createToken;
    window.toggleLyricsMode = player.toggleLyricsMode;
    window.toggleSongSplit = player.toggleSongSplit;
})(window.mNotes.ui.player);

/* ─────────────────────────────────────────────────────────────
   Long-press στο σώμα του τραγουδιού = εναλλαγή «εκτελεσμένο».
   Delegation στο document επειδή τα #fixed-container / #scroll-container
   γεμίζουν με innerHTML σε κάθε renderArea.
   ΔΕΝ δένεται στα κουμπιά πλοήγησης: υπάρχουν ΔΥΟ ζεύγη με
   διαφορετικές συναρτήσεις (navSetlist στο player.js, navVisiblePlaylist
   στο index.html), οπότε λύση δεμένη εκεί θα δούλευε μισή. (04/09/2026)
   ───────────────────────────────────────────────────────────── */
(function () {
    'use strict';

    const HOLD_MS = 500;
    const MOVE_TOLERANCE_PX = 10;
    const TITLE_SELECTOR = '#mainAppTitle';

    let timer = null;
    let startX = 0;
    let startY = 0;

    function cancel() {
        if (timer) { clearTimeout(timer); timer = null; }
    }

    document.addEventListener('pointerdown', function (e) {
        if (document.body.classList.contains('play-mode') || window.isPlayModeActive) return;
        const titleEl = e.target.closest(TITLE_SELECTOR);
        if (!titleEl) return;
        // Αν το πάτημα έγινε σε κουμπί/πινέζα/σύνδεσμο, δεν ξεκινάμε long-press μαρκαρίσματος
        if (e.target.closest('button, a, input, textarea, select')) return;

        startX = e.clientX;
        startY = e.clientY;

        cancel();
        timer = setTimeout(function () {
            timer = null;
            if (document.body.classList.contains('play-mode') || window.isPlayModeActive) return;
            if (window.PlayedSet && typeof currentSongId !== 'undefined' && currentSongId) {
                window.PlayedSet.toggle(currentSongId);
                if (navigator.vibrate) navigator.vibrate(40);
            }
        }, HOLD_MS);
    });

    // Χωρίς αυτό, η αργή κύλιση με το δάχτυλο μαρκάρει τραγούδια κατά λάθος.
    document.addEventListener('pointermove', function (e) {
        if (!timer) return;
        if (Math.abs(e.clientX - startX) > MOVE_TOLERANCE_PX ||
            Math.abs(e.clientY - startY) > MOVE_TOLERANCE_PX) {
            cancel();
        }
    });

    document.addEventListener('pointerup', cancel);
    document.addEventListener('pointercancel', cancel);
    document.addEventListener('pointerleave', cancel);

    // Το μενού αντιγραφής του κινητού διακόπτει το κράτημα στον τίτλο.
    document.addEventListener('contextmenu', function (e) {
        if (e.target.closest(TITLE_SELECTOR)) e.preventDefault();
    });
})();

/* ─────────────────────────────────────────────────────────────
   Σήμα κλίμακας (.player-header .key-badge):
   Απλό πάτημα/κλικ (+1) · Παρατεταμένο πάτημα ~500ms ή δεξί κλικ (-1).
   Κάθε πάτημα ανεξάρτητο (χωρίς κατάσταση κατεύθυνσης).
   ───────────────────────────────────────────────────────────── */
(function () {
    const BADGE_SELECTOR = '.player-header .key-badge';
    const HOLD_MS = 500;
    const MOVE_TOLERANCE_PX = 10;

    let timer = null;
    let suppressNextClick = false;
    let suppressResetTimer = null;
    let startX = 0;
    let startY = 0;

    function cancelHold() {
        if (timer) {
            clearTimeout(timer);
            timer = null;
        }
    }

    function clearSuppressSoon() {
        clearTimeout(suppressResetTimer);
        suppressResetTimer = setTimeout(function () {
            suppressNextClick = false;
        }, 80);
    }

    document.addEventListener('pointerdown', function (e) {
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        const badge = e.target.closest(BADGE_SELECTOR);
        if (!badge) return;
        e.stopPropagation();

        // Νέο πάτημα -> ακυρώνει τυχόν υπόλοιπο suppression από προηγούμενη χειρονομία
        clearTimeout(suppressResetTimer);
        suppressNextClick = false;
        startX = e.clientX;
        startY = e.clientY;
        cancelHold();

        timer = setTimeout(function () {
            timer = null;
            suppressNextClick = true;
            if (window.mNotes && window.mNotes.ui && window.mNotes.ui.player && typeof window.mNotes.ui.player.triggerKeyBadge === 'function') {
                window.mNotes.ui.player.triggerKeyBadge(-1);
            } else if (typeof transDown === 'function') {
                transDown();
            }
        }, HOLD_MS);
    });

    document.addEventListener('pointermove', function (e) {
        if (!timer) return;
        if (Math.hypot(e.clientX - startX, e.clientY - startY) > MOVE_TOLERANCE_PX) {
            cancelHold();
        }
    });

    document.addEventListener('pointerup', function () {
        cancelHold();
        if (suppressNextClick) clearSuppressSoon();
    });

    document.addEventListener('pointercancel', function () {
        cancelHold();
        if (suppressNextClick) clearSuppressSoon();
    });

    document.addEventListener('click', function (e) {
        const badge = e.target.closest(BADGE_SELECTOR);
        if (!badge) return;
        e.stopPropagation();
        if (suppressNextClick) {
            e.preventDefault();
            clearTimeout(suppressResetTimer);
            suppressNextClick = false;
            return;
        }
        if (window.mNotes && window.mNotes.ui && window.mNotes.ui.player && typeof window.mNotes.ui.player.triggerKeyBadge === 'function') {
            window.mNotes.ui.player.triggerKeyBadge(1);
        } else if (typeof transUp === 'function') {
            transUp();
        }
    });

    document.addEventListener('contextmenu', function (e) {
        const badge = e.target.closest(BADGE_SELECTOR);
        if (!badge) return;
        e.preventDefault();
        e.stopPropagation();
        cancelHold();
        suppressNextClick = false;
        if (window.mNotes && window.mNotes.ui && window.mNotes.ui.player && typeof window.mNotes.ui.player.triggerKeyBadge === 'function') {
            window.mNotes.ui.player.triggerKeyBadge(-1);
        } else if (typeof transDown === 'function') {
            transDown();
        }
    });
})();

