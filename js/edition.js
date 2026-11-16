window.MNOTES_EDITION = 'solo';
window.beforeFetchRhythmUrl = function (url) {
    if (/\.supabase\.co\b/i.test(String(url || ''))) {
        if (typeof showToast === 'function') showToast('Ο ρυθμός είναι από την Pro', 'warning');
        return false;
    }
    return true;
};
