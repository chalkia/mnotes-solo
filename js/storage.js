/* =========================================
   STORAGE & DATA MANAGEMENT (WYSIWYG EXPORT & SAFE IMPORT)
   ========================================= */

function saveToLocal() {
    const storageKey = (typeof currentGroupId !== 'undefined' && currentGroupId !== 'personal') 
        ? 'mnotes_band_' + currentGroupId 
        : 'mnotes_data';
    
    // 🛡️ Ποτέ μην αποθηκεύουμε διαγραμμένα τραγούδια τοπικά!
    const toSave = library.filter(s => {
        if (s.is_deleted) return false;
        if (typeof currentGroupId !== 'undefined' && currentGroupId !== 'personal') {
            if (s.group_id !== currentGroupId) return false; // Μην αποθηκεύεις Hybrid clones στο cache της μπάντας
        }
        return true;
    });
    safeSetLocal(storageKey, JSON.stringify(toSave));
    console.log(`💾 [STORAGE] Τοπική αποθήκευση στο κλειδί: ${storageKey} (${toSave.length} τραγούδια)`);
}

// ✅ Μετατρέπει [Am] → !Am! για συμβατότητα με το standard ! format (§Σ3.1, §Σ7.4)
function convertBracketsToBang(text) {
    if (!text) return text;
    return text.replace(/\[([^\]]+)\]/g, (match, inner) => {
        const trimmed = inner.trim();
        const lower = trimmed.toLowerCase();

        // 1. Σημειογραφία (rep / bar notation): [:], [,], [|], [||], [:|], [|:]
        if (/^[:|,.\/%x\s]+$/i.test(trimmed) || trimmed === ':|' || trimmed === '|:') {
            return trimmed;
        }

        // 2. Ετικέτες ενοτήτων ChordPro σε αγκύλες
        if (lower === 'chorus') return '!cho';
        if (lower === 'verse') return '!ver';
        if (lower === 'bridge') return '!bri';
        if (lower === 'tab') return '!tab';
        if (['intro', 'outro', 'solo', 'break', 'coda', 'interlude'].includes(lower)) {
            return trimmed;
        }

        // 3. Συγχορδίες: [Am] -> !Am!, [C/E] -> !C/E!, [D6/9] -> !D6/9!
        const isChordPattern = /^[A-Ga-g][b#]?(?:m|min|maj|dim|aug|sus|add|[0-9#\/+\-])*$/i.test(trimmed);
        if (isChordPattern) {
            const nonChordWords = ['and', 'all', 'are', 'but', 'by', 'can', 'end', 'for'];
            if (nonChordWords.includes(lower)) {
                return trimmed;
            }
            return '!' + trimmed + '!';
        }

        return trimmed;
    });
}

