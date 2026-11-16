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
            noteBtnHtml = `<button onclick="toggleStickyNotes()" title="${t('title_show_notes')}" style="background: #fbc02d; color: #000; border: none; border-radius: 50%; width: 26px; height: 26px; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; box-shadow: 0 2px 6px rgba(0,0,0,0.4); margin-left: 12px; transform: translateY(-2px); transition: transform 0.2s;" onmouseover="this.style.transform='translateY(-2px) scale(1.1)'" onmouseout="this.style.transform='translateY(-2px) scale(1)'"><i class="fas fa-thumbtack" style="font-size:0.85rem;"></i></button>`;
        }

        let tagsHtml = "";
        if (s.tags && Array.isArray(s.tags) && s.tags.length > 0) {
            tagsHtml = s.tags.map(tagVal => `
                <span onclick="filterByTag(event, '${tagVal}')" 
                      title="${t('title_filter_tag')}${tagVal}"
                      style="cursor:pointer; background:var(--accent); color:#000; padding:2px 8px; border-radius:12px; font-size:0.7rem; font-weight:bold; margin-right:5px; display:inline-block; margin-top:5px; box-shadow:0 2px 4px rgba(0,0,0,0.2); transition:transform 0.1s;" 
                      onmouseover="this.style.transform='scale(1.05)'" 
                      onmouseout="this.style.transform='scale(1)'">
                    #${tagVal}
                </span>`).join('');
        }

        let versionBadgeHtml = '';
        if (typeof window.getVersionGroup === 'function') {
            const vGroup = window.getVersionGroup(s.id);
            if (vGroup.length > 1) {
                const vIdx = vGroup.findIndex(v => v.id === s.id) + 1;
                const isMaster = !s.parent_id && !s.is_clone;
                const label = isMaster ? `<span style="color:var(--accent);font-weight:900;">★ Master</span>` : `v${vIdx}`;
                const ts = window.getCreationTimeFromId(s.id);
                const dateStr = ts ? new Date(ts).toLocaleDateString('el-GR', {day:'2-digit', month:'short'}) : '';
                versionBadgeHtml = `
                    <span style="display:inline-flex;align-items:center;gap:0;margin-left:8px;vertical-align:middle;">
                        <button onclick="window.switchVersion(-1)" style="background:none;border:1px solid rgba(255,255,255,0.25);border-right:none;color:var(--text-muted);border-radius:4px 0 0 4px;padding:1px 5px;cursor:pointer;font-size:0.65rem;line-height:1.6;" title="Προηγούμενη">◀</button>
                        <span title="${dateStr}" style="background:${isMaster ? 'rgba(255,152,0,0.2)' : 'rgba(255,255,255,0.07)'};border:1px solid ${isMaster ? 'rgba(255,152,0,0.5)' : 'rgba(255,255,255,0.2)'};border-left:none;border-right:none;padding:1px 7px;font-size:0.65rem;font-weight:bold;color:${isMaster ? 'var(--accent)' : 'var(--text-muted)'};white-space:nowrap;cursor:default;line-height:1.6;">${isMaster ? '★ Master' : `v${vIdx}/${vGroup.length}`}</span>
                        <button onclick="window.switchVersion(1)" style="background:none;border:1px solid rgba(255,255,255,0.25);border-left:none;color:var(--text-muted);border-radius:0 4px 4px 0;padding:1px 5px;cursor:pointer;font-size:0.65rem;line-height:1.6;" title="Επόμενη">▶</button>
                    </span>`;
            }
        }

        const headerContainer = document.querySelector('.player-header-container');
        if (headerContainer) {
            // 🚀 [V2.1.8] Prepare split button variables
            const isSplit = (window.songSplitOverride === 'force_split') || 
                            (window.songSplitOverride !== 'force_single' && (typeof userSettings !== 'undefined' ? !userSettings.disableSplit : true));
            const isOverridden = window.songSplitOverride !== null;
            const splitIcon = isSplit ? 'fa-columns' : 'fa-align-justify';
            const splitColor = isOverridden ? 'var(--accent)' : 'inherit';
            const splitBorder = isOverridden ? '2px solid var(--accent)' : '1px solid rgba(255,255,255,0.15)';
            const splitTitle = isSplit 
                ? (typeof t === 'function' ? t('title_force_single', 'Αλλαγή σε Ενιαία Προβολή (Προσωρινά)') : 'Αλλαγή σε Ενιαία Προβολή (Προσωρινά)')
                : (typeof t === 'function' ? t('title_force_split', 'Αλλαγή σε Στήλες (Προσωρινά)') : 'Αλλαγή σε Στήλες (Προσωρινά)');

            const isPlayed = (window.PlayedSet && window.PlayedSet.has(s.id));

            headerContainer.innerHTML = `
            <div class="player-header" style="position: relative;">
                <div id="stagePlayedBookmark" class="stage-played-bookmark ${isPlayed ? 'active' : ''}" title="${typeof t === 'function' ? t('lbl_song_highlight', 'Επισήμανση τραγουδιού (Μαρκάρισμα)') : 'Επισήμανση τραγουδιού (Μαρκάρισμα)'}" onclick="if(window.PlayedSet && typeof currentSongId !== 'undefined') { window.PlayedSet.toggle(currentSongId); if(navigator.vibrate) navigator.vibrate(40); }"></div>
                <div class="header-main-content">
                    <div class="stage-nav-buttons" style="position: absolute; top: 0; right: 42px; display: flex; gap: 8px; align-items: center; z-index: 10;">
                        <span id="stagePendingBadge" class="stage-pending-badge" title="Αλλαγές που δεν έχουν σταλεί" style="display:none;"></span>
                        <span id="stagePlayedBadge" style="display:none;"></span>
                        <button id="btnToggleSplit" onclick="toggleSongSplit()" class="round-btn" title="${splitTitle}" style="width: 42px; height: 42px; font-size: 1.1rem; display: flex; align-items: center; justify-content: center; cursor: pointer; color: ${splitColor}; border: ${splitBorder};"><i class="fas ${splitIcon}"></i></button>
                        <button id="btnEditSong" onclick="switchToEditor()" class="round-btn btn-edit-stage" title="${t('btn_edit', 'Επεξεργασία')}" style="width: 42px; height: 42px; font-size: 1.1rem; display: flex; align-items: center; justify-content: center; cursor: pointer;"><i class="fas fa-pen"></i></button>
                        <button onclick="navSetlist(-1)" class="round-btn" title="Προηγούμενο" style="width: 42px; height: 42px; font-size: 1.1rem; display: flex; align-items: center; justify-content: center; cursor: pointer;"><i class="fas fa-step-backward"></i></button>
                        <button onclick="navSetlist(1)" class="round-btn" title="Επόμενο" style="width: 42px; height: 42px; font-size: 1.1rem; display: flex; align-items: center; justify-content: center; cursor: pointer;"><i class="fas fa-step-forward"></i></button>
                    </div>
                    <h2 id="mainAppTitle" class="${isPlayed ? 'title-marked' : ''}" style="margin:0 0 5px 0; font-size:1.2rem; color:var(--text-main); display:flex; align-items:center; flex-wrap:wrap; padding-right:200px;">
                         <span>${s.title} ${s.artist ? `<span style="font-size:0.9rem; opacity:0.6;">- ${s.artist}</span>` : ''}${versionBadgeHtml}</span>
                         ${noteBtnHtml}
                    </h2>
                     <div style="margin-bottom: 8px;">${tagsHtml}</div>
                     <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 8px;">
                         <div style="display:flex; align-items:center; gap: 10px;">
                            <button class="key-badge" onclick="transUp()" title="${t('title_change_key')}" style="color: var(--accent); font-size: 1.8rem; font-weight: 900; text-shadow: 0 2px 5px rgba(0,0,0,0.4); border: 2px solid var(--accent); padding: 4px 12px; border-radius: 8px; background: rgba(0,0,0,0.2); cursor: pointer; transition: transform 0.1s; display: inline-flex; align-items: center; justify-content: center; line-height: 1;" onmouseover="this.style.transform='scale(1.05)'" onmouseout="this.style.transform='scale(1)'">${typeof getNote === 'function' ? getNote(s.key || "-", state.t, { baseKey: s.key, keyTranspose: state.t }) : s.key}</button>
                             <span id="stageCapoInfo" style="display:${state.c > 0 ? 'inline-block' : 'none'}; background-color:#e74c3c; color:#fff; padding:2px 6px; border-radius:4px; font-size:0.8rem; font-weight:bold; letter-spacing: 0.5px;">CAPO ${state.c}</span>
                             <button id="btnToggleView" onclick="toggleViewMode()"></button>
                         </div>
                    </div>
                </div>
            </div>`;
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
       
        const dValT = document.getElementById('val-t'); const dValC = document.getElementById('val-c');
        if(dValT) dValT.innerText = (state.t > 0 ? "+" : "") + state.t; if(dValC) dValC.innerText = state.c;
        const mValT = document.getElementById('drawer-val-t'); const mValC = document.getElementById('drawer-val-c');
        if(mValT) mValT.innerText = (state.t > 0 ? "+" : "") + state.t; if(mValC) mValC.innerText = state.c;

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
        const icon = document.getElementById('cpPlayIcon');
        if (!audioCore) return;
        
        if (audioCore.paused) {
            const delay = (typeof userSettings !== 'undefined' && typeof userSettings.playDelay !== 'undefined') ? parseInt(userSettings.playDelay) : 0;
            if (delay > 0 && typeof window.runPlayCountdown === 'function') {
                window.runPlayCountdown(delay, () => {
                    audioCore.play();
                    if (icon) { icon.classList.remove('fa-play'); icon.classList.add('fa-pause'); }
                }, () => {
                    audioCore.pause();
                    if (icon) { icon.classList.remove('fa-pause'); icon.classList.add('fa-play'); }
                });
            } else {
                audioCore.play();
                if (icon) { icon.classList.remove('fa-play'); icon.classList.add('fa-pause'); }
            }
        } else {
            if (window.activePlayCountdown) {
                window.activePlayCountdown.cancel();
            }
            audioCore.pause();
            if (icon) { icon.classList.remove('fa-pause'); icon.classList.add('fa-play'); }
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
        text = text.replace(new RegExp(`\\[${chordRx}\\]`, 'g'), "!$1 ");
        text = text.replace(new RegExp(`!${chordRx}!`, 'g'), "!$1 ");

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

            let rawLyrics = line.replace(new RegExp(`!${chordRx}!?`, 'g'), '');
            let hasText = /[\p{L}]/u.test(rawLyrics); 
            let isChordsOnly = !hasText;
            let rowClass = isChordsOnly ? 'line-row chords-only-row' : 'line-row';
            if (line.includes('|') && isChordsOnly) rowClass += ' chords-grid-row';
            row.className = rowClass;

            if (line.indexOf('!') === -1 || (typeof isLyricsMode !== 'undefined' && isLyricsMode)) { 
                let pureText = line;
                if (typeof isLyricsMode !== 'undefined' && isLyricsMode) {
                    pureText = rawLyrics.replace(/\s{2,}/g, ' ').trim(); 
                }
                let safeText = pureText;
                row.innerHTML = `<span class="lyric">${(safeText && safeText.length > 0) ? safeText : " "}</span>`; 
            } else { 
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

                // Append groups to the row
                groups.forEach(g => {
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

    player.toggleLyricsMode = function() {
        isLyricsMode = !isLyricsMode;
        if (isLyricsMode) {
            document.body.classList.add('lyrics-only');
            showToast(t('msg_lyrics_on'));
        } else {
            document.body.classList.remove('lyrics-only');
            showToast(t('msg_lyrics_off'));
        }
        var btn = document.getElementById('btnLyrics');
        if (btn) {
            if (isLyricsMode) btn.classList.add('active-btn'); 
            else btn.classList.remove('active-btn');
        }
        if (currentSongId && typeof library !== 'undefined') {
            const s = library.find(x => x.id === currentSongId);
            if (s) player.render(s);
        }
    };


    // 🚀 [V2.1.8] Ephemeral per-song split override toggle
    player.toggleSongSplit = function() {
        const isSplit = (window.songSplitOverride === 'force_split') || 
                        (window.songSplitOverride !== 'force_single' && (typeof userSettings !== 'undefined' ? !userSettings.disableSplit : true));
        
        if (isSplit) {
            window.songSplitOverride = 'force_single';
            showToast(typeof t === 'function' ? t('msg_view_single', "Ενιαία προβολή (Προσωρινά) 📄") : "Ενιαία προβολή (Προσωρινά) 📄");
        } else {
            window.songSplitOverride = 'force_split';
            showToast(typeof t === 'function' ? t('msg_view_split', "Προβολή στηλών (Προσωρινά) 🗂️") : "Προβολή στηλών (Προσωρινά) 🗂️");
        }
        
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

    const HOLD_MS = 750;
    const MOVE_TOLERANCE_PX = 10;
    const BODY_SELECTOR = '#fixed-container, #scroll-container, #mainAppTitle';

    let timer = null;
    let startX = 0;
    let startY = 0;

    function cancel() {
        if (timer) { clearTimeout(timer); timer = null; }
    }

    document.addEventListener('pointerdown', function (e) {
        const body = e.target.closest(BODY_SELECTOR);
        if (!body) return;
        // Αν το πάτημα έγινε σε κουμπί/πινέζα/σύνδεσμο, δεν ξεκινάμε long-press μαρκαρίσματος
        if (e.target.closest('button, a, input, textarea, select')) return;

        startX = e.clientX;
        startY = e.clientY;

        cancel();
        timer = setTimeout(function () {
            timer = null;
            if (window.PlayedSet && typeof currentSongId !== 'undefined' && currentSongId) {
                window.PlayedSet.toggle(currentSongId);
                // Η μόνη επιβεβαίωση στη σκηνή: toast θα σκέπαζε τους στίχους.
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

    // Το μενού αντιγραφής του κινητού διακόπτει το κράτημα.
    document.addEventListener('contextmenu', function (e) {
        if (e.target.closest(BODY_SELECTOR)) e.preventDefault();
    });
})();

