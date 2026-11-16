/* =========================================
   SUPABASE CLIENT BRIDGE (js/supabase-client.js)
   ========================================= */

// 1. ΑΣΦΑΛΗΣ ΛΗΨΗ ΚΛΕΙΔΙΩΝ ΑΠΟ ΤΟ CONFIG.JS
if (typeof CONFIG === 'undefined') {
    console.error("❌ CRITICAL: Το αρχείο js/config.js δεν βρέθηκε ή έχει λάθος!");
    alert("System Error: Configuration file missing (js/config.js).");
}

// Χρήση των κλειδιών από το αρχείο ρυθμίσεων
const SUPABASE_URL = CONFIG.SUPABASE_URL; 
const SUPABASE_KEY = CONFIG.SUPABASE_KEY; 

let supabaseClient = null;
var currentUser = null; // Global variable

// Initialization
if (typeof window.supabase !== 'undefined') {
    // Δημιουργία του Client
    supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
} else {
    console.error("❌ Supabase Library not loaded! Check index.html");
}

// --- AUTH FUNCTIONS ---

async function doLogin() {
    const email = document.getElementById('authEmail').value.trim();
    const password = document.getElementById('authPass').value;
    const msg = document.getElementById('authMsg');

    if (!email || !password) {
        msg.innerText = (typeof t === 'function') ? t('msg_title_body_req') : "Παρακαλώ συμπληρώστε Email και Κωδικό.";
        return;
    }

    console.log(`[AUTH] Προσπάθεια εισόδου για το email: ${email}`);
    msg.innerText = (typeof t === 'function' ? t('auto_msg_122', "Connecting... / Φόρτωση...") : "Connecting... / Φόρτωση..."); 

    try {
        const { data, error } = await supabaseClient.auth.signInWithPassword({
            email: email,
            password: password,
        });

        if (error) throw error;

        currentUser = data.user;
        console.log(`[AUTH] Επιτυχής είσοδος. User ID: ${currentUser.id}`);
        safeSetLocal('mnotes_last_auth', 'email');
        
        document.getElementById('authModal').style.display = 'none';
        msg.innerText = ""; 
        showToast((typeof t === 'function' ? t('auto_msg_121', "Επιτυχής σύνδεση! 🎉") : "Επιτυχής σύνδεση! 🎉"));
        
        // ✨ ΔΙΕΓΡΑΦΗ: Το UI(true) αφαιρέθηκε για να μην προκαλέσει ReferenceError.
        
        if (typeof initUserData === 'function') initUserData(); 
        
    } catch (err) {
        console.error("[AUTH ERROR] Σφάλμα Εισόδου:", err.message);
        msg.innerText = (typeof t === 'function' ? t('auto_msg_120', "Λάθος στοιχεία ή το προφίλ δεν υπάρχει.") : "Λάθος στοιχεία ή το προφίλ δεν υπάρχει.");
        showToast((typeof t === 'function' ? t('auto_msg_119', "Αποτυχία σύνδεσης") : "Αποτυχία σύνδεσης"), "error");
    }
}

async function doSignUp() {
    const email = document.getElementById('authEmail').value.trim();
    const password = document.getElementById('authPass').value;
    const msg = document.getElementById('authMsg');

    if (!email || !password) {
        msg.innerText = (typeof t === 'function' ? t('auto_msg_118', "Παρακαλώ συμπληρώστε Email και Κωδικό.") : "Παρακαλώ συμπληρώστε Email και Κωδικό.");
        return;
    }

    if (password.length < 6) {
        msg.innerText = (typeof t === 'function' ? t('auto_msg_117', "Ο κωδικός πρέπει να έχει τουλάχιστον 6 χαρακτήρες.") : "Ο κωδικός πρέπει να έχει τουλάχιστον 6 χαρακτήρες.");
        return;
    }

    console.log(`[AUTH] Προσπάθεια εγγραφής νέου χρήστη: ${email}`);
    msg.innerText = (typeof t === 'function' ? t('auto_msg_116', "Creating account... / Δημιουργία λογαριασμού...") : "Creating account... / Δημιουργία λογαριασμού...");

    try {
        // ✨ Η ΔΙΟΡΘΩΣΗ ΓΙΑ ΤΟ EMAIL: Παίρνουμε το καθαρό URL
        const cleanUrl = window.location.origin + window.location.pathname;
        console.log(`[AUTH] Το email redirect ορίστηκε στο: ${cleanUrl}`);

        const { data, error } = await supabaseClient.auth.signUp({
            email: email,
            password: password,
            // ✨ Ενημερώνουμε τη Supabase πού να επιστρέψει τον χρήστη
            options: {
                emailRedirectTo: cleanUrl
            }
        });

        if (error) throw error;

        console.log("[AUTH] Επιτυχής Εγγραφή. Δεδομένα Supabase:", data);
        safeSetLocal('mnotes_last_auth', 'email');
        document.getElementById('authModal').style.display = 'none';
        msg.innerText = ""; 
        
        // Έλεγχος αν απαιτείται επιβεβαίωση email
        if (data.user && data.user.identities && data.user.identities.length === 0) {
            console.warn(`[AUTH] Το email ${email} χρησιμοποιείται ήδη.`);
            showToast((typeof t === 'function' ? t('auto_msg_115', "Αυτό το email χρησιμοποιείται ήδη.") : "Αυτό το email χρησιμοποιείται ήδη."), "error");
            msg.innerText = (typeof t === 'function' ? t('auto_msg_114', "Το email χρησιμοποιείται ήδη.") : "Το email χρησιμοποιείται ήδη.");
        } else if (data.session) {
            showToast((typeof t === 'function' ? t('auto_msg_113', "Η εγγραφή ολοκληρώθηκε! Καλώς ήρθατε! 🎉") : "Η εγγραφή ολοκληρώθηκε! Καλώς ήρθατε! 🎉"));
            setTimeout(() => {
                alert((typeof t === 'function' ? t('auto_msg_112', "Συγχαρητήρια για την εγγραφή σας!\n\nΠΡΟΣΟΧΗ (Free Tier):\nΤα δεδομένα σας (τραγούδια, εγγραφές) αποθηκεύονται ΜΟΝΟ ΤΟΠΙΚΑ σε αυτόν τον browser. Αν καθαρίσετε την cache του browser ή αν αποσυνδεθείτε, θα τα χάσετε οριστικά!\n\n💡 Συμβουλή: Θυμηθείτε να κάνετε τακτικά Εξαγωγή (Export) σε .mnotes αρχείο από τις ρυθμίσεις.") : "Συγχαρητήρια για την εγγραφή σας!\n\nΠΡΟΣΟΧΗ (Free Tier):\nΤα δεδομένα σας (τραγούδια, εγγραφές) αποθηκεύονται ΜΟΝΟ ΤΟΠΙΚΑ σε αυτόν τον browser. Αν καθαρίσετε την cache του browser ή αν αποσυνδεθείτε, θα τα χάσετε οριστικά!\n\n💡 Συμβουλή: Θυμηθείτε να κάνετε τακτικά Εξαγωγή (Export) σε .mnotes αρχείο από τις ρυθμίσεις."));
            }, 500);
        } else {
            showToast((typeof t === 'function' ? t('auto_msg_111', "Επιτυχία! Ελέγξτε το email σας για επιβεβαίωση 📩") : "Επιτυχία! Ελέγξτε το email σας για επιβεβαίωση 📩"), "info");
            setTimeout(() => {
                alert((typeof t === 'function' ? t('auto_msg_110', "Η εγγραφή προχωράει! Ελέγξτε το email σας.\n\nΠΡΟΣΟΧΗ (Free Tier):\nΤα δεδομένα σας (τραγούδια, εγγραφές) αποθηκεύονται ΜΟΝΟ ΤΟΠΙΚΑ σε αυτόν τον browser. Αν καθαρίσετε την cache του browser ή αν αποσυνδεθείτε, θα τα χάσετε οριστικά!\n\n💡 Συμβουλή: Θυμηθείτε να κάνετε τακτικά Εξαγωγή (Export) σε .mnotes αρχείο από τις ρυθμίσεις.") : "Η εγγραφή προχωράει! Ελέγξτε το email σας.\n\nΠΡΟΣΟΧΗ (Free Tier):\nΤα δεδομένα σας (τραγούδια, εγγραφές) αποθηκεύονται ΜΟΝΟ ΤΟΠΙΚΑ σε αυτόν τον browser. Αν καθαρίσετε την cache του browser ή αν αποσυνδεθείτε, θα τα χάσετε οριστικά!\n\n💡 Συμβουλή: Θυμηθείτε να κάνετε τακτικά Εξαγωγή (Export) σε .mnotes αρχείο από τις ρυθμίσεις."));
            }, 500);
        }
    } catch (err) {
        console.error("[AUTH ERROR] Σφάλμα Εγγραφής:", err.message);
        msg.innerText = "Σφάλμα: " + err.message;
    }
}

