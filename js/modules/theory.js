/**
 * mNotes Theory Module
 * Handles Transposition, Capo, and Chord logic
 */

window.mNotes = window.mNotes || {};
window.mNotes.ui = window.mNotes.ui || {};
window.mNotes.theory = window.mNotes.theory || {};

(function(theory) {

    theory.transUp = function() {
        if (typeof state === 'undefined') return;
        state.t = (state.t || 0) + 1;
        if (state.t > 11) state.t = 11;
        theory.refreshPlayerUI();
    };

    theory.transDown = function() {
        if (typeof state === 'undefined') return;
        state.t = (state.t || 0) - 1;
        if (state.t < -11) state.t = -11;
        theory.refreshPlayerUI();
    };

    theory.capoUp = function() {
        if (typeof state === 'undefined') return;
        
        let max = 12;
        if (typeof userSettings !== 'undefined' && userSettings.maxCapo) {
            max = parseInt(userSettings.maxCapo);
        }
        
        if (state.c < max) {
            state.c = (state.c || 0) + 1;
        } else {
            state.c = 0; 
        }
        
        theory.refreshPlayerUI();
    };

    theory.capoDown = function() {
        if (typeof state === 'undefined') return;
        if (state.c > 0) {
            state.c = (state.c || 0) - 1;
            theory.refreshPlayerUI();
        }
    };

    theory.refreshPlayerUI = function() {
        if (currentSongId && typeof library !== 'undefined') {
            const s = library.find(x => x.id === currentSongId);
            if (s && typeof renderPlayer === 'function') {
                renderPlayer(s);
                if (typeof applyScrollBtnVisibility === 'function') applyScrollBtnVisibility();
            }
        }
        theory.updateTransDisplay();
        if (typeof renderSidebar === 'function') renderSidebar();
    };

    theory.updateTransDisplay = function() {
        const dValT = document.getElementById('val-t'); 
        const dValC = document.getElementById('val-c'); 
        const mValT = document.getElementById('drawer-val-t'); 
        const mValC = document.getElementById('drawer-val-c'); 

        const tTxt = (state.t > 0 ? "+" : "") + state.t;
        
        if (dValT) dValT.innerText = tTxt;
        if (mValT) mValT.innerText = tTxt;
        
        if (dValC) dValC.innerText = state.c;
        if (mValC) mValC.innerText = state.c;
    };

    theory.autoCapo = function() {
        const result = theory.calculateSmartCapo();
        if (result.msg === "No chords!") {
            if (typeof showToast === 'function') showToast(result.msg, "warning");
            return;
        }
        state.c = result.best;
        theory.refreshPlayerUI();
        if (typeof showToast === 'function') showToast(t('msg_smart_capo_applied', "Smart Capo: +{capo}").replace('{capo}', result.best));
    };

    theory.calculateSmartCapo = function() {
        if (typeof currentSongId === 'undefined' || !currentSongId) return { msg: "No chords!", best: 0 };
        const s = library.find(x => x.id === currentSongId);
        if (!s || !s.body) return { msg: "No chords!", best: 0 };

        const chordRx = /\[([A-G][b#]?[a-zA-Z0-9#\/+-]*|[a-g][b#]?)(?![a-z])\]/g;
        let match;
        const songChords = [];
        const text = s.body + (s.intro || "") + (s.interlude || "");
        while ((match = chordRx.exec(text)) !== null) {
            songChords.push(match[1]);
        }
        
        // Check for !chord format too
        const bangRx = /!([A-G][b#]?[a-zA-Z0-9#\/+-]*|[a-g][b#]?)(?![a-z])/g;
        while ((match = bangRx.exec(text)) !== null) {
            songChords.push(match[1]);
        }

        if (songChords.length === 0) return { msg: "No chords!", best: 0 };

        const easyChords = ["C", "G", "D", "A", "E", "Am", "Dm", "Em", "Cmaj7", "G7", "D7", "A7", "E7", "Am7", "Dm7", "Em7"];
        let bestCapo = 0;
        let maxEasy = -1;

        let maxCapoLimit = 12;
        if (typeof userSettings !== 'undefined' && userSettings.maxCapo) {
            maxCapoLimit = parseInt(userSettings.maxCapo);
        }

        for (let c = 0; c <= maxCapoLimit; c++) {
            let easyCount = 0;
            songChords.forEach(chord => {
                if (typeof getNote === 'function') {
                    try {
                        const transposed = getNote(chord, -c, { ignorePreferences: true });
                        if (easyChords.includes(transposed)) easyCount++;
                    } catch(e) {}
                }
            });
            if (easyCount > maxEasy) {
                maxEasy = easyCount;
                bestCapo = c;
            }
        }
        return { msg: "Success", best: bestCapo };
    };

    // --- Aliases ---
    window.transUp = theory.transUp;
    window.transDown = theory.transDown;
    window.capoUp = theory.capoUp;
    window.capoDown = theory.capoDown;
    window.autoCapo = theory.autoCapo;
    window.calculateSmartCapo = theory.calculateSmartCapo;
    window.refreshPlayerUI = theory.refreshPlayerUI;
    window.updateTransDisplay = theory.updateTransDisplay;

})(window.mNotes.theory);
