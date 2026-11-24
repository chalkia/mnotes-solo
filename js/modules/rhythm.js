/**
 * mNotes Rhythm & Metronome UI Module
 */

window.mNotes = window.mNotes || {};
window.mNotes.ui = window.mNotes.ui || {};
window.mNotes.ui.rhythm = window.mNotes.ui.rhythm || {};

(function(rhythmMod) {

    const KIT_LABELS = {
        'standard': 'Standard',
        'eastern': 'Eastern Synth',
        'eastern-real-v1': 'Eastern Real',
        'rock-acoustic': 'Rock Acoustic',
        'synth-808': 'Synth 808',
        'cajon-latin': 'Cajon Latin',
        'latin-tango': 'Latin / Tango',
        'jazz-brush': 'Jazz Brush',
        'balkan-brass': 'Balkan Brass',
        'global': 'Global'
    };

    const ASYMMETRIC_SUBDIVISIONS = {
        '9/8': ['3+2+2+2', '2+2+2+3', '2+3+2+2', '2+2+3+2'],
        '7/8': ['3+2+2', '2+2+3', '2+3+2'],
        '5/8': ['3+2', '2+3']
    };

    let activeRhythmIndex = -1;
    let lastRenderSongId = null;
    let currentRhythms = [];
    let currentGrid = { beatCount: 4, stepsPerBeat: 4, denominator: 4, stepCount: 16 };
    let currentKitId = 'standard';
    let currentSubdiv = '';
    let savedSnapshot = { bpm: 100, kit: 'standard', subdiv: '' };
    let isDirty = false;
    let engineHooksBound = false;

    function parseMeterString(meterStr) {
        const m = String(meterStr || '').trim().match(/^(\d+)\s*\/\s*(\d+)$/);
        if (!m) return null;
        const bc = parseInt(m[1], 10);
        const den = parseInt(m[2], 10);
        if (!bc || !den) return null;
        const spb = den === 8 ? 2 : 4;
        return { beatCount: bc, stepsPerBeat: spb, denominator: den, stepCount: bc * spb };
    }

    function escHtml(str) {
        return String(str ?? '').replace(/[&<>"']/g, function(ch) {
            return ch === '&' ? '&amp;' : ch === '<' ? '&lt;' : ch === '>' ? '&gt;' : ch === '"' ? '&quot;' : '&#39;';
        });
    }

    function readMorePref() {
        try {
            if (typeof window.readDrawerPrefs === 'function') {
                return window.readDrawerPrefs().rhythmMoreOpen === true;
            }
            const raw = localStorage.getItem('mnotes_drawer_prefs_v1');
            return raw ? JSON.parse(raw).rhythmMoreOpen === true : false;
        } catch (_) {
            return false;
        }
    }

    function writeMorePref(open) {
        try {
            if (typeof window.writeDrawerPrefs === 'function' && typeof window.readDrawerPrefs === 'function') {
                const prefs = window.readDrawerPrefs();
                prefs.rhythmMoreOpen = !!open;
                window.writeDrawerPrefs(prefs);
                return;
            }
            const raw = localStorage.getItem('mnotes_drawer_prefs_v1');
            const prefs = raw ? JSON.parse(raw) : {};
            prefs.rhythmMoreOpen = !!open;
            localStorage.setItem('mnotes_drawer_prefs_v1', JSON.stringify(prefs));
        } catch (_) {}
    }

    function getMeterLabel(grid) {
        const g = grid || currentGrid;
        return `${Number(g.beatCount) || 4}/${Number(g.denominator) || 4}`;
    }

    function parseSubdivGroups(sub) {
        if (!sub || typeof sub !== 'string') return null;
        const nums = sub.split('+').map(n => Number(n.trim())).filter(n => Number.isInteger(n) && n > 0);
        return nums.length ? nums : null;
    }

    function getAccentBeatSet(beatCount, stepsPerBeat, subdivStr, engineProfile) {
        const set = new Set([0]);
        const groups = parseSubdivGroups(subdivStr);
        if (groups && groups.reduce((a, b) => a + b, 0) === beatCount) {
            let offset = 0;
            for (const len of groups) {
                set.add(offset);
                offset += len;
            }
            return set;
        }
        if (Array.isArray(engineProfile) && engineProfile.length >= beatCount * stepsPerBeat) {
            for (let b = 0; b < beatCount; b++) {
                if (engineProfile[b * stepsPerBeat]) set.add(b);
            }
            return set;
        }
        if (beatCount === 4) set.add(2);
        else if (beatCount === 9) { set.add(2); set.add(4); set.add(6); }
        else if (beatCount === 7) { set.add(3); set.add(5); }
        return set;
    }

    function buildSubdivisionProfile(groups, beatCount, stepsPerBeat) {
        const stepCount = beatCount * stepsPerBeat;
        const profile = Array(stepCount).fill(false);
        let beatOffset = 0;
        for (const gLen of groups) {
            const stepIdx = beatOffset * stepsPerBeat;
            if (stepIdx < stepCount) profile[stepIdx] = true;
            beatOffset += gLen;
        }
        return profile;
    }

    function renderBeatDial(activeBeatIdx = -1) {
        const badge = document.getElementById('rhythmMeterBadge');
        const counter = document.getElementById('rhythmBeatCounter');
        const strip = document.getElementById('rhythmBeatStrip');
        const bc = Number(currentGrid.beatCount) || 4;
        const den = Number(currentGrid.denominator) || 4;
        if (badge) badge.textContent = `${bc}/${den}`;
        if (counter) {
            counter.textContent = activeBeatIdx >= 0 ? `${activeBeatIdx + 1}/${bc}` : `—/${bc}`;
        }
        if (!strip) return;
        const engineProfile = window.mRhythm?.engine?.getMetricAccentState?.()?.userProfile;
        const accents = getAccentBeatSet(bc, Number(currentGrid.stepsPerBeat) || 4, currentSubdiv, engineProfile);
        if (strip.children.length !== bc || strip.getAttribute('data-subdiv') !== (currentSubdiv || '')) {
            strip.setAttribute('data-subdiv', currentSubdiv || '');
            let html = '';
            for (let i = 0; i < bc; i++) {
                const cls = ['rhythm-led'];
                if (i === 0) cls.push('is-downbeat');
                else if (accents.has(i)) cls.push('is-accent');
                html += `<span class="${cls.join(' ')}" data-beat="${i}"></span>`;
            }
            strip.innerHTML = html;
        }
        for (let i = 0; i < strip.children.length; i++) {
            strip.children[i].classList.toggle('is-hit', i === activeBeatIdx);
        }
    }

    function populateKitSelect(selectedKit) {
        const sel = document.getElementById('rhythmKitSelect');
        if (!sel) return;
        const engineKits = window.mRhythm?.engine?.kits ? Object.keys(window.mRhythm.engine.kits) : [];
        const keys = engineKits.length ? engineKits : Object.keys(KIT_LABELS);
        sel.innerHTML = keys.map(k => `<option value="${escHtml(k)}">${escHtml(KIT_LABELS[k] || k)}</option>`).join('');
        const target = (selectedKit && keys.includes(selectedKit)) ? selectedKit : (keys.includes(currentKitId) ? currentKitId : keys[0]);
        if (target) {
            sel.value = target;
            currentKitId = target;
        }
    }

    function populateSubdivSelect(meterLabel, selectedSubdiv) {
        const sel = document.getElementById('rhythmSubdivSelect');
        if (!sel) return;
        const presets = ASYMMETRIC_SUBDIVISIONS[meterLabel];
        if (!presets) {
            sel.innerHTML = `<option value="">${escHtml(meterLabel)}</option>`;
            sel.value = '';
            sel.disabled = true;
            currentSubdiv = '';
            return;
        }
        sel.disabled = false;
        sel.innerHTML = presets.map(opt => `<option value="${escHtml(opt)}">${escHtml(opt)} ♪</option>`).join('');
        const chosen = (selectedSubdiv && presets.includes(selectedSubdiv)) ? selectedSubdiv : presets[0];
        sel.value = chosen;
        currentSubdiv = chosen;
    }

    function syncMorePanelState(open, skipPrefSave = false) {
        const panel = document.getElementById('rhythmMorePanel');
        const btn = document.getElementById('btnRhythmMore');
        const lbl = document.getElementById('lblRhythmMoreText');
        if (panel) panel.hidden = !open;
        if (btn) {
            btn.setAttribute('aria-expanded', open ? 'true' : 'false');
            btn.classList.toggle('is-open', !!open);
        }
        if (lbl) lbl.textContent = open ? t('btn_rhythm_less', 'Λιγότερα') : t('btn_rhythm_more', 'Περισσότερα');
        if (!skipPrefSave) writeMorePref(!!open);
        if (typeof window.fitToolsSections === 'function') window.fitToolsSections();
    }

    function syncPlayingVisuals() {
        const seqPlaying = (window.activeRhythmType === 'sequencer' && !!window.isRhythmPlaying);
        const metroPlaying = (typeof BasicMetronome !== 'undefined' && !!BasicMetronome.isPlaying);
        const anyPlaying = seqPlaying || metroPlaying;

        const drawer = document.getElementById('drawerRhythms');
        const plate = document.getElementById('rhythmOrganPlate');
        const icon = document.getElementById('iconPlayRhythm');
        const metroBtn = document.getElementById('btnToggleMetronome');

        if (drawer) drawer.classList.toggle('is-playing', anyPlaying);
        if (plate) plate.classList.toggle('is-playing', anyPlaying);
        if (icon) {
            icon.classList.toggle('fa-stop', anyPlaying);
            icon.classList.toggle('fa-play', !anyPlaying);
        }
        if (metroBtn) {
            metroBtn.classList.toggle('is-on', metroPlaying);
            metroBtn.setAttribute('aria-pressed', metroPlaying ? 'true' : 'false');
        }
        if (!anyPlaying) renderBeatDial(-1);
    }

    function setDirty(flag) {
        isDirty = !!flag;
        const dot = document.getElementById('saveDirtyDot');
        const btn = document.getElementById('btnSaveRhythmBpm');
        if (dot) dot.hidden = !isDirty;
        if (btn) btn.classList.toggle('is-dirty', isDirty);
    }

    function recomputeDirty() {
        if (activeRhythmIndex < 0 || !currentRhythms[activeRhythmIndex]) {
            setDirty(false);
            return;
        }
        const txtBpmEl = document.getElementById('txtBpm');
        const curBpm = txtBpmEl ? (parseInt(txtBpmEl.value, 10) || 100) : 100;
        const dirty = (curBpm !== Number(savedSnapshot.bpm))
            || (currentKitId !== (savedSnapshot.kit || 'standard'))
            || ((currentSubdiv || '') !== (savedSnapshot.subdiv || ''));
        setDirty(dirty);
    }

    function updateGridFromRuntime(fallbackGrid) {
        const cfg = window.mRhythm?.runtimeGridConfig
            || window.mRhythm?.engine?.getGridConfig?.()
            || fallbackGrid;
        if (cfg) {
            const bc = Number(cfg.beatCount) || 4;
            const spb = Number(cfg.stepsPerBeat) || 4;
            const den = Number(cfg.denominator) || 4;
            const sc = Number(cfg.stepCount) || (bc * spb);
            currentGrid = { beatCount: bc, stepsPerBeat: spb, denominator: den, stepCount: sc };
        }
    }

    rhythmMod.bindEngineHooks = function() {
        if (typeof BasicMetronome !== 'undefined' && !BasicMetronome.__rhythmUiHooked) {
            BasicMetronome.__rhythmUiHooked = true;
            BasicMetronome.onBeat = (beatIdx) => {
                if (!(window.activeRhythmType === 'sequencer' && window.isRhythmPlaying)) {
                    renderBeatDial(beatIdx);
                }
            };
            BasicMetronome.onStateChange = () => syncPlayingVisuals();
        }
        if (!window.mRhythm || engineHooksBound) return;
        engineHooksBound = true;
        const origStarted = window.mRhythm.onPlaybackStarted;
        const origStopped = window.mRhythm.onPlaybackStopped;
        window.mRhythm.onPlaybackStarted = (...args) => {
            if (typeof origStarted === 'function') origStarted(...args);
            syncPlayingVisuals();
        };
        window.mRhythm.onPlaybackStopped = (...args) => {
            if (typeof origStopped === 'function') origStopped(...args);
            syncPlayingVisuals();
        };
        window.mRhythm.onStep = (stepIndex) => {
            updateGridFromRuntime();
            const spb = Math.max(1, Number(currentGrid.stepsPerBeat) || 4);
            const bc = Math.max(1, Number(currentGrid.beatCount) || 4);
            const beatIdx = Math.floor((Number(stepIndex) || 0) / spb) % bc;
            renderBeatDial(beatIdx);
        };
        window.mRhythm.onPatternLoaded = () => {
            updateGridFromRuntime();
            renderBeatDial(-1);
        };
    };

    rhythmMod.renderList = function(rhythms = []) {
        rhythmMod.bindEngineHooks();
        currentRhythms = Array.isArray(rhythms) ? rhythms : [];
        const songKey = (typeof currentSongId !== 'undefined' && currentSongId) ? currentSongId : '__none__';
        const songChanged = songKey !== lastRenderSongId;
        if (songChanged) {
            lastRenderSongId = songKey;
            activeRhythmIndex = currentRhythms.length > 0 ? 0 : -1;
        }
        const listEl = document.getElementById('list-rhythms');
        const activeBox = document.getElementById('activeRhythmBox');
        const meterEl = document.getElementById('seq-current-meter');
        const nameEl = document.getElementById('seq-current-name');
        const tempoEl = document.getElementById('seq-current-tempo');
        const dlBtn = document.getElementById('btnDownloadRhythm');
        const delBtn = document.getElementById('btnDeleteRhythm');
        if (!listEl) return;

        const isOwnerOrAdmin = typeof roleCan === 'function' ? roleCan('MANAGE_BAND_RHYTHMS') : true;
        const canDelete = (typeof currentGroupId === 'undefined' || currentGroupId === 'personal') || isOwnerOrAdmin;

        if (currentRhythms.length === 0) {
            activeRhythmIndex = -1;
            if (songChanged) {
                currentGrid = { beatCount: 4, stepsPerBeat: 4, denominator: 4, stepCount: 16 };
                currentSubdiv = '';
            }
            listEl.innerHTML = `<div class="empty-state">${escHtml(t('msg_no_attachments', 'Κανένα αρχείο'))}</div>`;
            listEl.hidden = true;
            if (activeBox) activeBox.hidden = false;
            const curBpm = parseInt(document.getElementById('txtBpm')?.value, 10) || 100;
            if (meterEl) meterEl.textContent = getMeterLabel();
            if (nameEl) nameEl.textContent = t('lbl_rhythm_active_empty', 'Απλός Μετρονόμος');
            if (tempoEl) tempoEl.textContent = `♩ = ${curBpm}`;
            if (dlBtn) dlBtn.disabled = true;
            if (delBtn) delBtn.disabled = true;
            populateKitSelect(currentKitId);
            populateSubdivSelect(getMeterLabel(), currentSubdiv);
            renderBeatDial(-1);
            syncMorePanelState(readMorePref(), true);
            setDirty(false);
            if (typeof window.fitToolsSections === 'function') window.fitToolsSections();
            return;
        }

        if (activeRhythmIndex < 0 || activeRhythmIndex >= currentRhythms.length) {
            activeRhythmIndex = 0;
        }

        listEl.innerHTML = '';
        currentRhythms.forEach((rhythm, index) => {
            const el = document.createElement('div');
            const isActive = index === activeRhythmIndex;
            el.className = 'track-item rhythm-choice-btn' + (isActive ? ' is-active' : '');
            const savedBpm = rhythm.bpm || rhythm.defaultBpm || rhythm.metadata?.defaultBpm || null;
            const bpmLabel = savedBpm ? `♩ = ${savedBpm}` : '♩ = —';
            const meter = rhythm.timeSignature || rhythm.metadata?.timeSignature || (rhythm.grid?.beatCount ? `${rhythm.grid.beatCount}/${rhythm.grid.denominator || 4}` : '4/4');

            el.setAttribute('title', t('title_load_rhythm', 'Φόρτωση ρυθμού'));
            el.innerHTML = `
                <span class="rc-dot" aria-hidden="true"></span>
                <span class="rc-meter">${escHtml(meter)}</span>
                <span class="rc-name">${escHtml(rhythm.name)}</span>
                <span class="rc-tempo rhythm-item-bpm" data-rhythm-idx="${index}">${escHtml(bpmLabel)}</span>
            `;
            el.addEventListener('click', () => {
                rhythmMod.activate(rhythm.url, rhythm.name, savedBpm || 0, index);
            });
            listEl.appendChild(el);
        });

        const cur = currentRhythms[activeRhythmIndex] || currentRhythms[0];
        const curSavedBpm = cur.bpm || cur.defaultBpm || cur.metadata?.defaultBpm || parseInt(document.getElementById('txtBpm')?.value, 10) || 100;
        const curMeter = cur.timeSignature || cur.metadata?.timeSignature || (cur.grid?.beatCount ? `${cur.grid.beatCount}/${cur.grid.denominator || 4}` : getMeterLabel());

        if (songChanged) {
            const parsedGrid = cur.grid && cur.grid.beatCount
                ? {
                    beatCount: Number(cur.grid.beatCount) || 4,
                    stepsPerBeat: Number(cur.grid.stepsPerBeat) || 4,
                    denominator: Number(cur.grid.denominator) || 4,
                    stepCount: Number(cur.grid.stepCount) || ((Number(cur.grid.beatCount) || 4) * (Number(cur.grid.stepsPerBeat) || 4))
                }
                : (parseMeterString(curMeter) || { beatCount: 4, stepsPerBeat: 4, denominator: 4, stepCount: 16 });
            currentGrid = parsedGrid;
            const txt = document.getElementById('txtBpm');
            const rng = document.getElementById('rngBpm');
            const disp = document.getElementById('dispBpm');
            if (txt) txt.value = curSavedBpm;
            if (rng) rng.value = curSavedBpm;
            if (disp) disp.innerText = curSavedBpm;
        }

        if (currentRhythms.length <= 1) {
            if (activeBox) activeBox.hidden = false;
            listEl.hidden = true;
        } else {
            if (activeBox) activeBox.hidden = true;
            listEl.hidden = false;
        }

        const displayBpm = parseInt(document.getElementById('txtBpm')?.value, 10) || curSavedBpm;
        if (meterEl) meterEl.textContent = curMeter;
        if (nameEl) nameEl.textContent = cur.name || t('lbl_rhythm_active_empty', 'Απλός Μετρονόμος');
        if (tempoEl) tempoEl.textContent = `♩ = ${displayBpm}`;
        if (dlBtn) dlBtn.disabled = false;
        if (delBtn) delBtn.disabled = !canDelete;

        populateKitSelect(cur.preferredKit || currentKitId);
        populateSubdivSelect(getMeterLabel(), cur.subdivision || currentSubdiv);
        if (songChanged) {
            savedSnapshot = {
                bpm: Number(curSavedBpm) || 100,
                kit: cur.preferredKit || currentKitId,
                subdiv: cur.subdivision || currentSubdiv || ''
            };
            setDirty(false);
        }
        renderBeatDial(-1);
        syncMorePanelState(readMorePref(), true);

        if (typeof window.fitToolsSections === 'function') window.fitToolsSections();
    };

    rhythmMod.renderRhythmsList = rhythmMod.renderList;

    rhythmMod.updateBpm = function(songId, rhythmIndex) {
        const targetSongId = songId || (typeof currentSongId !== 'undefined' ? currentSongId : null);
        const idx = (typeof rhythmIndex === 'number' && rhythmIndex >= 0) ? rhythmIndex : Math.max(0, activeRhythmIndex);
        const targetSong = typeof library !== 'undefined' ? library.find(s => s.id === targetSongId) : null;
        if (!targetSong || !targetSong.rhythms || !targetSong.rhythms[idx]) return;

        const txtBpmEl = document.getElementById('txtBpm');
        const currentBpm = txtBpmEl ? (parseInt(txtBpmEl.value, 10) || 100) : 100;
        targetSong.rhythms[idx].bpm = currentBpm;
        if (currentKitId) targetSong.rhythms[idx].preferredKit = currentKitId;
        if (currentSubdiv) targetSong.rhythms[idx].subdivision = currentSubdiv;

        savedSnapshot = { bpm: currentBpm, kit: currentKitId, subdiv: currentSubdiv || '' };
        setDirty(false);

        if (typeof saveSong === 'function') saveSong(targetSong);
        rhythmMod.renderList(targetSong.rhythms);

        showToast(t('msg_bpm_saved', 'Αποθηκεύτηκε: ♩ = {bpm}').replace('{bpm}', currentBpm));
    };

    rhythmMod.handleDelete = async function(songId, index) {
        const targetSongId = songId || (typeof currentSongId !== 'undefined' ? currentSongId : null);
        const targetIdx = (typeof index === 'number' && index >= 0) ? index : Math.max(0, activeRhythmIndex);
        let removed = false;
        if (typeof deleteMediaItem === 'function') {
            removed = await deleteMediaItem(targetSongId, 'rhythms', targetIdx);
        }
        if (!removed) return false;

        if (window.mRhythm && window.activeRhythmType === 'sequencer') {
            window.mRhythm.stop();
        }
        if (typeof BasicMetronome !== 'undefined' && BasicMetronome.isPlaying) {
            BasicMetronome.toggle();
        }
        window.activeRhythmType = 'metronome';
        activeRhythmIndex = -1;
        setDirty(false);
        syncPlayingVisuals();
        return true;
    };

    rhythmMod.activate = async function(url, name, savedBpm = null, rhythmIndex = -1) {
        rhythmMod.bindEngineHooks();
        activeRhythmIndex = rhythmIndex;

        if (window.mRhythm) {
            try {
                await window.mRhythm.init();
                window.mRhythm.stop();
            } catch (e) { console.warn("[RHYTHM] Audio init warning:", e); }
        }

        if (typeof BasicMetronome !== 'undefined' && BasicMetronome.isPlaying) {
            BasicMetronome.toggle();
        }

        try {
            if (typeof window.beforeFetchRhythmUrl === 'function' && window.beforeFetchRhythmUrl(url) === false) {
                return;
            }
            const response = await fetch(url);
            if (!response.ok) throw new Error("Fetch failed");
            const rhythmData = await response.json();

            const song = (typeof library !== 'undefined' && typeof currentSongId !== 'undefined')
                ? library.find(s => s.id === currentSongId)
                : null;
            const songRhythm = (song && Array.isArray(song.rhythms) && rhythmIndex >= 0) ? song.rhythms[rhythmIndex] : null;

            const EngineCls = window.UniversalPercussionEngine;
            const rawTargetBpm = savedBpm || rhythmData.metadata?.defaultBpm || songRhythm?.bpm;
            const effectiveBpm = (rawTargetBpm && EngineCls && typeof EngineCls.normalizeLegacyBpmValue === 'function')
                ? EngineCls.normalizeLegacyBpmValue(rawTargetBpm, rhythmData)
                : (rawTargetBpm || 100);

            if (window.mRhythm) {
                await window.mRhythm.loadFromObject(rhythmData);
                updateGridFromRuntime(rhythmData.grid || rhythmData.metadata?.grid);

                const preferredKit = songRhythm?.preferredKit || rhythmData.kitId || rhythmData.metadata?.kitId || 'standard';
                if (preferredKit && window.mRhythm.engine?.loadKit) {
                    await window.mRhythm.engine.loadKit(preferredKit).catch(() => {});
                }
                populateKitSelect(preferredKit);

                const meterLabel = getMeterLabel();
                const prefSubdiv = songRhythm?.subdivision || rhythmData.subdivision || '';
                populateSubdivSelect(meterLabel, prefSubdiv);
                if (currentSubdiv) {
                    const groups = parseSubdivGroups(currentSubdiv);
                    if (groups && window.mRhythm.engine?.setMetricAccentState) {
                        const profile = buildSubdivisionProfile(groups, currentGrid.beatCount, currentGrid.stepsPerBeat);
                        window.mRhythm.engine.setMetricAccentState({ enabled: true, strength: 0.55, userProfile: profile }, false);
                    }
                }

                window.mRhythm.setBpm(effectiveBpm);
                window.activeRhythmType = 'sequencer';
                showToast(t('msg_rhythm_loaded', 'Φορτώθηκε ρυθμός ({bpm} BPM)').replace('{bpm}', effectiveBpm));
            } else {
                window.activeRhythmType = 'metronome';
            }

            savedSnapshot = { bpm: Number(effectiveBpm) || 100, kit: currentKitId, subdiv: currentSubdiv || '' };
            rhythmMod.changeBpm(effectiveBpm);
            setDirty(false);

            const songList = song && Array.isArray(song.rhythms) ? song.rhythms : currentRhythms;
            if (songList.length > 0) rhythmMod.renderList(songList);
            else renderBeatDial(-1);
            syncPlayingVisuals();
        } catch (error) {
            console.error("[RHYTHM ERROR]:", error);
            window.activeRhythmType = 'metronome';
            syncPlayingVisuals();
            showToast(t('msg_err_rhythm_load'), "error");
        }
    };

    rhythmMod.resetToDefault = function() {
        window.activeRhythmType = 'metronome';
        activeRhythmIndex = -1;
        if (window.mRhythm) window.mRhythm.stop();
        if (typeof BasicMetronome !== 'undefined' && BasicMetronome.isPlaying) BasicMetronome.toggle();
        currentGrid = { beatCount: 4, stepsPerBeat: 4, denominator: 4, stepCount: 16 };
        populateSubdivSelect(getMeterLabel(), '');
        setDirty(false);
        syncPlayingVisuals();
    };

    rhythmMod.startPlayMaster = function(currentBpm) {
        rhythmMod.bindEngineHooks();
        if (window.activeRhythmType === 'sequencer' && window.mRhythm) {
            window.mRhythm.setBpm(currentBpm);
            window.mRhythm.play().catch(err => console.error("❌ [RHYTHM] Play Error:", err));
        } else if (typeof BasicMetronome !== 'undefined') {
            BasicMetronome.beatCount = currentGrid.beatCount || 4;
            if (typeof BasicMetronome.setBpm === 'function') BasicMetronome.setBpm(currentBpm);
            if (!BasicMetronome.isPlaying) BasicMetronome.toggle();
        } else {
            showToast(t('msg_err_metro_unavail'), "error");
        }
        syncPlayingVisuals();
    };

    rhythmMod.toggleMaster = function() {
        rhythmMod.bindEngineHooks();
        const txtBpmEl = document.getElementById('txtBpm');
        const currentBpm = txtBpmEl ? (parseInt(txtBpmEl.value, 10) || 100) : 100;

        const seqPlaying = (window.activeRhythmType === 'sequencer' && window.mRhythm && window.isRhythmPlaying);
        const metroPlaying = (typeof BasicMetronome !== 'undefined' && BasicMetronome.isPlaying);

        if (seqPlaying || metroPlaying) {
            if (window.activePlayCountdown) window.activePlayCountdown.cancel();
            if (seqPlaying && window.mRhythm) window.mRhythm.stop();
            if (metroPlaying && typeof BasicMetronome !== 'undefined') BasicMetronome.toggle();
            syncPlayingVisuals();
            return;
        }

        const delay = (typeof userSettings !== 'undefined' && typeof userSettings.playDelay !== 'undefined') ? parseInt(userSettings.playDelay, 10) : 0;
        if (delay > 0 && typeof window.runPlayCountdown === 'function') {
            window.runPlayCountdown(delay, () => {
                rhythmMod.startPlayMaster(currentBpm);
            }, () => {
                syncPlayingVisuals();
            });
        } else {
            rhythmMod.startPlayMaster(currentBpm);
        }
    };

    rhythmMod.toggleMetronome = function() {
        rhythmMod.bindEngineHooks();
        if (typeof BasicMetronome === 'undefined') {
            showToast(t('msg_err_metro_unavail'), "error");
            return;
        }
        const txtBpmEl = document.getElementById('txtBpm');
        const currentBpm = txtBpmEl ? (parseInt(txtBpmEl.value, 10) || 100) : 100;
        BasicMetronome.beatCount = currentGrid.beatCount || 4;
        if (typeof BasicMetronome.setBpm === 'function') BasicMetronome.setBpm(currentBpm);
        BasicMetronome.toggle();
        syncPlayingVisuals();
    };

    rhythmMod.toggleMorePanel = function() {
        const panel = document.getElementById('rhythmMorePanel');
        const currentlyOpen = panel ? !panel.hidden : readMorePref();
        syncMorePanelState(!currentlyOpen, false);
    };

    rhythmMod.changeKitTemp = async function(kitId) {
        if (!kitId) return;
        currentKitId = kitId;
        if (window.mRhythm?.engine?.loadKit) {
            await window.mRhythm.engine.loadKit(kitId).catch(() => {});
        }
        recomputeDirty();
    };

    rhythmMod.changeSubdivTemp = function(subStr) {
        currentSubdiv = subStr || '';
        const groups = parseSubdivGroups(currentSubdiv);
        if (groups && window.mRhythm?.engine?.setMetricAccentState) {
            const profile = buildSubdivisionProfile(groups, currentGrid.beatCount, currentGrid.stepsPerBeat);
            window.mRhythm.engine.setMetricAccentState({ enabled: true, strength: 0.55, userProfile: profile }, true);
        }
        renderBeatDial(-1);
        recomputeDirty();
    };

    rhythmMod.downloadCurrent = function() {
        const idx = Math.max(0, activeRhythmIndex);
        const r = currentRhythms[idx];
        if (r && typeof window.downloadAssetLocal === 'function') {
            window.downloadAssetLocal(r.url, r.name);
        }
    };

    rhythmMod.deleteCurrent = function() {
        const idx = Math.max(0, activeRhythmIndex);
        if (!currentRhythms[idx] || typeof currentSongId === 'undefined') return;
        rhythmMod.handleDelete(currentSongId, idx);
    };

    rhythmMod.changeVolume = function(value) {
        const normalizedVol = parseInt(value, 10) / 100;
        if (window.mRhythm) {
            if (typeof window.mRhythm.setMasterVolume === 'function') window.mRhythm.setMasterVolume(normalizedVol);
            else if (window.mRhythm.engine && typeof window.mRhythm.engine.setMasterVolume === 'function') window.mRhythm.engine.setMasterVolume(normalizedVol);
        }
        if (typeof BasicMetronome !== 'undefined' && typeof BasicMetronome.setVolume === 'function') BasicMetronome.setVolume(normalizedVol);
    };

    rhythmMod.changeBpm = function(value) {
        const raw = parseInt(value, 10);
        if (isNaN(raw)) return;
        const newBpm = Math.max(20, Math.min(240, raw));

        const txtBpm = document.getElementById('txtBpm');
        if (txtBpm && parseInt(txtBpm.value, 10) !== newBpm) txtBpm.value = newBpm;
        const rngBpm = document.getElementById('rngBpm');
        if (rngBpm && parseInt(rngBpm.value, 10) !== newBpm) rngBpm.value = newBpm;
        const dispBpm = document.getElementById('dispBpm');
        if (dispBpm) dispBpm.innerText = newBpm;
        const activeTempo = document.getElementById('seq-current-tempo');
        if (activeTempo) activeTempo.textContent = `♩ = ${newBpm}`;

        if (window.mRhythm) window.mRhythm.setBpm(newBpm);
        if (typeof BasicMetronome !== 'undefined' && typeof BasicMetronome.setBpm === 'function') BasicMetronome.setBpm(newBpm);

        recomputeDirty();
    };

    rhythmMod.clearActive = function() {
        rhythmMod.resetToDefault();
    };

    if (typeof document !== 'undefined') {
        document.addEventListener('DOMContentLoaded', () => {
            rhythmMod.bindEngineHooks();
            populateKitSelect(currentKitId);
            populateSubdivSelect(getMeterLabel(), currentSubdiv);
            renderBeatDial(-1);
            syncMorePanelState(readMorePref(), true);
            syncPlayingVisuals();
        });
    }

    // --- Aliases ---
    window.renderRhythmsList = rhythmMod.renderList;
    window.updateRhythmBpm = rhythmMod.updateBpm;
    window.handleDeleteRhythm = rhythmMod.handleDelete;
    window.activateSongRhythm = rhythmMod.activate;
    window.resetRhythmToDefault = rhythmMod.resetToDefault;
    window.toggleMasterRhythm = rhythmMod.toggleMaster;
    window.toggleRhythmMetronome = rhythmMod.toggleMetronome;
    window.toggleRhythmMorePanel = rhythmMod.toggleMorePanel;
    window.changeRhythmKitTemp = rhythmMod.changeKitTemp;
    window.changeRhythmSubdivTemp = rhythmMod.changeSubdivTemp;
    window.downloadCurrentRhythm = rhythmMod.downloadCurrent;
    window.deleteCurrentRhythm = rhythmMod.deleteCurrent;
    window.changeRhythmVolume = rhythmMod.changeVolume;
    window.changeRhythmBpm = rhythmMod.changeBpm;
    window.clearActiveRhythm = rhythmMod.clearActive;

})(window.mNotes.ui.rhythm);