async function doLogout() {
    try {
        console.log("🚪 [AUTH] Εκκίνηση αποσύνδεσης...");
        
        // 1. Προστασία: Ειδικό μήνυμα για Free χρήστες (Data Loss Warning)
        if (typeof userProfile !== 'undefined' && userProfile && userProfile.subscription_tier === 'solo_free') {
            const freeWarnMsg = "ΠΡΟΣΟΧΗ: Είστε στο δωρεάν πακέτο (Free) και τα δεδομένα σας αποθηκεύονται ΜΟΝΟ σε αυτόν τον browser.\n\nΑν αποσυνδεθείτε, η βιβλιοθήκη σας θα διαγραφεί οριστικά για λόγους ασφαλείας!\n\n💡 Συμβουλή: Κάντε πρώτα Εξαγωγή (Export) σε .mnotes αρχείο.\n\nΘέλετε σίγουρα να αποσυνδεθείτε και να ΧΑΣΕΤΕ τα τοπικά δεδομένα;";
            if (!confirm(freeWarnMsg)) return;
        }

        // 2. Προστασία: Έλεγχος για unsynced δεδομένα (για Plus/Pro)
        let pendingWrites = [];
        try { pendingWrites = JSON.parse(localStorage.getItem('mnotes_sync_queue') || "[]"); } catch (e) { pendingWrites = []; }
        if (pendingWrites.length > 0) {
            if (!confirm(typeof t === 'function' ? t('msg_unsynced_logout_warning', 'Υπάρχουν αλλαγές που δεν έχουν συγχρονιστεί! Αν αποσυνδεθείτε τώρα, θα χαθούν. Είστε σίγουροι;') : 'Υπάρχουν αλλαγές που δεν έχουν συγχρονιστεί! Αν αποσυνδεθείτε τώρα, θα χαθούν. Είστε σίγουροι;')) {
                return;
            }
        }
        
        // 3. Καθαρισμός Local Storage (Αποτροπή Data Leak)
        const keysToKeep = ['mnotes_lang', 'mnotes_theme', 'mnotes_settings', 'mnotes_last_auth', 'mnotes_device_lock'];
        const allKeys = Object.keys(localStorage);
        allKeys.forEach(key => {
            if (!keysToKeep.includes(key)) {
                localStorage.removeItem(key);
            }
        });
        
        // 4. Ζητάμε από τη Supabase να κλείσει το session
        await supabaseClient.auth.signOut();
        
        // 5. Reload
        window.location.reload(); 
        
    } catch (err) {
        console.error("❌ Logout Error:", err);
    }
}
//   Password Recovery Functions
// 1. Στέλνει το Email ανάκτησης
async function sendPasswordReset() {
    const email = document.getElementById('authEmail').value.trim();
    if (!email) {
        showToast((typeof t === 'function' ? t('auto_msg_109', "Παρακαλώ γράψτε το email σας στο πεδίο πάνω και ξαναπατήστε το.") : "Παρακαλώ γράψτε το email σας στο πεδίο πάνω και ξαναπατήστε το."), "warning");
        return;
    }

    const cleanUrl = window.location.origin + window.location.pathname;
    
    try {
        const { error } = await supabaseClient.auth.resetPasswordForEmail(email, {
            redirectTo: cleanUrl,
        });
        if (error) throw error;
        
        showToast((typeof t === 'function' ? t('auto_msg_108', "Σας στείλαμε email με οδηγίες επαναφοράς! 📩") : "Σας στείλαμε email με οδηγίες επαναφοράς! 📩"), "info");
        document.getElementById('authModal').style.display = 'none';
    } catch (err) {
        console.error("Reset Error:", err);
        showToast(t('msg_err_prefix', "Σφάλμα: ") + err.message, "error");
    }
}

