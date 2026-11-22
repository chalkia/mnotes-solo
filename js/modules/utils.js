/**
 * mNotes Utils Module
 * Part of the "Babushka" Refactoring Project
 */

// Initialize the global Namespace
window.mNotes = window.mNotes || {};
window.mNotes.core = window.mNotes.core || {};
window.mNotes.core.utils = window.mNotes.core.utils || {};
window.mNotes.logic = window.mNotes.logic || {};
window.mNotes.ui = window.mNotes.ui || {};

(function(utils) {

    var activeToast = null;
    var activeToastTimer = null;

    /**
     * Εμφάνιση Toast μηνύματος (προαιρετικά με action button & διάρκεια)
     */
    utils.showToast = function(msg, type = 'info', opts = {}) {
        if (window.mToast && typeof window.mToast.show === 'function') {
            return window.mToast.show(msg, type, opts);
        }
        if (activeToast && activeToast.parentNode) {
            clearTimeout(activeToastTimer);
            activeToast.parentNode.removeChild(activeToast);
            activeToast = null;
        }

        var o = (opts && typeof opts === 'object') ? opts : {};
        var durationMs = (typeof o.durationMs === 'number' && o.durationMs > 0) ? o.durationMs : 3000;
        var hasAction = Boolean(o.actionLabel && typeof o.onAction === 'function');

        var div = document.createElement("div");
        activeToast = div;
        div.id = "mnotesActiveToast";

        var bgColor = "#222";
        if (type === 'success') {
            bgColor = "#2e7d32"; // Πράσινο (συγχρονισμός / cloud)
        } else if (type === 'warning') {
            bgColor = "#e65100"; // Πορτοκαλί (offline αποθήκευση)
        } else if (type === 'error') {
            bgColor = "#c62828"; // Κόκκινο (σφάλμα)
        }

        if (hasAction) {
            var span = document.createElement('span');
            span.innerHTML = msg;
            var btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'toast-action-btn';
            btn.textContent = o.actionLabel;
            btn.style.cssText = 'margin-left:10px; padding:4px 10px; border-radius:14px; border:1px solid rgba(255,255,255,0.45); background:rgba(255,255,255,0.16); color:#fff; font-weight:700; font-size:13px; cursor:pointer;';
            btn.onclick = function(ev) {
                ev.stopPropagation();
                clearTimeout(activeToastTimer);
                if (div.parentNode) div.parentNode.removeChild(div);
                if (activeToast === div) activeToast = null;
                o.onAction();
            };
            div.appendChild(span);
            div.appendChild(btn);
        } else {
            div.innerHTML = msg;
        }
        
        div.style.position = "fixed";
        div.style.bottom = hasAction ? "18px" : "80px";
        div.style.left = "50%";
        div.style.transform = "translateX(-50%)"; 
        div.style.backgroundColor = bgColor; 
        div.style.color = "#fff";           
        div.style.padding = "8px 18px";    
        div.style.borderRadius = "30px";    
        div.style.fontSize = "14px";
        div.style.fontWeight = "bold";
        div.style.boxShadow = "0 6px 20px rgba(0,0,0,0.5)"; 
        div.style.zIndex = "9000";   
        div.style.opacity = "0";
        div.style.maxWidth = hasAction ? "calc(100vw - 140px)" : "85vw";
        div.style.textAlign = "center";
        div.style.display = hasAction ? "inline-flex" : "block";
        div.style.alignItems = "center";
        div.style.justifyContent = "center";
        div.style.flexWrap = "wrap";
        div.style.gap = "4px";
        div.style.pointerEvents = hasAction ? "auto" : "none";
        div.style.transition = "opacity 0.3s ease-in-out, transform 0.3s";
        
        document.body.appendChild(div);

        requestAnimationFrame(() => {
            div.style.opacity = "1";
            div.style.transform = "translateX(-50%) translateY(-10px)";
        });

        activeToastTimer = setTimeout(function() {
            div.style.opacity = "0";
            div.style.transform = "translateX(-50%) translateY(0)";
            setTimeout(function() {
                if (div.parentNode) div.parentNode.removeChild(div);
                if (activeToast === div) activeToast = null;
            }, 300);
        }, durationMs);
    };

    /**
     * Custom Confirm Modal
     */
    utils.mConfirm = function(msg, isDanger = false) {
        if (window.mDialog && typeof window.mDialog.confirm === 'function') {
            return isDanger ? window.mDialog.dangerConfirm({ message: msg }) : window.mDialog.confirm({ message: msg });
        }
        return new Promise((resolve) => {
            const modal = document.getElementById('mConfirmModal');
            if (!modal) { resolve(confirm(msg)); return; }
            
            const msgEl = document.getElementById('mConfirmMsg');
            if (msgEl) msgEl.innerText = msg;
            
            const icon = document.getElementById('mConfirmIcon');
            const okBtn = document.getElementById('btnMConfirmOk');
            
            if (isDanger && icon && okBtn) {
                icon.className = 'fas fa-exclamation-triangle';
                icon.style.color = 'var(--danger, #ff4444)';
                okBtn.style.background = 'var(--danger, #ff4444)';
                okBtn.style.color = '#fff';
            } else if (icon && okBtn) {
                icon.className = 'fas fa-question-circle';
                icon.style.color = 'var(--accent, #ff9800)';
                okBtn.style.background = 'var(--accent, #ff9800)';
                okBtn.style.color = '#000';
            }
            
            modal.style.display = 'flex';
            
            const btnCancel = document.getElementById('btnMConfirmCancel');
            
            const cleanup = () => {
                modal.style.display = 'none';
                if (btnCancel) btnCancel.removeEventListener('click', onCancel);
                if (okBtn) okBtn.removeEventListener('click', onOk);
            };
            const onCancel = () => { cleanup(); resolve(false); };
            const onOk = () => { cleanup(); resolve(true); };
            
            if (btnCancel) btnCancel.addEventListener('click', onCancel);
            if (okBtn) okBtn.addEventListener('click', onOk);
        });
    };

    /**
     * Custom Prompt Modal
     */
    utils.mPrompt = function(msg, defaultVal = "", checkboxOpts = null) {
        if (window.mDialog && typeof window.mDialog.prompt === 'function') {
            return window.mDialog.prompt({
                message: msg,
                defaultValue: defaultVal,
                checkbox: checkboxOpts
            });
        }
        return new Promise((resolve) => {
            const modal = document.getElementById('mPromptModal');
            if (!modal) { resolve(prompt(msg, defaultVal)); return; }
            
            const msgEl = document.getElementById('mPromptMsg');
            if (msgEl) msgEl.innerText = msg;
            
            const input = document.getElementById('mPromptInput');
            if (input) {
                input.value = defaultVal;
            }

            const chkContainer = document.getElementById('mPromptCheckboxContainer');
            const chkInput = document.getElementById('mPromptCheckbox');
            const chkLabel = document.getElementById('mPromptCheckboxLabel');

            if (checkboxOpts && chkContainer && chkInput && chkLabel) {
                chkLabel.innerText = checkboxOpts.label || "Επιλογή";
                chkInput.checked = !!checkboxOpts.defaultChecked;
                chkContainer.style.display = 'block';
            } else if (chkContainer) {
                chkContainer.style.display = 'none';
            }

            modal.style.display = 'flex';
            if (input) input.focus();
            
            const btnCancel = document.getElementById('btnMPromptCancel');
            const btnOk = document.getElementById('btnMPromptOk');
            
            const cleanup = () => {
                modal.style.display = 'none';
                if (btnCancel) btnCancel.removeEventListener('click', onCancel);
                if (btnOk) btnOk.removeEventListener('click', onOk);
                if (input) input.removeEventListener('keyup', onEnter);
            };
            
            const onCancel = () => { cleanup(); resolve(null); };
            const onOk = () => { 
                cleanup(); 
                if (checkboxOpts) {
                    resolve({ value: input ? input.value : null, checked: chkInput ? chkInput.checked : false });
                } else {
                    resolve(input ? input.value : null); 
                }
            };
            const onEnter = (e) => { if (e.key === 'Enter') onOk(); };
            
            if (btnCancel) btnCancel.addEventListener('click', onCancel);
            if (btnOk) btnOk.addEventListener('click', onOk);
            if (input) input.addEventListener('keyup', onEnter);
        });
    };


    /**
     * Εξαγωγή YouTube ID από URL
     */
    utils.getYoutubeId = function(url) {
        if (!url) return null; 
        var regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=|shorts\/)([^#\&\?]*).*/; 
        var match = url.match(regExp); 
        return (match && match[2].length === 11) ? match[2] : null; 
    };

    /**
     * Transpose Note Logic
     */
    utils.getNote = function(note, semitones, opts = {}) {
        if (!note || note === "-" || note === "") return note;
        // Do NOT return early for semitones === 0 unless we also have no preferences to apply.
        // It's safer to always run it so formatting (e.g. Db -> C# if set to sharps) applies.

        const transposePart = (part) => {
            let match = part.match(/^[A-Ga-g][#b]?/);
            if (!match) return part; 
            
            let root = match[0];
            let suffix = part.substring(root.length);
            let isLower = (root === root.toLowerCase());
            let searchRoot = root.charAt(0).toUpperCase() + root.slice(1).toLowerCase();
            
            const SHARP = (typeof NOTES !== 'undefined') ? NOTES : ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
            const FLAT  = (typeof NOTES_FLAT !== 'undefined') ? NOTES_FLAT : ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];
            
            let index = SHARP.indexOf(searchRoot);
            if (index === -1) index = FLAT.indexOf(searchRoot);
            if (index === -1) return part; 
            
            let newIndex = (index + semitones) % 12;
            if (newIndex < 0) newIndex += 12;
            
            let outScale;
            let mode = (typeof userSettings !== 'undefined' && userSettings.accidentalMode) ? userSettings.accidentalMode : 'scale';
            if (opts.ignorePreferences) mode = 'scale';
            
            if (semitones === 0 && mode === 'scale') {
                // ⚠️ ΕΠΙΣΤΡΕΦΟΥΜΕ `part`, ΟΧΙ `note`.
                // Το `note` είναι η παράμετρος της ΕΞΩΤΕΡΙΚΗΣ getNote — ολόκληρη η
                // συγχορδία. Εδώ μέσα δουλεύουμε σε ΜΙΣΟ (το `part`). Στις slash
                // συγχορδίες η getNote καλεί δύο φορές την transposePart και ενώνει
                // με «/», οπότε με `note` το C/E γινόταν C/E/C/E.
                // Στις απλές συγχορδίες δεν φαινόταν, γιατί εκεί note === part.
                return part;
            }

            if (mode === 'sharps') {
                outScale = SHARP;
            } else if (mode === 'flats') {
                outScale = FLAT;
            } else {
                let refRoot = null;
                let isMinor = false;
                
                if (opts.baseKey && opts.baseKey !== "-" && opts.baseKey !== "") {
                    // Compute the visual key strictly by theory to find its accidentals
                    let refKey = utils.getNote(opts.baseKey, opts.keyTranspose || 0, { ignorePreferences: true });
                    let kMatch = refKey.match(/^[A-Ga-g][#b]?/);
                    if (kMatch) {
                        refRoot = kMatch[0].charAt(0).toUpperCase() + kMatch[0].slice(1).toLowerCase();
                        isMinor = (refKey.indexOf('m') !== -1 && refKey.indexOf('maj') === -1);
                    }
                }
                
                if (!refRoot) {
                    refRoot = searchRoot;
                    isMinor = (suffix.startsWith('m') && !suffix.startsWith('maj')) || suffix.startsWith('-');
                }
                
                let refIndex = SHARP.indexOf(refRoot);
                if (refIndex === -1) refIndex = FLAT.indexOf(refRoot);
                if (refIndex === -1) refIndex = newIndex;
                
                const majorPref = (typeof THEORY_MAJOR_PREF !== 'undefined') ? THEORY_MAJOR_PREF : ['sharp','flat','sharp','flat','sharp','flat','sharp','sharp','flat','sharp','flat','sharp'];
                const minorPref = (typeof THEORY_MINOR_PREF !== 'undefined') ? THEORY_MINOR_PREF : ['flat','sharp','flat','flat','sharp','flat','sharp','flat','sharp','sharp','flat','sharp'];
                
                let theoryPreference = isMinor ? minorPref[refIndex] : majorPref[refIndex];
                outScale = (theoryPreference === 'sharp') ? SHARP : FLAT;
            }
        
            let transposedNote = outScale[newIndex];
            if (isLower) transposedNote = transposedNote.toLowerCase();
            return transposedNote + suffix;
        };

        if (note.includes('/')) {
            let parts = note.split('/');
            return `${transposePart(parts[0])}/${transposePart(parts[1])}`;
        }
        return transposePart(note);
    };

    /**
     * Parse Meta Lines for Chords (Intro/Interlude)
     */
    utils.parseMetaLine = function(text, baseKey = "-", keyTranspose = 0) {
        if (!text) return "";
        text = text.replace(/\[([A-G][b#]?[a-zA-Z0-9#\/+-]*|[a-g][b#]?)(?![a-z])\]/g, "!$1 ");
       
        return text.replace(/!([A-G][b#]?[a-zA-Z0-9#\/+-]*|[a-g][b#]?)(?![a-z])/g, (match, chord) => {
            let firstChar = chord.charAt(0).toUpperCase();
            let restOfChord = chord.slice(1);
            let calculationChord = firstChar + restOfChord;

            let translated = (typeof utils.getNote === 'function') ? utils.getNote(calculationChord, state.t - state.c, { baseKey: baseKey, keyTranspose: keyTranspose }) : chord;
            
            if (chord.charAt(0) === chord.charAt(0).toLowerCase()) {
                translated = translated.charAt(0).toLowerCase() + translated.slice(1);
            }

            return `<span class="chord" style="display:inline; position:static; font-size:inherit; color: var(--chord-color);">${translated}</span>`;
        });
    };

    /**
     * Η τονικότητα όπως την ακούει ΑΥΤΟΣ ο χρήστης.
     *
     * Η στήλη `key` κρατά την τονικότητα του τραγουδιού όπως γράφτηκε — και σε
     * μπάντα, όπως τη θέλει η μπάντα. Η προσωπική μεταφορά είναι χωριστό στρώμα.
     * Για τη βιβλιοθήκη και την αναζήτηση όμως μετράει το τι ακούει ο χρήστης:
     * αν έχει μεταφέρει το τραγούδι, γι' αυτόν είναι πλέον σε άλλη τονικότητα.
     *
     * Για το τραγούδι που είναι ανοιχτό τώρα μετράει η ζωντανή μεταφορά
     * (state.t), γιατί μπορεί να την αλλάζει εκείνη τη στιγμή. Για τα υπόλοιπα
     * μετράει η αποθηκευμένη (personal_transpose).
     */
    utils.getEffectiveKey = function(song) {
        if (!song || !song.key || song.key === "-") return (song && song.key) || "";

        var isCurrent = (typeof currentSongId !== 'undefined') && song.id === currentSongId;
        var semis = (isCurrent && typeof state !== 'undefined' && typeof state.t === 'number')
            ? state.t
            : (song.personal_transpose || 0);

        if (!semis) return song.key;
        try {
            return utils.getNote(song.key, semis, { baseKey: song.key, keyTranspose: semis });
        } catch (e) {
            return song.key;
        }
    };

    // --- Create Global Aliases for backward compatibility ---
    window.getEffectiveKey = utils.getEffectiveKey;
    window.showToast = utils.showToast;
    window.mConfirm = utils.mConfirm;
    window.mPrompt = utils.mPrompt;
    window.getYoutubeId = utils.getYoutubeId;
    window.getNote = utils.getNote;
    window.parseMetaLine = utils.parseMetaLine;

})(window.mNotes.core.utils);
