/**
 * mNotes Rhythm & Metronome UI Module
 */

window.mNotes = window.mNotes || {};
window.mNotes.ui = window.mNotes.ui || {};
window.mNotes.ui.rhythm = window.mNotes.ui.rhythm || {};

(function(rhythmMod) {

    let activeRhythmIndex = -1;

    rhythmMod.renderList = function(rhythms = []) {
        const listEl = document.getElementById('list-rhythms'); 
        if (!listEl) return;
        
        listEl.innerHTML = ''; 
        
        rhythms.forEach((rhythm, index) => {
            const el = document.createElement('div'); 
            el.className = 'track-item'; 
            el.style.cssText = `display:flex; justify-content:space-between; align-items:center; background:rgba(0,0,0,0.2); padding:8px; margin-bottom:5px; border-radius:4px; border-left: 3px solid var(--accent);`;
            
            const isOwnerOrAdmin = roleCan('MANAGE_BAND_RHYTHMS');
            const canDelete = currentGroupId === 'personal' || isOwnerOrAdmin;
            
            let deleteBtnHtml = canDelete ? `<button onclick="handleDeleteRhythm('${currentSongId}', ${index})" style="background:none; border:none; color:var(--danger); cursor:pointer; padding:0 5px;" title="${t('btn_delete')}"><i class="fas fa-times"></i></button>` : '';
            let downloadBtnHtml = `<button onclick="downloadAssetLocal('${rhythm.url}', '${rhythm.name}')" style="background:none; border:none; color:#28a745; cursor:pointer; padding:0 8px; font-size:1rem;" title="${t('btn_download')}"><i class="fas fa-download"></i></button>`;
            let updateBpmBtnHtml = canDelete ? `<button onclick="updateRhythmBpm('${currentSongId}', ${index})" style="background:none; border:none; color:var(--accent); cursor:pointer; padding:0 8px;" title="${t('title_save_bpm')}"><i class="fas fa-save"></i></button>` : '';

            const savedBpm = rhythm.bpm || rhythm.defaultBpm || rhythm.metadata?.defaultBpm || null;
            const bpmLabel = savedBpm ? `♩ = ${savedBpm}` : '♩ = —';

            el.innerHTML = `
                <div onclick="activateSongRhythm('${rhythm.url}', '${rhythm.name}', ${savedBpm || 0}, ${index})" style="cursor:pointer; flex:1; display:flex; align-items:center; overflow:hidden;" title="${t('title_load_rhythm')}">
                    <i class="fas fa-drum" style="color:var(--accent); margin-right:8px;"></i>
                    <div style="display:flex; flex-direction:column; overflow:hidden;">
                        <span style="font-size:0.85rem; color:var(--text-main); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${rhythm.name}</span>
                        <span class="rhythm-item-bpm" data-rhythm-idx="${index}" style="font-size:0.65rem; color:var(--text-muted);">${bpmLabel}</span>
                    </div>
                </div>
                <div style="display:flex; align-items:center;">
                    ${updateBpmBtnHtml}
                    ${downloadBtnHtml}
                    ${deleteBtnHtml}
                </div>
            `;
            listEl.appendChild(el); 
        });
        if (typeof window.fitToolsSections === 'function') window.fitToolsSections();
    };

    rhythmMod.updateBpm = function(songId, rhythmIndex) {
        const targetSong = library.find(s => s.id === songId);
        if (!targetSong || !targetSong.rhythms || !targetSong.rhythms[rhythmIndex]) return;

        const txtBpmEl = document.getElementById('txtBpm');
        const currentBpm = txtBpmEl ? (parseInt(txtBpmEl.value, 10) || 100) : 100;
        targetSong.rhythms[rhythmIndex].bpm = currentBpm;
        
        if (typeof saveSong === 'function') saveSong(targetSong);
        rhythmMod.renderList(targetSong.rhythms); 
        
        showToast(t('msg_bpm_saved').replace('{bpm}', currentBpm));
    };

    rhythmMod.handleDelete = function(songId, index) {
        if (window.mRhythm && window.activeRhythmType === 'sequencer') {
            window.mRhythm.stop();
        }
        
        window.activeRhythmType = 'metronome';
        const icon = document.getElementById('iconPlayRhythm');
        if (icon) { icon.classList.remove('fa-stop'); icon.classList.add('fa-play'); }
        
        const nameDisplay = document.getElementById('seq-current-name');
        if (nameDisplay) {
            nameDisplay.innerText = t('lbl_simple_metronome');
            nameDisplay.style.color = "var(--text-main)"; 
        }

        if (typeof deleteMediaItem === 'function') {
            deleteMediaItem(songId, 'rhythms', index);
        }
    };

    rhythmMod.activate = async function(url, name, savedBpm = null, rhythmIndex = -1) {
        activeRhythmIndex = rhythmIndex;

        if (window.mRhythm) {
            try {
                await window.mRhythm.init(); 
                window.mRhythm.stop();       
            } catch (e) { console.warn("[RHYTHM] Audio init warning:", e); }
        }

        if (typeof BasicMetronome !== 'undefined') {
            const isMetroPlaying = typeof BasicMetronome.isPlaying === 'function' ? BasicMetronome.isPlaying() : BasicMetronome.isPlaying;
            if (isMetroPlaying === true) BasicMetronome.toggle(); 
        }

        try {
            if (typeof window.beforeFetchRhythmUrl === 'function' && window.beforeFetchRhythmUrl(url) === false) {
                return;
            }
            const response = await fetch(url);
            if (!response.ok) throw new Error("Fetch failed");
            const rhythmData = await response.json();

            const nameDisplay = document.getElementById('seq-current-name');
            if (nameDisplay) {
                nameDisplay.innerText = name || rhythmData.metadata?.name || t('lbl_custom_rhythm');
                nameDisplay.style.color = "var(--accent)"; 
            }

            const EngineCls = window.UniversalPercussionEngine;
            const rawTargetBpm = savedBpm || rhythmData.metadata?.defaultBpm;
            const effectiveBpm = (rawTargetBpm && EngineCls && typeof EngineCls.normalizeLegacyBpmValue === 'function')
                ? EngineCls.normalizeLegacyBpmValue(rawTargetBpm, rhythmData)
                : rawTargetBpm;

            if (effectiveBpm) {
                const txtBpm = document.getElementById('txtBpm');
                if (txtBpm) txtBpm.value = effectiveBpm;
                rhythmMod.changeBpm(effectiveBpm);
                if (!savedBpm && rhythmIndex !== -1) {
                    const lbl = document.querySelector(`.rhythm-item-bpm[data-rhythm-idx="${rhythmIndex}"]`);
                    if (lbl) lbl.textContent = `♩ = ${effectiveBpm}`;
                }
            }

            if (window.mRhythm) {
                await window.mRhythm.loadFromObject(rhythmData);
                if (effectiveBpm) window.mRhythm.setBpm(effectiveBpm);
                window.activeRhythmType = 'sequencer'; 
                showToast(t('msg_rhythm_loaded').replace('{bpm}', effectiveBpm || 100));
            } else {
                window.activeRhythmType = 'metronome';
            }
        } catch (error) {
            console.error("[RHYTHM ERROR]:", error);
            window.activeRhythmType = 'metronome'; 
            showToast(t('msg_err_rhythm_load'), "error");
        }
    };

    rhythmMod.resetToDefault = function() {
        window.activeRhythmType = 'metronome';
        activeRhythmIndex = -1;
        
        const icon = document.getElementById('iconPlayRhythm');
        if (icon) { icon.classList.remove('fa-stop'); icon.classList.add('fa-play'); }

        if (window.mRhythm) window.mRhythm.stop();

        const nameDisplay = document.getElementById('seq-current-name');
        if (nameDisplay) {
            nameDisplay.innerText = t('sum_metronome');
            nameDisplay.style.color = "var(--text-muted)";
        }
    };

    rhythmMod.startPlayMaster = function(currentBpm, icon) {
        if (window.activeRhythmType === 'sequencer' && window.mRhythm) {
            window.mRhythm.setBpm(currentBpm);
            window.mRhythm.play().catch(err => console.error("❌ [RHYTHM] Play Error:", err));
            if (icon) { icon.classList.remove('fa-play'); icon.classList.add('fa-stop'); }
        } else {
            if (typeof BasicMetronome !== 'undefined') {
                if (typeof BasicMetronome.setBpm === 'function') BasicMetronome.setBpm(currentBpm);
                if (!BasicMetronome.isPlaying) BasicMetronome.toggle();
                if (icon) { icon.classList.remove('fa-play'); icon.classList.add('fa-stop'); }
            } else {
                showToast(t('msg_err_metro_unavail'), "error");
            }
        }
    };

    rhythmMod.toggleMaster = function() {
        const icon = document.getElementById('iconPlayRhythm');
        const txtBpmEl = document.getElementById('txtBpm');
        const currentBpm = txtBpmEl ? (parseInt(txtBpmEl.value, 10) || 100) : 100;

        const isCurrentlyPlaying = (window.activeRhythmType === 'sequencer' && window.mRhythm) 
            ? window.isRhythmPlaying 
            : (typeof BasicMetronome !== 'undefined' && BasicMetronome.isPlaying);

        if (isCurrentlyPlaying) {
            if (window.activePlayCountdown) {
                window.activePlayCountdown.cancel();
            }
            if (window.activeRhythmType === 'sequencer' && window.mRhythm) {
                window.mRhythm.stop();
            } else if (typeof BasicMetronome !== 'undefined') {
                if (BasicMetronome.isPlaying) BasicMetronome.toggle();
            }
            if (icon) { icon.classList.remove('fa-stop'); icon.classList.add('fa-play'); }
        } else {
            const delay = (typeof userSettings !== 'undefined' && typeof userSettings.playDelay !== 'undefined') ? parseInt(userSettings.playDelay) : 0;
            if (delay > 0 && typeof window.runPlayCountdown === 'function') {
                window.runPlayCountdown(delay, () => {
                    rhythmMod.startPlayMaster(currentBpm, icon);
                }, () => {
                    if (icon) { icon.classList.remove('fa-stop'); icon.classList.add('fa-play'); }
                });
            } else {
                rhythmMod.startPlayMaster(currentBpm, icon);
            }
        }
    };

    rhythmMod.changeVolume = function(value) {
        const normalizedVol = parseInt(value) / 100;
        if (window.mRhythm) {
            if (typeof window.mRhythm.setMasterVolume === 'function') window.mRhythm.setMasterVolume(normalizedVol);
            else if (window.mRhythm.engine && typeof window.mRhythm.engine.setMasterVolume === 'function') window.mRhythm.engine.setMasterVolume(normalizedVol);
        }
        if (typeof BasicMetronome !== 'undefined' && typeof BasicMetronome.setVolume === 'function') BasicMetronome.setVolume(normalizedVol);
    };

    let bpmSaveTimeout = null;
    rhythmMod.changeBpm = function(value) {
        const newBpm = parseInt(value);
        if (isNaN(newBpm)) return;
        
        const txtBpm = document.getElementById('txtBpm');
        if (txtBpm && txtBpm.value != newBpm) txtBpm.value = newBpm;
        const dispBpm = document.getElementById('dispBpm');
        if (dispBpm) dispBpm.innerText = newBpm;

        if (window.mRhythm) window.mRhythm.setBpm(newBpm);
        if (typeof BasicMetronome !== 'undefined' && typeof BasicMetronome.setBpm === 'function') BasicMetronome.setBpm(newBpm);

        clearTimeout(bpmSaveTimeout);
        bpmSaveTimeout = setTimeout(() => {
            if (typeof currentSongId !== 'undefined' && currentSongId && activeRhythmIndex !== -1) {
                const song = library.find(s => s.id === currentSongId);
                if (song && song.rhythms && song.rhythms[activeRhythmIndex]) {
                    const targetRhythm = song.rhythms[activeRhythmIndex];
                    if (targetRhythm.bpm !== newBpm) {
                        targetRhythm.bpm = newBpm;
                        if (typeof saveSong === 'function') saveSong(song);
                        rhythmMod.renderList(song.rhythms); 
                    }
                }
            }
        }, 1000);
    };

    rhythmMod.clearActive = function() {
        if (window.mRhythm && window.activeRhythmType === 'sequencer') window.mRhythm.stop();
        window.activeRhythmType = 'metronome';
        activeRhythmIndex = -1;
        const icon = document.getElementById('iconPlayRhythm');
        if (icon) { icon.classList.remove('fa-stop'); icon.classList.add('fa-play'); }
        const nameDisplay = document.getElementById('seq-current-name');
        if (nameDisplay) {
            nameDisplay.innerText = t('lbl_simple_metronome');
            nameDisplay.style.color = "var(--text-main)"; 
        }
    };

    // --- Aliases ---
    window.renderRhythmsList = rhythmMod.renderList;
    window.updateRhythmBpm = rhythmMod.updateBpm;
    window.handleDeleteRhythm = rhythmMod.handleDelete;
    window.activateSongRhythm = rhythmMod.activate;
    window.resetRhythmToDefault = rhythmMod.resetToDefault;
    window.toggleMasterRhythm = rhythmMod.toggleMaster;
    window.changeRhythmVolume = rhythmMod.changeVolume;
    window.changeRhythmBpm = rhythmMod.changeBpm;
    window.clearActiveRhythm = rhythmMod.clearActive;

})(window.mNotes.ui.rhythm);