// 2. Αποθηκεύει τον νέο κωδικό
async function updateNewPassword() {
    const newPass = document.getElementById('newAuthPass').value;
    if (newPass.length < 6) {
        document.getElementById('resetMsg').innerText = (typeof t === 'function' ? t('auto_msg_107', "Τουλάχιστον 6 χαρακτήρες.") : "Τουλάχιστον 6 χαρακτήρες.");
        return;
    }

    try {
        const { error } = await supabaseClient.auth.updateUser({ password: newPass });
        if (error) throw error;

        showToast((typeof t === 'function' ? t('auto_msg_106', "Ο κωδικός σας άλλαξε επιτυχώς! ✅") : "Ο κωδικός σας άλλαξε επιτυχώς! ✅"));
        document.getElementById('resetPasswordModal').style.display = 'none';
    } catch (err) {
        console.error("Update Pass Error:", err);
        document.getElementById('resetMsg').innerText = "Σφάλμα: " + err.message;
    }
}

function updateAuthUI(isLoggedIn) {
    const buttonIDs = ['btnAuth', 'btnAuthBottom', 'btnAuthDrawer'];

    buttonIDs.forEach(id => {
        const btn = document.getElementById(id);
        if (!btn) return; 

        if (isLoggedIn) {
            // ΣΥΝΔΕΔΕΜΕΝΟΣ
            if (id === 'btnAuth') {
                btn.innerHTML = '<i class="fas fa-user-check"></i>';
                btn.style.color = ''; // Keep CSS default (#111 on yellow background)
            } else {
                btn.innerHTML = '<i class="fas fa-user-check"></i> <span data-msi18n="btn_account">Account</span>';
                btn.style.color = 'var(--accent)';
            }
            btn.onclick = function() { 
                console.log(`🖱️ Clicked on ${id} (Logged In)`);
                if (typeof window.openAccountModal === 'function') {
                    window.openAccountModal();
                } else {
                    console.error("❌ window.openAccountModal is not defined!");
                }
            };
        } else {
            // ΑΠΟΣΥΝΔΕΔΕΜΕΝΟΣ
            if (id === 'btnAuth') {
                btn.innerHTML = '<i class="fas fa-user"></i>';
                btn.style.color = ''; // Keep CSS default
            } else {
                btn.innerHTML = '<i class="fas fa-user"></i> <span data-msi18n="btn_account">Account</span>';
                btn.style.color = 'var(--text-muted)';
            }
            btn.onclick = function() { 
                console.log(`🖱️ Clicked on ${id} (Logged Out)`);
                openAuthModal(); 
            };
        }
    });
}

// --- ΓΕΝΙΚΗ ΣΥΝΑΡΤΗΣΗ UPLOAD (Για Ήχο, PDF, Εικόνες κλπ) ---
async function uploadFileToCloud(fileBlob, filename, bucketName = 'user_assets') {
    if (!currentUser) {
        alert((typeof t === 'function' ? t('auto_msg_105', "Παρακαλώ συνδεθείτε για να ανεβάσετε αρχεία!") : "Παρακαλώ συνδεθείτε για να ανεβάσετε αρχεία!"));
        openAuthModal();
        return null;
    }

    // Το Λουκέτο του Πορτιέρη για τα συνημμένα
    if (typeof canUserPerform === 'function' && !canUserPerform('SAVE_ATTACHMENTS')) {
        if (typeof promptUpgrade === 'function') promptUpgrade('Cloud Storage');
        return null;
    }

    showToast((typeof t === 'function' ? t('auto_msg_104', "Ανέβασμα αρχείου... ☁️") : "Ανέβασμα αρχείου... ☁️"));

    // Αποθηκεύουμε τα αρχεία στον ατομικό φάκελο του χρήστη
    const filePath = `${currentUser.id}/${filename}`;
    
    // Ανεβάζουμε στο δυναμικό Bucket (προεπιλογή: user_assets)
    const { data, error } = await supabaseClient.storage
        .from(bucketName)
        .upload(filePath, fileBlob, {
            cacheControl: '3600',
            upsert: true
        });

    if (error) {
        alert(t('msg_upload_failed2', "Το ανέβασμα απέτυχε: ") + error.message);
        console.error(error);
        return null;
    }

    // Παίρνουμε το Public Link
    const { data: urlData } = supabaseClient.storage
        .from(bucketName)
        .getPublicUrl(filePath);

    return urlData.publicUrl;
}
// --- OAUTH LOGINS (Google, Apple, Facebook, Spotify) ---
// Μία έξυπνη συνάρτηση για όλους τους παρόχους
async function loginWith(providerName) {
    try {
        safeSetLocal('mnotes_last_auth', providerName);
        // Παίρνουμε το καθαρό URL της εφαρμογής (χωρίς το τεράστιο #hash)
        const cleanUrl = window.location.origin + window.location.pathname;
        
        // Χωρίς αυτό, ο πάροχος ξαναμπάζει σιωπηλά τον ίδιο λογαριασμό μετά από
        // logout — δηλαδή η αποσύνδεση δεν φαίνεται πουθενά και δεν αλλάζεις
        // ποτέ λογαριασμό. Κάθε πάροχος το λέει με δική του παράμετρο.
        const FORCE_ACCOUNT_PICKER = {
            google:   { prompt: 'select_account' },      // δείχνει τον επιλογέα λογαριασμών
            facebook: { auth_type: 'reauthenticate' },   // ζητά ξανά διαπιστευτήρια
            discord:  { prompt: 'consent' },             // ξαναδείχνει την οθόνη έγκρισης
            apple:    {}                                 // δεν υποστηρίζει επιλογέα — αγνοεί το prompt
        };

        const { data, error } = await supabaseClient.auth.signInWithOAuth({
            provider: providerName,
            options: {
                redirectTo: cleanUrl, // Επιβάλλουμε την επιστροφή στο καθαρό URL
                queryParams: FORCE_ACCOUNT_PICKER[providerName] || {}
            }
        });

        if (error) throw error;
        
    } catch (err) {
        console.error(`${providerName} Auth Error:`, err);
        const msgBox = document.getElementById('authMsg');
        if (msgBox) msgBox.innerText = "Σφάλμα: " + err.message;
    }
}

// Διατηρούμε την παλιά συνάρτηση για να μην "σπάσει" το παλιό κουμπί στο HTML (αν δεν το έχεις αλλάξει ακόμα)
function loginWithGoogle() {
    loginWith('google');
}

