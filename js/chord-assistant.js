import Oracle from './chord-oracle.js';

const chordRxStr = "([A-G][b#]?[a-zA-Z0-9#\\/+-]*|[a-g][b#]?)(?![a-z])";
const bracketRx = new RegExp(`\\[(${chordRxStr})\\]`, 'g');
const bangRx = new RegExp(`!(${chordRxStr})`, 'g');

function parseSongToSections(bodyText) {
    if (!bodyText) return [];
    const blocks = bodyText.split(/\n\s*\n/);
    const sections = [];

    blocks.forEach((block, idx) => {
        const chords = [];
        const bracketMatches = [...block.matchAll(new RegExp(`\\[(${chordRxStr})\\]`, 'g'))];
        const bangMatches = []; let m2; const r2 = new RegExp(`!(${chordRxStr})`, 'g'); while ((m2 = r2.exec(block)) !== null) bangMatches.push(m2);
        
        const allMatches = [];
        bracketMatches.forEach(m => allMatches.push({ index: m.index, chord: m[1] }));
        bangMatches.forEach(m => allMatches.push({ index: m.index, chord: m[1] }));
        
        allMatches.sort((a, b) => a.index - b.index);
        allMatches.forEach(m => chords.push(m.chord));

        if (chords.length > 0) {
            sections.push({
                id: `sec_${idx}`,
                name: `Section ${idx + 1}`,
                chords: chords
            });
        }
    });

    return sections;
}

function extractAllChords(bodyText) {
    if (!bodyText) return [];
    const sections = parseSongToSections(bodyText);
    return sections.flatMap(s => s.chords);
}

const ChordAssistant = {
    runDiagnosis: function(library) {
        const results = { warnings: [], lowConfidence: [], modeStats: {} };
        library.forEach(song => {
            const chords = extractAllChords(song.body);
            if (chords.length < 3) return;

            const rec = Oracle.reconcileKey(chords, song.key);
            if (!rec) return;

            results.modeStats[rec.label] = (results.modeStats[rec.label] || 0) + 1;

            if (rec.warning) {
                results.warnings.push({ song, declaredKey: song.key, warning: rec.warning, detectedMode: rec.label });
            } else if (rec.confidence < 0.6) {
                results.lowConfidence.push({ song, confidence: rec.confidence, detectedMode: rec.label });
            }
        });

        results.warnings.sort((a, b) => a.song.title.localeCompare(b.song.title));
        results.lowConfidence.sort((a, b) => a.confidence - b.confidence);
        return results;
    },

    suggestForEditor: function(songKey, bodyText, cursorIndex) {
        const sections = parseSongToSections(bodyText);
        const textUpToCursor = bodyText.substring(0, cursorIndex);
        const sectionsUpToCursor = parseSongToSections(textUpToCursor);
        
        let sectionIndex = sectionsUpToCursor.length - 1;
        let chordIndex = -1;
        if (sectionIndex >= 0) {
            chordIndex = sectionsUpToCursor[sectionIndex].chords.length - 1;
            if (chordIndex < 0) {
                sectionIndex--;
                if (sectionIndex >= 0) chordIndex = sectionsUpToCursor[sectionIndex].chords.length - 1;
            }
        }

        const songObj = { declaredKey: songKey, sections: sections.length > 0 ? sections : [{ type: 'verse', chords: [] }] };
        const slot = { sectionIndex: Math.max(0, sectionIndex), chordIndex: chordIndex };

        try {
            const result = Oracle.suggestMissing(songObj, slot, { topN: 4, ignoreRepetition: true });
            return { result, targetSection: sectionIndex, targetChordIdx: chordIndex };
        } catch (e) {
            console.error("Oracle error:", e);
            return null;
        }
    },

    replaceChordInText: function(bodyText, sectionIndex, chordIndex, newChordStr) {
        const blocks = bodyText.split(/\n\s*\n/);
        let targetGlobalChordCount = 0;
        for (let i = 0; i < sectionIndex; i++) {
            const b = blocks[i];
            const bM = []; let mm1; const rr1 = new RegExp(bracketRx.source, 'g'); while ((mm1 = rr1.exec(b)) !== null) bM.push(mm1);
            const bM2 = []; let mm2; const rr2 = new RegExp(bangRx.source, 'g'); while ((mm2 = rr2.exec(b)) !== null) bM2.push(mm2);
            targetGlobalChordCount += (bM.length + bM2.length);
        }
        targetGlobalChordCount += chordIndex;

        let matchCounter = -1;
        const combinedRx = new RegExp(`(\\[(${chordRxStr})\\]|!(${chordRxStr}))`, 'g');
        
        return bodyText.replace(combinedRx, (match, p1, p2, p3, p4, offset) => {
            matchCounter++;
            if (matchCounter === targetGlobalChordCount) {
                if (match.startsWith('[')) return `[${newChordStr}]`;
                else return `!${newChordStr}`;
            }
            return match;
        });
    }
};