// 🎼 Μετατροπή ChordPro (.pro, .cho, .chopro, .crd, .txt) σε δομή τραγουδιού mNotes (§Σ1-§Σ3, §Σ7)
function parseChordPro(rawText, fileName) {
    if (!rawText) return null;

    let title = "";
    let artist = "";
    let key = "";
    let capo = null;
    let rhythm = null;
    let video = "";
    let intro = "";
    const customChords = {};
    const defineLines = [];

    if (fileName) {
        title = fileName.replace(/\.[^/.]+$/, "").trim();
    }

    const lines = rawText.split(/\r?\n/);
    const bodyLines = [];

    for (let line of lines) {
        const trimmed = line.trim();
        if (!trimmed) {
            bodyLines.push("");
            continue;
        }

        // 1. Μεταδεδομένα σε directives {...}
        const mTitle = trimmed.match(/^\{(?:title|t)\s*:\s*(.*?)\}$/i);
        if (mTitle) {
            if (mTitle[1].trim()) title = mTitle[1].trim();
            continue;
        }

        const mArtist = trimmed.match(/^\{(?:subtitle|st|artist)\s*:\s*(.*?)\}$/i);
        if (mArtist) {
            if (mArtist[1].trim()) artist = mArtist[1].trim();
            continue;
        }

        const mKey = trimmed.match(/^\{key\s*:\s*(.*?)\}$/i);
        if (mKey) {
            if (mKey[1].trim()) key = mKey[1].trim();
            continue;
        }

        // §Σ3.2: ΟΧΙ σε song.tempo (δεν υπάρχει στήλη tempo στο PostgREST)
        const mTempo = trimmed.match(/^\{tempo\s*:\s*(.*?)\}$/i);
        if (mTempo) {
            const bpm = parseInt(mTempo[1].trim(), 10);
            if (!isNaN(bpm)) {
                rhythm = { bpm: bpm };
            }
            continue;
        }

        // §Σ3.3: υποχρεωτικό parseInt για αποφυγή PostgREST 22P02 integer error (περιλαμβάνει και το 0)
        const mCapo = trimmed.match(/^\{capo\s*:\s*(.*?)\}$/i);
        if (mCapo) {
            const cVal = mCapo[1].trim();
            capo = (cVal !== "" && !isNaN(cVal)) ? parseInt(cVal, 10) : null;
            continue;
        }

        // Custom Chords: {define: chord_name base-fret N frets f1 f2 f3 f4 f5 f6} (§Σ7.2, §Σ10, §Σ11)
        const mDefine = trimmed.match(/^\{define\s*:\s*([^\s}]+)(.*?)\}$/i);
        if (mDefine) {
            const chordName = mDefine[1].trim();
            const rest = mDefine[2];
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
                    customChords[chordName] = [{ frets: fretsArr, base: baseFret }];
                } else {
                    console.warn(`[ChordPro Import] Μη έγκυρος ορισμός για τη συγχορδία '${chordName}':`, fretsArr);
                }
            } else {
                console.warn(`[ChordPro Import] Μη έγκυρος ορισμός για τη συγχορδία '${chordName}': λείπουν frets`);
            }
            // §Σ11.3: Συλλογή όλων των {define: ...} για τοποθέτηση στην κορυφή του body
            defineLines.push(trimmed);
            continue;
        }

        // Directives intro: {intro: ...}
        const mIntroDir = trimmed.match(/^\{intro\s*:\s*(.*?)\}$/i);
        if (mIntroDir) {
            let introContent = convertBracketsToBang(mIntroDir[1].trim());
            intro = intro ? (intro + ' ' + introContent) : introContent;
            continue;
        }

        // Αγνόηση λοιπών μεταδεδομένων
        if (/^\{(?:album|year|composer|lyricist|copyright)\s*:/i.test(trimmed)) {
            continue;
        }

        // 2. Εξαγωγή YouTube URL & Capo από γραμμές (§Σ7.4)
        const mYt = line.match(/(https?:\/\/(?:www\.)?(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)[\w\-]+[^\s]*)/i);
        if (mYt) {
            if (!video) {
                video = mYt[1].trim();
            }
            const mCapoInYt = line.match(/\(?\bcapo\s*[:=]?\s*(\d+)\)?/i);
            if (mCapoInYt && capo === null) {
                capo = parseInt(mCapoInYt[1], 10);
            }
            continue; // Η γραμμή με το YouTube URL φεύγει από το σώμα
        }

        // Αυτόνομη γραμμή Capo: π.χ. (Capo 0) ή Capo 2 (§Σ7.4)
        const mCapoAlone = trimmed.match(/^\(?\bcapo\s*[:=]?\s*(\d+)\)?$/i);
        if (mCapoAlone) {
            if (capo === null) {
                capo = parseInt(mCapoAlone[1], 10);
            }
            continue;
        }

        // 3. Εξαγωγή Intro: [INTRO][:] [Em] ... ή INTRO: ... (§Σ7.4)
        const mIntroLine = trimmed.match(/^(?:\[intro\]|intro\s*:)\s*(.*)$/i);
        if (mIntroLine) {
            let introContent = convertBracketsToBang(mIntroLine[1].trim());
            introContent = introContent.replace(/^[:\-\s]+/, '').trim();
            if (introContent) {
                intro = intro ? (intro + ' ' + introContent) : introContent;
            }
            continue; // Το intro αποθηκεύεται στο song.intro και φεύγει από το σώμα
        }

        // 4. Γραμμές TIP: / NOTE: / Note: -> !com ... !/ (§Σ7.4)
        let processedLine = line;
        if (/^(?:TIP|NOTE|Note)\s*:/i.test(trimmed)) {
            processedLine = `!com ${trimmed} !/`;
            processedLine = convertBracketsToBang(processedLine);
            bodyLines.push(processedLine);
            continue;
        }

        // 5. Μετατροπή οδηγιών και τμημάτων ChordPro -> mNotes markup
        // Τμήματα έναρξης
        processedLine = processedLine.replace(/\{(?:soc|start_of_chorus)\}/gi, '!cho');
        processedLine = processedLine.replace(/\{(?:sov|start_of_verse)\}/gi, '!ver');
        processedLine = processedLine.replace(/\{(?:sob|start_of_bridge)\}/gi, '!bri');
        processedLine = processedLine.replace(/\{(?:sot|start_of_tab)\}/gi, '!tab');

        // Τερματιστής: {eoc}, {eov}, {eob}, {eot}, {end_of_...} -> !/
        processedLine = processedLine.replace(/\{(?:eoc|end_of_chorus|eov|end_of_verse|eob|end_of_bridge|eot|end_of_tab|end_of_[a-z0-9_]+)\}/gi, '!/');

        // Σχόλια: {c: ...} ή {comment: ...} -> !com ... !/
        processedLine = processedLine.replace(/\{(?:comment|c)\s*:\s*(.*?)\}/gi, '!com $1 !/');

        // 6. Συγχορδίες: [Am] -> !Am!, [C/E] -> !C/E! χωρίς καμία προσθήκη κενών (§Σ3.1)
        processedLine = convertBracketsToBang(processedLine);

        bodyLines.push(processedLine);
    }

    // §Σ11.3: Όλα τα {define: ...} μαζεύονται στην αρχή του body
    const finalBodyLines = [];
    if (defineLines.length > 0) {
        finalBodyLines.push(...defineLines);
        finalBodyLines.push(""); // Διαχωριστική κενή γραμμή
    }
    finalBodyLines.push(...bodyLines);

    let body = finalBodyLines.join('\n').trim();

    // §Σ2.2: Έλεγχος ισοσκελισμού markup
    if (typeof window.validateMarkupBalance === 'function') {
        const balance = window.validateMarkupBalance(body);
        if (!balance.ok) {
            console.warn(`[ChordPro Import] Προειδοποίηση markup στο "${title}":`, balance);
            if (typeof showToast === 'function') {
                showToast(`Προειδοποίηση markup στο "${title}": μη ισοσκελισμένα tags.`, 'warning');
            }
        }
    }

    // §Σ3.4: Πάντα στην Προσωπική Βιβλιοθήκη (group_id = null)
    const songData = {
        title: title || "Untitled",
        artist: artist || "",
        key: key || "",
        capo: capo,
        video: video || "",
        intro: intro || "",
        rhythm: rhythm,
        body: body,
        custom_chords: Object.keys(customChords).length > 0 ? customChords : undefined,
        group_id: null
    };

    return typeof ensureSongStructure === 'function' ? ensureSongStructure(songData) : songData;
}

// Global έκθεση για χρήση από εξωτερικά scripts και τεστ
window.parseChordPro = parseChordPro;

// ── Κοινός Πυρήνας Εισαγωγής (.mnote / URL) ───────────────────────────────
window.isPersonalOwnedSong = function (song, userId) {
    if (!song || typeof song !== 'object') return false;
    if (song.group_id) return false;
    if (userId && song.user_id && song.user_id !== userId) return false;
    return true;
};