// --- GLOBAL AUTH STATE LISTENER ---
if (typeof window.supabase !== 'undefined' && supabaseClient) {
    supabaseClient.auth.onAuthStateChange((event, session) => {
        console.log("Auth Event:", event);
       
       if (event === 'PASSWORD_RECOVERY') {
            // Κλείνουμε τυχόν άλλα modals και ανοίγουμε αυτό της επαναφοράς
            document.getElementById('authModal').style.display = 'none';
            const resetMod = document.getElementById('resetPasswordModal'); if (resetMod && resetMod.parentElement !== document.body) { document.body.appendChild(resetMod); } resetMod.style.display = 'flex';
            return;
        }

        if (session) {
            currentUser = session.user;
            updateAuthUI(true);
            // Τρέχει μόνο αν δεν έχει ήδη τρέξει από το doLogin
            if (event === 'SIGNED_IN' || event === 'INITIAL_SESSION') {
                if (typeof initUserData === 'function') initUserData();
            }
        } else {
            // Καθαρισμός ταυτότητας → υποβάθμιση σε Guest
            currentUser = null;
            userProfile = null;
            myGroups = [];
            groupsKnown = false;   // αλλιώς ο guest κληρονομεί «ξέρω» χωρίς δεδομένα
            currentGroupId = 'personal';
            updateAuthUI(false);
            
            // [NEW] Έλεγχος για Pending Invite σε Unauthenticated χρήστες
            if (localStorage.getItem('mnotes_pending_invite')) {
                showToast((typeof t === 'function' ? t('auto_msg_103', "Απαιτείται σύνδεση ή εγγραφή για να προβάλετε την πρόσκληση.") : "Απαιτείται σύνδεση ή εγγραφή για να προβάλετε την πρόσκληση."), "warning");
                setTimeout(() => {
                    if (typeof openAuthModal === 'function') openAuthModal();
                }, 1000);
            }

            if (localStorage.getItem('mnotes_pending_join')) {
                showToast((typeof t === 'function' ? t('msg_login_to_join_band', "Συνδέσου για να μπεις στη μπάντα.") : "Συνδέσου για να μπεις στη μπάντα."), "warning");
                setTimeout(() => {
                    if (typeof openAuthModal === 'function') openAuthModal();
                }, 1000);
            }
            
            // 🛡️ ΑΚΟΥΣΙΑ απώλεια συνεδρίας: λήξη token, αποτυχία refresh, ή sign-out
            // που ξεκίνησε αλλού. Ο χρήστης ΔΕΝ ζήτησε αποσύνδεση, άρα τα τοπικά
            // δεδομένα ΔΕΝ αγγίζονται. Η ρητή αποσύνδεση καθαρίζει ήδη μέσω
            // handleLogout('user') / doLogout(), πριν φτάσει εδώ.
            if (typeof trimLibraryToGuestLimit === 'function') trimLibraryToGuestLimit('session_lost');
            
            // Επαναφορά UI στα Guest δικαιώματα (κρύβει premium features)
            if (typeof refreshUIByTier === 'function') refreshUIByTier();
            
            // Επιστροφή στα τοπικά δεδομένα (Guest mode)
            if (typeof loadContextData === 'function') loadContextData();
        }
    });
}

// --- DTO & SANITIZATION ΓΙΑ TH SUPABASE ---
window.sanitizeForDatabase = function(song, userId, groupId = null) {
    return {
        id: song.id,
        title: song.title || "Untitled",
        artist: song.artist || "",
        key: song.key || "",
        body: song.body || "",
        intro: song.intro || "",
        interlude: song.interlude || song.inter || "", 
        
        notes: song.notes || "", 
        // Κάνουμε map το camelCase του JS στο snake_case της SQL
        conductor_notes: song.conductorNotes || song.conductor_notes || "", 
        capo: (song.capo !== undefined && song.capo !== null && song.capo !== "" && !isNaN(song.capo)) ? parseInt(song.capo, 10) : null,
        capo_print: !!song.capo_print,
        
        video: song.video || "",
        tags: Array.isArray(song.tags) ? song.tags : (Array.isArray(song.playlists) ? song.playlists : []),
        recordings: Array.isArray(song.recordings) ? song.recordings : [],
        attachments: Array.isArray(song.attachments) ? song.attachments : [],
        rhythms: Array.isArray(song.rhythms) ? song.rhythms : [],
        user_id: userId,
        group_id: (groupId === 'personal') ? null : (groupId || null),
        
        is_clone: !!song.is_clone,
        parent_id: song.parent_id || null,
        is_deleted: !!song.is_deleted,

        // Μεταδεδομένα μετανάστευσης — διατηρούνται αν υπάρχουν (null αλλιώς)
        migrated_from: song.migrated_from || null,
        
        updated_at: new Date().toISOString()
    };
};
async function fetchUserStorageBytes(userId) {
    if (!userId || typeof supabaseClient === 'undefined') return 0;
    let totalBytes = 0;
    let offset = 0;
    const pageSize = 1000;
    while (true) {
        const { data: files, error } = await supabaseClient.storage
            .from('audio_files')
            .list(userId, {
                limit: pageSize,
                offset: offset
            });

        if (error) throw error;
        if (!files || files.length === 0) break;

        files.forEach(file => {
            if (file.name) {
                const sz = (file.metadata && typeof file.metadata.size === 'number')
                    ? file.metadata.size
                    : (file.size || 0);
                totalBytes += sz;
            }
        });

        if (files.length < pageSize) break;
        offset += pageSize;
    }
    return totalBytes;
}
window.fetchUserStorageBytes = fetchUserStorageBytes;

