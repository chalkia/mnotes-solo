/**
 * mNotes Editor Module
 * Handles Song Creation, Editing, and Metadata management
 */

window.mNotes = window.mNotes || {};
window.mNotes.ui = window.mNotes.ui || {};
window.mNotes.ui.editor = window.mNotes.ui.editor || {};

(function(editor) {

    // --- State ---
    editor.tags = [];

    // --- View Management ---

    editor.updateIntroInterVisibility = function(s) {
        const hideSetting = (typeof userSettings !== 'undefined' && !!userSettings.hideIntroInter);
        const introInp = document.getElementById('inpIntro');
        const interInp = document.getElementById('inpInter');

        let introVal = (s && typeof s.intro !== 'undefined') ? (s.intro || '') : (introInp?.value || '');
        let interVal = (s && (typeof s.inter !== 'undefined' || typeof s.interlude !== 'undefined')) 
            ? (s.inter || s.interlude || '') 
            : (interInp?.value || '');

        const hasIntro = introVal.trim().length > 0;
        const hasInter = interVal.trim().length > 0;
        const shouldHide = hideSetting && !hasIntro && !hasInter;

        const introContainer = introInp ? introInp.closest('.single-input-container') : null;
        const interContainer = interInp ? interInp.closest('.single-input-container') : null;

        if (introContainer) introContainer.style.display = shouldHide ? 'none' : '';
        if (interContainer) interContainer.style.display = shouldHide ? 'none' : '';
    };

    editor.switchTo = function() {
        if (typeof saveAppState === 'function') saveAppState(currentGroupId, 'editor');
        localStorage.setItem('mnotes_view_state', 'editor');
       
        if (typeof currentGroupId !== 'undefined' && currentGroupId !== 'personal' && currentSongId) {
            let s = library.find(x => x.id === currentSongId);
            
            if (s && !s.is_clone) {
                const existingClone = library.find(c => c.is_clone && c.parent_id === s.id && c.user_id === currentUser?.id);
                if (existingClone) {
                    alert(t('msg_clone_exists_alert', "Υπάρχει ήδη προσωπικός κλώνος για αυτό το τραγούδι.\nΘα μεταφερθείτε αυτόματα σε αυτόν για επεξεργασία."));
                    currentSongId = existingClone.id; 
                } else {
                    const isAdmin = roleCan('EDIT_BAND_MASTER');
                    if (isAdmin) {
                        showToast(t('msg_editing_master_band'), "warning");
                    } else {
                        alert(t('msg_editing_master_alert'));
                    }
                }
            }
        }
        
        document.getElementById('view-player').classList.remove('active-view'); 
        document.getElementById('view-editor').classList.add('active-view');
       
        let chordsGroup = document.getElementById('guitarChordsGroup');
        if (chordsGroup) chordsGroup.open = false; 
        
        if (typeof applyEditorPlaceholders === 'function') applyEditorPlaceholders();

        if (currentSongId) { 
            var s = library.find(x => x.id === currentSongId); 
            if (s) { 
                editor.refreshSyncButton(s);
                let editBody = s.body || "";
                let editIntro = s.intro || "";
                let editInter = s.interlude || "";
                let newKey = s.key || "";
                
                let netTranspose = parseInt(state.t || 0, 10); 
                
                if (netTranspose !== 0 && typeof getNote === 'function') {
                    const chordRxStr = "([A-G][b#]?[a-zA-Z0-9#\\/+-]*|[a-g][b#]?)(?![a-z])";
                    
                    const bracketRx = new RegExp(`\\[${chordRxStr}\\]`, 'g');
                    editBody = editBody.replace(bracketRx, (match, chord) => {
                        if (chord.toLowerCase().includes('horus') || chord.toLowerCase().includes('erse')) return match;
                        try { return `[${getNote(chord, netTranspose, { ignorePreferences: true, baseKey: s.key, keyTranspose: netTranspose })}]`; } 
                        catch(e) { return match; }
                    });

                    const bangRx = new RegExp(`!${chordRxStr}`, 'g');
                    const reservedTags = ['cho', 'ver', 'bri', 'tab', 'com', 'str', 'strum', '/', 'soc', 'eoc', 'sov', 'eov', 'sob', 'eob', 'sot', 'eot'];
                    editBody = editBody.replace(bangRx, (match, chord) => {
                        let cleanChord = chord.toLowerCase();
                        if (reservedTags.some(t => cleanChord.startsWith(t))) return match;
                        try { return `!${getNote(chord, netTranspose, { ignorePreferences: true, baseKey: s.key, keyTranspose: netTranspose })}`; } 
                        catch(e) { return match; }
                    });

                    const plainRx = new RegExp(chordRxStr, 'g');
                    editIntro = editIntro.replace(plainRx, (match) => {
                        try { return getNote(match, netTranspose, { ignorePreferences: true, baseKey: s.key, keyTranspose: netTranspose }); } catch(e) { return match; }
                    });
                    editInter = editInter.replace(plainRx, (match) => {
                        try { return getNote(match, netTranspose, { ignorePreferences: true, baseKey: s.key, keyTranspose: netTranspose }); } catch(e) { return match; }
                    });

                    if (newKey && newKey !== "-") {
                        try { newKey = getNote(newKey, netTranspose, { ignorePreferences: true, baseKey: s.key, keyTranspose: netTranspose }); } catch(e) {}
                    }
                    
                    state.t = 0;
                    if (typeof updateTransDisplay === 'function') updateTransDisplay();
                } 
                
                const savedDraftStr = localStorage.getItem('mnotes_draft_' + s.id);
                let draft = null;
                try { if (savedDraftStr) draft = JSON.parse(savedDraftStr); } catch(e){}

                document.getElementById('inpTitle').value = draft ? draft.title : (s.title || ""); 
                document.getElementById('inpArtist').value = draft ? draft.artist : (s.artist || ""); 
                document.getElementById('inpVideo').value = draft ? draft.video : (s.video || ""); 
                document.getElementById('inpKey').value = draft ? draft.key : newKey; 
                document.getElementById('inpBody').value = draft ? draft.body : editBody;
                if (typeof window.updateHighlights === 'function') window.updateHighlights();
                document.getElementById('inpIntro').value = draft ? draft.intro : editIntro; 
                document.getElementById('inpInter').value = draft ? draft.inter : editInter; 
                editor.updateIntroInterVisibility(draft || s);
                document.getElementById('inpPersonalNotes').value = draft ? draft.notes : (s.notes || ""); 
                document.getElementById('inpCapo').value = draft ? (draft.capo || "") : (s.capo || "");
                document.getElementById('chkCapoPrint').checked = draft ? !!draft.capo_print : !!s.capo_print;

                editor.tags = draft ? (draft.tags || []) : (Array.isArray(s.tags) ? s.tags : []);
                editor.renderTags();
                
                if (draft) {
                    showToast(t('msg_draft_recovered'));
                }
                
                editor.updateVersionUI(s);
                editor.updateTimestampsBar(s);
            } 
        } else { 
            editor.createNew(); 
        }
    };

    editor.exit = function() { 
        if (typeof saveAppState === 'function') saveAppState(currentGroupId, 'player');
        localStorage.setItem('mnotes_view_state', 'player');
        localStorage.removeItem('mnotes_draft_' + currentSongId);
        
        let chordsGroup = document.getElementById('guitarChordsGroup');
        if (chordsGroup) chordsGroup.open = true;

        // Always switch views
        document.getElementById('view-editor').classList.remove('active-view'); 
        document.getElementById('view-player').classList.add('active-view'); 

        if (currentSongId) {
            if (typeof loadSong === 'function') loadSong(currentSongId); 
        } else if (library.length > 0) {
            if (typeof loadSong === 'function') loadSong(library[0].id); 
        }
    };

    // --- Song Operations ---

    editor.createNew = function() {
        if (typeof currentGroupId !== 'undefined' && currentGroupId !== 'personal') {
            if (typeof showToast === 'function') {
                showToast(typeof t === 'function' ? t('msg_err_new_song_band', "Τα νέα τραγούδια δημιουργούνται στην Προσωπική Βιβλιοθήκη.") : "Τα νέα τραγούδια δημιουργούνται στην Προσωπική Βιβλιοθήκη.", "warning");
            }
            return;
        }

        // Μονάδα μέτρησης: το ΤΡΑΓΟΥΔΙ, όχι η εγγραφή. Τρεις εκδόσεις με κοινή
        // ρίζα μετρούν ως ένα — ο κλώνος δεν καταναλώνει θέση στο όριο.
        const currentCount = (typeof window.countDistinctSongs === 'function')
            ? window.countDistinctSongs()
            : library.filter(s => !String(s.id).includes('demo')).length;


        const limits = typeof getUserLimits === 'function' ? getUserLimits() : { maxGuestSongs: 5, maxSongs: 40 };

        if (!currentUser) {
            if (typeof canUserPerform === 'function' && !canUserPerform('CREATE_GUEST_SONG', currentCount)) {
                if (typeof window.onSongLimitReached === 'function') {
                    window.onSongLimitReached('editor_new', { currentCount, maxSongs: limits.maxSongs || limits.maxGuestSongs });
                    return;
                }
                showToast(t('msg_guest_limit_reached').replace('{count}', limits.maxGuestSongs), "warning");
                const authMsg = document.getElementById('authMsg');
                if (authMsg) authMsg.innerText = t('msg_create_free_acc_songs');
                const authModal = document.getElementById('authModal');
                if (authModal) authModal.style.display = 'flex';
                return; 
            }
        } else {
            if (typeof canUserPerform === 'function' && !canUserPerform('CREATE_SONG', currentCount)) {
                if (typeof promptUpgrade === 'function') {
                    promptUpgrade(t('msg_unlimited_songs'));
                } else {
                    alert(t('msg_free_limit_reached').replace('{max}', limits.maxSongs));
                }
                return; 
            }
        }
        
        currentSongId = null; 
        // ⚠️ ΜΟΝΟ πεδία φόρμας. Το #inpBodyBackdrop έχει ΚΙ ΑΥΤΟ class="inp" αλλά
        // είναι <div>: το e.value = "" δεν το αδειάζει, μένει στην οθόνη το
        // κείμενο του προηγούμενου τραγουδιού ενώ το textarea είναι κενό.
        document.querySelectorAll('input.inp, textarea.inp, select.inp').forEach(e => e.value = "");
        // Καθάρισμα του backdrop συγχορδιών — αλλιώς ο χρήστης βλέπει το παλιό τραγούδι.
        if (typeof window.updateHighlights === 'function') window.updateHighlights();
        editor.updateIntroInterVisibility();
        const chkCapo = document.getElementById('chkCapoPrint');
        if (chkCapo) chkCapo.checked = false;
        editor.tags = []; 
        editor.renderTags(); 
        
        // Κρύβουμε το timestamps bar για νέα τραγούδια
        const tsBar = document.getElementById('editorTimestampsBar');
        if (tsBar) tsBar.style.display = 'none';
        
        document.getElementById('view-player').classList.remove('active-view'); 
        document.getElementById('view-editor').classList.add('active-view'); 
        
        if (typeof saveAppState === 'function') saveAppState(typeof currentGroupId !== 'undefined' ? currentGroupId : 'personal', 'editor');
        localStorage.setItem('mnotes_view_state', 'editor');
        
        if (typeof applyEditorPlaceholders === 'function') {
            applyEditorPlaceholders();
        }

        if (isMobileView() && typeof switchMobileTab === 'function') {
            switchMobileTab('stage');
        }
    };

    editor.save = async function() { 
        let bodyArea = document.getElementById('inpBody'); 
        if (bodyArea) bodyArea.value = editor.fixTrailingChords(bodyArea.value); 
        
        let oldId = currentSongId; 

        if (typeof saveSong !== 'function') return;

        // ⚠️ Η ΣΕΙΡΑ ΕΧΕΙ ΣΗΜΑΣΙΑ — ΜΗΝ ΤΗ ΜΕΤΑΚΙΝΗΣΕΙΣ ΠΑΡΑΚΑΤΩ.
        // Πατώντας Αποθήκευση, ο χρήστης ΦΕΥΓΕΙ από τον editor. Πρέπει να
        // καταγραφεί ΠΡΙΝ τη saveSong, γιατί εκείνη καλεί loadContextData(),
        // που αν δει mnotes_view_state === 'editor' ΞΑΝΑΝΟΙΓΕΙ τον editor
        // (logic.js, «Μην πετάς τον χρήστη έξω από τον Editor») — και η
        // αποθήκευση φαίνεται να «κολλάει» μέσα στον editor.
        // Το editor.exit() παρακάτω το ξαναγράφει· αβλαβές, απλώς αργεί.
        try { localStorage.setItem('mnotes_view_state', 'player'); } catch (e) { /* ιδιωτικό παράθυρο */ }

        const isSaved = await saveSong(); 
        if (isSaved === false) {
            // Απέτυχε η αποθήκευση — ο χρήστης μένει στον editor, άρα
            // επαναφέρουμε την κατάσταση ώστε να μη χαθεί σε ανανέωση.
            try { localStorage.setItem('mnotes_view_state', 'editor'); } catch (e) { /* ό,τι να 'ναι */ }
            return;
        }

        if (typeof populateTags === 'function') populateTags(); 
        
        if (oldId) localStorage.removeItem('mnotes_draft_' + oldId);
        if (currentSongId) localStorage.removeItem('mnotes_draft_' + currentSongId);
        console.log("[SaveEdit] Τα προσωρινά Drafts καθαρίστηκαν.");
        
        editor.exit();
    };

    editor.fixTrailingChords = function(text) { 
        let lines = text.split('\n'); 
        return lines.map(line => { 
            const trailingChordRegex = /![A-G][b#]?[m]?[maj7|sus4|7|add9|dim|0-9]*(\/[A-G][b#]?)?\s*$/; 
            if (line.match(trailingChordRegex)) return line.trimEnd() + "    "; 
            return line; 
        }).join('\n'); 
    };

    editor.autoSaveDraft = function() {
        if (!currentSongId) return;
        
        const draft = {
            title: document.getElementById('inpTitle')?.value || "",
            artist: document.getElementById('inpArtist')?.value || "",
            video: document.getElementById('inpVideo')?.value || "",
            key: document.getElementById('inpKey')?.value || "",
            body: document.getElementById('inpBody')?.value || "",
            intro: document.getElementById('inpIntro')?.value || "",
            inter: document.getElementById('inpInter')?.value || "",
            notes: document.getElementById('inpPersonalNotes')?.value || "",
            capo: document.getElementById('inpCapo')?.value || "",
            capo_print: document.getElementById('chkCapoPrint')?.checked || false
        };
        
        localStorage.setItem('mnotes_draft_' + currentSongId, JSON.stringify(draft));
        console.log(`[Auto-Save] Το draft για το ${currentSongId} ενημερώθηκε`);
    };

    // --- UI Helpers ---

    editor.updateVersionUI = function(s) {
        const bar   = document.getElementById('editorVersionBar');
        const label = document.getElementById('editorVersionLabel');
        const btnNV = document.getElementById('btnNewVersion');
        if (!bar || !label) return;

        let canSeeNewVersion = false;
        if (typeof currentGroupId !== 'undefined' && currentGroupId === 'personal') {
            canSeeNewVersion = true;
        } else {
            const isAdmin = roleCan('SEE_BAND_VERSION_BAR');
            if (isAdmin) canSeeNewVersion = true;
        }
        if (btnNV) btnNV.style.display = canSeeNewVersion ? 'inline-flex' : 'none';

        if (typeof window.getVersionGroup !== 'function') { bar.style.display = 'none'; return; }
        const group = window.getVersionGroup(s.id);
        const isMaster = !s.parent_id && !s.is_clone;

        // Hide only if it's already a master AND there are no other versions
        if (isMaster && group.length <= 1) { 
            bar.style.display = 'none'; 
            return; 
        }

        const vIdx    = group.findIndex(v => v.id === s.id) + 1;
        const lblText = isMaster ? '★ Master' : (s.is_clone ? `Κλώνος (v${vIdx}/${group.length})` : `Έκδοση ${vIdx}/${group.length}`);

        if (group.length > 1) {
            label.innerHTML = `
                <span style="display:inline-flex;align-items:center;gap:0;margin-right:8px;vertical-align:middle;">
                    <button onclick="window.switchVersionInEditor(-1)" style="background:none;border:1px solid rgba(255,152,0,0.3);border-right:none;color:var(--accent);border-radius:4px 0 0 4px;padding:1px 5px;cursor:pointer;font-size:0.65rem;line-height:1.2;" title="Προηγούμενη">◀</button>
                    <span style="background:rgba(255,152,0,0.1);border:1px solid rgba(255,152,0,0.3);border-left:none;border-right:none;padding:1px 7px;font-size:0.65rem;font-weight:bold;color:var(--accent);white-space:nowrap;line-height:1.2;">${lblText}</span>
                    <button onclick="window.switchVersionInEditor(1)" style="background:none;border:1px solid rgba(255,152,0,0.3);border-left:none;color:var(--accent);border-radius:0 4px 4px 0;padding:1px 5px;cursor:pointer;font-size:0.65rem;line-height:1.2;" title="Επόμενη">▶</button>
                </span>`;
        } else {
            label.innerHTML = `<span style="font-weight:bold;color:var(--accent);">${lblText}</span>`;
        }

        const promoteBtn = bar.querySelector('button');
        if (promoteBtn) promoteBtn.style.display = isMaster ? 'none' : 'inline-block';

        bar.style.display = 'flex';
    };

    editor.showPromoteDialog = function() {
        if (typeof mConfirm !== 'function') return;
        mConfirm('Κράτησε τις παλιές εκδόσεις;').then(keepOthers => {
            if (typeof window.promoteToMaster === 'function') window.promoteToMaster(keepOthers);
        });
    };

    editor.updateTimestampsBar = function(song) {
        const bar = document.getElementById('editorTimestampsBar');
        if (!bar) return;

        // Κρύβουμε για νέα τραγούδια
        if (!song || (!song.created_at && !song.updated_at)) {
            bar.style.display = 'none';
            return;
        }

        const fmt = (isoStr) => {
            if (!isoStr) return null;
            try {
                return new Date(isoStr).toLocaleString('el-GR', {
                    day: '2-digit', month: '2-digit', year: 'numeric',
                    hour: '2-digit', minute: '2-digit'
                });
            } catch(e) { return null; }
        };

        const createdStr = fmt(song.created_at);
        const updatedStr = fmt(song.updated_at);

        const createdEl = document.getElementById('stampCreatedVal');
        const updatedEl = document.getElementById('stampUpdatedVal');
        const createdSpan = document.getElementById('stampCreated');

        if (createdEl && createdStr) {
            createdEl.textContent = 'Δημιουργία: ' + createdStr;
            if (createdSpan) createdSpan.style.display = 'flex';
        } else if (createdSpan) {
            createdSpan.style.display = 'none';
        }

        if (updatedEl && updatedStr) {
            updatedEl.textContent = 'Τελευταία αλλαγή: ' + updatedStr;
        }

        bar.style.display = 'flex';
    };

    editor.refreshSyncButton = function(song) {
        const btnSync = document.getElementById('btnSyncFromBand');
        if (!btnSync) return;

        btnSync.style.display = 'none';
        if (currentGroupId !== 'personal' && song && song.is_clone) {
            btnSync.style.display = 'inline-block';
            btnSync.title = t('title_sync_clone');
        }
    };

    // --- Tag System ---

    editor.handleTagInput = function(input) {
        const val = input.value.toLowerCase().trim();
        const suggestionsBox = document.getElementById('tagSuggestions');
        
        if (!val) {
            if(suggestionsBox) suggestionsBox.style.display = 'none';
            return;
        }

        const allTags = new Set();
        if (typeof library !== 'undefined') {
            library.forEach(s => {
                let sTags = Array.isArray(s.tags) ? s.tags : [];
                sTags.forEach(tag => { if(tag) allTags.add(tag.trim()); });
            });
        }

        const matches = Array.from(allTags).filter(tag => 
            tag.toLowerCase().includes(val) && !editor.tags.includes(tag)
        );

        if (suggestionsBox) {
            suggestionsBox.innerHTML = '';
            if (matches.length > 0) {
                matches.forEach(match => {
                    const div = document.createElement('div');
                    div.className = 'tag-suggestion-item'; 
                    div.innerText = match;
                    div.onclick = () => {
                        editor.addTag(match);
                        input.value = '';
                        suggestionsBox.style.display = 'none';
                        input.focus();
                    };
                    suggestionsBox.appendChild(div);
                });
                suggestionsBox.style.display = 'block';
            } else {
                suggestionsBox.style.display = 'none';
            }
        }
    };

    editor.addTag = function(tag) {
        if (!tag) return;
        if (!editor.tags.includes(tag)) {
            editor.tags.push(tag);
            editor.renderTags();
        }
    };

    editor.handleTagKey = function(e) {
        if (e.key === 'Enter') {
            e.preventDefault();
            const inputEl = e.target;
            const clean = inputEl.value.trim().replace(/,$/, '');
            if (clean) {
                editor.addTag(clean);
            }
            inputEl.value = "";
        }
    };


    editor.removeTag = function(tag) {
        editor.tags = editor.tags.filter(t => t !== tag);
        editor.renderTags();
    };

    editor.renderTags = function() {
        const container = document.getElementById('tagChips');
        const hiddenInp = document.getElementById('inpTags');
        
        if (container) {
            container.innerHTML = '';
            editor.tags.forEach(tag => {
                const chip = document.createElement('span');
                chip.className = 'tag-chip';
                chip.innerHTML = `${tag} <i class="fas fa-times" onclick="removeTag('${tag}')"></i>`;
                container.appendChild(chip);
            });
        }
        
        if (hiddenInp) {
            hiddenInp.value = editor.tags.join(',');
        }
    };

    // --- Aliases ---
    window.switchToEditor = editor.switchTo;
    window.exitEditor = editor.exit;
    window.createNewSong = editor.createNew;
    window.saveEdit = editor.save;
    window.autoSaveDraft = editor.autoSaveDraft;
    window.updateEditorVersionUI = editor.updateVersionUI;
    window.showPromoteDialog = editor.showPromoteDialog;
    window.refreshSyncButtonVisibility = editor.refreshSyncButton;
    window.handleTagInput = editor.handleTagInput;
    window.handleTagKey = editor.handleTagKey;
    window.addTag = editor.addTag;
    window.removeTag = editor.removeTag;
    window.renderTags = editor.renderTags;
    window.fixTrailingChords = editor.fixTrailingChords;
    window.updateIntroInterVisibility = editor.updateIntroInterVisibility;

    window.switchVersionInEditor = function(dir) {
        if (typeof window.getVersionGroup !== 'function') return;
        const group = window.getVersionGroup(currentSongId);
        if (group.length <= 1) return;
        
        const idx = group.findIndex(s => s.id === currentSongId);
        let newIdx = (idx + dir + group.length) % group.length;
        const newSong = group[newIdx];

        // Save active version
        const masterId = group[0].id;
        let activeVersions = JSON.parse(localStorage.getItem('mnotes_active_version') || '{}');
        activeVersions[masterId] = newSong.id;
        localStorage.setItem('mnotes_active_version', JSON.stringify(activeVersions));

        currentSongId = newSong.id;
        
        // Reload editor inputs with the new song
        if (typeof window.switchToEditor === 'function') {
            window.switchToEditor();
        }
    };

    // --- Markup Balance Validator (§Σ2) ---
    window.validateMarkupBalance = function(body) {
        if (!body) return { ok: true, open: [], extraClosers: [] };
        const lines = body.split('\n');
        let stack = [];
        let extraClosers = [];

        lines.forEach((lineText, lineIdx) => {
            const lineNum = lineIdx + 1;
            const tokenRegex = /!(cho|ver|bri|tab|com|str|strum|soc|sov|sob|sot)\b|!\/|!(?:eoc|eov|eob|eot)\b!?|\{(soc|sov|sob|sot|start_of_[a-z]+)\}|\{(?:eoc|eov|eob|eot|end_of_[a-z]+)\}/gi;
            let match;
            while ((match = tokenRegex.exec(lineText)) !== null) {
                const token = match[0];
                if (token === '!/' || token.startsWith('{eoc') || token.startsWith('{eov') || token.startsWith('{eob') || token.startsWith('{eot') || token.startsWith('{end_of') || /!(?:eoc|eov|eob|eot)/i.test(token)) {
                    if (stack.length > 0) {
                        stack.pop();
                    } else {
                        extraClosers.push({ line: lineNum, token: token });
                    }
                } else {
                    const tagType = (match[1] || match[2] || '').toLowerCase();
                    stack.push({ tag: tagType, line: lineNum, token: token });
                }
            }
        });

        return {
            ok: stack.length === 0 && extraClosers.length === 0,
            open: stack,
            extraClosers: extraClosers
        };
    };

    // --- Editor Format Button Controller ---
    editor.activeSectionTag = null;

    editor.getUnclosedSection = function(text, cursorPos) {
        if (!text) return null;
        let sub = text.substring(0, cursorPos);
        let res = window.validateMarkupBalance(sub);
        if (res.open && res.open.length > 0) {
            return res.open[res.open.length - 1].tag;
        }
        return null;
    };

    window.updateEditorFormatButtonState = function() {
        const btn = document.getElementById('btnEditorFormat');
        const inpBody = document.getElementById('inpBody');
        const closeItem = document.getElementById('btnFormatCloseItem');
        const closeItemLabel = document.getElementById('closeItemTagLabel');
        const divider = document.getElementById('formatMenuDivider');
        if (!btn || !inpBody) return;

        let cursorPos = inpBody.selectionStart || 0;
        let unclosed = editor.getUnclosedSection(inpBody.value, cursorPos);
        editor.activeSectionTag = unclosed;

        let fullBalance = window.validateMarkupBalance(inpBody.value);

        const tagNames = {
            'cho': 'Ρεφρέν', 'soc': 'Ρεφρέν',
            'ver': 'Κουπλέ', 'sov': 'Κουπλέ',
            'bri': 'Γέφυρα', 'sob': 'Γέφυρα',
            'tab': 'Tab', 'sot': 'Tab',
            'com': 'Σχόλιο',
            'str': 'Ρυθμός', 'strum': 'Ρυθμός'
        };

        if (unclosed) {
            btn.classList.add('block-active');
            let friendlyName = tagNames[unclosed] || unclosed;
            if (closeItem) {
                closeItem.style.display = 'flex';
                if (closeItemLabel) closeItemLabel.innerText = `(${friendlyName})`;
            }
            if (divider) divider.style.display = 'block';
        } else {
            btn.classList.remove('block-active');
            if (closeItem) closeItem.style.display = 'none';
            if (divider) divider.style.display = 'none';
        }

        if (!fullBalance.ok) {
            btn.title = `Προσοχή: Ασύμμετρη σήμανση (${fullBalance.open.length} ανοιχτά, ${fullBalance.extraClosers.length} περίσσια !/)`;
            btn.style.border = '1px solid #f59e0b';
        } else {
            btn.title = 'Μορφοποίηση (Format)';
            btn.style.border = '';
        }
    };

    window.toggleEditorFormat = function(e) {
        if (e) { e.preventDefault(); e.stopPropagation(); }
        const menu = document.getElementById('editorFormatMenu');
        if (!menu) return;
        let isVisible = menu.style.display === 'flex' || menu.style.display === 'block';
        menu.style.display = isVisible ? 'none' : 'flex';
    };

    window.applyEditorFormat = function(type, e) {
        if (e) { e.preventDefault(); e.stopPropagation(); }
        const menu = document.getElementById('editorFormatMenu');
        if (menu) menu.style.display = 'none';

        const inpBody = document.getElementById('inpBody');
        if (!inpBody) return;

        let start = inpBody.selectionStart || 0;
        let end = inpBody.selectionEnd || 0;
        let val = inpBody.value;
        let selected = val.substring(start, end);
        let replacement = '';
        let newCursorPos = start;

        if (type === 'close') {
            let prefix = (start > 0 && val[start - 1] !== '\n') ? '\n' : '';
            replacement = `${prefix}!/\n`;
            newCursorPos = start + replacement.length;
        } else if (type === 'com') {
            if (selected.length > 0) {
                replacement = `!com ${selected} !/`;
                newCursorPos = start + replacement.length;
            } else {
                replacement = `!com  !/`;
                newCursorPos = start + 5;
            }
        } else if (type === 'str') {
            if (selected.length > 0) {
                replacement = `!str ${selected} !/`;
                newCursorPos = start + replacement.length;
            } else {
                let prefix = (start > 0 && val[start - 1] !== '\n') ? '\n' : '';
                replacement = `${prefix}!str D U D U !/\n`;
                newCursorPos = start + replacement.length;
            }
        } else {
            let prefix = (start > 0 && val[start - 1] !== '\n') ? '\n' : '';
            if (selected.length > 0) {
                replacement = `${prefix}!${type}\n${selected}\n!/\n`;
                newCursorPos = start + replacement.length;
            } else {
                replacement = `${prefix}!${type}\n`;
                newCursorPos = start + replacement.length;
            }
        }

        inpBody.value = val.substring(0, start) + replacement + val.substring(end);
        inpBody.focus();
        inpBody.setSelectionRange(newCursorPos, newCursorPos);
        inpBody.dispatchEvent(new Event('input'));
        if (typeof window.updateHighlights === 'function') window.updateHighlights();
        window.updateEditorFormatButtonState();
    };

    document.addEventListener('click', (e) => {
        const menu = document.getElementById('editorFormatMenu');
        const btn = document.getElementById('btnEditorFormat');
        if (menu && menu.style.display !== 'none') {
            if (!menu.contains(e.target) && !btn?.contains(e.target)) {
                menu.style.display = 'none';
            }
        }
    });

})(window.mNotes.ui.editor);