/**
 * Καθαρή επίλυση κωδικών (id, parent_id, is_clone) για εισαγόμενα τραγούδια.
 * Κρατάει το id ΜΟΝΟ αν υπάρχει ήδη στα προσωπικά του χρήστη (user_id = εγώ, group_id = null),
 * συμπεριλαμβανομένου του Κάδου. Αλλιώς παράγει νέο id.
 */
window.resolveImportedSongIdentities = function (songs, ctx) {
    const ownedPersonalIds = ctx && ctx.ownedPersonalIds instanceof Set ? ctx.ownedPersonalIds : new Set();
    const validParentIds = ctx && ctx.validParentIds instanceof Set ? ctx.validParentIds : ownedPersonalIds;
    const idGenerator = (ctx && typeof ctx.generateId === 'function')
        ? ctx.generateId
        : () => "s_" + Date.now() + "_" + Math.random().toString(36).substring(2, 7);

    const idMap = new Map();
    const resolved = (Array.isArray(songs) ? songs : []).map(song => {
        const copy = { ...song };
        const rawId = copy.id ? String(copy.id) : '';
        if (rawId && !rawId.startsWith('demo') && ownedPersonalIds.has(rawId)) {
            idMap.set(rawId, rawId);
        } else {
            const newId = idGenerator();
            if (rawId) idMap.set(rawId, newId);
            copy.id = newId;
        }
        return copy;
    });

    resolved.forEach(copy => {
        if (copy.parent_id) {
            const rawParent = String(copy.parent_id);
            const mappedParent = idMap.get(rawParent);
            if (validParentIds.has(rawParent)) {
                copy.parent_id = rawParent;
            } else if (mappedParent && validParentIds.has(mappedParent)) {
                copy.parent_id = mappedParent;
            } else {
                copy.parent_id = null;
                copy.is_clone = false;
            }
        } else {
            copy.parent_id = null;
            copy.is_clone = false;
        }
    });

    return resolved;
};

window.fetchPersonalOwnedIdsForImport = async function (candidateIds) {
    const ids = Array.from(new Set((candidateIds || []).map(id => id ? String(id) : '').filter(id => id && !id.startsWith('demo'))));
    const userId = (typeof currentUser !== 'undefined' && currentUser) ? currentUser.id : null;
    const ownedPersonalIds = new Set();
    const validParentIds = new Set();

    // 1. Pro: έλεγχος στη βάση για τα προσωπικά (συμπεριλαμβάνει και Κάδο)
    const isProCloud = (typeof canUserPerform === 'function') && canUserPerform('USE_SUPABASE');
    let dbCheckOk = false;
    if (isProCloud && userId && navigator.onLine && typeof supabaseClient !== 'undefined') {
        if (ids.length === 0) {
            dbCheckOk = true;
        } else {
            try {
                const { data, error } = await supabaseClient
                    .from('songs')
                    .select('id')
                    .eq('user_id', userId)
                    .is('group_id', null)
                    .in('id', ids);
                if (!error && Array.isArray(data)) {
                    dbCheckOk = true;
                    data.forEach(r => {
                        if (r && r.id) {
                            ownedPersonalIds.add(String(r.id));
                            validParentIds.add(String(r.id));
                        }
                    });
                }
            } catch (e) {
                console.warn('[IMPORT] Αποτυχία ελέγχου IDs στη βάση:', e);
            }
        }
    }

    // 2. Τοπικά προσωπικά τραγούδια: γεμίζουν το ownedPersonalIds ΜΟΝΟ σε μη-Pro
    //    ή όταν ο έλεγχος στη βάση απέτυχε/offline. Το validParentIds γεμίζει πάντα.
    const localSources = [];
    if (typeof library !== 'undefined' && Array.isArray(library)) localSources.push(...library);
    try {
        const rawPersonal = localStorage.getItem('mnotes_data');
        if (rawPersonal) {
            const parsed = JSON.parse(rawPersonal);
            if (Array.isArray(parsed)) localSources.push(...parsed);
        }
    } catch (e) {}

    localSources.forEach(s => {
        if (!s || !s.id) return;
        if (window.isPersonalOwnedSong(s, userId)) {
            if (!dbCheckOk) ownedPersonalIds.add(String(s.id));
            validParentIds.add(String(s.id));
        } else if (s.group_id) {
            validParentIds.add(String(s.id));
        }
    });

    // 3. Τραγούδια μπαντών του χρήστη (για έλεγχο parent_id)
    if (typeof myGroups !== 'undefined' && Array.isArray(myGroups)) {
        myGroups.forEach(g => {
            if (!g || !g.group_id) return;
            try {
                const rawBand = localStorage.getItem(`mnotes_band_${g.group_id}`);
                if (rawBand) {
                    const parsed = JSON.parse(rawBand);
                    if (Array.isArray(parsed)) {
                        parsed.forEach(s => { if (s && s.id) validParentIds.add(String(s.id)); });
                    }
                }
            } catch (e) {}
        });
    }

    return { ownedPersonalIds, validParentIds };
};

window.enqueueOrBatchImportedSong = function (safeSong, opts) {
    const o = opts || {};
    if (!o.isProCloud) return; // μη-Pro: καμία εγγραφή/ουρά προς Supabase
    const userIdToUse = o.userId || 'offline';
    const groupIdToUse = (o.groupId !== undefined) ? o.groupId : null;
    const safePayload = (typeof window.sanitizeForDatabase === 'function')
        ? window.sanitizeForDatabase(safeSong, userIdToUse, groupIdToUse)
        : safeSong;
    if (o.isOnline && typeof supabaseClient !== 'undefined' && o.hasUser) {
        o.batchCloudPayloads.push(safePayload);
    } else {
        o.batchOfflineQueue.push(safePayload);
    }
};