window.ChordAssistant = ChordAssistant;

window.runLibraryDiagnosis = async function() {
    let libToScan = [];
    if (typeof library !== 'undefined') libToScan = library; // index.html
    else if (typeof window.auditorGlobalData !== 'undefined' && window.auditorGlobalData.personalSongs && window.auditorGlobalData.personalSongs.length > 0) libToScan = [...(window.auditorGlobalData.personalSongs || []), ...(window.auditorGlobalData.bandSongs || [])];
    else if (typeof window.mNotesLibrary !== 'undefined') libToScan = window.mNotesLibrary; // mstudio might use this
    else if (typeof dbLibrary !== 'undefined') libToScan = dbLibrary; // another common name
    else if (typeof App !== 'undefined' && App.library) libToScan = App.library;
    else if (typeof allSongs !== 'undefined') libToScan = allSongs; // mstudio
    
    // In mstudio, window.mStudioLogic might have the library.
    // Let's fallback to fetch from localStorage if empty
    if (!libToScan || libToScan.length === 0) {
        try {
            const lStr = localStorage.getItem('mnotes_data');
            if (lStr) {
                const parsed = JSON.parse(lStr);
                if (Array.isArray(parsed)) libToScan = parsed;
                else if (parsed && Array.isArray(parsed.songs)) libToScan = parsed.songs;
            }
        } catch(e){}
    }

    // Dynamic fetch for mStudio if still empty
    if ((!libToScan || libToScan.length === 0) && typeof fetchCloudLibraryForAuditor === 'function') {
        document.getElementById('diagnosisModal').style.display = 'flex';
        document.getElementById('diagnosisLoading').style.display = 'block';
        document.getElementById('diagnosisResults').style.display = 'none';
        try {
            await fetchCloudLibraryForAuditor();
            if (typeof window.auditorGlobalData !== 'undefined' && window.auditorGlobalData.personalSongs) {
                libToScan = [...(window.auditorGlobalData.personalSongs || []), ...(window.auditorGlobalData.bandSongs || [])];
            }
        } catch(e) {
            console.error(e);
        }
    }

    if (!libToScan || libToScan.length === 0) {
        alert(t('msg_no_songs_in_library', "Δεν βρέθηκαν τραγούδια στη βιβλιοθήκη."));
        document.getElementById('diagnosisModal').style.display = 'none';
        return;
    }

    document.getElementById('diagnosisModal').style.display = 'flex';
    document.getElementById('diagnosisLoading').style.display = 'block';
    document.getElementById('diagnosisResults').style.display = 'none';

    setTimeout(() => {
        const res = ChordAssistant.runDiagnosis(libToScan);
        
        let statsHtml = '<strong>Συχνότητες Δρόμων:</strong><br>';
        const sortedModes = Object.entries(res.modeStats).sort((a,b) => b[1] - a[1]);
        statsHtml += sortedModes.map(e => `<span>${e[0]}: ${e[1]}</span>`).join(', ');
        document.getElementById('diagnosisStats').innerHTML = statsHtml;

        const warnUl = document.getElementById('diagnosisWarnings');
        warnUl.innerHTML = '';
        if (res.warnings.length === 0) warnUl.innerHTML = '<li>Κανένα πρόβλημα!</li>';
        res.warnings.forEach(w => {
            const li = document.createElement('li');
            li.style.padding = '8px';
            li.style.background = 'var(--input-bg)'; li.style.borderLeft = '4px solid var(--danger)';
            li.style.borderRadius = '4px';
            li.style.cursor = 'pointer';
            li.innerHTML = `<strong>${w.song.title}</strong> (Δηλώνει: ${w.declaredKey||'-'})<br><span style="font-size:0.85em; color:var(--danger);">${w.warning}</span>`;
            li.onclick = () => {
                document.getElementById('diagnosisModal').style.display = 'none';
                if(typeof loadSong === 'function') loadSong(w.song.id);
                if(typeof switchToEditor === 'function') switchToEditor();
            };
            warnUl.appendChild(li);
        });

        const lowUl = document.getElementById('diagnosisLowConf');
        lowUl.innerHTML = '';
        if (res.lowConfidence.length === 0) lowUl.innerHTML = '<li>Όλα ΟΚ!</li>';
        res.lowConfidence.forEach(w => {
            const li = document.createElement('li');
            li.style.padding = '8px';
            li.style.background = 'var(--input-bg)'; li.style.borderLeft = '4px solid #ff9800';
            li.style.borderRadius = '4px';
            li.style.cursor = 'pointer';
            li.innerHTML = `<strong>${w.song.title}</strong><br><span style="font-size:0.85em;">Βεβαιότητα: ${(w.confidence * 100).toFixed(1)}% (${w.detectedMode})</span>`;
            li.onclick = () => {
                document.getElementById('diagnosisModal').style.display = 'none';
                if(typeof loadSong === 'function') loadSong(w.song.id);
                if(typeof switchToEditor === 'function') switchToEditor();
            };
            lowUl.appendChild(li);
        });

        document.getElementById('diagnosisLoading').style.display = 'none';
        document.getElementById('diagnosisResults').style.display = 'flex';
    }, 100);
};