async function updateStorageUI() {
    if (!currentUser) return;

    const storageText = document.getElementById('storageText');
    const storageBar = document.getElementById('storageBar');
    
    if (storageText) storageText.innerText = (typeof t === 'function' ? t('auto_msg_102', "Υπολογισμός... ⏳") : "Υπολογισμός... ⏳");

    try {
        // 0. Αν δεν έχει δικαίωμα cloud attachments (μη-Pro), καμία ανάγνωση bucket
        if (typeof canUserPerform === 'function' && !canUserPerform('SAVE_ATTACHMENTS')) {
            if (storageText) storageText.innerText = (typeof t === 'function' ? t('lbl_storage_local_pro', 'Μόνο στη συσκευή · Cloud στην Pro') : 'Μόνο στη συσκευή · Cloud στην Pro');
            if (storageBar) storageBar.style.width = '0%';
            return;
        }

        // 1. Παίρνουμε το όριο του χρήστη από την TIER_CONFIG
        const limits = typeof getUserLimits === 'function' ? getUserLimits() : { storageLimitMB: 0 };
        const maxMB = limits.storageLimitMB;

        // 2. Αν είναι Free και έχει 0 όριο
        if (maxMB === 0) {
            if (storageText) storageText.innerText = (typeof t === 'function' ? t('auto_msg_101', "0 MB / 0 MB (Αναβαθμίστε)") : "0 MB / 0 MB (Αναβαθμίστε)");
            if (storageBar) storageBar.style.width = '0%';
            return;
        }

        // 3. Διαβάζουμε τα αρχεία του από το Bucket 'audio_files' με σελιδοποίηση
        const totalBytes = await fetchUserStorageBytes(currentUser.id);

        // Μετατροπή σε Megabytes (με 1 δεκαδικό)
        const usedMB = (totalBytes / (1024 * 1024)).toFixed(1);
        const maxLabel = maxMB >= 1024 ? `${(maxMB / 1024).toFixed(1)} GB` : `${maxMB} MB`;

        // 4. Ενημέρωση του UI
        if (storageText) {
            storageText.innerText = `${usedMB} MB / ${maxLabel}`;
        }
        
        if (storageBar) {
            let percent = (usedMB / maxMB) * 100;
            if (percent > 100) percent = 100; // Για να μην βγει η μπάρα έξω από το div!
            
            storageBar.style.width = `${percent}%`;
            
            // Αλλάζουμε χρώμα ανάλογα με την πληρότητα
            if (percent > 90) {
                storageBar.style.background = '#ff4444'; // Κόκκινο (Κίνδυνος)
            } else if (percent > 75) {
                storageBar.style.background = '#ffbb33'; // Κίτρινο/Πορτοκαλί (Προειδοποίηση)
            } else {
                storageBar.style.background = 'var(--accent)'; // Κανονικό χρώμα
            }
        }

    } catch (err) {
        console.error("❌ Σφάλμα υπολογισμού χώρου:", err);
        if (storageText) storageText.innerText = (typeof t === 'function' ? t('auto_msg_100', "Σφάλμα υπολογισμού") : "Σφάλμα υπολογισμού");
    }
}
// ===========================================================
// CONCURRENCY MONITOR (1 Mobile + 1 Desktop Limit)
// ===========================================================
const myDeviceInstanceId = Math.random().toString(36).substring(2, 15);
const myConnectionTime = Date.now();