window.uploadImportedSongsBatch = async function (batchCloudPayloads, batchOfflineQueue) {
    if (Array.isArray(batchCloudPayloads) && batchCloudPayloads.length > 0 && typeof supabaseClient !== 'undefined') {
        console.log(`☁️ Ομαδικό ανέβασμα ${batchCloudPayloads.length} τραγουδιών...`);
        let cloudErr = null;
        try {
            const { error } = await supabaseClient.from('songs').upsert(batchCloudPayloads);
            if (error) cloudErr = error;
        } catch (e) {
            cloudErr = e;
        }
        if (cloudErr) {
            console.error('❌ [IMPORT] Σφάλμα αποθήκευσης στο Cloud:', cloudErr);
            const kind = (typeof window.classifyCloudError === 'function') ? window.classifyCloudError(cloudErr) : 'retryable';
            if (kind === 'permanent' && typeof window.addToFailedSync === 'function') {
                batchCloudPayloads.forEach(payload => window.addToFailedSync(payload, cloudErr));
                return { ok: false, failedPermanent: true, error: cloudErr };
            }
            if (typeof addToSyncQueue === 'function') {
                batchCloudPayloads.forEach(payload => addToSyncQueue('SAVE_SONG', payload));
            }
            return { ok: false, queued: true, error: cloudErr };
        }
    }
    if (Array.isArray(batchOfflineQueue) && batchOfflineQueue.length > 0 && typeof addToSyncQueue === 'function') {
        batchOfflineQueue.forEach(payload => addToSyncQueue('SAVE_SONG', payload));
    }
    return { ok: true };
};

window.loadSampleSongs = async function () {
    let rawSongs = [];
    try {
        const res = await fetch('samples/sample-songs.mnote');
        if (!res || !res.ok) throw new Error(`HTTP ${res ? res.status : 'err'}`);
        const data = await res.json();
        rawSongs = Array.isArray(data) ? data : (data && Array.isArray(data.songs) ? data.songs : []);
        if (!rawSongs.length) throw new Error('Empty sample songs');
    } catch (err) {
        console.warn('[SAMPLES] Αποτυχία φόρτωσης δοκιμαστικών:', err);
        if (typeof showToast === 'function') {
            showToast(typeof t === 'function' ? t('msg_samples_not_found', 'Δεν βρέθηκαν τα δοκιμαστικά τραγούδια') : 'Δεν βρέθηκαν τα δοκιμαστικά τραγούδια', 'error');
        }
        return false;
    }

    if (typeof window.soloImportSongs === 'function') {
        const res = window.soloImportSongs(rawSongs);
        if (!res || !res.ok) return false;
        if (typeof applySortAndRender === 'function') applySortAndRender();
        else if (typeof renderSidebar === 'function') renderSidebar();
        if (res.addedIds && res.addedIds.length > 0 && typeof loadSong === 'function') {
            loadSong(res.addedIds[0]);
        }
        if (typeof showToast === 'function') {
            const msg = (typeof t === 'function' ? t('msg_samples_loaded', 'Προστέθηκαν {n} δοκιμαστικά τραγούδια') : 'Προστέθηκαν {n} δοκιμαστικά τραγούδια').replace('{n}', String(res.addedCount));
            showToast(msg, 'success');
        }
        return true;
    }

    const userSongs = (window.library || []).filter(s => !String(s.id).includes('demo'));
    const limits = typeof getUserLimits === 'function' ? getUserLimits() : { maxGuestSongs: 5, maxSongs: 40 };
    const projectedCount = (typeof window.countDistinctSongs === 'function')
        ? window.countDistinctSongs(userSongs.concat(rawSongs))
        : userSongs.length + rawSongs.length;

    if (typeof canUserPerform === 'function' && !canUserPerform('CREATE_SONG', userSongs.length)) {
        if (typeof promptUpgrade === 'function') promptUpgrade(typeof t === 'function' ? t('msg_unlimited_songs', 'Απεριόριστα Τραγούδια') : 'Απεριόριστα Τραγούδια');
        return false;
    }
    if (typeof currentUser === 'undefined' || !currentUser) {
        if (projectedCount > limits.maxGuestSongs) {
            if (typeof showToast === 'function') showToast(typeof t === 'function' ? t('msg_import_guest_limit', `Η εισαγωγή ξεπερνάει το όριο επισκεπτών! (Max: ${limits.maxGuestSongs})`) : `Η εισαγωγή ξεπερνάει το όριο επισκεπτών! (Max: ${limits.maxGuestSongs})`, 'warning');
            return false;
        }
    } else if (projectedCount > limits.maxSongs) {
        if (typeof promptUpgrade === 'function') promptUpgrade(typeof t === 'function' ? t('msg_unlimited_songs', 'Απεριόριστα Τραγούδια') : 'Απεριόριστα Τραγούδια');
        return false;
    }

    const uid = (typeof currentUser !== 'undefined' && currentUser) ? currentUser.id : null;
    const isProCloud = (typeof canUserPerform === 'function') && canUserPerform('USE_SUPABASE');
    const resolved = window.resolveImportedSongIdentities(rawSongs, {
        ownedPersonalIds: new Set(),
        validParentIds: new Set()
    });

    window.library = Array.isArray(window.library) ? window.library : [];
    const nowIso = new Date().toISOString();
    const batchCloudPayloads = [];
    const batchOfflineQueue = [];
    const addedSongs = [];

    resolved.forEach(s => {
        const prepared = {
            ...s,
            user_id: uid,
            group_id: null,
            parent_id: null,
            is_clone: false,
            updated_at: nowIso
        };
        const safeSong = (typeof window.ensureSongStructure === 'function') ? window.ensureSongStructure(prepared) : prepared;
        window.library.push(safeSong);
        addedSongs.push(safeSong);
        window.enqueueOrBatchImportedSong(safeSong, {
            isProCloud,
            userId: uid,
            groupId: null,
            isOnline: navigator.onLine,
            hasUser: !!uid,
            batchCloudPayloads,
            batchOfflineQueue
        });
    });

    if (typeof library !== 'undefined') library = window.library;
    if (typeof saveData === 'function') saveData();
    else if (typeof safeSetLocal === 'function') safeSetLocal('mnotes_data', JSON.stringify(window.library));

    if (isProCloud) {
        await window.uploadImportedSongsBatch(batchCloudPayloads, batchOfflineQueue);
    }

    if (typeof applySortAndRender === 'function') applySortAndRender();
    else if (typeof renderSidebar === 'function') renderSidebar();

    if (addedSongs.length > 0 && typeof loadSong === 'function') {
        loadSong(addedSongs[0].id);
    }
    if (typeof showToast === 'function') {
        const msg = (typeof t === 'function' ? t('msg_samples_loaded', 'Προστέθηκαν {n} δοκιμαστικά τραγούδια') : 'Προστέθηκαν {n} δοκιμαστικά τραγούδια').replace('{n}', String(addedSongs.length));
        showToast(msg, 'success');
    }
    return true;
};