window.openChordAssistant = function() {
    const inpBody = document.getElementById('inpBody');
    if (!inpBody) return;
    const keyEl = document.getElementById('inpKey'); const key = keyEl ? keyEl.value : null;
    
    document.getElementById('chordSuggestModal').style.display = 'flex';
    const resultsDiv = document.getElementById('chordSuggestResults');
    if (!key) {
        resultsDiv.innerHTML = '<div style="color:var(--warning, orange);"><strong>Προσοχή:</strong><br/>Πρέπει να συμπληρώσετε την <strong>Τονικότητα (π.χ. Am, C)</strong> του τραγουδιού στα πεδία επεξεργασίας, ώστε ο Βοηθός να καταλάβει τον δρόμο και να προτείνει σωστές συγχορδίες!</div>';
        return;
    }
    resultsDiv.innerHTML = '<div style="text-align:center;"><i class="fas fa-spinner fa-spin fa-2x"></i></div>';

    setTimeout(() => {
        const cursor = inpBody.selectionStart;
        const resultObj = ChordAssistant.suggestForEditor(key, inpBody.value, cursor);
        
        if (!resultObj || !resultObj.result || !resultObj.result.suggestions || resultObj.result.suggestions.length === 0) {
            // Δοκιμάζουμε να πάρουμε το λεξιλόγιο γενικά για τον δρόμο της τονικότητας
            try {
                const p = Oracle.parseChord(key);
                if (p) {
                    const modeId = Oracle.detectModeFromString ? Oracle.detectModeFromString(key, p) : ((p.quality === 'm' || p.quality === 'min' || p.quality === 'min7') ? 'pop_minor' : 'pop_major');
                    const vocab = Oracle.deriveVocabulary(modeId).filter(v => v.prior > 0.05).sort((a, b) => b.prior - a.prior).slice(0, 7);
                    
                    let fallbackHtml = '<div style="font-size:0.85rem; color:var(--text-muted); margin-bottom:10px;">Δεν βρέθηκε πλαίσιο γύρω από τον κέρσορα.<br/><strong>Βασικές συγχορδίες για ' + key + ':</strong></div>';
                    
                    vocab.forEach(v => {
                        const chordName = Oracle.spellChord(v, p.root, modeId, 'simple', null);
                        fallbackHtml += 
                        '<div style="background:var(--bg-panel); border:1px solid var(--border-color); border-radius:6px; padding:10px; cursor:pointer; margin-bottom:5px; transition: background 0.2s;" onmouseover="this.style.background=\'var(--input-bg)\'" onmouseout="this.style.background=\'var(--bg-panel)\'" onclick="window.applyChordSuggestion(0, 0, \'' + chordName + '\')">' +
                            '<div style="display:flex; justify-content:space-between; align-items:center;">' +
                                '<span style="font-size:1.2rem; font-weight:bold; color:var(--accent);">' + chordName + '</span>' +
                            '</div>' +
                            '<div style="font-size:0.8rem; color:var(--text-muted);">' + (v.degree ? v.degree.label : '') + '</div>' +
                        '</div>';
                    });
                    resultsDiv.innerHTML = fallbackHtml;
                    return;
                }
            } catch(e) {}

            resultsDiv.innerHTML = '<div style="color:var(--danger);">Δεν βρέθηκε συγχορδία κοντά στον κέρσορα ή δεν υπάρχουν αρκετά δεδομένα για πρόταση.</div>';
            return;
        }

        const data = resultObj.result;
        let html = `<div style="font-size:0.85rem; color:var(--text-muted); margin-bottom:10px;">Ανάλυση: <strong>${data.key.label || 'Άγνωστο'}</strong> (Τονική: ${data.key.tonicName || '?'})</div>`;
        
        data.suggestions.forEach(s => {
            const confColor = s.confidence > 0.7 ? 'var(--accent)' : (s.confidence > 0.4 ? 'var(--warning, orange)' : 'var(--danger)');
            html += `
            <div style="background:var(--bg-panel); border:1px solid var(--border-color); border-radius:6px; padding:10px; cursor:pointer; transition: background 0.2s;" onmouseover="this.style.background='var(--input-bg)'" onmouseout="this.style.background='var(--bg-panel)'"
                 onclick="window.applyChordSuggestion(${resultObj.targetSection}, ${resultObj.targetChordIdx}, '${s.chord}')">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:5px;">
                    <span style="font-size:1.2rem; font-weight:bold; color:var(--accent);">${s.chord}</span>
                    
                </div>
                <div style="font-size:0.8rem; color:var(--text-muted);">${s.reason}</div>
            </div>`;
        });

        resultsDiv.innerHTML = html;
    }, 50);
};

