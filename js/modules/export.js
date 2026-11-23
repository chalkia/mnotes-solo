/**
 * mNotes Export & PDF Module
 */

window.mNotes = window.mNotes || {};
window.mNotes.ui = window.mNotes.ui || {};
window.mNotes.ui.export = window.mNotes.ui.export || {};

(function(exportMod) {

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

    exportMod.printPDF = function() {
        if (typeof canUserPerform === 'function' && !canUserPerform('PRINT')) {
            if (typeof promptUpgrade === 'function') promptUpgrade(t('msg_print_setlist_pdf'));
            return; 
        }

        if (!liveSetlist || liveSetlist.length === 0) {
            showToast(t('msg_list_empty'), "warning");
            return;
        }

        var currentSettings = JSON.parse(localStorage.getItem('mnotes_settings')) || {};
        var showToC = currentSettings.pdfTableOfContents !== false; 
        var showSongNumbers = currentSettings.pdfPageNumbers !== false; 
        var showCoverPage = currentSettings.pdfCoverPage !== false;
        var printLyricsOnly = currentSettings.printLyricsOnly === true;

        var fullHtmlBody = "";
        const chordRx = "([A-G][b#]?[a-zA-Z0-9#\\/+-]*|[a-g][b#]?)(?![a-z])";

        // Cover Page Generation
        if (showCoverPage) {
            var activeListName = "";
            if (typeof viewMode !== 'undefined' && viewMode === 'setlist') {
                if (window.mNotes && window.mNotes.logic && window.mNotes.logic.setlists && typeof window.mNotes.logic.setlists.getActiveName === 'function') {
                    activeListName = window.mNotes.logic.setlists.getActiveName() || "";
                } else if (window.mNotes && window.mNotes.logic && window.mNotes.logic.setlists && typeof window.mNotes.logic.setlists.getActiveNameKey === 'function') {
                    activeListName = localStorage.getItem(window.mNotes.logic.setlists.getActiveNameKey()) || "";
                } else {
                    var groupId = (typeof currentGroupId !== 'undefined') ? currentGroupId : 'personal';
                    var activeKey = groupId === 'personal' ? 'mnotes_active_personal_setlist' : `mnotes_active_band_setlist_${groupId}`;
                    activeListName = localStorage.getItem(activeKey) || "";
                }
            }

            var coverTitle = activeListName || (typeof t === 'function' ? t('lbl_personal_library') : 'Προσωπική Βιβλιοθήκη');
            var today = new Date().toLocaleDateString(typeof currentLang !== 'undefined' && currentLang === 'en' ? 'en-US' : 'el-GR', {
                year: 'numeric',
                month: 'long',
                day: 'numeric'
            });

            var coverHtml = `
                <div class="cover-page page-break">
                    <div class="cover-content">
                        <img src="icon-192dev.png" class="cover-logo" alt="Logo">
                        <h1 class="cover-title">${coverTitle}</h1>
                        <div class="cover-divider"></div>
                        <p class="cover-subtitle">${typeof t === 'function' ? t('app_title') : 'mNotes Pro'}</p>
                        <div class="cover-footer">
                            <p class="cover-date">${today}</p>
                        </div>
                    </div>
                </div>
            `;
            fullHtmlBody += coverHtml;
        }

        if (showToC) {
            let tocHtml = `
                <div class="song-page page-break">
                    <img src="icon-192dev.png" class="logo" alt="Logo">
                    <h1>${t('lbl_toc')}</h1>
                    <ul style="font-size: 18px; line-height: 1.6; margin-top: 40px; list-style-type: none; padding-left: 0;">
            `;
            liveSetlist.forEach((item, index) => {
            let songId = typeof item === 'object' ? item.id : item;
            let s = library.find(x => x.id === songId);
            if (s) {
                // 🔖 Χρησιμοποίησε την ενεργή έκδοση αν υπάρχει
                if (typeof window.getVersionGroup === 'function') {
                    const group = window.getVersionGroup(s.id);
                    if (group.length > 1) {
                        const masterId = group[0].id;
                        const activeVersions = JSON.parse(localStorage.getItem('mnotes_active_version') || '{}');
                        const rememberedId = activeVersions[masterId];
                        const activeSong = rememberedId ? library.find(x => x.id === rememberedId) : null;
                        if (activeSong) s = activeSong;
                    }
                }
                let sTitle = s.title || t('lbl_untitled');
                let sArtist = s.artist ? `<span style="color:#666; font-size:14px;"> - ${s.artist}</span>` : "";
                tocHtml += `<li style="margin-bottom: 10px; border-bottom: 1px dashed #ccc; padding-bottom: 5px;">
                                <strong>${index + 1}.</strong> ${sTitle} ${sArtist}
                            </li>`;
            }
        });
            tocHtml += `</ul></div>`;
            fullHtmlBody += tocHtml; 
        }

        liveSetlist.forEach((item, index) => {
            let songId = typeof item === 'object' ? item.id : item;
            let s = library.find(x => x.id === songId);
            if (!s) return;

            // 🔖 Χρησιμοποίησε την ενεργή έκδοση αν υπάρχει
            if (typeof window.getVersionGroup === 'function') {
                const group = window.getVersionGroup(s.id);
                if (group.length > 1) {
                    const masterId = group[0].id;
                    const activeVersions = JSON.parse(localStorage.getItem('mnotes_active_version') || '{}');
                    const rememberedId = activeVersions[masterId];
                    const activeSong = rememberedId ? library.find(x => x.id === rememberedId) : null;
                    if (activeSong) s = activeSong;
                }
            }

            var title = s.title || t('lbl_untitled');
            var artist = s.artist || "";
            var bodyRaw = s.body || "";
            var displayKey = s.key || "-";
            var personalTranspose = s.personal_transpose || 0;
            var effCapo = (s.personal_capo !== undefined && s.personal_capo !== null && s.personal_capo !== 0) ? s.personal_capo : (parseInt(s.capo, 10) || 0);
            var capoPrint = s.capo_print ? effCapo : 0;
            
            if (typeof getNote === 'function' && displayKey !== "-") {
                displayKey = getNote(displayKey, personalTranspose, { baseKey: displayKey, keyTranspose: personalTranspose }); 
            }
            
            var key = displayKey;
            if (capoPrint > 0) {
                key += ` <span style="background-color:#e74c3c; color:#fff; padding:2px 6px; border-radius:4px; font-size:12px; font-weight:bold; margin-left:8px; vertical-align:middle;">CAPO ${capoPrint}</span>`;
            }
            var transposeVal = personalTranspose - capoPrint;
            
            var introRaw = s.intro || "";
            var interRaw = s.interlude || "";
            var introSectionHtml = "";

            function formatIntroText(text) {
                if (!text) return "";
                const bracketRegex = new RegExp(`\\[${chordRx}\\]`, 'g');
                text = text.replace(bracketRegex, "!$1 ");
                const bangRegex = new RegExp(`!${chordRx}`, 'g');
                return text.replace(bangRegex, (match, chord) => {
                    let noteDisp = chord;
                    if (typeof getNote === 'function') {
                        try { noteDisp = getNote(chord, transposeVal, { baseKey: s.key, keyTranspose: transposeVal }); } catch(e) {}
                    }
                    return `<span class="chord inline-chord" style="margin-right: 5px;">${noteDisp}</span>`;
                });
            }

            if (introRaw.trim() !== "" && !printLyricsOnly) introSectionHtml += `<div class="intro-line"><strong>Intro:</strong> ${formatIntroText(introRaw)}</div>`;
            if (interRaw.trim() !== "" && !printLyricsOnly) introSectionHtml += `<div class="intro-line"><strong>Interlude:</strong> ${formatIntroText(interRaw)}</div>`;
            
            let introBlock = introSectionHtml !== "" ? `<div class="intro-section">${introSectionHtml}</div>` : "";
            title = title.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();

            if (window.mNotes && window.mNotes.ui && window.mNotes.ui.player && typeof window.mNotes.ui.player.formatMarkup === 'function') {
                bodyRaw = window.mNotes.ui.player.formatMarkup(bodyRaw, s);
            } else if (typeof formatStrumming === 'function') {
                bodyRaw = formatStrumming(bodyRaw);
            }
            // No pre-injection of spaces before lyrics-only stripping

            var lines = bodyRaw.split('\n');
            var htmlBody = "";
            var inSection = false;

            function renderPrintRow(line) {
                let trimmed = line.trim();
                if (trimmed === '') {
                    htmlBody += '<div class="print-row empty-row">&nbsp;</div>';
                    return;
                }
                if (trimmed.startsWith('___CUE_') && trimmed.endsWith('___')) {
                    htmlBody += `<div class="print-row cue-row">${trimmed}</div>`;
                    return;
                }
                let rawLyrics = line
                    .replace(new RegExp(`\\[${chordRx}\\]`, 'g'), '')
                    .replace(new RegExp(`!${chordRx}!?`, 'g'), '');
                let hasText = /[\p{L}]/u.test(rawLyrics); 
                let isChordsOnly = !hasText;
                let rowClass = isChordsOnly ? 'print-row chords-only-row' : 'print-row';
                if (line.includes('|') && isChordsOnly) rowClass += ' chords-grid-row';
                var rowHtml = `<div class="${rowClass}">`;

                if ((line.indexOf('!') === -1 && line.indexOf('[') === -1) || ((typeof isLyricsMode !== 'undefined' && isLyricsMode) || printLyricsOnly)) { 
                    let pureText = line;
                    if ((typeof isLyricsMode !== 'undefined' && isLyricsMode) || printLyricsOnly) {
                        pureText = rawLyrics.replace(/\s{2,}/g, ' ').trim();
                    }
                    let safeText = pureText.replace(/ /g, '&nbsp;'); 
                    rowHtml += `<div class="token"><div class="lyric-only">${(safeText && safeText.length > 0) ? safeText : "&nbsp;"}</div></div>`; 
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
                            if (typeof getNote === 'function') {
                                try { noteDisp = getNote(chordRaw, transposeVal, { baseKey: s.key, keyTranspose: transposeVal }); } catch(e) {}
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

                    function createExportTokenHtml(c, l, isChordsOnly) {
                        let safeLyric = l ? l.replace(/ /g, '&nbsp;') : "";
                        if (isChordsOnly) {
                            return `<div class="token"><div class="chord inline-chord">${c || ""}${safeLyric}</div></div>`;
                        } else {
                            let chordHtml = (c && c.trim() !== "") ? `<div class="chord">${c}</div>` : `<div class="chord empty">&nbsp;</div>`;
                            let lyricHtml = `<div class="lyric">${safeLyric !== "" ? safeLyric : "&nbsp;"}</div>`;
                            return `<div class="token">${chordHtml}${lyricHtml}</div>`;
                        }
                    }

                    // Append groups to rowHtml
                    groups.forEach(g => {
                        if (g.length === 1) {
                            rowHtml += createExportTokenHtml(g[0].chord, g[0].lyric, isChordsOnly);
                        } else {
                            rowHtml += `<div class="token-group">`;
                            g.forEach(t => {
                                rowHtml += createExportTokenHtml(t.chord, t.lyric, isChordsOnly);
                            });
                            rowHtml += `</div>`;
                        }
                    });
                }
                rowHtml += '</div>';
                htmlBody += rowHtml;
            }

            lines.forEach(function(line) {
                // Check start of section
                let startMatch = line.match(/(?:!(cho|ver|bri|tab)\b|!(soc|sov|sob|sot)\b!?|\{(soc|sov|sob|sot|start_of_chorus|start_of_verse|start_of_bridge|start_of_tab)\})/i);
                if (startMatch) {
                    if (inSection) { htmlBody += '</div>'; inSection = false; }
                    let rawTag = (startMatch[1] || startMatch[2] || startMatch[3] || '').toLowerCase();
                    let sectionClass = 'chorus-section';
                    let labelText = (typeof t === 'function' ? t('lbl_chorus') : null) || 'ΡΕΦΡΕΝ';
                    if (rawTag.includes('v') || rawTag.includes('verse')) { sectionClass = 'verse-section'; labelText = (typeof t === 'function' ? t('lbl_verse') : null) || 'ΚΟΥΠΛΕ'; }
                    else if (rawTag.includes('b') || rawTag.includes('bridge')) { sectionClass = 'bridge-section'; labelText = (typeof t === 'function' ? t('lbl_bridge') : null) || 'ΓΕΦΥΡΑ'; }
                    else if (rawTag.includes('t') || rawTag.includes('tab')) { sectionClass = 'tab-section'; labelText = 'TAB'; }

                    htmlBody += `<div class="print-section ${sectionClass}">`;
                    if (sectionClass === 'chorus-section') {
                        htmlBody += `<div class="print-section-label">${labelText}</div>`;
                    }
                    inSection = true;

                    line = line.replace(/(?:!(?:cho|ver|bri|tab)\b\s*|!(?:soc|sov|sob|sot)\b!?\s*|\{(?:soc|sov|sob|sot|start_of_chorus|start_of_verse|start_of_bridge|start_of_tab)\}\s*)/gi, '').trim();
                    if (line.length === 0) return;
                }

                // Check end of section
                if (/!\/|!(?:eoc|eov|eob|eot)\b!?|\{(?:eoc|eov|eob|eot|end_of_chorus|end_of_verse|end_of_bridge|end_of_tab)\}/i.test(line)) {
                    let stripped = line.replace(/\s*(!\/|!(?:eoc|eov|eob|eot)\b!?|\{(?:eoc|eov|eob|eot|end_of_chorus|end_of_verse|end_of_bridge|end_of_tab)\})\s*$/gi, '').trim();
                    if (stripped.length > 0) {
                        renderPrintRow(stripped);
                    }
                    if (inSection) {
                        htmlBody += '</div>';
                        inSection = false;
                    }
                    return;
                }

                renderPrintRow(line);
            });
            if (inSection) { htmlBody += '</div>'; }

            // Replace markup dictionary placeholders
            if (typeof strumDictionary !== 'undefined') {
                Object.keys(strumDictionary).forEach(placeholder => {
                    htmlBody = htmlBody.replace(placeholder, strumDictionary[placeholder]);
                });
            }

            let pageBreakClass = index < liveSetlist.length - 1 ? 'page-break' : '';
            let songNumberHtml = showSongNumbers ? `<span style="color: #666; margin-right: 8px;">${index + 1}.</span>` : "";
            
            fullHtmlBody += `
                <div class="song-page ${pageBreakClass}">
                    <img src="icon-192dev.png" class="logo" alt="Logo">
                    <h1>${songNumberHtml}${title}</h1>
                    <h2>${artist}</h2>
                    ${printLyricsOnly ? '' : `<div class="meta-container"><div class="meta">Key: ${key}</div></div>`}
                    ${introBlock}
                    <div class="content">${htmlBody}</div>
                </div>
            `;
        });

        const printWin = window.open('', '', 'width=900,height=800');
        printWin.document.write(`<html><head><title>mNotes PDF</title>`);
        printWin.document.write(`<link rel="stylesheet" href="css/print.css">`);
        printWin.document.write(`</head><body>${fullHtmlBody}</body></html>`);
        printWin.document.close();
        printWin.focus();
        setTimeout(() => { printWin.print(); }, 500);
    };

    // --- Aliases ---
    window.printSetlistPDF = exportMod.printPDF;

})(window.mNotes.ui.export);