window.migrateOldDemoSongs = async function (opts) {
    try {
        if (localStorage.getItem('mnotes_demo_migrated')) return { migrated: false };
    } catch (e) {
        return { migrated: false };
    }

    const OLD_DEMOS = [
        {
            title: "Μήλο μου κόκκινο (Demo)",
            body: "!DΜήλο μου κόκκινο, ρ!Gόδο βαμμ!Dένο   ] 2x\n!Dγιατί με μ!Aάρανες, !Dτον πικ!A7ραμ!Dένο   ] 2x\n\nΠηγαίνω κι έρχομαι, μα δε σε βρίσκω   ] 2x\nΒρίσκω την πόρτα σου μανταλωμένη\nτα παραθύρια σου φεγγοβολούνε\n\nΡωτώ την πόρτα σου, πού είν' η κυρά σου   ] 2x\nΚυρά μ' δεν είναι δω, πάησε στη βρύση\nπάησε να πιει νερό και να γιομίσει"
        },
        {
            title: "Stand By Me (Demo)",
            body: "!strum: D D U U D\n\nWhen the !G!night has come\n!Em! And the land is dark\nAnd the !C!moon is the !D!only light we'll !G!see\nNo I !G!won't be afraid, no I !Em!won't be afraid\nJust as !C!long as you !D!stand, stand by !G!me\n\nSo darling, darling, !G!stand by me, oh !Em!stand by me\nOh !C!stand, !D!stand by !G!me, stand by me"
        }
    ];

    const o = opts || {};
    const genId = typeof o.generateId === 'function'
        ? o.generateId
        : () => "s_" + Date.now() + "_" + Math.random().toString(36).substring(2, 7);

    let songs = [];
    try {
        const raw = localStorage.getItem('mnotes_data');
        if (raw) {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) songs = parsed;
        }
    } catch (e) {}
    if (songs.length === 0 && typeof window.library !== 'undefined' && Array.isArray(window.library)) {
        songs = [...window.library];
    }

    const uid = (typeof currentUser !== 'undefined' && currentUser) ? currentUser.id : null;
    const isProCloud = (typeof canUserPerform === 'function') && canUserPerform('USE_SUPABASE');
    const nowIso = new Date().toISOString();
    const batchCloudPayloads = [];
    const batchOfflineQueue = [];
    let deletedCount = 0;
    let convertedCount = 0;
    const nextSongs = [];

    for (const s of songs) {
        if (!s || !s.id || s.group_id || !String(s.id).startsWith('demo')) {
            if (s) nextSongs.push(s);
            continue;
        }
        const isUntouched = OLD_DEMOS.some(d => d.title === s.title && d.body === s.body);
        if (isUntouched) {
            deletedCount++;
            continue;
        }
        const converted = {
            ...s,
            id: genId(),
            group_id: null,
            parent_id: null,
            is_clone: false,
            user_id: uid || s.user_id || null,
            updated_at: nowIso
        };
        nextSongs.push(converted);
        convertedCount++;
        window.enqueueOrBatchImportedSong(converted, {
            isProCloud,
            userId: uid,
            groupId: null,
            isOnline: typeof navigator !== 'undefined' ? navigator.onLine : false,
            hasUser: !!uid,
            batchCloudPayloads,
            batchOfflineQueue
        });
    }

    if (deletedCount > 0 || convertedCount > 0) {
        if (typeof window.library !== 'undefined') window.library = nextSongs;
        if (typeof library !== 'undefined') library = nextSongs;
        try {
            if (typeof safeSetLocal === 'function') safeSetLocal('mnotes_data', JSON.stringify(nextSongs));
            else localStorage.setItem('mnotes_data', JSON.stringify(nextSongs));
        } catch (e) {}
    }

    try {
        if (typeof safeSetLocal === 'function') safeSetLocal('mnotes_demo_migrated', '1');
        else localStorage.setItem('mnotes_demo_migrated', '1');
    } catch (e) {}

    if (isProCloud && (batchCloudPayloads.length > 0 || batchOfflineQueue.length > 0)) {
        await window.uploadImportedSongsBatch(batchCloudPayloads, batchOfflineQueue);
    }

    return { migrated: true, deletedCount, convertedCount };
};

