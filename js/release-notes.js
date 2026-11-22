/* =========================================================================
   mNotes Pro — Σημειώσεις Έκδοσης (Release Notes)

   Διαβάζει το release-notes.json και το εμφανίζει στο mStudio.
   Καθαρά προβολή: δεν γράφει ποτέ δεδομένα, δεν αγγίζει τη βάση.

   Πλήρης υποστήριξη διγλωσσίας (Ελληνικά & English).
   Ενημέρωση περιεχομένου: ΜΟΝΟ το release-notes.json. Καμία αλλαγή εδώ.
   ========================================================================= */

(function () {
    'use strict';

    var SEEN_KEY = 'mnotes_seen_release';
    var loaded = false;

    var TYPE_META = {
        'new':      { label: { el: 'Νέο',      en: 'New' },      color: '#2ecc71' },
        'improved': { label: { el: 'Βελτίωση', en: 'Improved' }, color: '#3498db' },
        'fix':      { label: { el: 'Διόρθωση', en: 'Fix' },      color: '#f39c12' }
    };

    function getLang() {
        var l = null;
        try { l = localStorage.getItem('mnotes_lang'); } catch (e) {}
        if (!l && typeof window.currentLang !== 'undefined') l = window.currentLang;
        return (l === 'en') ? 'en' : 'el';
    }

    function localize(val, lang) {
        if (!val) return '';
        if (typeof val === 'string') return val;
        if (typeof val === 'object') {
            return val[lang] || val['el'] || val['en'] || Object.values(val)[0] || '';
        }
        return String(val);
    }

    /* Το περιεχόμενο είναι δικό μας αρχείο, αλλά δεν μπαίνει ποτέ
       αφιλτράριστο σε innerHTML. Κανόνας, όχι εξαίρεση. */
    function esc(str) {
        return String(str == null ? '' : str)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function newestVersion(data) {
        return (data && data.releases && data.releases.length) ? data.releases[0].version : null;
    }

    function filterReleaseItems(items, edition) {
        if (!Array.isArray(items)) return [];
        const ed = edition || (typeof window !== 'undefined' && window.MNOTES_EDITION) || 'pro';
        if (ed !== 'solo') return items;
        return items.filter(function (it) {
            return !(it && Array.isArray(it.editions) && it.editions.indexOf('solo') === -1);
        });
    }

    function filterReleasesForEdition(releases, edition) {
        if (!Array.isArray(releases)) return [];
        var out = [];
        for (var i = 0; i < releases.length; i++) {
            var rel = releases[i];
            if (!rel) continue;
            var filtered = filterReleaseItems(rel.items, edition);
            if (filtered.length > 0) {
                out.push({ version: rel.version, date: rel.date, title: rel.title, items: filtered });
            }
        }
        return out;
    }

    function renderItem(it, lang) {
        var meta = TYPE_META[it && it.type] || { label: {}, color: 'var(--text-muted)' };
        var lblText = localize(meta.label, lang);
        var badge = lblText
            ? '<span style="flex:0 0 auto; font-size:0.68rem; font-weight:bold; text-transform:uppercase; ' +
              'letter-spacing:0.5px; color:' + meta.color + '; border:1px solid ' + meta.color + '; ' +
              'border-radius:4px; padding:1px 6px; margin-top:2px;">' + esc(lblText) + '</span>'
            : '';
        var itemText = localize(it && it.text, lang);
        return '<li style="display:flex; gap:10px; align-items:flex-start; margin-bottom:10px; line-height:1.5;">' +
               badge +
               '<span style="color:var(--text-main);">' + esc(itemText) + '</span></li>';
    }

    function renderRelease(rel, isNewest, lang) {
        var items = Array.isArray(rel.items) ? rel.items.map(function(it) { return renderItem(it, lang); }).join('') : '';
        var currentLabel = (lang === 'en') ? 'Current' : 'Τρέχουσα';
        var flag = isNewest
            ? '<span style="font-size:0.7rem; font-weight:bold; background:var(--accent); color:#000; ' +
              'border-radius:10px; padding:2px 8px; margin-left:10px;">' + esc(currentLabel) + '</span>'
            : '';
        var titleText = localize(rel.title, lang);
        return '<article style="border-left:3px solid var(--accent); padding:0 0 0 18px; margin-bottom:34px;">' +
               '<header style="display:flex; align-items:baseline; flex-wrap:wrap; gap:8px; margin-bottom:10px;">' +
               '<h3 style="margin:0; color:var(--accent); font-size:1.15rem;">' + esc(rel.version) + '</h3>' +
               '<span style="color:var(--text-muted); font-size:0.85rem;">' + esc(rel.date || '') + '</span>' +
               flag + '</header>' +
               (titleText ? '<p style="margin:0 0 12px; font-weight:bold; color:var(--text-main);">' + esc(titleText) + '</p>' : '') +
               '<ul style="list-style:none; margin:0; padding:0;">' + items + '</ul>' +
               '</article>';
    }

    function message(icon, text) {
        return '<div style="text-align:center; padding:60px 20px; color:var(--text-muted);">' +
               '<i class="fas ' + icon + '" style="font-size:2.5rem; margin-bottom:15px; display:block;"></i>' +
               '<p style="margin:0;">' + esc(text) + '</p></div>';
    }

    /* Τελεία «νέο» στο μενού, μέχρι να ανοίξει ο χρήστης τη σελίδα.
       Τρέχει κατά τη φόρτωση, ανεξάρτητα από το αν πατηθεί η καρτέλα. */
    function markNavIfUnseen() {
        fetch('release-notes.json?v=' + Date.now())
            .then(function (r) { return r.ok ? r.json() : null; })
            .then(function (data) {
                var latest = newestVersion(data);
                if (!latest) return;
                var seen = null;
                try { seen = localStorage.getItem(SEEN_KEY); } catch (e) {}
                if (seen === latest) return;
                var dot = document.getElementById('navReleaseDot');
                if (dot) dot.style.display = 'inline-block';
            })
            .catch(function () { /* offline ή απών αρχείο: καμία τελεία, καμία ενόχληση */ });
    }

    window.loadReleaseNotes = function (force) {
        var box = document.getElementById('releaseNotesContent');
        if (!box) return;
        if (loaded && !force) return;

        var lang = getLang();
        box.innerHTML = message('fa-spinner fa-spin', lang === 'en' ? 'Loading…' : 'Φόρτωση…');

        fetch('release-notes.json?v=' + Date.now())
            .then(function (r) {
                if (!r.ok) throw new Error('HTTP ' + r.status);
                return r.json();
            })
            .then(function (data) {
                var rawList = (data && Array.isArray(data.releases)) ? data.releases : [];
                var list = filterReleasesForEdition(rawList);
                if (!list.length) {
                    box.innerHTML = message('fa-inbox', lang === 'en'
                        ? 'No release notes available.'
                        : 'Δεν υπάρχουν καταχωρημένες σημειώσεις έκδοσης.');
                    return;
                }
                box.innerHTML = list.map(function (rel, i) { return renderRelease(rel, i === 0, lang); }).join('');
                loaded = true;

                /* Διαβάστηκε: σβήνει η τελεία και θυμόμαστε την έκδοση. */
                try { localStorage.setItem(SEEN_KEY, list[0].version); } catch (e) {}
                var dot = document.getElementById('navReleaseDot');
                if (dot) dot.style.display = 'none';
            })
            .catch(function (err) {
                console.warn('[ReleaseNotes] Αποτυχία φόρτωσης:', err);
                box.innerHTML = message('fa-plug', lang === 'en'
                    ? 'Could not load release notes. Please check your connection and try again.'
                    : 'Δεν ήταν δυνατή η φόρτωση των σημειώσεων. Ελέγξτε τη σύνδεσή σας και δοκιμάστε ξανά.');
            });
    };

    window.renderWhatsNewReleaseNotes = function (listEl, versionEl) {
        if (!listEl) return;
        var lang = getLang();
        listEl.style.listStyle = 'none';
        listEl.style.paddingLeft = '0';
        listEl.dataset.loaded = 'false';
        listEl.innerHTML = '<li style="color:var(--text-muted); text-align:center; padding:12px 0;">' +
            esc(lang === 'en' ? 'Loading…' : 'Φόρτωση…') + '</li>';

        fetch('release-notes.json?v=' + Date.now())
            .then(function (r) {
                if (!r.ok) throw new Error('HTTP ' + r.status);
                return r.json();
            })
            .then(function (data) {
                var rawList = (data && Array.isArray(data.releases)) ? data.releases : [];
                var list = filterReleasesForEdition(rawList);
                if (!list.length) {
                    listEl.innerHTML = '<li style="color:var(--text-muted);">' +
                        esc(lang === 'en' ? 'No release notes available.' : 'Δεν υπάρχουν σημειώσεις έκδοσης.') + '</li>';
                    return;
                }
                var rel = list[0];
                if (versionEl) {
                    var ver = (typeof window.MNOTES_VERSION === 'string' && window.MNOTES_VERSION) ? window.MNOTES_VERSION : rel.version;
                    if (ver) versionEl.innerText = 'v' + ver;
                }
                var titleText = localize(rel.title, lang);
                var html = titleText
                    ? '<li style="font-weight:bold; color:var(--text-main); margin-bottom:12px;">' + esc(titleText) + '</li>'
                    : '';
                html += Array.isArray(rel.items)
                    ? rel.items.map(function (it) { return renderItem(it, lang); }).join('')
                    : '';
                listEl.innerHTML = html;
                listEl.dataset.loaded = 'true';
            })
            .catch(function (err) {
                console.warn('[ReleaseNotes] Αποτυχία φόρτωσης What\'s New:', err);
                listEl.innerHTML = '<li style="color:var(--text-muted);">' +
                    esc(lang === 'en' ? 'Could not load release notes.' : 'Δεν ήταν δυνατή η φόρτωση των σημειώσεων.') + '</li>';
                listEl.dataset.loaded = 'true';
            });
    };

    if (typeof document !== 'undefined') {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', markNavIfUnseen);
        } else {
            markNavIfUnseen();
        }
    }
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = { filterReleaseItems: filterReleaseItems, filterReleasesForEdition: filterReleasesForEdition };
    }
})();