// Έξυπνος έλεγχος αν είναι Κινητό/Tablet ή Υπολογιστής (Πιάνει και τα νεότερα iPad Pro που δηλώνουν Mac)
const isModernIPad = (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isMobileDevice = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || isModernIPad;
const myDeviceType = isMobileDevice ? 'mobile' : 'desktop';

let userPresenceChannel = null;
// Χρόνος διεκδίκησης της θέσης. Ανανεώνεται με το "Συνέχεια εδώ", ώστε η
// επιστροφή σε μια συσκευή να είναι το ίδιο εύκολη με την αποχώρηση.
let myClaimTime = myConnectionTime;

function startConcurrencyMonitor() {
    if (typeof currentUser === 'undefined' || !currentUser || !supabaseClient) return;

    if (userPresenceChannel) {
        supabaseClient.removeChannel(userPresenceChannel);
    }

    // 🔑 Μόνιμο ID συσκευής (όχι ανά καρτέλα): δύο καρτέλες, ή PWA + browser,
    // στο ΙΔΙΟ μηχάνημα δεν πρέπει να μετράνε ως δύο συσκευές.
    const myPersistentId = (typeof getOrCreateDeviceId === 'function')
        ? getOrCreateDeviceId()
        : myDeviceInstanceId;

    userPresenceChannel = supabaseClient.channel('presence_' + currentUser.id);

    userPresenceChannel
        .on('presence', { event: 'sync' }, () => {
            const state = userPresenceChannel.presenceState();
            let allDevices = [];
            for (const key in state) {
                allDevices.push(...state[key]);
            }

            const myTypeDevices = allDevices.filter(d => d.device_type === myDeviceType);

            // 🧩 Ομαδοποίηση ανά ΦΥΣΙΚΗ συσκευή (persistent_id).
            const byDevice = new Map();
            myTypeDevices.forEach(d => {
                const pid = d.persistent_id || d.device_id;
                const prev = byDevice.get(pid);
                if (!prev || (d.online_at || 0) > (prev.online_at || 0)) byDevice.set(pid, d);
            });

            // Υπάρχει ΑΛΛΗ φυσική συσκευή ίδιου τύπου που διεκδίκησε πιο πρόσφατα;
            let newerOther = null;
            byDevice.forEach((d, pid) => {
                if (pid === myPersistentId) return;
                if ((d.online_at || 0) > myClaimTime) {
                    if (!newerOther || (d.online_at || 0) > (newerOther.online_at || 0)) newerOther = d;
                }
            });

            if (newerOther) showConcurrencyBlocker(myDeviceType);
            else hideConcurrencyBlocker();
        })
        .subscribe(async (status) => {
            if (status === 'SUBSCRIBED') {
                await userPresenceChannel.track({
                    device_id: myDeviceInstanceId,
                    persistent_id: myPersistentId,
                    device_type: myDeviceType,
                    online_at: myClaimTime
                });
            }
        });
}

/**
 * Επαναδιεκδίκηση της θέσης από αυτή τη συσκευή ("Συνέχεια εδώ").
 * Δεν κάνει logout, δεν κάνει reload, δεν αγγίζει κανένα τοπικό δεδομένο.
 */
async function reclaimDeviceSlot() {
    myClaimTime = Date.now();
    hideConcurrencyBlocker();
    try {
        if (userPresenceChannel) {
            await userPresenceChannel.track({
                device_id: myDeviceInstanceId,
                persistent_id: (typeof getOrCreateDeviceId === 'function') ? getOrCreateDeviceId() : myDeviceInstanceId,
                device_type: myDeviceType,
                online_at: myClaimTime
            });
        }
        if (typeof currentUser !== 'undefined' && currentUser && typeof registerDevice === 'function') {
            await registerDevice(currentUser.id);
        }
    } catch (e) {
        console.error("❌ [Device] Αποτυχία επαναδιεκδίκησης:", e);
    }
}
window.reclaimDeviceSlot = reclaimDeviceSlot;

// --- ΟΠΤΙΚΟ ΜΠΛΟΚΑΡΙΣΜΑ (Προσαρμοσμένο) ---
function showConcurrencyBlocker(deviceType) {
    let blocker = document.getElementById('concurrencyBlocker');

    if (!blocker) {
        blocker = document.createElement('div');
        blocker.id = 'concurrencyBlocker';
        blocker.style.cssText = 'position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.95); z-index:99999; display:flex; flex-direction:column; align-items:center; justify-content:center; color:#fff; text-align:center; padding:20px; backdrop-filter: blur(10px);';
        document.body.appendChild(blocker);
    }

    const T = (k, fb) => (typeof t === 'function') ? t(k, fb) : fb;
    const typeText = deviceType === 'mobile'
        ? T('dev_type_mobile', 'κινητό ή tablet')
        : T('dev_type_desktop', 'υπολογιστή');

    blocker.innerHTML =
        '<i class="fas fa-pause-circle" style="font-size:4rem; color:var(--accent, #ffd166); margin-bottom:20px;"></i>' +
        '<h2 style="margin-bottom:10px;">' + T('dev_paused_title', 'Το mNotes άνοιξε αλλού') + '</h2>' +
        '<p style="max-width:420px; color:#bbb; line-height:1.55; margin-bottom:8px;">' +
            T('dev_paused_body', 'Η εφαρμογή χρησιμοποιείται αυτή τη στιγμή σε άλλο ') + typeText + '.</p>' +
        '<p style="max-width:420px; color:#888; line-height:1.5; margin-bottom:28px; font-size:0.9rem;">' +
            T('dev_paused_safe', 'Τα τραγούδια σου εδώ είναι ασφαλή. Πάτα συνέχεια για να παίξεις από αυτή τη συσκευή.') + '</p>' +
        '<button onclick="reclaimDeviceSlot()" style="padding:14px 26px; background:var(--accent, #ffd166); color:#000; border:none; border-radius:10px; font-weight:bold; cursor:pointer; font-size:1.05rem;">' +
            '<i class="fas fa-play"></i> ' + T('dev_continue_here', 'Συνέχεια εδώ') + '</button>';

    blocker.style.display = 'flex';
}

function hideConcurrencyBlocker() {
    const blocker = document.getElementById('concurrencyBlocker');
    if (blocker) blocker.style.display = 'none';
}
// ===========================================================
// mNotes - DEVICE LOCK & ANTI-FRAUD SYSTEM
// Αρχείο: deviceAuth.js
// ===========================================================

const DEVICE_KEY = 'mnotes_device_id';

// 1. Εντοπισμός τύπου συσκευής (πιο αξιόπιστος έλεγχος από το πλάτος οθόνης)
function getDeviceType() {
    const isModernIPad = (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const isMobileOrTablet = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || isModernIPad;
    return isMobileOrTablet ? 'mobile' : 'desktop';
}

// 2. Ανάκτηση ή Δημιουργία Μοναδικού ID Συσκευής
function getOrCreateDeviceId() {
    let id = localStorage.getItem(DEVICE_KEY);
    if (!id) {
        // Δημιουργία τυχαίου αλφαριθμητικού (π.χ. dev_a8f9b2_171300000)
        id = 'dev_' + Math.random().toString(36).substr(2, 9) + '_' + Date.now();
        safeSetLocal(DEVICE_KEY, id);
        console.log(`🔒 [Device Auth] Δημιουργήθηκε νέο Device ID: ${id}`);
    }
    return id;
}

// 3. Εγγραφή της συσκευής & Έλεγχος Συγκρούσεων κατά την είσοδο
// --- ΑΔΕΙΑ OFFLINE ΧΡΗΣΗΣ (LEASE) ---------------------------------------
// Η άδεια είναι μια ημερομηνία λήξης που δίνει ο server ΜΑΖΙ με τη θέση.
// Ανανεώνεται ΜΟΝΟ σε όποιον κρατά τη θέση. Έτσι δύο άνθρωποι δεν μπορούν
// να έχουν ταυτόχρονα διαρκώς ανανεούμενο δικαίωμα offline χρήσης.
const LEASE_KEY = 'mnotes_lease';
const LEASE_HOURS = 24;

function readLocalLease() {
    try {
        const raw = localStorage.getItem(LEASE_KEY);
        if (!raw) return null;
        const ts = parseInt(atob(raw), 10);
        return isNaN(ts) ? null : ts;
    } catch (e) { return null; }
}

function writeLocalLease(ts) {
    try { safeSetLocal(LEASE_KEY, btoa(String(ts))); } catch (e) { /* noop */ }
}

// 3. Διεκδίκηση θέσης + έκδοση άδειας
async function registerDevice(userId) {
    if (!userId || !navigator.onLine) return;

    const deviceId = getOrCreateDeviceId();
    const deviceType = getDeviceType();
    const column = deviceType === 'mobile' ? 'active_mobile_id' : 'active_desktop_id';
    const leaseColumn = deviceType === 'mobile' ? 'mobile_lease_until' : 'desktop_lease_until';

    // 🎸 Όριο ΤΑΥΤΟΧΡΟΝΗΣ χρήσης: η τελευταία συσκευή παίρνει τη θέση αθόρυβα.
    // Καμία ερώτηση, κανένα logout, κανένα τοπικό δεδομένο δεν αγγίζεται.
    try {
        // Προτιμούμε RPC ώστε η λήξη να υπολογίζεται από το ΡΟΛΟΪ ΤΟΥ SERVER.
        let leaseUntil = null;
        try {
            const { data: rpcData, error: rpcErr } = await supabaseClient
                .rpc('claim_device_slot', { p_device_type: deviceType, p_device_id: deviceId });
            if (rpcErr) throw rpcErr;
            if (rpcData) leaseUntil = new Date(rpcData).getTime();
        } catch (rpcFail) {
            // Το RPC δεν έχει εγκατασταθεί ακόμα: fallback σε απλό update.
            console.warn("ℹ️ [Device] Χωρίς RPC, χρήση fallback για την άδεια.");
            const clientLease = new Date(Date.now() + LEASE_HOURS * 3600 * 1000).toISOString();
            const payload = {};
            payload[column] = deviceId;
            payload[leaseColumn] = clientLease;
            const { error: updErr } = await supabaseClient
                .from('profiles').update(payload).eq('id', userId);
            if (updErr) {
                // Η στήλη της άδειας μπορεί να μην υπάρχει ακόμα στη βάση.
                const fallback = {};
                fallback[column] = deviceId;
                await supabaseClient.from('profiles').update(fallback).eq('id', userId);
            }
            leaseUntil = new Date(clientLease).getTime();
        }

        if (leaseUntil) writeLocalLease(leaseUntil);
        window.offlineGraceNotified = false;
        console.log("🎧 [Device] Η συσκευή (" + deviceType + ") πήρε τη θέση. Άδεια έως " +
                    (leaseUntil ? new Date(leaseUntil).toLocaleString() : "—"));
    } catch (err) {
        console.error("❌ [Device] Σφάλμα κατά την εγγραφή της συσκευής:", err);
    }
}

// 4. Έλεγχος: offline -> άδεια · online -> ποιος κρατά τη θέση
async function checkDeviceLock(userId) {
    if (!userId) return true;

    // ---------- OFFLINE ----------
    if (!navigator.onLine) {
        const leaseUntil = readLocalLease();
        const now = Date.now();

        // Προστασία από πισωγύρισμα ρολογιού
        const lastOnline = localStorage.getItem('_sys_mt');
        if (lastOnline) {
            try {
                if (now - parseInt(atob(lastOnline), 10) < 0) {
                    showOfflineExpiredBlocker(true);
                    return false;
                }
            } catch (e) { /* noop */ }
        }

        // Χωρίς άδεια (π.χ. παλιά εγκατάσταση πριν την αναβάθμιση):
        // δίνουμε μία αυτόματη περίοδο χάριτος αντί να κλειδώσουμε τον χρήστη.
        if (!leaseUntil) {
            writeLocalLease(now + LEASE_HOURS * 3600 * 1000);
            return true;
        }

        if (now >= leaseUntil) {
            showOfflineExpiredBlocker(false);
            return false;
        }

        notifyOfflineLease(leaseUntil - now);
        return true;
    }

    // ---------- ONLINE ----------
    safeSetLocal('_sys_mt', btoa(Date.now().toString()));

    try {
        const deviceId = getOrCreateDeviceId();
        const deviceType = getDeviceType();
        const column = deviceType === 'mobile' ? 'active_mobile_id' : 'active_desktop_id';

        const { data, error } = await supabaseClient
            .from('profiles').select(column).eq('id', userId).single();
        if (error) throw error;

        const holder = data ? data[column] : null;

        if (holder && holder !== deviceId) {
            // Κάποιος άλλος κρατά τη θέση. Ήπια παύση -- ΠΟΤΕ logout, ΠΟΤΕ διαγραφή.
            // Και, κρίσιμο: ΔΕΝ ανανεώνουμε την άδεια. Το ρολόι του μη-κατόχου τρέχει.
            console.warn("⏸️ [Device] Τη θέση κρατά άλλη συσκευή. Παύση χωρίς ανανέωση άδειας.");
            hideOfflineExpiredBlocker();
            if (typeof showConcurrencyBlocker === 'function') showConcurrencyBlocker(deviceType);
        } else {
            // Κρατάμε τη θέση. Ανανεώνουμε την άδεια μόνο όταν έχει "παλιώσει"
            // (λιγότερο από μισό παράθυρο), ώστε να μη γράφουμε στη βάση συνεχώς.
            hideOfflineExpiredBlocker();
            if (typeof hideConcurrencyBlocker === 'function') hideConcurrencyBlocker();

            const currentLease = readLocalLease();
            const halfWindow = (LEASE_HOURS / 2) * 3600 * 1000;
            if (!currentLease || (currentLease - Date.now()) < halfWindow) {
                await registerDevice(userId);
            }
        }
    } catch (err) {
        // Σφάλμα δικτύου: δεν τιμωρούμε τον χρήστη.
        console.error("❌ [Device] Έλεγχος κατοχής απέτυχε:", err);
    }

    return true;
}

// --- ΕΝΗΜΕΡΩΣΗ ΧΡΗΣΤΗ ΓΙΑ ΤΗΝ ΑΔΕΙΑ ------------------------------------
function notifyOfflineLease(remainingMs) {
    const hours = Math.floor(remainingMs / 3600000);
    const T = (k, fb) => (typeof t === 'function') ? t(k, fb) : fb;

    // Κάτω από 4 ώρες: επίμονη υπενθύμιση σε κάθε έλεγχο.
    const urgent = hours < 4;
    if (!urgent && window.offlineGraceNotified) return;
    window.offlineGraceNotified = true;

    const timeStr = hours >= 1
        ? hours + ' ' + T('lease_hours', 'ώρες')
        : Math.max(1, Math.floor(remainingMs / 60000)) + ' ' + T('lease_minutes', 'λεπτά');

    showToast(
        T('lease_offline_notice', 'Παίζεις εκτός σύνδεσης. Συνδέσου μέσα στις επόμενες ')
        + timeStr +
        T('lease_offline_notice_end', ' για να συνεχίσεις να έχεις πρόσβαση.'),
        urgent ? 'warning' : 'info'
    );
}

function showOfflineExpiredBlocker(clockError) {
    let el = document.getElementById('offlineLeaseBlocker');
    if (!el) {
        el = document.createElement('div');
        el.id = 'offlineLeaseBlocker';
        el.style.cssText = 'position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.96); z-index:99998; display:flex; flex-direction:column; align-items:center; justify-content:center; color:#fff; text-align:center; padding:20px; backdrop-filter: blur(10px);';
        document.body.appendChild(el);
    }

    const T = (k, fb) => (typeof t === 'function') ? t(k, fb) : fb;
    const title = clockError
        ? T('lease_clock_title', 'Σφάλμα ρολογιού')
        : T('lease_expired_title', 'Χρειάζεται σύνδεση');
    const body = clockError
        ? T('lease_clock_body', 'Η ημερομηνία της συσκευής δεν είναι έγκυρη. Συνδέσου στο Internet για επαλήθευση.')
        : T('lease_expired_body', 'Πέρασαν 24 ώρες εκτός σύνδεσης. Συνδέσου για ένα λεπτό και συνεχίζεις κανονικά.');

    el.innerHTML =
        '<i class="fas fa-wifi" style="font-size:3.4rem; color:var(--accent, #ffd166); margin-bottom:18px;"></i>' +
        '<h2 style="margin-bottom:10px;">' + title + '</h2>' +
        '<p style="max-width:420px; color:#bbb; line-height:1.55; margin-bottom:10px;">' + body + '</p>' +
        '<p style="max-width:420px; color:#888; line-height:1.5; margin-bottom:26px; font-size:0.9rem;">' +
            T('lease_expired_safe', 'Τα τραγούδια σου παραμένουν αποθηκευμένα σε αυτή τη συσκευή.') + '</p>' +
        '<button onclick="retryLeaseCheck()" style="padding:14px 26px; background:var(--accent, #ffd166); color:#000; border:none; border-radius:10px; font-weight:bold; cursor:pointer; font-size:1.05rem;">' +
            '<i class="fas fa-sync-alt"></i> ' + T('lease_retry', 'Δοκίμασε ξανά') + '</button>';

    el.style.display = 'flex';
}

function hideOfflineExpiredBlocker() {
    const el = document.getElementById('offlineLeaseBlocker');
    if (el) el.style.display = 'none';
}

async function retryLeaseCheck() {
    if (typeof currentUser !== 'undefined' && currentUser) {
        const ok = await checkDeviceLock(currentUser.id);
        if (ok) hideOfflineExpiredBlocker();
    }
}
window.retryLeaseCheck = retryLeaseCheck;


let heartbeatInterval = null;

function startDeviceHeartbeat() {
    if (heartbeatInterval) clearInterval(heartbeatInterval);

    console.log("⏱️ [Device Auth] Έλεγχος συνδρομής / offline ενεργός.");

    const runCheck = async () => {
        if (typeof currentUser === 'undefined' || !currentUser) return;
        // Δεν τρέχουμε με την καρτέλα στο παρασκήνιο ή την οθόνη κλειστή.
        if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
        // Ελέγχει ΜΟΝΟ την περίοδο χάριτος offline. Online δεν κάνει ερώτημα στη βάση.
        await checkDeviceLock(currentUser.id);
    };

    runCheck();
    heartbeatInterval = setInterval(runCheck, 300000); // 5 λεπτά αντί για 1

    if (typeof window !== 'undefined' && !window._mnotesOnlineHooked) {
        window._mnotesOnlineHooked = true;
        // Μόλις επανέλθει το δίκτυο, έλεγξε ΑΜΕΣΩΣ ποιος κρατά τη θέση.
        window.addEventListener('online', () => { runCheck(); });
    }

    if (typeof document !== 'undefined' && !window._mnotesVisibilityHooked) {
        window._mnotesVisibilityHooked = true;
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible') runCheck();
        });
    }
}