window.applyChordSuggestion = function(sectionIdx, chordIdx, newChord) {
    const inpBody = document.getElementById('inpBody');
    if (inpBody) {
        const cursorPosition = window.chordAssistantCursor || inpBody.selectionStart || 0;
        const textBefore = inpBody.value.substring(0, cursorPosition);
        const textAfter = inpBody.value.substring(cursorPosition);
        let countExclamation = (inpBody.value.match(/![A-G][A-Za-z0-9#\/]*!/g) || []).length;
        let countBrackets = (inpBody.value.match(/\[[A-G][A-Za-z0-9#\/]*\]/g) || []).length;
        let format = (countExclamation > countBrackets) ? '!' : '[]';
        const chordStr = (format === '!') ? '!' + newChord + '!' : '[' + newChord + ']';
        inpBody.value = textBefore + chordStr + textAfter;
        const newCursorPos = cursorPosition + chordStr.length;
        inpBody.focus();
        inpBody.setSelectionRange(newCursorPos, newCursorPos);
        if (typeof window.updateHighlights === 'function') window.updateHighlights();
        inpBody.dispatchEvent(new Event('input'));
        document.getElementById('chordSuggestModal').style.display = 'none';
        
        // Trigger auto-save draft if available
        if (typeof window.autoSaveDraft === 'function') window.autoSaveDraft();
    }
};