async function importJSON(input) {
    const file = input.files[0];
    if(!file) return;

    // ✨ 1. ΕΛΕΓΧΟΣ ΚΑΤΑΛΗΞΗΣ (Απορρίπτει λάθος αρχεία)
    const validExtensions = ['.mnote', '.mnotes', '.json', '.pro', '.cho', '.chopro', '.crd', '.txt'];
    const fileName = file.name.toLowerCase();
    const isValid = validExtensions.some(ext => fileName.endsWith(ext));

    if (!isValid) {
        alert(t('msg_wrong_file_type_mnote', "Λάθος τύπος αρχείου! Παρακαλώ επιλέξτε ένα αρχείο .mnote, .json ή ChordPro (.pro, .cho, .chopro, .crd, .txt)"));
        input.value = ''; 
        return;
    }

    const isChordProExt = ['.pro', '.cho', '.chopro', '.crd'].some(ext => fileName.endsWith(ext));
    const isBandContext = (typeof currentGroupId !== 'undefined' && currentGroupId !== 'personal');

    if (!isChordProExt && isBandContext) {
        const isGod = roleCan('IMPORT_BAND_FILES');
        if (!isGod) {
            alert(t('msg_admins_only_bulk_import', "Μόνο οι διαχειριστές της μπάντας μπορούν να κάνουν μαζική εισαγωγή αρχείων."));
            input.value = '';
            return;
        }
    }

    const reader = new FileReader();
    reader.onload = async function(e) {
        try {
            const rawContent = e.target.result;
            let importedSongs = [];
            let isChordPro = false;

            try {
                const imported = JSON.parse(rawContent);
                if (imported && (imported.app_version || imported.songs || Array.isArray(imported))) {
                    if (imported.app_version && imported.songs) {
                        importedSongs = imported.songs;
                    } else {
                        importedSongs = Array.isArray(imported) ? imported : [imported];
                    }
                } else {
                    isChordPro = true;
                }
            } catch (err) {
                isChordPro = true;
            }

            if (isChordPro) {
                const song = parseChordPro(rawContent, file.name);
                if (!song) {
                    alert(t('msg_failed_chordpro_parse', "Δεν ήταν δυνατή η ανάγνωση του αρχείου ChordPro."));
                    input.value = '';
                    return;
                }
                importedSongs = [song];
            }

            let confirmMsg;
            if (isChordPro) {
                confirmMsg = `Θέλετε να εισάγετε το τραγούδι "${importedSongs[0].title}" στην Προσωπική σας Βιβλιοθήκη;`;
            } else {
                confirmMsg = isBandContext 
                    ? `⚠️ ΠΡΟΣΟΧΗ! ⚠️\n\nΠάτε να εισάγετε ${importedSongs.length} τραγούδια στην ΚΟΙΝΗ βιβλιοθήκη της Μπάντας!\nΑυτό θα επηρεάσει όλα τα μέλη.\n\nΘέλετε σίγουρα να συνεχίσετε;`
                    : `Βρέθηκαν ${importedSongs.length} τραγούδια.\nΘέλετε να τα εισάγετε στην Προσωπική σας Βιβλιοθήκη;`;
            }

            if (!confirm(confirmMsg)) {
                input.value = ''; return;
            }

            if (typeof window.soloImportSongs === 'function') {
                const res = window.soloImportSongs(importedSongs, { tombstones: data && data.tombstones });
                if (res && res.ok) {
                    if (typeof updateSetlistDropdown === 'function') updateSetlistDropdown();
                    if (typeof applyFilters === 'function') applyFilters();
                    else if (typeof renderSidebar === 'function') renderSidebar();
                    const resultMsg = `Η Εισαγωγή Ολοκληρώθηκε!\n\nΝέα: ${res.addedCount}\nΕνημερώθηκαν: ${res.updatedCount}\nΠαραλείφθηκαν (Διπλά): ${res.skippedCount}`;
                    alert(resultMsg);
                }
                input.value = '';
                return;
            }

            // §Σ3.4: Αν ο χρήστης βρίσκεται σε context μπάντας, προβολή toast
            if (isChordPro && isBandContext) {
                if (typeof showToast === 'function') {
                    showToast(t('msg_imported_to_personal', "Το τραγούδι εισήχθη στην Προσωπική σας Βιβλιοθήκη."), 'info');
                }
            }

            console.log("📥 [IMPORT] Ξεκινάει ο έξυπνος έλεγχος διπλοεγγραφών...");

            let addedCount = 0;
            let updatedCount = 0;
            let skippedCount = 0;
            
            // ✨ 2. ΚΑΛΑΘΙΑ ΟΜΑΔΙΚΟΥ UPLOAD (Batching)
            let batchCloudPayloads = []; 
            let batchOfflineQueue = [];
            const isProCloud = (typeof canUserPerform === 'function') && canUserPerform('USE_SUPABASE');

            // Επίλυση κωδικών (id, parent_id, is_clone) βάσει προσωπικών του χρήστη
            const activeImports = importedSongs.filter(s => s && !s.is_deleted);
            skippedCount += importedSongs.length - activeImports.length;
            const idCtx = await window.fetchPersonalOwnedIdsForImport(activeImports.map(s => s.id));
            const resolvedImports = window.resolveImportedSongIdentities(activeImports, idCtx);

            for (let song of resolvedImports) {

                if (typeof convertBracketsToBang === 'function' && song.body) {
                    song.body = convertBracketsToBang(song.body);
                }
                
                let safeSong = typeof ensureSongStructure === 'function' ? ensureSongStructure(song) : song;
                // Διασφαλίζουμε ότι τα imported τραγούδια δεν φέρουν ποτέ is_deleted=true
                safeSong.is_deleted = false;
                
                // §Σ3.4: ChordPro πάει ΠΑΝΤΑ στα προσωπικά
                safeSong.group_id = isChordPro ? null : (isBandContext ? currentGroupId : null);
                safeSong.user_id = (typeof currentUser !== 'undefined' && currentUser) ? currentUser.id : safeSong.user_id;
                safeSong.attachments = [];
                safeSong.recordings = [];

                const idxById = library.findIndex(x => x.id === safeSong.id);
                const safeTitle = (safeSong.title || "").toLowerCase().trim();
                const safeArtist = (safeSong.artist || "").toLowerCase().trim();
                const idxByContent = library.findIndex(x => 
                    (x.title || "").toLowerCase().trim() === safeTitle && 
                    (x.artist || "").toLowerCase().trim() === safeArtist
                );

                let needsCloudSync = false;

                if (idxById !== -1) {
                    const existingSong = library[idxById];
                    const isOldBackup = !song.updated_at && !song.updatedAt;
                    let importedTime = new Date(safeSong.updated_at || 0).getTime();
                    const existingTime = new Date(existingSong.updated_at || 0).getTime();

                    // ✨ Συμβατότητα με παλιά export που δεν είχαν rhythms / updated_at
                    if (isOldBackup) {
                        if (existingSong.rhythms && existingSong.rhythms.length > 0 && (!song.rhythms || song.rhythms.length === 0)) {
                            safeSong.rhythms = [...existingSong.rhythms];
                        }
                        if (existingSong.tempo && !song.tempo) safeSong.tempo = existingSong.tempo;
                        if (existingSong.time_signature && !song.time_signature) safeSong.time_signature = existingSong.time_signature;
                        
                        // Force update since the user explicitly requested to import this backup
                        importedTime = existingTime + 1000;
                    }

                    if (importedTime > existingTime) {
                        library[idxById] = safeSong;
                        updatedCount++;
                        needsCloudSync = true;
                    } else {
                        skippedCount++;
                    }
                } 
                else if (idxByContent !== -1) {
                    const existingSong = library[idxByContent];
                    const isOldBackup = !song.updated_at && !song.updatedAt;
                    let importedTime = new Date(safeSong.updated_at || 0).getTime();
                    const existingTime = new Date(existingSong.updated_at || 0).getTime();

                    if (isOldBackup) {
                        if (existingSong.rhythms && existingSong.rhythms.length > 0 && (!song.rhythms || song.rhythms.length === 0)) {
                            safeSong.rhythms = [...existingSong.rhythms];
                        }
                        importedTime = existingTime + 1000;
                    }

                    if (importedTime > existingTime) {
                        safeSong.id = existingSong.id; // Keep the existing ID
                        library[idxByContent] = safeSong;
                        updatedCount++;
                        needsCloudSync = true;
                    } else {
                        skippedCount++;
                    }
                } 
                else {
                    library.push(safeSong);
                    addedCount++;
                    needsCloudSync = true;
                }

                // Προσθήκη στο καλάθι (Αντί για 1-1 upload) — μόνο για Pro
                if (needsCloudSync) {
                    const hasUser = (typeof currentUser !== 'undefined' && !!currentUser);
                    window.enqueueOrBatchImportedSong(safeSong, {
                        userId: hasUser ? currentUser.id : 'offline',
                        groupId: safeSong.group_id,
                        hasUser: hasUser,
                        isProCloud: isProCloud,
                        isOnline: navigator.onLine,
                        batchCloudPayloads: batchCloudPayloads,
                        batchOfflineQueue: batchOfflineQueue
                    });
                }
            }

            // Αποθήκευση στη συσκευή ΠΡΙΝ από loadContextData (κρίσιμο για μη-Pro)
            if (typeof saveData === 'function') saveData();
            else if (typeof saveToLocal === 'function') saveToLocal();

            // ✨ 3. ΟΜΑΔΙΚΟ UPLOAD ΣΤΗ SUPABASE
            const uploadRes = await window.uploadImportedSongsBatch(batchCloudPayloads, batchOfflineQueue);

            if (typeof loadContextData === 'function') {
                await loadContextData(); 
            } else {
                if(typeof updateSetlistDropdown === 'function') updateSetlistDropdown();
                if(typeof applyFilters === 'function') applyFilters();
            }
            
            if (uploadRes && !uploadRes.ok) {
                const errText = (uploadRes.error && uploadRes.error.message) ? uploadRes.error.message : 'Cloud error';
                alert(t('msg_import_cloud_failed', `Τα τραγούδια αποθηκεύτηκαν στη συσκευή, αλλά απέτυχε ο συγχρονισμός στο Cloud (${errText}).`));
            } else {
                const resultMsg = `Η Εισαγωγή Ολοκληρώθηκε!\n\nΝέα: ${addedCount}\nΕνημερώθηκαν: ${updatedCount}\nΠαραλείφθηκαν (Διπλά): ${skippedCount}`;
                alert(resultMsg);
            }
            
        } catch(err) {
            console.error("❌ [IMPORT ERROR]", err);
            alert(t('msg_err_reading_file', "Σφάλμα στην ανάγνωση του αρχείου ❌"));
        }
    };
    reader.readAsText(file);
    input.value = ''; 
}

