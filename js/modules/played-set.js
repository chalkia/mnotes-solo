/**
 * Played Set — ποια τραγούδια έχουν εκτελεστεί στο τρέχον σετ.
 *
 * Ζει σε localStorage με σφραγίδα χρόνου και λήγει μετά από 12 ώρες.
 * ΔΕΝ χρησιμοποιείται sessionStorage: το λειτουργικό σκοτώνει PWA στο
 * παρασκήνιο, και τα σημάδια θα χάνονταν στη μέση της βραδιάς χωρίς ο
 * χρήστης να έχει κλείσει τίποτα. (04/09/2026)
 *
 * ΔΕΝ αγγίζει τη βάση. Είναι κατάσταση συσκευής, όχι ιδιότητα τραγουδιού.
 */
(function () {
    'use strict';

    const KEY = 'mnotes_played_set';
    const MAX_AGE_MS = 12 * 60 * 60 * 1000;

    let played = new Set();

    function load() {
        try {
            const raw = localStorage.getItem(KEY);
            if (!raw) return;
            const obj = JSON.parse(raw);
            if (!obj || !Array.isArray(obj.ids) || typeof obj.ts !== 'number') return;
            if (Date.now() - obj.ts > MAX_AGE_MS) { localStorage.removeItem(KEY); return; }
            played = new Set(obj.ids);
        } catch (err) {
            // Ποτέ σιωπηλή αποτυχία: το localStorage πετάει σε private mode.
            console.warn('[PlayedSet] Αδύνατη η ανάγνωση:', err);
        }
    }

    function save() {
        try {
            localStorage.setItem(KEY, JSON.stringify({ ts: Date.now(), ids: Array.from(played) }));
        } catch (err) {
            console.warn('[PlayedSet] Αδύνατη η εγγραφή:', err);
        }
    }

    const api = {
        has(id) { return played.has(id); },

        size() { return played.size; },

        /** Πόσα από ΤΑ ΟΡΑΤΑ είναι μαρκαρισμένα. Το size() μετράει όλο
            το Set και μετά από αλλαγή όψης έδινε «✓12/8». (05/09/2026) */
        countIn(list) {
            if (!Array.isArray(list)) return 0;
            let n = 0;
            for (const s of list) if (s && played.has(s.id)) n++;
            return n;
        },

        toggle(id) {
            if (!id) return false;
            if (played.has(id)) played.delete(id); else played.add(id);
            save();
            api.paint(id);
            return played.has(id);
        },

        clear() {
            played.clear();
            try { localStorage.removeItem(KEY); } catch (err) { console.warn('[PlayedSet] clear:', err); }
            document.querySelectorAll('.song-item.song-played')
                    .forEach(el => el.classList.remove('song-played'));
            document.querySelectorAll('.song-item .played-dot')
                    .forEach(dot => dot.remove());
            api.paintCounters();
        },

        /**
         * Στοχευμένη ενημέρωση. ΔΕΝ καλεί renderSidebar(): εκείνη περιέχει
         * AUTO-LOAD LOGIC που μπορεί να αλλάξει τραγούδι πάνω στη σκηνή.
         */
        paint(id) {
            if (id) {
                const isPlayed = played.has(id);
                document.querySelectorAll(`.song-item[data-id="${id}"]`).forEach(li => {
                    li.classList.toggle('song-played', isPlayed);
                    const titleEl = li.querySelector('.song-title');
                    if (titleEl) {
                        const existingDot = titleEl.querySelector('.played-dot');
                        if (isPlayed && !existingDot) {
                            const dot = document.createElement('span');
                            dot.className = 'played-dot';
                            dot.setAttribute('aria-hidden', 'true');
                            dot.textContent = '✓';
                            titleEl.insertBefore(dot, titleEl.firstChild);
                        } else if (!isPlayed && existingDot) {
                            existingDot.remove();
                        }
                    }
                });
            }
            api.paintCounters();
        },

        paintCounters() {
            const total = (typeof window.visiblePlaylist !== 'undefined' && window.visiblePlaylist)
                ? window.visiblePlaylist.length : 0;
            const done = api.countIn(window.visiblePlaylist);

            const countEl = document.getElementById('songCount');
            if (countEl) {
                countEl.innerText = (typeof window.formatEditionSongCount === 'function')
                    ? window.formatEditionSongCount(total)
                    : String(total);
            }

            const isCurrentPlayed = typeof currentSongId !== 'undefined' && played.has(currentSongId);

            const stageEl = document.getElementById('stagePlayedBadge');
            if (stageEl) {
                stageEl.style.display = 'none';
            }

            const setlistBadge = document.getElementById('setlistMarkedBadge');
            if (setlistBadge) {
                setlistBadge.innerText = `${done}/${total}`;
                setlistBadge.style.display = done > 0 ? 'inline-flex' : 'none';
            }

            const bookmarkEl = document.getElementById('stagePlayedBookmark');
            if (bookmarkEl) {
                bookmarkEl.classList.toggle('active', isCurrentPlayed);
            }

            const titleEl = document.getElementById('mainAppTitle');
            if (titleEl) {
                titleEl.classList.toggle('title-marked', isCurrentPlayed);
            }
        }
    };

    load();
    window.PlayedSet = api;
})();
