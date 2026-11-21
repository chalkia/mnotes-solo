/* =========================================================================
   mNotes Solo — Messages Module (Static JSON + Offline Cache)
   ========================================================================= */
(function (root) {
    'use strict';

    const MESSAGES_URL = 'messages-solo.json';
    const CACHE_KEY = 'mnotes_solo_messages_cache';
    const READ_KEY = 'mnotes_solo_read_messages';

    function tr(key, fallback) {
        if (typeof root.t === 'function') return root.t(key, fallback || '');
        return fallback || '';
    }

    function getLang() {
        try {
            const l = localStorage.getItem('mnotes_lang');
            if (l === 'en' || l === 'el') return l;
        } catch (_) {}
        if (typeof root.currentLang === 'string') {
            return root.currentLang === 'en' ? 'en' : 'el';
        }
        return 'el';
    }

    function esc(str) {
        return String(str == null ? '' : str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function localize(val, lang) {
        if (!val) return '';
        if (typeof val === 'string') return val;
        if (typeof val === 'object') {
            return val[lang] || val.el || val.en || '';
        }
        return String(val);
    }

    function getReadIds() {
        try {
            const raw = localStorage.getItem(READ_KEY);
            const arr = raw ? JSON.parse(raw) : [];
            return Array.isArray(arr) ? arr : [];
        } catch (_) {
            return [];
        }
    }

    function saveReadIds(ids) {
        try {
            localStorage.setItem(READ_KEY, JSON.stringify(Array.from(new Set(ids))));
        } catch (_) {}
    }

    function markAllRead(messages) {
        if (!Array.isArray(messages) || messages.length === 0) return;
        const current = getReadIds();
        for (const m of messages) {
            if (m && m.id) current.push(m.id);
        }
        saveReadIds(current);
    }

    function getUnreadCount(messages) {
        if (!Array.isArray(messages)) return 0;
        const readSet = new Set(getReadIds());
        let count = 0;
        for (const m of messages) {
            if (m && m.id && !readSet.has(m.id)) count++;
        }
        return count;
    }

    function getCachedMessages() {
        try {
            const raw = localStorage.getItem(CACHE_KEY);
            const parsed = raw ? JSON.parse(raw) : null;
            return parsed && Array.isArray(parsed.messages) ? parsed.messages : [];
        } catch (_) {
            return [];
        }
    }

    function setCachedMessages(messages) {
        try {
            localStorage.setItem(CACHE_KEY, JSON.stringify({ messages: messages || [], cachedAt: Date.now() }));
        } catch (_) {}
    }

    async function loadMessages(fetchImpl) {
        const doFetch = fetchImpl || (typeof fetch === 'function' ? fetch : null);
        if (doFetch) {
            try {
                const res = await doFetch(MESSAGES_URL + '?v=' + Date.now());
                if (res && res.ok) {
                    const data = await res.json();
                    const list = data && Array.isArray(data.messages) ? data.messages : [];
                    setCachedMessages(list);
                    return { messages: list, offline: false };
                }
            } catch (_) {}
        }
        return { messages: getCachedMessages(), offline: true };
    }

    function updateBadge(messages) {
        if (typeof document === 'undefined') return;
        const dot = document.getElementById('soloMessagesDot');
        if (!dot) return;
        const unread = getUnreadCount(messages);
        dot.style.display = unread > 0 ? 'inline-block' : 'none';
    }

    function typeMeta(type) {
        if (type === 'tip') return { key: 'solo_msg_type_tip', color: '#3498db' };
        if (type === 'promo') return { key: 'solo_msg_type_promo', color: 'var(--accent)' };
        return { key: 'solo_msg_type_info', color: '#2ecc71' };
    }

    function ensureModal() {
        if (typeof document === 'undefined') return null;
        let overlay = document.getElementById('soloMessagesModal');
        if (overlay) return overlay;
        overlay = document.createElement('div');
        overlay.id = 'soloMessagesModal';
        overlay.className = 'modal-overlay';
        overlay.style.display = 'none';
        overlay.style.zIndex = '2400';
        overlay.innerHTML =
            '<div class="modal-box" style="max-width:520px; width:92vw; max-height:85dvh; display:flex; flex-direction:column; padding:0; overflow:hidden;">' +
                '<div style="display:flex; align-items:center; justify-content:space-between; padding:14px 18px; border-bottom:1px solid var(--border-color);">' +
                    '<h3 id="soloMessagesModalTitle" style="margin:0; font-size:1.05rem;"></h3>' +
                    '<button id="btnCloseSoloMessages" type="button" style="background:transparent; border:none; color:var(--text-main); font-size:1.2rem; cursor:pointer; padding:4px 8px;">✕</button>' +
                '</div>' +
                '<div id="soloMessagesList" style="padding:14px 18px; overflow-y:auto; flex:1 1 auto;"></div>' +
            '</div>';
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) overlay.style.display = 'none';
        });
        document.body.appendChild(overlay);
        const closeBtn = document.getElementById('btnCloseSoloMessages');
        if (closeBtn) {
            closeBtn.addEventListener('click', () => { overlay.style.display = 'none'; });
        }
        return overlay;
    }

    async function openDialog() {
        if (typeof document === 'undefined') return;
        if (document.body && document.body.classList.contains('play-mode')) return;
        const overlay = ensureModal();
        if (!overlay) return;

        const lang = getLang();
        const titleEl = document.getElementById('soloMessagesModalTitle');
        const listEl = document.getElementById('soloMessagesList');
        if (titleEl) titleEl.textContent = tr('solo_messages_title', '');
        if (listEl) listEl.innerHTML = '<div style="text-align:center; padding:24px 0; color:var(--text-muted);">...</div>';
        overlay.style.display = 'flex';

        const { messages } = await loadMessages();
        if (!listEl) return;

        if (!messages.length) {
            listEl.innerHTML = '<p style="text-align:center; color:var(--text-muted); padding:24px 0; margin:0;">' +
                esc(tr('solo_messages_empty', '')) + '</p>';
            return;
        }

        listEl.innerHTML = messages.map((m) => {
            const meta = typeMeta(m.type);
            const badge = tr(meta.key, m.type || 'info');
            return '<article style="border:1px solid var(--border-color); border-radius:8px; padding:12px 14px; margin-bottom:12px; background:var(--bg-main);">' +
                '<div style="display:flex; align-items:center; justify-content:space-between; gap:8px; margin-bottom:6px;">' +
                    '<span style="font-size:0.7rem; font-weight:700; text-transform:uppercase; color:' + meta.color + '; border:1px solid ' + meta.color + '; border-radius:4px; padding:1px 6px;">' + esc(badge) + '</span>' +
                    '<span style="font-size:0.75rem; color:var(--text-muted);">' + esc(m.date || '') + '</span>' +
                '</div>' +
                '<div style="font-weight:700; color:var(--text-main); margin-bottom:6px;">' + esc(localize(m.title, lang)) + '</div>' +
                '<div style="font-size:0.88rem; color:var(--text-muted); line-height:1.5;">' + esc(localize(m.body, lang)) + '</div>' +
            '</article>';
        }).join('');

        markAllRead(messages);
        updateBadge(messages);
    }

    async function init() {
        if (typeof document === 'undefined') return;
        const { messages } = await loadMessages();
        updateBadge(messages);
    }

    const SoloMessages = {
        loadMessages,
        getUnreadCount,
        markAllRead,
        updateBadge,
        openDialog,
        init
    };

    if (typeof document !== 'undefined') {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', init);
        } else {
            init();
        }
    }

    if (root) root.SoloMessages = SoloMessages;
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = SoloMessages;
    }
})(typeof window !== 'undefined' ? window : globalThis);