function exportJSON() {
   // ✨ ΝΕΟ: ΕΛΕΓΧΟΣ EXPORT ΓΙΑ ΕΠΙΣΚΕΠΤΕΣ (GUEST Auth-Wall)
    if (typeof currentUser === 'undefined' || !currentUser) {
        if (typeof canUserPerform === 'function' && !canUserPerform('GUEST_EXPORT')) {
            if (typeof showToast === 'function') showToast(t('msg_export_needs_signup', "Η Εξαγωγή απαιτεί εγγραφή."), "warning");
            
            const authMsg = document.getElementById('authMsg');
            if (authMsg) authMsg.innerText = "Δημιουργήστε έναν ΔΩΡΕΑΝ λογαριασμό για να ξεκλειδώσετε την Εξαγωγή (Backup) των τραγουδιών σας!";
            
            const authModal = document.getElementById('authModal');
            if (authModal) authModal.style.display = 'flex';
            
            return; // ⛔ Σταματάει η εξαγωγή αμέσως!
        }
    }
    const isPersonal = (typeof currentGroupId === 'undefined' || currentGroupId === 'personal');
    
    // ✨ ΜΑΓΕΙΑ W.Y.S.I.W.Y.G: Παίρνουμε Ο,ΤΙ ΒΛΕΠΕΙ Ο ΧΡΗΣΤΗΣ στη Sidebar!
    let songsToExport = (typeof visiblePlaylist !== 'undefined' && visiblePlaylist.length > 0) 
                        ? visiblePlaylist 
                        : (typeof library !== 'undefined' ? library : []);
                        
    if (songsToExport.length === 0) {
        alert(t('msg_no_songs_to_export', "Δεν υπάρχουν τραγούδια για εξαγωγή στην τρέχουσα προβολή!"));
        return;
    }

    let isSetlistMode = (typeof viewMode !== 'undefined' && viewMode === 'setlist');
    let modeLabel = isSetlistMode ? 'Setlist' : 'Library';

    // 🔖 Σε setlist: εξάγε την ενεργή έκδοση κάθε τραγουδιού (αυτή που ο χρήστης επέλεξε)
    // Σε βιβλιοθήκη: εξάγε ΟΛΕΣ τις εκδόσεις (WYSIWYG)
    if (isSetlistMode) {
        const activeVersions = JSON.parse(localStorage.getItem('mnotes_active_version') || '{}');
        songsToExport = songsToExport.map(s => {
            if (typeof window.getVersionGroup === 'function') {
                const group = window.getVersionGroup(s.id);
                if (group.length > 1) {
                    const masterId = group[0].id;
                    const rememberedId = activeVersions[masterId];
                    const activeSong = rememberedId ? library.find(x => x.id === rememberedId) : null;
                    if (activeSong) return activeSong;
                }
            }
            return s;
        });
    }

    console.log(`📦 [EXPORT] Εξαγωγή ${songsToExport.length} τραγουδιών. Προβολή: ${modeLabel}`);

    const cleanSongs = songsToExport.map(s => {
        let clean = { ...s };
        // Διαγράφουμε πεδία που δεν πρέπει να εξάγονται (για εξοικονόμηση χώρου/privacy)
        delete clean.attachments;
        delete clean.recordings;
        delete clean.group_id;
        delete clean.user_id;
        
        // Αν είμαστε σε μπάντα, σβήνουμε τα προσωπικά πεδία
        if (!isPersonal) {
            delete clean.personal_transpose;
            delete clean.personal_notes;
            delete clean.has_override;
        }

        // Το parent_id ΔΙΑΤΗΡΕΙΤΑΙ για να μην χαλάει η ιεραρχία των κλώνων
        return clean;
    });

    const exportPayload = {
        app_version: "2.1",
        export_date: new Date().toISOString(),
        context: isPersonal ? 'personal' : 'band',
        type: modeLabel.toLowerCase(),
        songs: cleanSongs
    };

    const dataStr = "data:application/octet-stream;charset=utf-8," + encodeURIComponent(JSON.stringify(exportPayload, null, 2));
    const downloadAnchorNode = document.createElement('a');
    downloadAnchorNode.setAttribute("href", dataStr);
    
    // Δυναμικό όνομα: π.χ. mnotes_Personal_Setlist_2026-03-17.mnote
    let prefix = isPersonal ? 'Personal' : 'Band';
    downloadAnchorNode.setAttribute("download", `mnotes_${prefix}_${modeLabel}_${new Date().toISOString().slice(0,10)}.mnote`);
    
    document.body.appendChild(downloadAnchorNode);
    downloadAnchorNode.click();
    downloadAnchorNode.remove();
    
    if (typeof showToast === 'function') showToast(`Η εξαγωγή (${modeLabel}) ολοκληρώθηκε! 📦`);
}