function toggleMoreAuth() {
    const more = document.getElementById('moreAuthOptions');
    const primary = document.getElementById('authPrimaryOptions');
    const container = document.getElementById('authLastUsedContainer');
    const btn = document.getElementById('btnToggleMoreAuth');
    
    // Αν ήμασταν σε "Προτεινόμενη Μέθοδο" view (primary κρυμμένο)
    if (primary.style.display === 'none') {
        // Επαναφέρουμε την αρχική μορφή
        container.style.display = 'none';
        primary.style.display = 'block';
        btn.innerText = (typeof t === 'function' ? t('auto_msg_92', "Περισσότερες επιλογές...") : "Περισσότερες επιλογές...");
        return;
    }

    // Αλλιώς (είμαστε στο κανονικό view), κάνουμε toggle τα extra socials
    if (more.style.display === 'none') {
        more.style.display = 'flex';
        btn.innerText = (typeof t === 'function' ? t('auto_msg_91', "Λιγότερες επιλογές...") : "Λιγότερες επιλογές...");
    } else {
        more.style.display = 'none';
        btn.innerText = (typeof t === 'function' ? t('auto_msg_90', "Περισσότερες επιλογές...") : "Περισσότερες επιλογές...");
    }
}

function openAuthModal() {
    const lastAuth = localStorage.getItem('mnotes_last_auth');
    const container = document.getElementById('authLastUsedContainer');
    const btnContainer = document.getElementById('authLastUsedBtnContainer');
    const primaryOptions = document.getElementById('authPrimaryOptions');
    const moreOptions = document.getElementById('moreAuthOptions');
    const toggleBtn = document.getElementById('btnToggleMoreAuth');

    if(moreOptions) moreOptions.style.display = 'none';
    if(toggleBtn) toggleBtn.innerText = (typeof t === 'function' ? t('auto_msg_89', "Περισσότερες επιλογές...") : "Περισσότερες επιλογές...");

    if (lastAuth && lastAuth !== 'email' && container && primaryOptions && btnContainer) {
        container.style.display = 'block';
        primaryOptions.style.display = 'none';
        if(toggleBtn) toggleBtn.innerText = (typeof t === 'function' ? t('auto_msg_88', "Άλλοι τρόποι σύνδεσης") : "Άλλοι τρόποι σύνδεσης");

        let btnHtml = '';
        if (lastAuth === 'google') {
            btnHtml = `<button onclick="loginWith('google')" class="social-btn google"><img src="https://www.svgrepo.com/show/475656/google-color.svg" width="22"> Συνέχεια με Google</button>`;
        } else if (lastAuth === 'apple') {
            btnHtml = `<button onclick="loginWith('apple')" class="social-btn apple"><i class="fab fa-apple"></i> Συνέχεια με Apple</button>`;
        } else if (lastAuth === 'facebook') {
            btnHtml = `<button onclick="loginWith('facebook')" class="social-btn facebook"><i class="fab fa-facebook"></i> Συνέχεια με Facebook</button>`;
        } else if (lastAuth === 'discord') {
            btnHtml = `<button onclick="loginWith('discord')" class="social-btn discord"><i class="fab fa-discord"></i> Συνέχεια με Discord</button>`;
        }
        btnContainer.innerHTML = btnHtml;
    } else {
        if(container) container.style.display = 'none';
        if(primaryOptions) primaryOptions.style.display = 'block';
        if(btnContainer) btnContainer.innerHTML = '';
    }

    const authMod = document.getElementById('authModal'); if (authMod && authMod.parentElement !== document.body) { document.body.appendChild(authMod); } authMod.style.display = 'flex';
}
