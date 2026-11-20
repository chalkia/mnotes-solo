/* global require, module */
/**
 * js/modules/package.js — Πυρήνας διαχείρισης πακέτων .mnotezip (Solo & Pro)
 * 
 * Καθαρές συναρτήσεις, ΧΩΡΙΣ DOM και ΧΩΡΙΣ Supabase.
 * Δέχονται και επιστρέφουν δεδομένα.
 */
(function (global) {
    'use strict';

    function getFflate() {
        if (typeof globalThis !== 'undefined' && globalThis.fflate) {
            return globalThis.fflate;
        }
        if (typeof require === 'function') {
            try {
                return require('../../libs/fflate.min.js');
            } catch (e1) {
                try {
                    return require('../libs/fflate.min.js');
                } catch (e2) {
                    try {
                        return require('./libs/fflate.min.js');
                    } catch (e3) {}
                }
            }
        }
        throw new Error('Η βιβλιοθήκη fflate δεν βρέθηκε.');
    }

    const MAX_UNCOMPRESSED_SIZE = 1024 * 1024 * 1024; // 1 GB όριο προστασίας

    /**
     * Ελέγχει την ασφάλεια μιας διαδρομής ανά τμήμα (split by '/').
     * Απορρίπτει αν ξεκινά με '/' ή αν κάποιο τμήμα είναι ακριβώς '..' ή '.'.
     * Επιτρέπει ονόματα όπως 'Ζεϊμπέκικο..pdf'.
     * 
     * @param {string} rawPath
     * @returns {boolean}
     */
    function isPathSafe(rawPath) {
        if (!rawPath || typeof rawPath !== 'string') return false;
        const normalized = rawPath.replace(/\\/g, '/');
        if (normalized.startsWith('/')) return false;
        const parts = normalized.split('/');
        for (const part of parts) {
            if (part === '.' || part === '..') {
                return false;
            }
        }
        return true;
    }

    /**
     * Ελέγχει αν το όνομα αρχείου ανήκει στα αναμενόμενα του πακέτου.
     * 
     * @param {string} filename
     * @returns {boolean}
     */
    function isExpectedName(filename) {
        if (!filename || typeof filename !== 'string') return false;
        const normalized = filename.replace(/\\/g, '/');
        if (normalized === 'manifest.json' ||
            normalized === 'songs.json' ||
            normalized === 'setlists.json' ||
            normalized === 'tombstones.json' ||
            normalized === 'assets.json') {
            return true;
        }
        if (normalized.startsWith('attachments/') && normalized.length > 'attachments/'.length) {
            return true;
        }
        if (normalized.startsWith('rhythms/') && normalized.length > 'rhythms/'.length) {
            return true;
        }
        return false;
    }

    /**
     * Ελέγχει αν τα δεδομένα ξεκινούν με την υπογραφή ZIP (PK).
     * 
     * @param {Uint8Array|ArrayBuffer|ArrayBufferView} data
     * @returns {boolean}
     */
    function isPackage(data) {
        if (!data) return false;
        let bytes;
        if (data instanceof Uint8Array) {
            bytes = data;
        } else if (data instanceof ArrayBuffer) {
            bytes = new Uint8Array(data);
        } else if (ArrayBuffer.isView(data)) {
            bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
        } else {
            return false;
        }
        if (bytes.length < 4) return false;
        return bytes[0] === 0x50 && bytes[1] === 0x4B;
    }

    /**
     * Κατασκευάζει ένα Uint8Array zip πακέτου .mnotezip
     * 
     * @param {Object} options
     * @param {string} options.app - 'pro' | 'solo' (Υποχρεωτικό)
     * @param {string} options.appVersion - π.χ. '2.6.13' (Υποχρεωτικό)
     * @param {Array} options.songs - Πίνακας τραγουδιών
     * @param {Array} options.setlists - Πίνακας λιστών
     * @param {Array} [options.tombstones] - Πίνακας διαγραμμένων (γράφεται πάντα)
     * @param {Array} [options.files] - [{ path: string, bytes: Uint8Array }]
     * @param {Array} [options.rhythms] - [{ path: string, bytes: Uint8Array }]
     * @returns {Uint8Array}
     */
    function buildPackage(options) {
        if (!options || typeof options !== 'object') {
            throw new Error('Απαιτούνται παράμετροι για την κατασκευή του πακέτου.');
        }

        const { app, appVersion } = options;
        if (app !== 'pro' && app !== 'solo') {
            throw new Error("Το πεδίο 'app' είναι υποχρεωτικό και πρέπει να είναι 'pro' ή 'solo'.");
        }
        if (!appVersion || typeof appVersion !== 'string' || !appVersion.trim()) {
            throw new Error("Το πεδίο 'appVersion' είναι υποχρεωτικό και πρέπει να είναι συμβολοσειρά έκδοσης.");
        }

        const fflate = getFflate();

        // 1. Καθαρισμός τραγουδιών: σβήνει τα recordings από κάθε τραγούδι
        const rawSongs = Array.isArray(options.songs) ? options.songs : [];
        const cleanSongs = rawSongs.map(s => {
            const copy = JSON.parse(JSON.stringify(s));
            delete copy.recordings;
            return copy;
        });

        const setlists = Array.isArray(options.setlists) ? options.setlists : [];
        const tombstones = Array.isArray(options.tombstones) ? options.tombstones : [];
        const files = Array.isArray(options.files) ? options.files : [];
        const rhythms = Array.isArray(options.rhythms) ? options.rhythms : [];
        const assets = Array.isArray(options.assets) ? options.assets : null;

        // 2. Κατασκευή manifest.json
        const manifest = {
            format: 1,
            app: app,
            appVersion: appVersion.trim(),
            createdAt: new Date().toISOString(),
            counts: {
                songs: cleanSongs.length,
                setlists: setlists.length,
                tombstones: tombstones.length,
                files: files.length,
                rhythms: rhythms.length,
                assets: assets ? assets.length : 0
            }
        };

        const zipEntries = {};
        zipEntries['manifest.json'] = fflate.strToU8(JSON.stringify(manifest, null, 2));
        zipEntries['songs.json'] = fflate.strToU8(JSON.stringify(cleanSongs, null, 2));
        zipEntries['setlists.json'] = fflate.strToU8(JSON.stringify(setlists, null, 2));
        // Το tombstones.json γράφεται ΠΑΝΤΑ (και κενό []), για σταθερή μορφή
        zipEntries['tombstones.json'] = fflate.strToU8(JSON.stringify(tombstones, null, 2));
        if (assets) {
            zipEntries['assets.json'] = fflate.strToU8(JSON.stringify(assets, null, 2));
        }

        // Attachments
        for (const file of files) {
            if (!file || !file.path) continue;
            let p = String(file.path).replace(/\\/g, '/');
            if (!isPathSafe(p)) {
                throw new Error(`Μη ασφαλής διαδρομή αρχείου στο πακέτο: ${file.path}`);
            }
            if (!p.startsWith('attachments/')) {
                p = 'attachments/' + p.replace(/^attachments\/?/, '').replace(/^\/+/, '');
            }
            if (!isPathSafe(p)) {
                throw new Error(`Μη ασφαλής διαδρομή αρχείου στο πακέτο: ${p}`);
            }
            const fileBytes = file.bytes instanceof Uint8Array ? file.bytes : new Uint8Array(file.bytes || []);
            zipEntries[p] = fileBytes;
        }

        // Rhythms
        for (const r of rhythms) {
            if (!r || !r.path) continue;
            let p = String(r.path).replace(/\\/g, '/');
            if (!isPathSafe(p)) {
                throw new Error(`Μη ασφαλής διαδρομή ρυθμού στο πακέτο: ${r.path}`);
            }
            if (!p.startsWith('rhythms/')) {
                p = 'rhythms/' + p.replace(/^rhythms\/?/, '').replace(/^\/+/, '');
            }
            if (!isPathSafe(p)) {
                throw new Error(`Μη ασφαλής διαδρομή ρυθμού στο πακέτο: ${p}`);
            }
            const rhythmBytes = r.bytes instanceof Uint8Array ? r.bytes : new Uint8Array(r.bytes || []);
            zipEntries[p] = rhythmBytes;
        }

        return fflate.zipSync(zipEntries);
    }

    /**
     * Διαβάζει ένα Uint8Array zip πακέτου .mnotezip
     * 
     * @param {Uint8Array|ArrayBuffer|ArrayBufferView} data
     * @param {Object} [options]
     * @param {number} [options.maxSize] - Προαιρετικό μέγιστο όριο αποσυμπίεσης σε bytes
     * @returns {Object} { manifest, songs, setlists, tombstones, files, rhythms }
     */
    function readPackage(data, options) {
        if (!isPackage(data)) {
            throw new Error('Μη έγκυρο αρχείο πακέτου (λείπει η υπογραφή PK).');
        }

        let bytes;
        if (data instanceof Uint8Array) {
            bytes = data;
        } else if (data instanceof ArrayBuffer) {
            bytes = new Uint8Array(data);
        } else if (ArrayBuffer.isView(data)) {
            bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
        } else {
            throw new Error('Μη έγκυρος τύπος δεδομένων για ανάγνωση πακέτου.');
        }

        const effectiveMaxSize = (options && typeof options.maxSize === 'number' && options.maxSize > 0)
            ? options.maxSize
            : MAX_UNCOMPRESSED_SIZE;

        const fflate = getFflate();

        // 1. Προστασία μεγέθους & ασφάλειας διαδρομών ΠΡΙΝ την αποσυμπίεση μέσω filter
        let preUncompressedSize = 0;
        const unzipped = fflate.unzipSync(bytes, {
            filter: f => {
                const normName = f.name.replace(/\\/g, '/');
                if (!isPathSafe(normName)) {
                    throw new Error(`Εντοπίστηκε μη ασφαλής διαδρομή στο πακέτο: ${f.name}`);
                }
                if (!isExpectedName(normName)) {
                    return false; // ΜΗΝ αποσυμπιέζεις μη αναμενόμενα αρχεία
                }
                preUncompressedSize += (f.originalSize || 0);
                if (preUncompressedSize > effectiveMaxSize) {
                    throw new Error(`Το πακέτο υπερβαίνει το μέγιστο επιτρεπόμενο όριο μεγέθους (${Math.round(effectiveMaxSize / (1024 * 1024))} MB).`);
                }
                return true;
            }
        });

        // 2. Έλεγχος μεγέθους και διαδρομών ΜΕΤΑ την αποσυμπίεση (διπλός έλεγχος αν το originalSize ήταν ψευδές)
        let postUncompressedSize = 0;
        for (const filename of Object.keys(unzipped)) {
            if (!isPathSafe(filename)) {
                throw new Error(`Εντοπίστηκε μη ασφαλής διαδρομή στο πακέτο: ${filename}`);
            }
            const entry = unzipped[filename];
            if (entry && entry.length) {
                postUncompressedSize += entry.length;
                if (postUncompressedSize > effectiveMaxSize) {
                    throw new Error(`Το πακέτο υπερβαίνει το μέγιστο επιτρεπόμενο όριο μεγέθους (${Math.round(effectiveMaxSize / (1024 * 1024))} MB).`);
                }
            }
        }

        if (!unzipped['manifest.json']) {
            throw new Error('Το πακέτο δεν περιέχει το απαραίτητο αρχείο manifest.json.');
        }

        let manifest;
        try {
            manifest = JSON.parse(fflate.strFromU8(unzipped['manifest.json']));
        } catch (e) {
            throw new Error('Το manifest.json του πακέτου δεν είναι έγκυρο JSON: ' + e.message);
        }

        if (!manifest || typeof manifest !== 'object') {
            throw new Error('Μη έγκυρο manifest.json στο πακέτο.');
        }

        if (!manifest.format || manifest.format > 1) {
            throw new Error(`Μη υποστηριζόμενη μορφή πακέτου (format: ${manifest.format}). Ενημέρωσε πρώτα την εφαρμογή.`);
        }

        // songs.json (πρέπει να είναι πίνακας)
        let songs = [];
        if (unzipped['songs.json']) {
            try {
                songs = JSON.parse(fflate.strFromU8(unzipped['songs.json']));
            } catch (e) {
                throw new Error('Το songs.json δεν είναι έγκυρο JSON: ' + e.message);
            }
            if (!Array.isArray(songs)) {
                throw new Error('Το αρχείο songs.json δεν περιέχει έγκυρο πίνακα τραγουδιών.');
            }
        }

        // setlists.json (πρέπει να είναι πίνακας)
        let setlists = [];
        if (unzipped['setlists.json']) {
            try {
                setlists = JSON.parse(fflate.strFromU8(unzipped['setlists.json']));
            } catch (e) {
                throw new Error('Το setlists.json δεν είναι έγκυρο JSON: ' + e.message);
            }
            if (!Array.isArray(setlists)) {
                throw new Error('Το αρχείο setlists.json δεν περιέχει έγκυρο πίνακα λιστών.');
            }
        }

        // tombstones.json (πρέπει να είναι πίνακας)
        let tombstones = [];
        if (unzipped['tombstones.json']) {
            try {
                tombstones = JSON.parse(fflate.strFromU8(unzipped['tombstones.json']));
            } catch (e) {
                throw new Error('Το tombstones.json δεν είναι έγκυρο JSON: ' + e.message);
            }
            if (!Array.isArray(tombstones)) {
                throw new Error('Το αρχείο tombstones.json δεν περιέχει έγκυρο πίνακα διαγραμμένων στοιχείων.');
            }
        }

        // assets.json (προαιρετικός πίνακας)
        let assets = [];
        if (unzipped['assets.json']) {
            try {
                assets = JSON.parse(fflate.strFromU8(unzipped['assets.json']));
            } catch (e) {
                throw new Error('Το assets.json δεν είναι έγκυρο JSON: ' + e.message);
            }
            if (!Array.isArray(assets)) {
                throw new Error('Το αρχείο assets.json δεν περιέχει έγκυρο πίνακα στοιχείων.');
            }
        }

        const files = [];
        const rhythms = [];

        // 3. Συλλογή αρχείων (attachments/*, rhythms/*)
        for (const filename of Object.keys(unzipped)) {
            if (filename.startsWith('attachments/') && filename.length > 'attachments/'.length) {
                files.push({
                    path: filename,
                    bytes: unzipped[filename]
                });
            } else if (filename.startsWith('rhythms/') && filename.length > 'rhythms/'.length) {
                rhythms.push({
                    path: filename,
                    bytes: unzipped[filename]
                });
            }
        }

        return {
            manifest,
            songs,
            setlists,
            tombstones,
            files,
            rhythms,
            assets
        };
    }

    /**
     * Ανιχνεύει τον τύπο MIME και την κατάληξη από magic bytes, content-type ή ένδειξη ρυθμού.
     * 
     * @param {Uint8Array|ArrayBuffer|ArrayBufferView|null} bytes
     * @param {string} [contentType]
     * @param {boolean} [isRhythm]
     * @returns {{ mime: string, ext: string }}
     */
    function detectMimeAndExt(bytes, contentType, isRhythm) {
        let u8 = null;
        if (bytes instanceof Uint8Array) {
            u8 = bytes;
        } else if (bytes && bytes.buffer instanceof ArrayBuffer) {
            u8 = new Uint8Array(bytes.buffer, bytes.byteOffset || 0, bytes.byteLength || 0);
        }

        if (u8 && u8.length >= 4) {
            // PDF: 25 50 44 46 (%PDF)
            if (u8[0] === 0x25 && u8[1] === 0x50 && u8[2] === 0x44 && u8[3] === 0x46) {
                return { mime: 'application/pdf', ext: 'pdf' };
            }
            // PNG: 89 50 4E 47
            if (u8[0] === 0x89 && u8[1] === 0x50 && u8[2] === 0x4E && u8[3] === 0x47) {
                return { mime: 'image/png', ext: 'png' };
            }
            // JPEG: FF D8 FF
            if (u8[0] === 0xFF && u8[1] === 0xD8 && u8[2] === 0xFF) {
                return { mime: 'image/jpeg', ext: 'jpg' };
            }
        }

        // JSON / rhythm: πρώτος μη-κενός χαρακτήρας { ή [
        if (u8 && u8.length > 0) {
            for (let i = 0; i < Math.min(u8.length, 64); i++) {
                const b = u8[i];
                if (b === 0x20 || b === 0x09 || b === 0x0A || b === 0x0D) continue;
                if (b === 0x7B || b === 0x5B) { // '{' ή '['
                    return {
                        mime: 'application/json',
                        ext: isRhythm ? 'mnr' : 'json'
                    };
                }
                break;
            }
        }

        // Content-Type fallback
        if (contentType && typeof contentType === 'string') {
            const ct = contentType.toLowerCase().split(';')[0].trim();
            if (ct === 'application/pdf') return { mime: 'application/pdf', ext: 'pdf' };
            if (ct === 'image/png') return { mime: 'image/png', ext: 'png' };
            if (ct === 'image/jpeg' || ct === 'image/jpg') return { mime: 'image/jpeg', ext: 'jpg' };
            if (ct === 'application/json') return { mime: 'application/json', ext: isRhythm ? 'mnr' : 'json' };
            if (ct.startsWith('audio/')) return { mime: ct, ext: 'mp3' };
        }

        if (isRhythm) {
            return { mime: 'application/json', ext: 'mnr' };
        }

        return { mime: 'application/octet-stream', ext: 'bin' };
    }

    /**
     * Παράγει ασφαλές όνομα αρχείου για το πακέτο:
     * - κατάληξη ΜΟΝΟ από το τελευταίο τμήμα της διαδρομής (μετά το τελευταίο '/')
     * - αν δεν έχει κατάληξη: από magic bytes / content-type
     * - το όνομα ΔΕΝ περιέχει '/', '\', ','
     * - κόβεται στους 80 χαρακτήρες
     * 
     * @param {Object} asset
     * @param {Uint8Array|ArrayBuffer|null} [bytes]
     * @param {string} [contentType]
     * @returns {{ filename: string, mime: string, ext: string }}
     */
    function makeSafePackageFilename(asset, bytes, contentType) {
        const isRhythm = !!(asset && (asset.file_type === 'rhythm' || (asset.custom_name && asset.custom_name.endsWith('.mnr'))));
        const rawUrl = (asset && asset.file_url) || '';
        const cleanUrl = String(rawUrl).split('?')[0].split('#')[0].trim();
        const lastSegment = cleanUrl.substring(cleanUrl.lastIndexOf('/') + 1);

        let extFromUrl = '';
        const dotIdx = lastSegment.lastIndexOf('.');
        if (dotIdx > 0) {
            const candidate = lastSegment.substring(dotIdx + 1).toLowerCase();
            if (/^[a-z0-9]{1,5}$/.test(candidate)) {
                extFromUrl = candidate;
            }
        }

        let detected = null;
        if (!extFromUrl && bytes) {
            detected = detectMimeAndExt(bytes, contentType, isRhythm);
        } else if (extFromUrl) {
            let mime = 'application/octet-stream';
            if (extFromUrl === 'pdf') mime = 'application/pdf';
            else if (extFromUrl === 'png') mime = 'image/png';
            else if (extFromUrl === 'jpg' || extFromUrl === 'jpeg') mime = 'image/jpeg';
            else if (extFromUrl === 'mnr' || extFromUrl === 'json') mime = 'application/json';
            detected = { mime, ext: extFromUrl };
        } else {
            detected = detectMimeAndExt(null, contentType, isRhythm);
        }

        const effectiveExt = (detected && detected.ext) || (isRhythm ? 'mnr' : 'bin');
        const effectiveMime = (detected && detected.mime) || 'application/octet-stream';

        // Βασικό όνομα
        let rawBase = (asset && asset.custom_name) ? asset.custom_name : (lastSegment ? lastSegment.substring(0, dotIdx > 0 ? dotIdx : lastSegment.length) : 'file');
        // Αφαίρεση κατάληξης από το base αν υπάρχει ήδη
        if (effectiveExt && rawBase.toLowerCase().endsWith('.' + effectiveExt)) {
            rawBase = rawBase.substring(0, rawBase.length - effectiveExt.length - 1);
        }

        // Καθαρισμός: ΚΑΜΙΑ '/', '\', ',' και αφαίρεση απαγορευμένων χαρακτήρων
        let cleanBase = String(rawBase)
            .replace(/[/\\,]/g, '_')
            .replace(/[*?"<>|:]/g, '_')
            .replace(/\s+/g, '_')
            .trim();
        if (!cleanBase) cleanBase = 'file';

        const prefix = `${asset && asset.id ? asset.id : 'asset'}-`.replace(/[/\\,]/g, '_');
        const suffix = effectiveExt ? `.${effectiveExt}` : '';

        // Περιορισμός ώστε το συνολικό όνομα να μην ξεπερνά τους 80 χαρακτήρες
        const maxBaseLength = Math.max(5, 80 - prefix.length - suffix.length);
        if (cleanBase.length > maxBaseLength) {
            cleanBase = cleanBase.slice(0, maxBaseLength);
        }

        let filename = `${prefix}${cleanBase}${suffix}`;
        if (filename.length > 80) {
            filename = filename.slice(0, 80);
        }

        return {
            filename,
            mime: effectiveMime,
            ext: effectiveExt
        };
    }

    /**
     * Επεξεργάζεται τις λίστες για το πακέτο:
     * - Διατηρεί όλα τα IDs στο list.songs
     * - Για όσα IDs δεν είναι στα προσωπικά τραγούδια του πακέτου, προσθέτει missing_refs:
     *   [{ id, title, artist, reason: 'band' | 'not_found' }]
     * - ΜΟΝΟ id/title/artist/group_id, ΠΟΤΕ body ή άλλο περιεχόμενο μπάντας
     * 
     * @param {Object} rawSetlists
     * @param {Set} personalSongIds
     * @param {Map} [dbSongMap]
     * @returns {{ setlists: Array, bandSongRefsCount: number }}
     */
    function buildSetlistsWithMissingRefs(rawSetlists, personalSongIds, dbSongMap) {
        const result = [];
        let bandSongRefsCount = 0;
        const validPersonalIds = personalSongIds instanceof Set ? personalSongIds : new Set(personalSongIds || []);

        for (const [name, data] of Object.entries(rawSetlists || {})) {
            let listCopy;
            if (data && typeof data === 'object' && !Array.isArray(data)) {
                listCopy = { name, ...JSON.parse(JSON.stringify(data)) };
            } else {
                listCopy = { name, songs: Array.isArray(data) ? JSON.parse(JSON.stringify(data)) : [] };
            }

            const missingRefs = [];
            const rawSongs = Array.isArray(listCopy.songs) ? listCopy.songs : [];

            for (const rawSongItem of rawSongs) {
                const songId = (typeof rawSongItem === 'object' && rawSongItem !== null) ? rawSongItem.id : rawSongItem;
                if (!songId) continue;

                if (!validPersonalIds.has(songId)) {
                    const found = dbSongMap ? dbSongMap.get(songId) : null;
                    if (found && found.group_id) {
                        missingRefs.push({
                            id: songId,
                            title: found.title || null,
                            artist: found.artist || null,
                            reason: 'band'
                        });
                        bandSongRefsCount++;
                    } else {
                        missingRefs.push({
                            id: songId,
                            title: found ? (found.title || null) : null,
                            artist: found ? (found.artist || null) : null,
                            reason: 'not_found'
                        });
                    }
                }
            }

            if (missingRefs.length > 0) {
                listCopy.missing_refs = missingRefs;
            }
            result.push(listCopy);
        }

        return { setlists: result, bandSongRefsCount };
    }

    function analyzeSongCollisions(pkgSongs, currentUserId, existingDbSongsMap) {
        const results = {
            newSongs: [],
            sameUserConflicts: [],
            forcedNewIdSongs: [],
            orphanedClones: []
        };
        const pkgSongIdSet = new Set((pkgSongs || []).map(s => s && s.id).filter(Boolean));
        const dbMap = existingDbSongsMap instanceof Map ? existingDbSongsMap : new Map();

        (pkgSongs || []).forEach(song => {
            if (!song || !song.id) return;
            const dbSong = dbMap.get(song.id);

            if (!dbSong) {
                results.newSongs.push(song);
            } else {
                const isBandSong = !!dbSong.group_id;
                const isOtherUser = dbSong.user_id && dbSong.user_id !== currentUserId;

                if (isBandSong || isOtherUser) {
                    // Πάντα νέο ID, καμία αντικατάσταση
                    results.forcedNewIdSongs.push({
                        song,
                        reason: isBandSong ? 'band' : 'other_user',
                        dbSong
                    });
                } else {
                    // Ίδιο id, ίδιος χρήστης, group_id null
                    const pkgTime = new Date(song.updated_at || song.updatedAt || 0).getTime();
                    const dbTime = new Date(dbSong.updated_at || dbSong.updatedAt || 0).getTime();
                    let age = 'identical';
                    if (pkgTime > dbTime) age = 'newer';
                    else if (pkgTime < dbTime) age = 'older';

                    results.sameUserConflicts.push({
                        song,
                        dbSong,
                        age
                    });
                }
            }

            // Έλεγχος parent_id
            if (song.parent_id) {
                const parentInPkg = pkgSongIdSet.has(song.parent_id);
                const parentInDb = dbMap.has(song.parent_id);
                if (!parentInPkg && !parentInDb) {
                    results.orphanedClones.push(song);
                }
            }
        });

        return results;
    }

    function analyzeAssetDeduplication(pkgAssets, existingUserAssetsMap) {
        const existingMap = existingUserAssetsMap instanceof Map ? existingUserAssetsMap : new Map();
        const toUpload = [];
        const skippedExisting = [];

        (pkgAssets || []).forEach(asset => {
            if (!asset || !asset.id) return;
            const existing = existingMap.get(asset.id);
            if (existing) {
                skippedExisting.push({
                    asset,
                    existingUrl: existing.file_url
                });
            } else {
                toUpload.push(asset);
            }
        });

        return { toUpload, skippedExisting };
    }

    function analyzeImportSetlists(pkgSetlists, userSetlists, accessibleSongIdSet) {
        const existing = userSetlists && typeof userSetlists === 'object' ? userSetlists : {};
        const accessible = accessibleSongIdSet instanceof Set ? accessibleSongIdSet : new Set(accessibleSongIdSet || []);

        const toSkipIdentical = [];
        const toRenameImport = [];
        const toCreateNew = [];
        const trashMerge = { hasTrash: false, songsToAdd: [] };
        const missingRefsReport = [];

        (pkgSetlists || []).forEach(list => {
            if (!list || !list.name) return;
            const listName = list.name;
            const listSongs = Array.isArray(list.songs) ? list.songs.map(s => typeof s === 'object' && s !== null ? s.id : s).filter(Boolean) : [];

            // Ειδική διαχείριση Κάδου
            if (listName === '🗑️ Κάδος') {
                const currentTrashSongs = (existing['🗑️ Κάδος'] && Array.isArray(existing['🗑️ Κάδος'].songs)) ? existing['🗑️ Κάδος'].songs : [];
                const currentSet = new Set(currentTrashSongs);
                const newTrashSongs = listSongs.filter(id => !currentSet.has(id));
                trashMerge.hasTrash = true;
                trashMerge.songsToAdd = newTrashSongs;
                return;
            }

            // Έλεγχος missing_refs
            const missingInList = [];
            listSongs.forEach(sid => {
                if (!accessible.has(sid)) {
                    missingInList.push(sid);
                }
            });
            if (missingInList.length > 0) {
                missingRefsReport.push({
                    listName,
                    missingIds: missingInList
                });
            }

            if (existing[listName]) {
                const curSongs = Array.isArray(existing[listName].songs) ? existing[listName].songs : [];
                const isIdentical = curSongs.length === listSongs.length && curSongs.every((id, idx) => id === listSongs[idx]);
                if (isIdentical) {
                    toSkipIdentical.push(list);
                } else {
                    let targetName = `${listName} (εισαγωγή)`;
                    let counter = 2;
                    while (existing[targetName]) {
                        targetName = `${listName} (εισαγωγή ${counter++})`;
                    }
                    toRenameImport.push({
                        originalName: listName,
                        targetName,
                        list
                    });
                }
            } else {
                toCreateNew.push(list);
            }
        });

        return {
            toSkipIdentical,
            toRenameImport,
            toCreateNew,
            trashMerge,
            missingRefsReport
        };
    }

    /**
     * Εξάγει το σωστό MIME type για ανέβασμα στο Storage.
     * Αν το packageMime είναι generic octet-stream ή κενό, βασίζεται στην κατάληξη.
     * 
     * @param {string} filename
     * @param {string} [packageMime]
     * @returns {string}
     */
    function deduceMimeType(filename, packageMime) {
        if (packageMime && typeof packageMime === 'string' && packageMime !== 'application/octet-stream') {
            return packageMime;
        }
        const name = (filename || '').toLowerCase();
        if (name.endsWith('.abc')) return 'text/plain';
        if (name.endsWith('.pdf')) return 'application/pdf';
        if (name.endsWith('.png')) return 'image/png';
        if (name.endsWith('.jpg') || name.endsWith('.jpeg')) return 'image/jpeg';
        if (name.endsWith('.mnr')) return 'application/json';
        if (name.endsWith('.mp3')) return 'audio/mpeg';
        if (name.endsWith('.m4a')) return 'audio/mp4';
        if (name.endsWith('.wav')) return 'audio/wav';
        if (name.endsWith('.ogg')) return 'audio/ogg';
        if (name.endsWith('.webp')) return 'image/webp';
        return 'application/octet-stream';
    }

    /**
     * Επίλυση συγκρούσεων τραγουδιών ίδιου χρήστη.
     * 
     * @param {Array} sameUserConflicts - [{ song, dbSong, age: 'newer'|'identical'|'older' }]
     * @param {Object} [defaultAgeRules] - { newer: 'replace', identical: 'skip', older: 'skip' }
     * @param {string|null} [globalOverride] - 'replace_all' | 'skip_all' | 'clone_all' | null
     * @returns {Map<string, 'replace'|'skip'|'clone'>}
     */
    function resolveConflictDecisions(sameUserConflicts, defaultAgeRules, globalOverride) {
        const decisions = new Map();
        const rules = Object.assign({
            newer: 'replace',
            identical: 'skip',
            older: 'skip'
        }, defaultAgeRules || {});

        (sameUserConflicts || []).forEach(item => {
            if (!item || !item.song || !item.song.id) return;
            const songId = item.song.id;

            if (globalOverride === 'replace_all') {
                decisions.set(songId, 'replace');
            } else if (globalOverride === 'skip_all') {
                decisions.set(songId, 'skip');
            } else if (globalOverride === 'clone_all') {
                decisions.set(songId, 'clone');
            } else {
                const age = item.age || 'identical';
                const chosen = rules[age] || 'skip';
                decisions.set(songId, chosen);
            }
        });

        return decisions;
    }

    /**
     * Δημιουργία νέου ασφαλούς αναγνωριστικού τραγουδιού.
     * @returns {string}
     */
    function generateSongId() {
        return 's_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8);
    }

    /**
     * Λίστα όλων των έγκυρων στηλών του πίνακα songs στη βάση δεδομένων.
     * (Πηγή αλήθειας: check_schema.py SCHEMA['songs'])
     */
    const SONGS_COLUMNS = [
        'id', 'group_id', 'user_id', 'title', 'artist', 'shared_data', 'updated_at',
        'rhythm_id', 'recordings', 'attachments', 'body', 'key', 'intro', 'interlude',
        'notes', 'video', 'tags', 'parent_id', 'is_clone', 'is_deleted',
        'conductor_notes', 'rhythms', 'migrated_from', 'capo', 'capo_print'
    ];
    const SONGS_COLUMNS_SET = new Set(SONGS_COLUMNS);

    /**
     * Προετοιμασία τραγουδιών πακέτου για εγγραφή/αντικατάσταση στη βάση δεδομένων.
     * 
     * @param {Array} pkgSongs
     * @param {string} currentUserId
     * @param {Map|Object} conflictDecisions - songId -> 'replace'|'skip'|'clone'
     * @param {Array} forcedNewIdSongs - [{ song, reason, dbSong }]
     * @param {Array} newSongs
     * @param {Map} existingDbSongsMap
     * @param {Map|Object} [packagePathToUrlMap]
     * @param {Array|Map} [replacedSnapshot] - Πλήρης γραμμή βάσης (select('*')) των προς αντικατάσταση
     * @returns {{
     *   songsToInsert: Array,
     *   songsToUpdate: Array,
     *   skippedSongs: Array,
     *   idMap: Map<string, string>,
     *   replaceIds: Array<string>
     * }}
     */
    function prepareImportSongs(
        pkgSongs,
        currentUserId,
        conflictDecisions,
        forcedNewIdSongs,
        newSongs,
        existingDbSongsMap,
        packagePathToUrlMap,
        replacedSnapshot
    ) {
        const decisions = conflictDecisions instanceof Map ? conflictDecisions : new Map(Object.entries(conflictDecisions || {}));
        const forcedSet = new Set((forcedNewIdSongs || []).map(item => item && item.song && item.song.id).filter(Boolean));
        const newSet = new Set((newSongs || []).map(s => s && s.id).filter(Boolean));
        const dbMap = existingDbSongsMap instanceof Map ? existingDbSongsMap : new Map();
        const urlMap = packagePathToUrlMap instanceof Map ? packagePathToUrlMap : new Map(Object.entries(packagePathToUrlMap || {}));

        let snapshotMap = new Map();
        if (replacedSnapshot instanceof Map) {
            snapshotMap = replacedSnapshot;
        } else if (Array.isArray(replacedSnapshot)) {
            replacedSnapshot.forEach(s => {
                if (s && s.id) snapshotMap.set(s.id, s);
            });
        }

        const idMap = new Map();
        const replaceIds = [];
        const skippedSongs = [];
        const songsToInsert = [];
        const songsToUpdate = [];

        // Πέρασμα 1: Ανάθεση IDs & κατηγοριοποίηση
        (pkgSongs || []).forEach(song => {
            if (!song || !song.id) return;
            const originalId = song.id;

            if (forcedSet.has(originalId) || newSet.has(originalId)) {
                // Πάντα νέο ID
                const newId = generateSongId();
                idMap.set(originalId, newId);
            } else if (decisions.has(originalId)) {
                const choice = decisions.get(originalId);
                if (choice === 'replace') {
                    // Διατηρείται το ίδιο ID
                    idMap.set(originalId, originalId);
                    replaceIds.push(originalId);
                } else if (choice === 'clone') {
                    // Νέο αντίγραφο -> νέο ID
                    const newId = generateSongId();
                    idMap.set(originalId, newId);
                } else {
                    // Παράλειψη
                    skippedSongs.push(song);
                }
            } else {
                // Προεπιλογή για μη συγκρουόμενα: νέο ID
                const newId = generateSongId();
                idMap.set(originalId, newId);
            }
        });

        // Βοηθητική αντικατάστασης package_path σε λίστες αρχείων
        function mapFileRefs(arr) {
            if (!Array.isArray(arr)) return [];
            return arr.map(item => {
                if (!item || typeof item !== 'object') return item;
                const copy = Object.assign({}, item);
                if (copy.package_path && urlMap.has(copy.package_path)) {
                    copy.url = urlMap.get(copy.package_path);
                }
                delete copy.package_path;
                return copy;
            });
        }

        // Πέρασμα 2: Δόμηση αντικειμένων τραγουδιών
        (pkgSongs || []).forEach(song => {
            if (!song || !song.id) return;
            const originalId = song.id;
            const decision = decisions.get(originalId);

            if (decision === 'skip') {
                return;
            }

            // 1. Ξεκινάμε από ΑΝΤΙΓΡΑΦΟ του τραγουδιού του πακέτου
            const rawCopy = JSON.parse(JSON.stringify(song));

            // Normalization για εναλλακτικές/παλιές ονομασίες
            if (rawCopy.conductor_notes === undefined && rawCopy.conductorNotes !== undefined) {
                rawCopy.conductor_notes = rawCopy.conductorNotes;
            }
            if (rawCopy.interlude === undefined && rawCopy.inter !== undefined) {
                rawCopy.interlude = rawCopy.inter;
            }
            if (rawCopy.tags === undefined && Array.isArray(rawCopy.playlists)) {
                rawCopy.tags = rawCopy.playlists;
            }

            // 2. Κρατάμε ΜΟΝΟ τις στήλες του πίνακα songs (check_schema.py SCHEMA['songs'])
            const cleanSong = {};
            SONGS_COLUMNS.forEach(col => {
                if (rawCopy[col] !== undefined) {
                    cleanSong[col] = rawCopy[col];
                }
            });

            // Ειδικός καθαρισμός τύπων
            if (cleanSong.capo !== undefined && cleanSong.capo !== null && cleanSong.capo !== '') {
                const parsedCapo = parseInt(cleanSong.capo, 10);
                cleanSong.capo = isNaN(parsedCapo) ? null : parsedCapo;
            } else if (cleanSong.capo === '') {
                cleanSong.capo = null;
            }
            if (cleanSong.capo_print !== undefined) {
                cleanSong.capo_print = !!cleanSong.capo_print;
            }
            if (cleanSong.is_deleted !== undefined) {
                cleanSong.is_deleted = !!cleanSong.is_deleted;
            }
            if (!cleanSong.title) {
                cleanSong.title = rawCopy.title || 'Untitled';
            }

            // 3. Ελεγχόμενα πεδία
            if (decision === 'replace') {
                // Βάση είναι η ΠΛΗΡΗΣ γραμμή της βάσης (snapshot από select('*'))
                const dbSong = snapshotMap.get(originalId) || dbMap.get(originalId) || {};

                // recordings: ΠΑΝΤΑ της βάσης (το πακέτο δεν έχει ηχογραφήσεις εκ σχεδιασμού)
                cleanSong.recordings = Array.isArray(dbSong.recordings)
                    ? JSON.parse(JSON.stringify(dbSong.recordings))
                    : [];

                // attachments: του πακέτου + όσα της βάσης ΔΕΝ υπάρχουν στο πακέτο (σύγκριση με το καθαρό url)
                const pkgAttachments = mapFileRefs(song.attachments);
                const pkgAttUrls = new Set(pkgAttachments.map(a => a && a.url).filter(Boolean));
                const dbAttachments = Array.isArray(dbSong.attachments)
                    ? JSON.parse(JSON.stringify(dbSong.attachments))
                    : [];
                const extraDbAtts = dbAttachments.filter(a => a && a.url && !pkgAttUrls.has(a.url));
                cleanSong.attachments = [...pkgAttachments, ...extraDbAtts];

                // rhythms: του πακέτου + όσα της βάσης ΔΕΝ υπάρχουν στο πακέτο (σύγκριση με το καθαρό url)
                const pkgRhythms = mapFileRefs(song.rhythms);
                const pkgRhyUrls = new Set(pkgRhythms.map(r => r && r.url).filter(Boolean));
                const dbRhythms = Array.isArray(dbSong.rhythms)
                    ? JSON.parse(JSON.stringify(dbSong.rhythms))
                    : [];
                const extraDbRhys = dbRhythms.filter(r => r && r.url && !pkgRhyUrls.has(r.url));
                cleanSong.rhythms = [...pkgRhythms, ...extraDbRhys];

                // parent_id / is_clone: ΠΑΝΤΑ της βάσης
                cleanSong.parent_id = dbSong.parent_id !== undefined ? dbSong.parent_id : null;
                cleanSong.is_clone = dbSong.is_clone !== undefined ? !!dbSong.is_clone : false;

                cleanSong.id = originalId;
                cleanSong.user_id = currentUserId;
                cleanSong.group_id = null;
                cleanSong.updated_at = new Date().toISOString();

                songsToUpdate.push(cleanSong);
            } else {
                // ΝΕΟ ΤΡΑΓΟΥΔΙ
                const targetId = idMap.get(originalId) || generateSongId();

                cleanSong.attachments = mapFileRefs(song.attachments);
                cleanSong.rhythms = mapFileRefs(song.rhythms);
                cleanSong.recordings = mapFileRefs(song.recordings);

                // Διαχείριση γονέα & ορφανών κλώνων ΜΟΝΟ στα νέα τραγούδια
                let parentId = null;
                let isClone = false;
                if (song.parent_id) {
                    if (idMap.has(song.parent_id)) {
                        parentId = idMap.get(song.parent_id);
                        isClone = !!song.is_clone;
                    } else if (dbMap.has(song.parent_id)) {
                        parentId = song.parent_id;
                        isClone = !!song.is_clone;
                    } else {
                        // Ορφανός κλώνος: αποσύνδεση
                        parentId = null;
                        isClone = false;
                    }
                }

                cleanSong.id = targetId;
                cleanSong.user_id = currentUserId;
                cleanSong.group_id = null;
                cleanSong.parent_id = parentId;
                cleanSong.is_clone = isClone;
                // ΝΕΑ τραγούδια -> διατηρούν το updated_at του πακέτου
                cleanSong.updated_at = song.updated_at || song.updatedAt || new Date().toISOString();

                songsToInsert.push(cleanSong);
            }
        });

        return {
            songsToInsert,
            songsToUpdate,
            skippedSongs,
            idMap,
            replaceIds
        };
    }

    /**
     * Επαναχαρτογράφηση IDs τραγουδιών στις λίστες, αφαίρεση μη προσβάσιμων,
     * ένωση Κάδου και μετονομασία συγκρούσεων.
     * 
     * @param {Array} pkgSetlists
     * @param {Object} userSetlists
     * @param {Map} idMap - oldId -> newId
     * @param {Set} accessibleSongIds
     * @param {Array} [missingRefsReport]
     * @returns {{
     *   finalSetlists: Object,
     *   importedCount: number,
     *   skippedCount: number,
     *   renamedCount: number,
     *   removedFromSetlists: Array<{ listName: string, songId: string, title: string|null, artist: string|null }>
     * }}
     */
    function remapAndFilterSetlists(pkgSetlists, userSetlists, idMap, accessibleSongIds, missingRefsReport) {
        const existing = userSetlists && typeof userSetlists === 'object' ? JSON.parse(JSON.stringify(userSetlists)) : {};
        const accessible = accessibleSongIds instanceof Set ? accessibleSongIds : new Set(accessibleSongIds || []);
        const idMapper = idMap instanceof Map ? idMap : new Map(Object.entries(idMap || {}));

        let importedCount = 0;
        let skippedCount = 0;
        let renamedCount = 0;
        const removedFromSetlists = [];

        (pkgSetlists || []).forEach(list => {
            if (!list || !list.name) return;
            const originalName = list.name;
            const rawSongs = Array.isArray(list.songs) ? list.songs : [];

            // 1. Επαναχαρτογράφηση IDs και έλεγχος προσβασιμότητας
            const cleanSongIds = [];
            rawSongs.forEach(rawItem => {
                const sid = (typeof rawItem === 'object' && rawItem !== null) ? rawItem.id : rawItem;
                if (!sid) return;
                const targetId = idMapper.has(sid) ? idMapper.get(sid) : sid;

                if (accessible.has(targetId)) {
                    cleanSongIds.push(targetId);
                } else {
                    let title = null;
                    let artist = null;
                    if (Array.isArray(list.missing_refs)) {
                        const m = list.missing_refs.find(r => r && r.id === sid);
                        if (m) {
                            title = m.title || null;
                            artist = m.artist || null;
                        }
                    }
                    removedFromSetlists.push({
                        listName: originalName,
                        songId: sid,
                        title,
                        artist
                    });
                }
            });

            // 2. Ειδική μεταχείριση Κάδου
            if (originalName === '🗑️ Κάδος') {
                const currentTrash = (existing['🗑️ Κάδος'] && Array.isArray(existing['🗑️ Κάδος'].songs))
                    ? existing['🗑️ Κάδος'].songs
                    : [];
                const trashSet = new Set(currentTrash);
                let addedToTrash = 0;
                cleanSongIds.forEach(id => {
                    if (!trashSet.has(id)) {
                        trashSet.add(id);
                        currentTrash.push(id);
                        addedToTrash++;
                    }
                });
                existing['🗑️ Κάδος'] = { name: '🗑️ Κάδος', songs: currentTrash };
                if (addedToTrash > 0) importedCount++;
                return;
            }

            // 3. Κανονικές Λίστες
            if (existing[originalName]) {
                const curSongs = Array.isArray(existing[originalName].songs) ? existing[originalName].songs : [];
                const isIdentical = curSongs.length === cleanSongIds.length && curSongs.every((id, idx) => id === cleanSongIds[idx]);
                if (isIdentical) {
                    skippedCount++;
                } else {
                    let targetName = `${originalName} (εισαγωγή)`;
                    let counter = 2;
                    while (existing[targetName]) {
                        targetName = `${originalName} (εισαγωγή ${counter++})`;
                    }
                    existing[targetName] = { name: targetName, songs: cleanSongIds };
                    renamedCount++;
                    importedCount++;
                }
            } else {
                existing[originalName] = { name: originalName, songs: cleanSongIds };
                importedCount++;
            }
        });

        return {
            finalSetlists: existing,
            importedCount,
            skippedCount,
            renamedCount,
            removedFromSetlists
        };
    }

    /**
     * Δημιουργεί το σχέδιο αναίρεσης από ένα ημερολόγιο εισαγωγής.
     * 
     * @param {Object} journal - { startedAt, newSongIds, replacedSnapshot, createdAssetIds, uploadedPaths }
     * @returns {{
     *   hasWork: boolean,
     *   songsToDelete: string[],
     *   songsToRestore: Object[],
     *   assetsToDelete: Array<string|number>,
     *   filesToRemove: string[],
     *   summary: { newSongs: number, replacedSongs: number, assets: number, files: number }
     * }}
     */
    function buildRollbackPlan(journal) {
        if (!journal || typeof journal !== 'object') {
            return {
                hasWork: false,
                songsToDelete: [],
                songsToRestore: [],
                assetsToDelete: [],
                filesToRemove: [],
                summary: { newSongs: 0, replacedSongs: 0, assets: 0, files: 0 }
            };
        }

        const songsToDelete = Array.isArray(journal.newSongIds) ? Array.from(new Set(journal.newSongIds.filter(Boolean))) : [];
        const songsToRestore = Array.isArray(journal.replacedSnapshot) ? journal.replacedSnapshot.filter(s => s && s.id) : [];
        const assetsToDelete = Array.isArray(journal.createdAssetIds) ? Array.from(new Set(journal.createdAssetIds.filter(Boolean))) : [];
        const filesToRemove = Array.isArray(journal.uploadedPaths) ? Array.from(new Set(journal.uploadedPaths.filter(Boolean))) : [];

        const hasWork = songsToDelete.length > 0 ||
                        songsToRestore.length > 0 ||
                        assetsToDelete.length > 0 ||
                        filesToRemove.length > 0;

        return {
            hasWork,
            songsToDelete,
            songsToRestore,
            assetsToDelete,
            filesToRemove,
            summary: {
                newSongs: songsToDelete.length,
                replacedSongs: songsToRestore.length,
                assets: assetsToDelete.length,
                files: filesToRemove.length
            }
        };
    }

    const mnotesPackage = {
        isPackage,
        buildPackage,
        readPackage,
        MAX_UNCOMPRESSED_SIZE,
        detectMimeAndExt,
        makeSafePackageFilename,
        buildSetlistsWithMissingRefs,
        analyzeSongCollisions,
        analyzeAssetDeduplication,
        analyzeImportSetlists,
        deduceMimeType,
        resolveConflictDecisions,
        generateSongId,
        prepareImportSongs,
        remapAndFilterSetlists,
        buildRollbackPlan,
        SONGS_COLUMNS
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = mnotesPackage;
    }

    // Ενιαίο καθολικό όνομα για browser usage
    if (typeof globalThis !== 'undefined') {
        globalThis.mnotesPackage = mnotesPackage;
    } else if (typeof window !== 'undefined') {
        window.mnotesPackage = mnotesPackage;
    } else {
        global.mnotesPackage = mnotesPackage;
    }

})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this));