window.MNOTES_TAB_PRESETS = {
    guitar: { strings: 6, tuning: ['E,', 'A,', 'D', 'G', 'B', 'e'], label: 'Guitar' },
    bass: { strings: 4, tuning: ['E,,', 'A,,', 'D,', 'G,'], label: 'Bass' },
    bouzouki3: { strings: 3, tuning: ['D,', 'A,', 'D'], label: 'Bouzouki 3' },
    bouzouki4: { strings: 4, tuning: ['C,', 'F,', 'A,', 'D'], label: 'Bouzouki 4' },
    custom: { strings: 6, tuning: ['E,', 'A,', 'D', 'G', 'B', 'e'], label: 'Custom' }
};

window.resolveTabTuning = function (instrument, customTuningStr) {
    const presets = window.MNOTES_TAB_PRESETS || {};
    if (instrument === 'custom') {
        const custom = String(customTuningStr || '').trim().split(/\s+/).filter(Boolean);
        return custom.length ? custom : (presets.custom ? presets.custom.tuning : ['E,', 'A,', 'D', 'G', 'B', 'e']);
    }
    return presets[instrument] ? presets[instrument].tuning : null;
};

window.parseMnotesTab = function (abcSource) {
    const src = String(abcSource || '');
    const match = src.match(/^[ \t]*%%mnotes-tab:\s*([\w-]+)(?::([^\r\n]*))?/m);
    if (!match) {
        return { enabled: false, instrument: null, customTuning: '', tuning: null };
    }
    const instrument = match[1];
    const customTuning = (match[2] || '').trim();
    const tuning = (instrument === 'custom' && !customTuning)
        ? null
        : window.resolveTabTuning(instrument, customTuning);
    return { enabled: true, instrument, customTuning, tuning };
};

window.setMnotesTab = function (abcSource, opts) {
    const stripped = String(abcSource || '')
        .split(/\r?\n/)
        .filter(line => !/^\s*%%mnotes-tab:/i.test(line))
        .join('\n')
        .replace(/^\n+/, '');
    if (!opts || !opts.enabled) {
        return stripped;
    }
    const inst = String(opts.instrument || 'guitar').trim();
    let directive = `%%mnotes-tab: ${inst}`;
    if (inst === 'custom' && opts.customTuning) {
        directive += `:${String(opts.customTuning).trim()}`;
    }
    return stripped ? `${directive}\n${stripped}` : directive;
};

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        isPersonalOwnedSong: window.isPersonalOwnedSong,
        resolveImportedSongIdentities: window.resolveImportedSongIdentities,
        migrateOldDemoSongs: window.migrateOldDemoSongs,
        MNOTES_TAB_PRESETS: window.MNOTES_TAB_PRESETS,
        resolveTabTuning: window.resolveTabTuning,
        parseMnotesTab: window.parseMnotesTab,
        setMnotesTab: window.setMnotesTab
    };
}
