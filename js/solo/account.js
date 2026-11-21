/* =========================================================================
   mNotes Solo — Lazy Gift Code Activation (Google OAuth + redeem_gift_code RPC)
   Zero network requests during normal Solo usage.
   ========================================================================= */
(function (root) {
    'use strict';

    const LICENSE_KEY = 'mnotes_solo_gift_license';
    const PENDING_GIFT_KEY = 'mnotes_solo_pending_gift';
    const GIFT_LIB_SRC = 'libs/supabase-gift.min.js';

    function tr(key, fallback) {
        if (typeof root.t === 'function') return root.t(key, fallback || '');
        return fallback || '';
    }

    function notify(msg, type) {
        if (typeof root.mToast === 'function') {
            root.mToast(msg, type || 'info');
        } else if (typeof root.showToast === 'function') {
            root.showToast(msg, type || 'info');
        }
    }

    async function askPrompt(msg, defaultVal) {
        if (typeof root.mPrompt === 'function') {
            return await root.mPrompt(msg, defaultVal || '');
        }
        return null;
    }

    async function askConfirm(msg) {
        if (typeof root.mConfirm === 'function') {
            return Boolean(await root.mConfirm(msg, false));
        }
        return false;
    }

    function showNotice(msg) {
        if (typeof root.mAlert === 'function') {
            return root.mAlert(msg);
        }
        notify(msg, 'info');
        return Promise.resolve();
    }

    function isExpired(license, nowMs) {
        if (!license || !license.expiresAt) return false;
        const ts = Date.parse(license.expiresAt);
        if (!Number.isFinite(ts)) return false;
        return (nowMs !== undefined ? nowMs : Date.now()) > ts;
    }

    function getActiveGiftLicense(nowMs) {
        try {
            const raw = localStorage.getItem(LICENSE_KEY);
            if (!raw) return null;
            const lic = JSON.parse(raw);
            if (!lic || lic.edition !== 'edition_solo_paid') return null;
            if (isExpired(lic, nowMs)) {
                localStorage.removeItem(LICENSE_KEY);
                applyLicenseToRuntime(null);
                return null;
            }
            return lic;
        } catch (_) {
            return null;
        }
    }

    function applyLicenseToRuntime(license) {
        if (license && license.edition === 'edition_solo_paid') {
            root.userProfile = { subscription_tier: 'edition_solo_paid' };
        } else if (root.userProfile && root.userProfile.subscription_tier === 'edition_solo_paid') {
            root.userProfile = { subscription_tier: 'edition_solo_free' };
        }
        if (typeof root.syncSoloEditionUI === 'function') {
            root.syncSoloEditionUI();
        }
    }

    function saveGiftLicense(rpcResult, code) {
        const lic = {
            edition: 'edition_solo_paid',
            redeemedAt: new Date().toISOString(),
            expiresAt: rpcResult.expires_at || null,
            codeSuffix: String(code || '').slice(-4)
        };
        try {
            localStorage.setItem(LICENSE_KEY, JSON.stringify(lic));
        } catch (_) {}
        applyLicenseToRuntime(lic);
        return lic;
    }

    let libLoadPromise = null;
    function loadGiftSupabaseLib() {
        if (libLoadPromise) return libLoadPromise;
        libLoadPromise = new Promise((resolve, reject) => {
            if (typeof document === 'undefined') {
                reject(new Error('No DOM'));
                return;
            }
            const script = document.createElement('script');
            script.src = GIFT_LIB_SRC;
            script.async = true;
            script.onload = () => resolve(root.supabase);
            script.onerror = () => {
                libLoadPromise = null;
                reject(new Error('Failed to load gift Supabase SDK'));
            };
            document.head.appendChild(script);
        });
        return libLoadPromise;
    }

    async function createGiftClient() {
        const prevSupabase = root.supabase;
        const sdk = await loadGiftSupabaseLib();
        const url = root.SUPABASE_URL;
        const key = root.SUPABASE_ANON_KEY;
        if (!sdk || typeof sdk.createClient !== 'function' || !url || !key) {
            throw new Error('Supabase gift config missing');
        }
        const client = sdk.createClient(url, key, {
            auth: {
                storageKey: 'mnotes_solo_gift_auth',
                detectSessionInUrl: true,
                persistSession: true,
                autoRefreshToken: false
            }
        });
        // Restore tripwire on window.supabase so non-gift code remains guarded
        if (prevSupabase && prevSupabase !== sdk) {
            root.supabase = prevSupabase;
        }
        return client;
    }

    function messageForReason(reason) {
        switch (reason) {
            case 'not_found': return tr('solo_gift_not_found', '');
            case 'already_used': return tr('solo_gift_already_used', '');
            case 'expired': return tr('solo_gift_expired', '');
            case 'invalid_code': return tr('solo_gift_invalid', '');
            case 'rate_limited': return tr('solo_gift_rate_limited', '');
            default: return tr('solo_gift_error', '');
        }
    }

    async function redeemWithClient(client, code) {
        const cleanCode = String(code || '').trim().toUpperCase();
        if (!cleanCode) return { ok: false, reason: 'empty_code' };

        const { data, error } = await client.rpc('redeem_gift_code', { p_code: cleanCode });
        try {
            await client.auth.signOut();
        } catch (_) {}
        try {
            sessionStorage.removeItem(PENDING_GIFT_KEY);
        } catch (_) {}

        if (error || !data) {
            notify(tr('solo_gift_error', ''), 'error');
            return { ok: false, reason: 'rpc_error' };
        }

        if (data.ok === true && data.reward_type === 'solo_edition') {
            saveGiftLicense(data, cleanCode);
            await showNotice(tr('solo_gift_success', ''));
            return data;
        }

        const msg = messageForReason(data.reason);
        if (msg) notify(msg, 'warning');
        return data;
    }

    async function openGiftDialog(prefillCode) {
        if (typeof document === 'undefined') return;
        const active = getActiveGiftLicense();
        if (active && !prefillCode) {
            const expiryText = active.expiresAt
                ? new Date(active.expiresAt).toLocaleDateString()
                : '∞';
            const statusMsg = tr('solo_gift_active_status', '').replace('{date}', expiryText);
            const recheck = await askConfirm(statusMsg);
            if (!recheck) return;
            const stillValid = getActiveGiftLicense();
            if (stillValid) {
                notify(tr('solo_gift_checked_ok', ''), 'success');
            } else {
                notify(tr('solo_gift_checked_expired', ''), 'warning');
            }
            return;
        }

        const raw = await askPrompt(tr('solo_gift_prompt', ''), prefillCode || '');
        if (!raw || !String(raw).trim()) return;

        const cleanCode = String(raw).trim().toUpperCase();
        try {
            sessionStorage.setItem(PENDING_GIFT_KEY, cleanCode);
        } catch (_) {}

        let client;
        try {
            client = await createGiftClient();
        } catch (err) {
            console.error('[SoloAccount] Gift client init error:', err);
            notify(tr('solo_gift_error', ''), 'error');
            return;
        }

        const sessionRes = await client.auth.getSession();
        const session = sessionRes && sessionRes.data ? sessionRes.data.session : null;
        if (session) {
            await redeemWithClient(client, cleanCode);
            return;
        }

        const proceed = await askConfirm(tr('solo_gift_oauth_confirm', ''));
        if (!proceed) {
            try { sessionStorage.removeItem(PENDING_GIFT_KEY); } catch (_) {}
            return;
        }

        const redirectTo = root.location.origin + root.location.pathname;
        await client.auth.signInWithOAuth({
            provider: 'google',
            options: { redirectTo }
        });
    }

    async function handleStartup() {
        const active = getActiveGiftLicense();
        if (active) {
            applyLicenseToRuntime(active);
        }

        if (typeof root.location === 'undefined') return;
        const params = new URLSearchParams(root.location.search || '');
        const giftParam = params.get('gift');
        const hash = root.location.hash || '';
        const pendingGift = (() => {
            try { return sessionStorage.getItem(PENDING_GIFT_KEY); } catch (_) { return null; }
        })();

        // OAuth callback return for pending gift code
        const isOAuthReturn = pendingGift && (hash.includes('access_token=') || params.has('code'));
        if (isOAuthReturn) {
            try {
                const client = await createGiftClient();
                const sessionRes = await client.auth.getSession();
                const session = sessionRes && sessionRes.data ? sessionRes.data.session : null;
                if (session) {
                    await redeemWithClient(client, pendingGift);
                }
            } catch (err) {
                console.error('[SoloAccount] OAuth callback error:', err);
                notify(tr('solo_gift_error', ''), 'error');
            } finally {
                try {
                    const cleanUrl = root.location.origin + root.location.pathname;
                    root.history.replaceState({}, '', cleanUrl);
                } catch (_) {}
            }
            return;
        }

        // Deep-link ?gift=XXXX
        if (giftParam && giftParam.trim()) {
            const code = giftParam.trim().toUpperCase();
            try { sessionStorage.setItem(PENDING_GIFT_KEY, code); } catch (_) {}
            try {
                params.delete('gift');
                const nextSearch = params.toString();
                const cleanUrl = root.location.pathname + (nextSearch ? '?' + nextSearch : '') + (hash || '');
                root.history.replaceState({}, '', cleanUrl);
            } catch (_) {}
            setTimeout(() => { openGiftDialog(code); }, 300);
        }
    }

    const SoloAccount = {
        getActiveGiftLicense,
        isExpired,
        saveGiftLicense,
        openGiftDialog,
        redeemWithClient,
        handleStartup
    };

    if (typeof document !== 'undefined') {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', handleStartup);
        } else {
            handleStartup();
        }
    }

    if (root) root.SoloAccount = SoloAccount;
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = SoloAccount;
    }
})(typeof window !== 'undefined' ? window : globalThis);
