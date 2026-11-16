/* ===========================================================
   GUITAR CHORDS GENERATOR (SVG) - v1.2 (Standalone Module)
   =========================================================== */

const GuitarChordsUI = {
    db: typeof CHORD_DICTIONARY !== 'undefined' ? CHORD_DICTIONARY : {},
    currentVoicings: {}, 

    toggleVisibility: function(isVisible) {
        const group = document.getElementById('guitarChordsGroup');
        const sep = document.getElementById('guitarChordsSep');
        
        if (group) group.style.display = isVisible ? 'block' : 'none';
        if (sep) sep.style.display = isVisible ? 'block' : 'none';
        
        // Αποθήκευση της επιλογής
        if (typeof userSettings !== 'undefined') {
            userSettings.showChords = isVisible;
            safeSetLocal('mnotes_settings', JSON.stringify(userSettings));
        }
        
        console.log(`[GuitarChordsUI] Visibility toggled: ${isVisible}`);
        if (isVisible) this.scanAndRender(); 
    },

    scanAndRender: function(songParam) {
        console.log("[GuitarChordsUI] Σάρωση τραγουδιού για συγχορδίες...");
        // ⚠️ Το #setShowChords ΔΕΝ υπάρχει στο index.html — κάποια στιγμή αφαιρέθηκε
        // η γραμμή από τις Ρυθμίσεις. Με σκέτο `?.checked` το αποτέλεσμα ήταν
        // undefined, δηλαδή «απενεργοποιημένο», και οι δαχτυλισμοί δεν
        // ζωγραφίζονταν ΠΟΤΕ — σιωπηλά, γιατί η συνάρτηση θεωρούσε ότι σέβεται
        // μια ρύθμιση του χρήστη.
        // Αυθεντία είναι η αποθηκευμένη ρύθμιση· το checkbox μετράει μόνο αν υπάρχει.
        const _chk = document.getElementById('setShowChords');
        const isEnabled = _chk
            ? _chk.checked
            : (typeof userSettings !== 'undefined' && typeof userSettings.showChords !== 'undefined'
                ? userSettings.showChords
                : true);

        if (!isEnabled) {
            console.log("[GuitarChordsUI] Ακύρωση σάρωσης. Το εργαλείο είναι απενεργοποιημένο στις ρυθμίσεις.");
            return;
        }

        const activeSong = (typeof songParam !== 'undefined' && songParam)
            ? songParam
            : (typeof currentSong !== 'undefined' ? currentSong : null)
            || this.lastSong
            || null;
        this.lastSong = activeSong;

        // Εξαγωγή custom chords από το τραγούδι ({define: ...}) (§Σ7.2, §Σ10, §Σ11)
        let rawCustomChords = (this.lastSong && this.lastSong.custom_chords) ? { ...this.lastSong.custom_chords } : {};
        if (this.lastSong && this.lastSong.body && this.lastSong.body.includes('{define:')) {
            const defineMatches = this.lastSong.body.matchAll(/\{define\s*:\s*([^\s}]+)(.*?)\}/gi);
            for (const dm of defineMatches) {
                const chordName = dm[1].trim();
                const rest = dm[2];
                const mBase = rest.match(/base-fret\s+(\d+)/i);
                const mFrets = rest.match(/frets\s+([0-9xX\s]+)/i);
                if (mFrets) {
                    const baseFret = mBase ? parseInt(mBase[1], 10) : 1;
                    let fretsArr = mFrets[1].trim().split(/\s+/).map(f => {
                        if (f.toLowerCase() === 'x') return -1;
                        const n = parseInt(f, 10);
                        return isNaN(n) ? -1 : n;
                    });
                    if (fretsArr.length === 6) {
                        // §Σ10.6α: Μετατροπή σχετικών τιμών σε απόλυτες όταν baseFret > 1
                        if (baseFret > 1) {
                            const hasRelative = fretsArr.some(f => f > 0 && f < baseFret);
                            if (hasRelative) {
                                fretsArr = fretsArr.map(f => (f > 0 ? (baseFret + f - 1) : f));
                            }
                        }
                        rawCustomChords[chordName] = [{ frets: fretsArr, base: baseFret }];
                    } else {
                        console.warn(`[GuitarChordsUI] Μη έγκυρος ορισμός για τη συγχορδία '${chordName}':`, fretsArr);
                    }
                }
            }
        }

        // §Σ10.2: Υπολογισμός netTranspose και μεταφορά των custom chords
        const netTranspose = (typeof state !== 'undefined' && state.t !== undefined) ? (state.t - (state.c || 0)) : 0;
        let customChords = {};

        const getNoteFn = (typeof getNote === 'function') 
            ? getNote 
            : (typeof window !== 'undefined' && typeof window.getNote === 'function' ? window.getNote : null);

        for (const [chordName, voicings] of Object.entries(rawCustomChords)) {
            // Πάντα κρατάμε την αρχική μορφή
            customChords[chordName] = voicings;

            // Αν υπάρχει μεταφορά, δημιουργούμε και την αντίστοιχη μεταφερμένη custom συγχορδία (§Σ10.2-Σ10.4)
            if (netTranspose !== 0) {
                const displayName = getNoteFn
                    ? getNoteFn(chordName, netTranspose, { ignorePreferences: true })
                    : chordName;

                const origVoicing = voicings[0];
                const shifted = this.shiftVoicing(origVoicing, netTranspose);
                if (shifted) {
                    customChords[displayName] = [{
                        ...shifted,
                        _origin: chordName
                    }];
                }
            }
        }

        this.currentCustomChords = customChords;
        this.lastResolved = {};

        const chordElements = document.querySelectorAll('#view-player .chord');
        let uniqueChords = new Set();
        chordElements.forEach(el => {
            let originalC = el.innerText.trim();
            
            // Καθαρισμός από κάθετες γραμμές (|) και αγκύλες ([ ])
            let c = originalC.replace(/[|\[\]]/g, '');
            
            // Καταγραφή στο console αν έγινε καθαρισμός, για εύκολο debugging
            if (c !== originalC && c.length > 0) {
                console.log(`[GuitarChordsUI] Καθαρισμός: '${originalC}' -> '${c}'`);
            }

            if (c) uniqueChords.add(c);
        });

        const container = document.getElementById('chord-charts-container');
        if (!container) {
            console.error("[GuitarChordsUI] Σφάλμα: Δεν βρέθηκε το container #chord-charts-container στο DOM!");
            return;
        }
        
        container.innerHTML = '';

        if (uniqueChords.size === 0) {
            console.log("[GuitarChordsUI] Δεν βρέθηκαν συγχορδίες στο κείμενο.");
            const emptyMsg = typeof t === 'function' ? t('msg_no_chords') : "No chords found...";
            container.innerHTML = `<div class="empty-state">${emptyMsg}</div>`;
            return;
        }

        uniqueChords.forEach(chordName => {
            const resolved = this.resolveChord(chordName, customChords);
            if (!resolved) {
                console.warn(`[GuitarChordsUI] Προσοχή: Η συγχορδία '${chordName}' δεν υπάρχει στο λεξικό.`);
                return;
            }

            this.lastResolved[chordName] = resolved;
            let voicings = resolved.voicings;
            let displayName = resolved.name;
            let isApprox = resolved.isApprox;
            let isCustom = resolved.isCustom;
            
            if (this.currentVoicings[chordName] === undefined) {
                this.currentVoicings[chordName] = 0;
            }

            const wrapper = document.createElement('div');
            wrapper.style.cssText = "display:flex; flex-direction:column; align-items:center; background:rgba(255,255,255,0.03); padding:8px; border-radius:8px; border:1px solid var(--border-color); cursor:pointer; transition: transform 0.1s;";
            
            // On hover effect
            wrapper.onmouseenter = () => wrapper.style.transform = "scale(1.05)";
            wrapper.onmouseleave = () => wrapper.style.transform = "scale(1)";

            const header = document.createElement('div');
            header.style.cssText = "display:flex; justify-content:space-between; align-items:center; width:100%; margin-bottom:5px;";
            
            // §Σ11.2: Δύο διακριτές σημάνσεις — Προσαρμοσμένη (κυανό) vs Προσέγγιση (πορτοκαλί)
            let chordStyle = "color:var(--accent);";
            let chordTitle = "";
            let customBadge = "";

            if (isCustom) {
                chordStyle = "color:#3498db;"; // Διακριτικό κυανό για custom ({define})
                chordTitle = ' title="Προσαρμοσμένη δαχτυλοθεσία (από το τραγούδι)"';
                customBadge = ' <i class="fas fa-star" style="font-size:0.65em; margin-left:3px; color:#3498db; vertical-align:middle;" title="Προσαρμοσμένη δαχτυλοθεσία"></i>';
            } else if (isApprox) {
                chordStyle = "color:#f39c12;"; // Πορτοκαλί για προσέγγιση (ρίζα)
                chordTitle = ' title="Κατά προσέγγιση (ρίζα)"';
            }

            // Stop propagation on buttons so clicking arrows doesn't play chord
            header.innerHTML = `
                <button onclick="event.stopPropagation(); GuitarChordsUI.changeVoicing('${chordName}', -1)" style="background:none; border:none; color:var(--text-muted); cursor:pointer;"><i class="fas fa-chevron-left"></i></button>
                <strong style="${chordStyle} font-size:1.1rem;"${chordTitle}>${displayName}${customBadge}</strong>
                <button onclick="event.stopPropagation(); GuitarChordsUI.changeVoicing('${chordName}', 1)" style="background:none; border:none; color:var(--text-muted); cursor:pointer;"><i class="fas fa-chevron-right"></i></button>
            `;

            const currentVoicing = voicings[this.currentVoicings[chordName]] || voicings[0];
            const svg = this.drawSVG(currentVoicing);
            
            // Play chord when clicking the wrapper
            wrapper.onclick = () => {
                if (window.ChordPlayer) {
                    window.ChordPlayer.play(currentVoicing.frets);
                }
            };
            
            wrapper.appendChild(header);
            wrapper.appendChild(svg);
            container.appendChild(wrapper);
        });
        
        console.log(`[GuitarChordsUI] Η σχεδίαση ολοκληρώθηκε. Βρέθηκαν ${uniqueChords.size} μοναδικές συγχορδίες.`);
    },

    // 🎼 Μεταφορά δαχτυλοθεσίας κατά N ημιτόνια (§Σ10.3 & §Σ10.4)
    shiftVoicing: function(voicing, N) {
        if (!voicing || !Array.isArray(voicing.frets)) return null;
        if (N === 0) return { frets: [...voicing.frets], base: voicing.base || 1 };

        let frets = [...voicing.frets];

        // §Σ10.3: Κάθε μη-σιγασμένη τιμή μετατοπίζεται κατά N (και οι ανοιχτές: 0 + N)
        let shifted = frets.map(f => (f === -1 ? -1 : f + N));

        // §Σ10.4.4: Αν όλες οι χορδές είναι σιγασμένες, αδύνατο σχήμα
        if (shifted.every(f => f === -1)) return null;

        // §Σ10.4.1: Αρνητική μεταφορά δίνει τάστο < 0 -> προσθήκη +12 (οκτάβα)
        if (shifted.some(f => f !== -1 && f < 0)) {
            shifted = shifted.map(f => (f === -1 ? -1 : f + 12));
        }

        // Υπολογισμός newBase
        let positiveFrets = shifted.filter(f => f > 0);
        let newBase = positiveFrets.length > 0 ? Math.min(...positiveFrets) : 1;

        // §Σ10.4.2: Πολύ ψηλά (newBase > 12) -> αφαίρεση 12 (οκτάβα)
        if (newBase > 12) {
            const canShiftDown = shifted.every(f => f === -1 || (f - 12 >= 0));
            if (canShiftDown) {
                shifted = shifted.map(f => (f === -1 ? -1 : f - 12));
                positiveFrets = shifted.filter(f => f > 0);
                newBase = positiveFrets.length > 0 ? Math.min(...positiveFrets) : 1;
            }
        }

        // Έλεγχος αν κάποιο τάστο είναι ακόμα < 0 ή υπερβολικά ψηλό (> 17)
        if (shifted.some(f => f !== -1 && (f < 0 || f > 17))) {
            return null;
        }

        // §Σ10.4.3: Άνοιγμα > 4 τάστα (max - min > 3) -> δεν σχεδιάζεται (fallback)
        if (positiveFrets.length > 0) {
            const minF = Math.min(...positiveFrets);
            const maxF = Math.max(...positiveFrets);
            if (maxF - minF > 3) {
                return null;
            }
        }

        return {
            frets: shifted,
            base: Math.max(1, newBase)
        };
    },

    // 🎼 Αλυσίδα Αναζήτησης 5 Βημάτων (§Σ7.2, §Σ7.3, §Σ10, §Σ11)
    resolveChord: function(chordName, customChords) {
        if (!chordName) return null;

        // 1. Custom chords του τραγουδιού ({define: ...}) (§Σ7.2, §Σ10, §Σ11)
        // Ελέγχονται πρώτα, ώστε να υπερισχύουν του γενικού λεξικού αν ορίστηκαν από τον συντάκτη
        if (customChords && customChords[chordName]) {
            return { voicings: customChords[chordName], name: chordName, isApprox: false, isCustom: true };
        }

        // 2. Ακριβές όνομα στο γενικό λεξικό
        if (this.db && this.db[chordName]) {
            return { voicings: this.db[chordName], name: chordName, isApprox: false, isCustom: false };
        }

        // 3. Εναρμόνια αντιστοίχιση (π.χ. Db -> C#)
        const flatMap = { 'Db':'C#', 'Eb':'D#', 'Gb':'F#', 'Ab':'G#', 'Bb':'A#' };
        let enharmonic = chordName.replace(/^([A-G]b)/, match => flatMap[match] || match);
        if (enharmonic !== chordName) {
            if (customChords && customChords[enharmonic]) {
                return { voicings: customChords[enharmonic], name: chordName, isApprox: false, isCustom: true };
            }
            if (this.db && this.db[enharmonic]) {
                return { voicings: this.db[enharmonic], name: chordName, isApprox: false, isCustom: false };
            }
        }

        // 4. Μουσική κανονικοποίηση (κανόνες chord-oracle) (§Σ7.3)
        // π.χ. Esus -> Esus4, D2 -> Dsus2, D4 -> Dsus4
        let normalized = chordName;
        if (/^[A-Ga-g][#b]?sus$/i.test(chordName)) {
            normalized = chordName + '4'; // Esus -> Esus4
        } else if (/^[A-Ga-g][#b]?2$/i.test(chordName)) {
            normalized = chordName.slice(0, -1) + 'sus2';
        } else if (/^[A-Ga-g][#b]?4$/i.test(chordName)) {
            normalized = chordName.slice(0, -1) + 'sus4';
        } else if (/add9$/i.test(chordName)) {
            normalized = chordName.replace(/add9$/i, '9');
        } else if (/maj$/i.test(chordName)) {
            normalized = chordName.replace(/maj$/i, '');
        } else if (/min$/i.test(chordName)) {
            normalized = chordName.replace(/min$/i, 'm');
        }

        if (normalized !== chordName) {
            if (customChords && customChords[normalized]) {
                return { voicings: customChords[normalized], name: chordName, isApprox: false, isCustom: true };
            }
            if (this.db && this.db[normalized]) {
                return { voicings: this.db[normalized], name: chordName, isApprox: false, isCustom: false };
            }
            let enhNorm = normalized.replace(/^([A-G]b)/, match => flatMap[match] || match);
            if (customChords && customChords[enhNorm]) {
                return { voicings: customChords[enhNorm], name: chordName, isApprox: false, isCustom: true };
            }
            if (this.db && this.db[enhNorm]) {
                return { voicings: this.db[enhNorm], name: chordName, isApprox: false, isCustom: false };
            }
        }

        // 5. Fallback ρίζας με σήμανση προσέγγισης (π.χ. D6/9 -> D) (§Σ7.3)
        const mRoot = chordName.match(/^([A-Ga-g][#b]?)/);
        if (mRoot) {
            const root = mRoot[1];
            const isMinor = /m(?!aj)/i.test(chordName.slice(root.length));
            const fallbackTarget = isMinor ? (root + 'm') : root;
            let rootVoicings = (this.db && this.db[fallbackTarget]) || null;
            if (!rootVoicings) {
                let enhRoot = fallbackTarget.replace(/^([A-G]b)/, match => flatMap[match] || match);
                rootVoicings = (this.db && this.db[enhRoot]) || null;
            }
            if (rootVoicings) {
                return { voicings: rootVoicings, name: chordName + '*', isApprox: true, isCustom: false };
            }
        }

        return null;
    },

    changeVoicing: function(chordName, dir) {
        const resolved = this.lastResolved && this.lastResolved[chordName];
        const voicings = resolved ? resolved.voicings : (this.db && this.db[chordName]);
        if (!voicings || voicings.length === 0) return;
        const total = voicings.length;
        let current = (this.currentVoicings[chordName] || 0) + dir;
        if (current < 0) current = total - 1;
        if (current >= total) current = 0;
        
        this.currentVoicings[chordName] = current;
        console.log(`[GuitarChordsUI] Αλλαγή voicing για την ${chordName} (Επιλογή: ${current + 1}/${total})`);
        this.scanAndRender(this.lastSong); 
    },

    drawSVG: function(voicing) {
        const svgNS = "http://www.w3.org/2000/svg";
        const svg = document.createElementNS(svgNS, "svg");
        svg.setAttribute("width", "70");
        svg.setAttribute("height", "85");
        svg.setAttribute("viewBox", "0 0 70 85");

        const strokeColor = "#888"; 
        const dotColor = "#bb86fc"; 

        let isCapo = (typeof state !== 'undefined' && state.c && state.c > 0);

        if (voicing.base === 1) {
            const line = document.createElementNS(svgNS, "line");
            line.setAttribute("x1", "10"); line.setAttribute("y1", "20");
            line.setAttribute("x2", "60"); line.setAttribute("y2", "20");
            line.setAttribute("stroke", strokeColor);
            line.setAttribute("stroke-width", "3"); 
            svg.appendChild(line);
            
            if (isCapo) {
                const ctext = document.createElementNS(svgNS, "text");
                ctext.setAttribute("x", "5"); ctext.setAttribute("y", "14");
                ctext.setAttribute("fill", "#e74c3c"); ctext.setAttribute("font-size", "10");
                ctext.setAttribute("font-weight", "bold");
                ctext.textContent = "CAPO " + state.c;
                svg.appendChild(ctext);
            }
        }

        for (let i = 0; i <= 4; i++) {
            if (i === 0 && voicing.base === 1) continue;
            const line = document.createElementNS(svgNS, "line");
            let y = 20 + (i * 15);
            line.setAttribute("x1", "10"); line.setAttribute("y1", y);
            line.setAttribute("x2", "60"); line.setAttribute("y2", y);
            line.setAttribute("stroke", strokeColor);
            line.setAttribute("stroke-width", "1"); 
            svg.appendChild(line);
        }

        for (let i = 0; i <= 5; i++) {
            const line = document.createElementNS(svgNS, "line");
            let x = 10 + (i * 10);
            line.setAttribute("x1", x); line.setAttribute("y1", "20");
            line.setAttribute("x2", x); line.setAttribute("y2", "80");
            line.setAttribute("stroke", strokeColor);
            line.setAttribute("stroke-width", "1");
            svg.appendChild(line);
        }

        if (voicing.base > 1) {
            const text = document.createElementNS(svgNS, "text");
            text.setAttribute("x", "0"); text.setAttribute("y", "32");
            text.setAttribute("fill", strokeColor); text.setAttribute("font-size", "10");
            text.textContent = isCapo ? (voicing.base + "fr(C" + state.c + ")") : (voicing.base + "fr");
            svg.appendChild(text);
        }

        voicing.frets.forEach((fret, stringIdx) => {
            let x = 10 + (stringIdx * 10);
            if (fret === -1) {
                const text = document.createElementNS(svgNS, "text");
                text.setAttribute("x", x - 3); text.setAttribute("y", "12");
                text.setAttribute("fill", "#cf6679"); text.setAttribute("font-size", "10");
                text.textContent = "X";
                svg.appendChild(text);
            } else if (fret === 0) {
                const circle = document.createElementNS(svgNS, "circle");
                circle.setAttribute("cx", x); circle.setAttribute("cy", "10");
                circle.setAttribute("r", "3");
                circle.setAttribute("fill", "none");
                circle.setAttribute("stroke", strokeColor);
                svg.appendChild(circle);
            } else {
                const relativeFret = fret - voicing.base + 1;
                if (relativeFret >= 1 && relativeFret <= 4) {
                    let y = 20 + ((relativeFret - 1) * 15) + 7.5;
                    const circle = document.createElementNS(svgNS, "circle");
                    circle.setAttribute("cx", x); circle.setAttribute("cy", y);
                    circle.setAttribute("r", "4");
                    circle.setAttribute("fill", dotColor);
                    svg.appendChild(circle);
                }
            }
        });

        return svg;
    }
};

window.GuitarChordsUI = GuitarChordsUI;
