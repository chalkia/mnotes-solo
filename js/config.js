// Αρχείο: js/config.js
const CONFIG = {
    // Τα κλειδιά του Supabase
    SUPABASE_URL: 'https://ihrckneywnzgkxantrvm.supabase.co',
    SUPABASE_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlocmNrbmV5d256Z2t4YW50cnZtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzAxMTU4NzAsImV4cCI6MjA4NTY5MTg3MH0.Gj7UdQebw8Jg6XbpfZxehPgyikhoUGG1MRd181EXztw',
    
    // Το Google Client ID (Συνήθως το βάζεις στο Supabase Dashboard, αλλά αν το θες κι εδώ:)
    GOOGLE_CLIENT_ID: "your-google-client-id.apps.googleusercontent.com"
};

window.MNOTES_VERSION = '2.6.26';
if (typeof globalThis !== 'undefined') {
    globalThis.MNOTES_VERSION = '2.6.26';
}


window.safeSetLocal = function(key, value) {
    try {
        // ⚠️ ΠΡΟΣΟΧΗ: εδώ ΠΡΕΠΕΙ να καλείται το localStorage.setItem και ΟΧΙ
        // η ίδια η safeSetLocal -- αλλιώς γίνεται άπειρη αναδρομή και καμία
        // εγγραφή δεν φτάνει ποτέ στον δίσκο.
        localStorage.setItem(key, value);
        return true;
    } catch (e) {
        if (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED') {
            if (typeof showToast === 'function') {
                const msg = (typeof t === 'function')
                    ? t('msg_err_storage_full', "Σφάλμα: Εξαντλήθηκε ο χώρος αποθήκευσης της συσκευής!")
                    : "Σφάλμα: Εξαντλήθηκε ο χώρος αποθήκευσης της συσκευής!";
                showToast(msg, "error");
            }
            console.error("LocalStorage QuotaExceededError", e);
        } else {
            console.error("LocalStorage error", e);
        }
        return false;
    }
};
