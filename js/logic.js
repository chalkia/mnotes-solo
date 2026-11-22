/* =========================================
   CORE LOGIC & PARSING (js/logic.js) - v2.1
   ========================================= */

// 🛡️ DATA_VERSION: Αύξησε αυτό κάθε φορά που αλλάζει η λογική αποθήκευσης δεδομένων.
// Όταν αλλάξει, όλοι οι χρήστες θα κάνουν αυτόματα Full Sync από τη Supabase.
const DATA_VERSION = "2.1.6";

(function() {
    const storedDataVersion = localStorage.getItem('mnotes_data_version');
    if (storedDataVersion !== DATA_VERSION) {
        console.warn(`⚠️ [VERSION CHANGE] ${storedDataVersion} → ${DATA_VERSION}. Εκκαθάριση Delta Sync για ΟΛΑ τα contexts...`);
        // Διαγράφουμε ΜΟΝΟ τα sync timestamps — τα δεδομένα παραμένουν
        Object.keys(localStorage)
            .filter(k => k.startsWith('mnotes_last_sync_'))
            .forEach(k => localStorage.removeItem(k));
        safeSetLocal('mnotes_data_version', DATA_VERSION);
    }
async function processPendingInvites() {
    const inviteId = localStorage.getItem('mnotes_pending_invite');
    if (!inviteId) return;

    console.log(`[INVITE] Επεξεργασία πρόσκλησης: ${inviteId}`);
    try {
        // Όλα γίνονται server-side, σε ένα βήμα, από το claim_setlist_invite:
        // έλεγχος εγκυρότητας και λήξης, εύρεση της λίστας (μπάντας ή
        // προσωπικής), εγγραφή στο guest_viewers, και επιστροφή ΜΟΝΟ των
        // πεδίων στίχων. Απευθείας ανάγνωση των setlist_invites / groups /
        // profiles / songs από επισκέπτη δεν επιτρέπεται πλέον από το RLS.
        const { data, error } = await supabaseClient
            .rpc('claim_setlist_invite', { p_invite_id: inviteId });

        if (error || !data || data.length === 0) {
            console.warn("Το link πρόσκλησης δεν είναι έγκυρο ή έχει λήξει.", error);
            showToast((typeof t === 'function' ? t('auto_msg_21', "Το link πρόσκλησης δεν είναι έγκυρο ή έχει λήξει.") : "Το link πρόσκλησης δεν είναι έγκυρο ή έχει λήξει."), "error");
            localStorage.removeItem('mnotes_pending_invite');
            return;
        }

        const result = data[0];
        const fullSongs = result.songs || [];

        // Αποθήκευση στη λίστα του χρήστη
        const { data: myData } = await supabaseClient.from('profiles').select('setlists').eq('id', currentUser.id).maybeSingle();
        let mySetlists = (myData && myData.setlists) ? myData.setlists : {};

        const guestListName = `🎤 ${result.setlist_name}`;
        mySetlists[guestListName] = {
            type: 'shared',
            expires_at: result.expires_at,
            songs: fullSongs
        };

        await supabaseClient.from('profiles').update({ setlists: mySetlists }).eq('id', currentUser.id);

        let localPersonalLists = JSON.parse(localStorage.getItem('mnotes_personal_setlists') || '{}');
        localPersonalLists[guestListName] = mySetlists[guestListName];
        safeSetLocal('mnotes_personal_setlists', JSON.stringify(localPersonalLists));

        showToast(`${typeof t === 'function' ? t('auto_msg_17', "Επιτυχής προσθήκη! Έχετε πρόσβαση στη λίστα: ") : "Επιτυχής προσθήκη! Έχετε πρόσβαση στη λίστα: "}${result.setlist_name}.`, "success");
        setTimeout(() => {
            window.location.reload();
        }, 2000);
    } catch (e) {
        console.error("Σφάλμα κατά την επεξεργασία του invite:", e);
    }
    
    localStorage.removeItem('mnotes_pending_invite');
}

window.processPendingInvites = processPendingInvites;

async function processPendingJoin() {
    const code = localStorage.getItem('mnotes_pending_join');
    if (!code || typeof currentUser === 'undefined' || !currentUser) return;

    if (!navigator.onLine) {
        showToast(typeof t === 'function' ? t('msg_join_needs_online', "Χρειάζεται σύνδεση στο internet για την ένταξη στη μπάντα.") : "Χρειάζεται σύνδεση στο internet για την ένταξη στη μπάντα.", "warning");
        return;
    }

    localStorage.removeItem('mnotes_pending_join');
    const cleanCode = code.trim().toUpperCase();
    if (typeof tryJoinBandWithCode === 'function') {
        const joined = await tryJoinBandWithCode(cleanCode);
        if (!joined) {
            alert(typeof t === 'function' ? t('band_join_invalid_code', "Ο κωδικός μπάντας δεν είναι έγκυρος.") : "Ο κωδικός μπάντας δεν είναι έγκυρος.");
        }
    }
}

window.processPendingJoin = processPendingJoin;
})();

// --- Global State ---
let userProfile = null;
let lastSaveTimestamp = 0;

let myGroups = [];

/* Ξεχωριστή σημαία από το πλήθος: το myGroups.length === 0 σημαίνει ΚΑΙ
   «δεν έχω μπάντες» ΚΑΙ «δεν τις ξέρω ακόμα». Χωρίς αυτή τη διάκριση, ο
   χρήστης χωρίς καμία μπάντα θα έχανε από την οθόνη τα τραγούδια με
   πραγματικά ορφανό group_id — ακόμα και online. (09/09/2026) */
let groupsKnown = false;

/* ⚠️ function declaration ΕΠΙΤΗΔΕΣ: καλείται στη φόρτωση του αρχείου, πριν
   από το σημείο ορισμού της. Ως `const ... = () => {}` θα έριχνε TDZ
   ReferenceError και ΟΛΟ το logic.js δεν θα εκτελούνταν. Μην τη
   μετατρέψεις. (09/09/2026)

   Επιστρέφει null όταν δεν ξέρουμε, [] όταν ξέρουμε ότι δεν υπάρχουν
   μπάντες. Η διάκριση είναι το όλο νόημα. */
function loadCachedGroups() {
    try {
        const raw = localStorage.getItem('mnotes_my_groups');
        if (raw === null) return null;
        const obj = JSON.parse(raw);
        if (Array.isArray(obj)) return obj;                       // παλιό σχήμα
        return Array.isArray(obj && obj.groups) ? obj.groups : null;
    } catch (err) {
        console.warn('[GROUPS] Ανάγνωση cache απέτυχε:', err);
        return null;
    }
}

/* Τρέχει ΤΩΡΑ, στη φόρτωση του logic.js. Το appInitRestore() του app.js
   καλείται στο DOMContentLoaded και ζωγραφίζει τη βιβλιοθήκη πριν
   ολοκληρωθεί η initUserData(): αν το myGroups ήταν ακόμα κενό εκείνη τη
   στιγμή, το πρώτο render offline έδειχνε 176 τραγούδια. (09/09/2026) */
(function () {
    const cached = loadCachedGroups();
    if (cached !== null) { myGroups = cached; groupsKnown = true; }
})();
let isSyncing = false; // ΝΕΟ: Φρένο συγχρονισμού           
let isAppInitialLoad = true; // Flag: μόνο στην αρχική είσοδο/φόρτωση εμφανίζεται το sync toast
let currentGroupId = 'personal';
let currentRole = 'owner';
let lastImportedIds = new Set(); // Κρατάει τα IDs μόνο της τελευταίας εισαγωγής για τη συνεδρία
let showingOriginal = false; // False = My View (Default), True = Band View
let originalSongSnapshot = null; // Για σύγκριση αλλαγών κατά το Save
window.isBandLocked = false; // Flag για λήξη συνδρομής του Band Owner

// --- TIER SYSTEM ---
// Η λογική των Tiers και των δικαιωμάτων (canUserPerform) έχει μεταφερθεί στο js/permissions.js
// για να είναι κοινή σε όλη την εφαρμογή και το mStudio.


// Helper translation function
if (typeof window.t === 'undefined') {
    window.t = function (key, fallbackText = "") {

        if (typeof TRANSLATIONS !== 'undefined' && typeof currentLang !== 'undefined' && TRANSLATIONS[currentLang]) {
            return TRANSLATIONS[currentLang][key] || fallbackText || key;
        }
        return fallbackText || key;
    };
}
/* =========================================
   GUEST LIBRARY TRIM
   Περικόπτει τη βιβλιοθήκη στο Guest όριο και διαγράφει band data.
   Καλείται τόσο από handleLogout() όσο και από onAuthStateChange.
   ========================================= */
function trimLibraryToGuestLimit(reason = 'user') {
    // 🛡️ ΑΣΠΙΔΑ 1: Μόνο ΡΗΤΗ αποσύνδεση από τον χρήστη επιτρέπεται να αγγίξει
    // τη βιβλιοθήκη. Καμία αυτόματη διαδρομή (σύγκρουση συσκευών, λήξη session,
    // σφάλμα δικτύου) δεν σβήνει ποτέ τοπικά δεδομένα.
    if (reason !== 'user') {
        console.log("🛡️ [Data Protection] Αυτόματη αποσύνδεση (" + reason + "). Η βιβλιοθήκη ΔΕΝ αγγίζεται.");
        return;
    }

    // 🛡️ ΑΣΠΙΔΑ 2: Αν υπάρχουν αλλαγές που δεν έχουν συγχρονιστεί, δεν σβήνουμε τίποτα.
    try {
        const pendingWrites = JSON.parse(localStorage.getItem('mnotes_sync_queue') || "[]");
        if (pendingWrites.length > 0) {
            console.warn("🛡️ [Data Protection] " + pendingWrites.length + " ασυγχρόνιστες αλλαγές. Η βιβλιοθήκη ΔΕΝ διαγράφεται.");
            return;
        }
    } catch (e) { /* κατεστραμμένη ουρά: συνεχίζουμε κανονικά */ }

    // 🛡️ OFFLINE ΑΣΠΙΔΑ: Αν δεν υπάρχει ίντερνετ (άρα μάλλον είμαστε σε Live)
    // ΑΠΑΓΟΡΕΥΕΤΑΙ η διαγραφή της βιβλιοθήκης. Απλά επιστρέφουμε.
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
        console.log("🛡️ [Data Protection] Είστε Offline. Η βιβλιοθήκη ΔΕΝ θα διαγραφεί για ασφάλεια του Live.");
        return;
    }

    const guestLimit = (typeof TIER_CONFIG !== 'undefined' && TIER_CONFIG['guest'])
        ? (TIER_CONFIG['guest'].maxGuestSongs || 5) : 5;

    // 1. Περικοπή προσωπικής βιβλιοθήκης στο Guest όριο
    const existingData = localStorage.getItem('mnotes_data');
    if (existingData) {
        try {
            const allSongs = JSON.parse(existingData);
            // Αγνοούμε τα demo songs, κρατάμε μόνο τα πρώτα N πραγματικά
            const realSongs = allSongs.filter(s => !String(s.id).startsWith('demo') && (!s.user_id || s.user_id === 'guest'));
            const trimmed = realSongs.slice(0, guestLimit);
            safeSetLocal('mnotes_data', JSON.stringify(trimmed));
            console.log(`✂️ [Guest] Βιβλιοθήκη: ${realSongs.length} → ${trimmed.length} τραγούδια (όριο: ${guestLimit}).`);
        } catch (e) {
            localStorage.removeItem('mnotes_data');
        }
    }


    // 2. Διαγραφή ΟΛΩΝ των band lists και sync timestamps
    const keysToRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && (key.startsWith('mnotes_band_') || key.startsWith('mnotes_last_sync_'))) {
            keysToRemove.push(key);
        }
    }
    keysToRemove.forEach(k => localStorage.removeItem(k));
    if (keysToRemove.length > 0) {
        console.log(`🗑️ [Guest] Διαγράφηκαν ${keysToRemove.length} band keys:`, keysToRemove);
    }

    localStorage.removeItem('mnotes_last_song');
}

/* =========================================
   SESSION MANAGEMENT & LOGOUT
   ========================================= */
async function handleLogout(reason = 'user') {
    console.log("🧹 [Session] Εκκίνηση αποσύνδεσης. Υποβιβασμός σε Guest...");

    // 1. Σκουπίζουμε τη μνήμη της συνεδρίας (προφίλ cache)
    if (typeof currentUser !== 'undefined' && currentUser) {
        localStorage.removeItem(`mnotes_user_profile_${currentUser.id}`);
    }

    // 2. Περικοπή βιβλιοθήκης στο Guest όριο + διαγραφή band data
    trimLibraryToGuestLimit(reason);

    try {
        // 3. Τερματισμός συνεδρίας στο Cloud (Supabase)
        if (typeof supabaseClient !== 'undefined') {
            await supabaseClient.auth.signOut();
        }
    } catch (e) {
        console.error("❌ Σφάλμα κατά την αποσύνδεση Supabase:", e);
    }

    // 4. Επαναφόρτωση Σελίδας
    // Η getUserLimits() θα δει ότι δεν υπάρχει currentUser,
    // θα φορτώσει το TIER_CONFIG['guest'], και ο "Πορτιέρης" θα επιβάλει
    // αυτόματα το όριο των 5 τραγουδιών.
    window.location.reload();
}

/* =========================================
   USER & CONTEXT MANAGEMENT 
   ========================================= */
async function initUserData() {
    if (!currentUser) return;

    const cacheKey = `mnotes_user_profile_${currentUser.id}`;
    const cachedProfile = localStorage.getItem(cacheKey);

    if (cachedProfile) {
        try {
            userProfile = JSON.parse(cachedProfile);
            if (typeof refreshUIByTier === 'function') refreshUIByTier();
        } catch (e) {
            console.warn(t('msg_err_cache_read', "⚠️ Σφάλμα ανάγνωσης cache προφίλ"), e);
        }
    }

    try {
        const { data: profile, error: pError } = await supabaseClient
            .from('profiles').select('*').eq('id', currentUser.id).maybeSingle();

        if (pError && pError.code !== 'PGRST116') throw pError;

        let isTierChanged = false;

        if (profile) {
            let rawTier = profile.subscription_tier.toLowerCase().trim();

            const tierMap = {
                'free': 'solo_free', 'solo_free': 'solo_free',
                'solo': 'solo_plus', 'plus': 'solo_plus', 'soloplus': 'solo_plus', 'solo_plus': 'solo_plus', 'pro': 'solo_plus', 'solo_pro': 'solo_plus',
                'member': 'band_mate', 'bandmate': 'band_mate', 'band_mate': 'band_mate',
                'owner': 'band_maestro', 'leader': 'band_maestro', 'bandleader': 'band_maestro', 'band_leader': 'band_maestro',
                'maestro': 'band_maestro', 'bandmaestro': 'band_maestro', 'band_maestro': 'band_maestro',
                'ensemble': 'ensemble'
            };
            const fetchedTier = tierMap[rawTier] || 'solo_free';

            if (!userProfile || userProfile.subscription_tier !== fetchedTier) {
                isTierChanged = true;
            }
            userProfile = profile;
            userProfile.subscription_tier = fetchedTier;

            console.log("====================================");
            console.log("🕵️‍♂️ [GOD MODE DETECTOR] Ας δούμε την αλήθεια:");
            console.log("1. Το κείμενο στη Βάση Δεδομένων (profiles):", profile.subscription_tier);
            console.log("2. Πώς το 'μετέφρασε' το app (Tier Key):", fetchedTier);
            console.log("3. Τα MB που σου δίνει (getUserLimits):", typeof getUserLimits === 'function' ? getUserLimits().storageLimitMB : 'Άγνωστο');
            console.log("4. Ο Ρόλος σου (currentRole):", currentRole);
            console.log("====================================");

        } else {
            const newProfile = { id: currentUser.id, email: currentUser.email, subscription_tier: 'solo_free' };
            await supabaseClient.from('profiles').upsert([newProfile], { onConflict: 'id' });
            userProfile = newProfile;
            isTierChanged = true;
        }

        safeSetLocal(cacheKey, JSON.stringify(userProfile));

        if (isTierChanged || !cachedProfile) {
            if (typeof refreshUIByTier === 'function') refreshUIByTier();
        }

        if (typeof showToast === 'function') {
            const tierLabel = TIER_CONFIG[userProfile.subscription_tier]?.label || "User";
            showToast(t('msg_login_success', `Σύνδεση ως ${tierLabel} ✅`));
        }

        const { data: groups, error: gError } = await supabaseClient
            .from('group_members')
            .select(`group_id, role, is_banned, is_sponsored, groups (name, owner_id, plan, plan_expires_at)`)
            .eq('user_id', currentUser.id);

        /* Το myGroups ζούσε ΜΟΝΟ στη μνήμη και γέμιζε αποκλειστικά από αυτό
           το ερώτημα. Offline έμενε [], οπότε το φίλτρο της προσωπικής
           βιβλιοθήκης θεωρούσε ΚΑΘΕ group_id «ορφανό» και εμφάνιζε όλα τα
           τραγούδια της μπάντας μέσα στα προσωπικά (110 ➜ 176, με τους
           κλώνους να μοιάζουν διπλότυπα). Τώρα κρατιέται τοπικά μαζί με
           τα ονόματα των συγκροτημάτων. (08/09/2026) */
        if (gError) {
            console.error("❌ Σφάλμα κατά την ανάκτηση group_members:", gError);
            /* ΟΧΙ myGroups = []: κρατάμε ό,τι ξέρουμε από την τελευταία επιτυχή
               φόρτωση (ή από την cache). Μηδενισμός εδώ ξαναφέρνει ακριβώς τη
               βλάβη που διορθώνουμε, σε κάθε προσωρινό σφάλμα δικτύου. */
        } else {
            myGroups = groups || [];
            groupsKnown = true;
            /* Αποθηκεύεται ΟΠΩΣ ΗΡΘΕ, χωρίς απαρίθμηση πεδίων: το
               updateGroupDropdown διαβάζει g.groups?.name και η switchContext
               τα is_sponsored / is_banned. Απαρίθμηση σημαίνει ότι το επόμενο
               πεδίο που θα μπει στο select θα λείπει σιωπηλά offline.
               (09/09/2026) */
            try {
                safeSetLocal('mnotes_my_groups', JSON.stringify({ ts: Date.now(), groups: myGroups }));
            } catch (err) {
                console.warn('[GROUPS] Αποθήκευση cache απέτυχε:', err);
            }
        }

        if (typeof updateGroupDropdown === 'function') updateGroupDropdown();

        // [ΝΕΟ] Επεξεργασία τυχόν εκκρεμούς πρόσκλησης από το URL
        if (typeof processPendingInvites === 'function') await processPendingInvites();
        if (typeof processPendingJoin === 'function') await processPendingJoin();


        // Safety: Μόνο αν δεν έχουμε ήδη κάνει restore ένα Band context από το AppState,
        // τότε γυρνάμε σε personal.
        if (typeof currentGroupId === 'undefined' || !currentGroupId || currentGroupId === 'personal') {
             await switchContext('personal');
        } else {
             // Είχαμε ήδη κάνει restore ένα Band context, οπότε απλά ξαναφορτώνουμε τα δεδομένα
             // τώρα που έχουμε τα σωστά myGroups.
             await switchContext(currentGroupId);
        }

        // ==========================================
        // 🔒 [ΝΕΟ] Έναρξη του "Πορτιέρη" (Device Lock)
        // Εγγραφή της συσκευής και έναρξη ελέγχου παραβιάσεων
        // ==========================================
        if (typeof registerDevice === 'function') {
            await registerDevice(currentUser.id);
            startDeviceHeartbeat();
        }

    } catch (err) {
        console.error("❌ Critical Init Error:", err);
        if (!myGroups || myGroups.length === 0) {
            const cached = loadCachedGroups();
            if (cached !== null) { myGroups = cached; groupsKnown = true; }
        }
        if (typeof showToast === 'function') showToast(t('msg_offline_mode', "Λειτουργία Offline."), "error");
    }
}

async function switchContext(targetId) {
    console.log(`🔄 [CONTEXT] Αίτημα αλλαγής σε: ${targetId}`);

    window.isBandLocked = false; // Αρχικοποίηση σε κάθε αλλαγή
    window.activeGuestInvite = null;

    const originalTarget = targetId;

    if (targetId !== 'personal') {
        const groupData = typeof myGroups !== 'undefined' ? myGroups.find(g => g.group_id === targetId) : null;

        if (groupData) {
            const role = groupData.role;
            const isBanned = groupData.is_banned === true;

            const accessCtx = (typeof bandAccessCtx === 'function') ? bandAccessCtx(groupData) : { account: null, plan: 'band', planExpiresAt: null, role: role };
            const hasBandAccess = can('ACCESS_BAND', accessCtx);
            const planExpired = accessCtx.planExpiresAt
                              ? (new Date(accessCtx.planExpiresAt).getTime() < Date.now())
                              : false;

            if (isBanned) {
                console.log(`🚫 [BANNED] Απαγόρευση εισόδου. Ο χρήστης είναι στη Μαύρη Λίστα.`);
                if (typeof showToast === 'function') {
                    showToast(t('msg_access_denied', "Απαγόρευση Πρόσβασης: Έχετε αποβληθεί από αυτή την ομάδα."), "error");
                }
                const sel = document.getElementById('selGroup');
                if (sel) sel.value = 'personal';
                targetId = 'personal';
            } else if (!hasBandAccess) {
                // Συνεργατική μπάντα χωρίς Pro: δεν μπαίνει.
                console.log(`🔒 [NO ACCESS] Συνεργατική μπάντα, απαιτείται Pro.`);
                if (typeof showToast === 'function') {
                    showToast(t('msg_band_needs_pro', "Η μπάντα αυτή απαιτεί συνδρομή Pro."), "error");
                }
                const sel = document.getElementById('selGroup');
                if (sel) sel.value = 'personal';
                targetId = 'personal';
            } else if (planExpired) {
                // Έληξε το πλάνο: μπαίνουν όλοι, μόνο για ανάγνωση.
                console.log(`🧊 [FROZEN] Το πλάνο της μπάντας έληξε. Μόνο ανάγνωση.`);
                if (typeof showToast === 'function') {
                    showToast(t('msg_band_frozen', "Το πλάνο της μπάντας έληξε. Μόνο ανάγνωση."), "warning");
                }
                window.isBandLocked = true;
            } else {
                console.log(`✅ [ACCESS GRANTED] Είσοδος επιτράπηκε.`);
            }
        }
    }

    currentGroupId = targetId;
    if (typeof syncWorkspaceChrome === 'function') syncWorkspaceChrome();

    if (targetId === 'personal') {
        currentRole = 'owner';
        document.body.classList.remove('band-mode');
        document.body.classList.add('personal-mode');
    } else {
        const memberInfo = myGroups.find(g => g.group_id === targetId);
        currentRole = memberInfo ? memberInfo.role : 'member';
        document.body.classList.remove('personal-mode');
        document.body.classList.add('band-mode');
    }

    if (typeof initSetlists === 'function') await initSetlists();

    await loadContextData();
    if (typeof currentSongId !== 'undefined' && currentSongId) {
        const existsInCtx = Array.isArray(library) && library.some(s => s && s.id === currentSongId);
        if (!existsInCtx) {
            currentSongId = null;
            window.currentSongId = null;
        }
    }
    updateUIForRole();
    
    // Ανανέωση του Sidebar Tab (Library/Setlist) για το νέο context
    if (typeof switchSidebarTab === 'function') switchSidebarTab(viewMode || 'library');

    if (typeof updateBandHubUI === 'function') {
        updateBandHubUI();
    }

    // 💾 Αποθήκευση κατάστασης (Persistence)
    saveAppState(targetId);
}




function updateUIForRole() {
    const btnDel = document.getElementById('btnDelSetlist');
    const btnAdd = document.getElementById('btnAddSong');
    const btnTabLibrary = document.getElementById('tab-library');

    const isLeader = roleCan('EDIT_BAND_MASTER');
    const isRestricted = roleCan('RESTRICTED_TO_READING');

    // Αν η μπάντα είναι κλειδωμένη λόγω λήξης συνδρομής, 
    // ο Owner συμπεριφέρεται σαν Viewer όσον αφορά την επεξεργασία.
    const restrictEditing = isRestricted || window.isBandLocked;

    if (restrictEditing) {
        if (btnTabLibrary) btnTabLibrary.style.display = 'none';
        if (typeof switchSidebarTab === 'function') switchSidebarTab('setlist');
    } else {
        if (btnTabLibrary) btnTabLibrary.style.display = 'inline-block';
    }

    const isStrictViewer = isRestricted && (typeof userLimits !== 'undefined' && userLimits.tierKey === 'solo_free');
    
    if (isStrictViewer) {
        if (typeof isLyricsMode !== 'undefined' && !isLyricsMode) {
            if (typeof toggleLyricsMode === 'function') toggleLyricsMode();
        }
        const btnLyricsToggle = document.querySelector('button[onclick="toggleLyricsMode()"]');
        if (btnLyricsToggle) btnLyricsToggle.style.display = 'none';
    } else {
        const btnLyricsToggle = document.querySelector('button[onclick="toggleLyricsMode()"]');
        if (btnLyricsToggle) btnLyricsToggle.style.display = '';
    }

    if (btnDel) {
        if (currentGroupId === 'personal' || (isLeader && !window.isBandLocked)) {
            btnDel.style.display = 'inline-block';
        } else {
            btnDel.style.display = 'none';
        }
    }

    if (btnAdd) {
        if (currentGroupId === 'personal') {
            btnAdd.style.display = '';
        } else {
            btnAdd.style.display = 'none';
        }
    }

    if (typeof refreshHeaderUI === 'function') refreshHeaderUI();

    if (typeof updateBandHubUI === 'function') {
        updateBandHubUI();
    }
}

/* =========================================
   DATA LOADING & SYNC 
   ========================================= */

/**
 * Γράφει στην τοπική cache ΜΟΝΟ τα τραγούδια που ανήκουν στο τρέχον context.
 *
 * ⚠️ ΣΤΗ ΜΠΑΝΤΑ Η window.library ΕΙΝΑΙ ΥΒΡΙΔΙΚΗ: κρατάει τα τραγούδια της
 * μπάντας ΚΑΙ τους προσωπικούς κλώνους (Hybrid View). Γράφοντάς τη ολόκληρη
 * στο mnotes_band_<id>, τα προσωπικά τραγούδια κατέληγαν στην cache της
 * μπάντας. Στις 04/09 η cache της μπάντας είχε 187 εγγραφές ενώ η μπάντα
 * είχε 70 — κάθε φόρτωση επέβαλλε Full Sync και ξαναέγραφε τα πάντα.
 *
 * ΚΑΜΙΑ εγγραφή στην cache χωρίς αυτή τη συνάρτηση.
 */
window.persistContextLibrary = function (list) {
    const src = Array.isArray(list) ? list : (window.library || []);
    if (currentGroupId === 'personal') {
        safeSetLocal('mnotes_data', JSON.stringify(src.filter(s => s && !s.group_id)));
        return;
    }
    safeSetLocal('mnotes_band_' + currentGroupId,
        JSON.stringify(src.filter(s => s && s.group_id === currentGroupId)));
};

async function fetchPrivateSongs(lastSyncISO) {
    console.log(`📥 [FETCH] Ανάκτηση Προσωπικής Βιβλιοθήκης... ${lastSyncISO ? '(Μόνο Αλλαγές)' : '(Πλήρης)'}`);

    let query = supabaseClient
        .from('songs')
        .select('id, group_id, user_id, title, artist, updated_at, recordings, attachments, body, key, intro, interlude, notes, video, tags, parent_id, is_clone, is_deleted, conductor_notes, rhythms, migrated_from, capo, capo_print')
        .eq('user_id', currentUser.id);
        // 🚀 ΑΦΑΙΡΕΣΗ ΠΕΡΙΟΡΙΣΜΟΥ: Επιτρέπουμε την ανάκτηση όλων των τραγουδιών του χρήστη, 
        // ακόμα και αν έχουν group_id, για να αποφύγουμε το "κόψιμο" λόγω ορφανών IDs.

    if (lastSyncISO) {
        query = query.gt('updated_at', lastSyncISO);
    }

    const { data, error } = await query;

    if (error) {
        console.error("❌ [FETCH ERROR]:", error);
        return [];
    }

    return data.map(s => ensureSongStructure(s));
}

async function fetchBandSongs(groupId, lastSyncISO) {
    console.log(`📥 [FETCH] Ανάκτηση τραγουδιών μπάντας: ${groupId} ${lastSyncISO ? '(Μόνο Αλλαγές)' : '(Πλήρης)'}`);

    let query = supabaseClient
        .from('songs')
        .select('id, group_id, user_id, title, artist, updated_at, recordings, attachments, body, key, intro, interlude, notes, video, tags, parent_id, is_clone, is_deleted, conductor_notes, rhythms, migrated_from, capo, capo_print')
        .eq('group_id', groupId)
        .order('title', { ascending: true });

    if (lastSyncISO) {
        query = query.gt('updated_at', lastSyncISO);
    }

    const { data, error } = await query;

    if (error) {
        console.error("❌ Error fetching band songs:", error);
        return [];
    }

    const filteredData = data.filter(s => {
        if (!s.is_clone) return true;
        if (s.is_clone && s.user_id === currentUser.id) return true;
        return false;
    });

    return filteredData.map(s => ensureSongStructure(s));
}

async function loadContextData(options = {}) {
    if (isSyncing) {
        console.warn("⏳ [SYNC] Ήδη σε εξέλιξη. Ακύρωση διπλής κλήσης.");
        return;
    }
    isSyncing = true;
    console.log(`🔍 [SYNC] Εκκίνηση Delta Sync για Context: ${currentGroupId}`);
    const listEl = document.getElementById('songList');

    const shouldShowSyncToast = (typeof options === 'object' && options !== null && options.showToast !== undefined)
        ? !!options.showToast
        : isAppInitialLoad;

    const isForceSyncing = (() => { try { return sessionStorage.getItem('mnotes_force_syncing') === '1'; } catch (e) { return false; } })();
    if ((shouldShowSyncToast || isForceSyncing) && typeof showLoader === 'function') {
        showLoader('syncing_data', t('msg_syncing', 'Συγχρονισμός...'));
    }

    try {
        // ==========================================================
        // 🚀 [ΝΕΟ] ΜΗΧΑΝΙΣΜΟΣ ΥΙΟΘΕΣΙΑΣ "ΟΡΦΑΝΩΝ" (GUEST) ΤΡΑΓΟΥΔΙΩΝ
        // ==========================================================
        if (typeof currentUser !== 'undefined' && currentUser && currentGroupId === 'personal' && navigator.onLine
            && typeof canUserPerform === 'function' && canUserPerform('USE_SUPABASE')) {
            let tempLocalRaw = localStorage.getItem('mnotes_data');
            if (tempLocalRaw) {
                let localLibrary = JSON.parse(tempLocalRaw);

                // Βρίσκουμε τραγούδια που: ΔΕΝ είναι demo ΚΑΙ (δεν έχουν user_id Ή έχουν λάθος/παλιό)
                let orphans = localLibrary.filter(s =>
                    !String(s.id).includes('demo') &&
                    (!s.user_id || s.user_id === 'guest')
                );

                if (orphans.length > 0) {
                    console.log(`🎵 [Adoption] Βρέθηκαν ${orphans.length} "ορφανά" τραγούδια. Γίνεται αφομοίωση...`);

                    // Τους βάζουμε το ID του συνδεδεμένου χρήστη
                    orphans.forEach(s => {
                        s.user_id = currentUser.id;
                        s.updated_at = new Date().toISOString();
                    });

                    // Ενημερώνουμε την τοπική μνήμη πριν την διαβάσει ο κώδικας παρακάτω
                    safeSetLocal('mnotes_data', JSON.stringify(localLibrary));

                    // Τα "σπρώχνουμε" όλα στο Supabase
                    if (typeof supabaseClient !== 'undefined') {
                        const payloads = orphans.map(s => window.sanitizeForDatabase(s, currentUser.id, null));
                        await supabaseClient.from('songs').upsert(payloads);
                    }

                    if (typeof showToast === 'function') {
                        showToast(t('msg_guest_songs_saved', "Τα τραγούδια που προσθέσατε ως επισκέπτης αποθηκεύτηκαν στο λογαριασμό σας! ☁️"), "success");
                    }
                }
            }
        }
        // ==========================================================

        let currentLibrary = [];
        let allLocalSongs = [];  // 🛡️ ΑΦΙΛΤΡΑΡΙΣΤΟ σύνολο - η πηγή αλήθειας για το localStorage
        let storageKey = currentGroupId === 'personal' ? 'mnotes_data' : `mnotes_band_${currentGroupId}`;
        let syncTimeKey = `mnotes_last_sync_${currentGroupId}`;

        const localDataRaw = localStorage.getItem(storageKey);
        if (localDataRaw) {
            allLocalSongs = JSON.parse(localDataRaw).map(ensureSongStructure);

            // Το φιλτράρισμα γίνεται ΜΟΝΟ για το UI - ΔΕΝ πειράζει το allLocalSongs
            // Η λογική "τι εμφανίζεται" ανήκει εξ ολοκλήρου στο renderSidebar (library.js)
            currentLibrary = allLocalSongs;
            
            // 🚀 ΑΜΕΣΗ ΕΝΗΜΕΡΩΣΗ UI από το Cache (πριν το Sync)
            window.library = currentLibrary;
            library = window.library;
            if (typeof applySortAndRender === 'function') applySortAndRender();
            else if (typeof renderSidebar === 'function') renderSidebar();
            // Το dropdown ετικετών χτίζεται από τη library. Χωρίς αυτό κρατούσε
            // ό,τι είχε η αρχικοποίηση, πριν φτάσουν τα τραγούδια (02/09).
            if (typeof populateTags === 'function') populateTags();
        }

        if (navigator.onLine && typeof canUserPerform === 'function' && canUserPerform('USE_SUPABASE')) {
            if (typeof processSyncQueue === 'function') await processSyncQueue();

            // 🛡️ [V2.4.2] FULL SYNC SAFETY NET (SMART SYNC):
            // Αντί να ελέγχουμε απλά αν τα τραγούδια είναι < 20, συγκρίνουμε το πραγματικό πλήθος
            // του Supabase με την τοπική μνήμη. Αν δεν ταιριάζουν, κάνουμε αναγκαστικό Full Sync.
            let forceFullSyncFlag = false;

            if (currentLibrary.length < 20) {
                forceFullSyncFlag = true;
            } else if (typeof currentUser !== 'undefined' && currentUser) {
                try {
                    let countQuery = supabaseClient.from('songs').select('*', { count: 'exact', head: true })
                                                   .or('is_deleted.is.null,is_deleted.eq.false'); // Ασφαλής καταμέτρηση μόνο ενεργών!
                    
                    if (currentGroupId === 'personal') {
                        countQuery = countQuery.eq('user_id', currentUser.id);
                    } else {
                        countQuery = countQuery.eq('group_id', currentGroupId);
                    }
                    
                    const { count, error: countErr } = await countQuery;
                    if (!countErr && count !== null) {
                        // 🛡️ Συμμετρικός υπολογισμός: μετράμε τοπικά μόνο ενεργά (χωρίς demo & διεγραμμένα)
                        const localActiveCount = currentLibrary.filter(s =>
                            !s.is_deleted &&
                            (!s.id || !String(s.id).includes('demo'))
                        ).length;

                        if (localActiveCount !== count) {
                            console.warn(`⚠️ [SYNC] Ασυμφωνία πλήθους! Τοπικά: ${localActiveCount}, Supabase: ${count}. Εξαναγκασμός Full Sync...`);
                            forceFullSyncFlag = true;
                        }
                    }
                } catch (e) {
                    console.error("❌ [SYNC] Έλεγχος πλήθους απέτυχε:", e);
                }
            }

            if (forceFullSyncFlag) {
                console.warn(`⚠️ [SYNC] Εκκίνηση Πλήρους Συγχρονισμού (Full Sync)...`);
                localStorage.removeItem(syncTimeKey);
            }

            const lastSyncISO = localStorage.getItem(syncTimeKey) || null;
            const syncAttemptTime = new Date().toISOString();

            if (currentGroupId === 'personal') {
                const cloudDeltas = await fetchPrivateSongs(lastSyncISO);

                if (cloudDeltas.length > 0) {
                    console.log(`🔄 [SYNC] Βρέθηκαν ${cloudDeltas.length} αλλαγές στην Προσωπική Βιβλιοθήκη.`);
                    // 🛡️ Χτίζουμε τον χάρτη από το ΑΦΙΛΤΡΑΡΙΣΤΟ σύνολο
                    const localMap = new Map(allLocalSongs.map(s => [s.id, s]));

                    for (const cloudSong of cloudDeltas) {
                        if (cloudSong.is_deleted) {
                            localMap.delete(cloudSong.id);
                        } else {
                            const localSong = localMap.get(cloudSong.id);
                            if (!localSong || new Date(cloudSong.updated_at).getTime() > new Date(localSong.updated_at || 0).getTime()) {
                                localMap.set(cloudSong.id, cloudSong);
                            } else if (localSong && new Date(localSong.updated_at).getTime() > new Date(cloudSong.updated_at).getTime()) {
                                await supabaseClient.from('songs').upsert(window.sanitizeForDatabase(localSong, currentUser.id, null));
                            }
                        }
                    }
                    // Το currentLibrary (και allLocalSongs) παίρνει ΟΛΑ τα merged
                    allLocalSongs = Array.from(localMap.values());
                    currentLibrary = allLocalSongs;
                }

            } else {
                const cloudDeltas = await fetchBandSongs(currentGroupId, lastSyncISO);

                const { data: overrides } = await supabaseClient
                    .from('personal_overrides')
                    .select('*')
                    .eq('user_id', currentUser.id)
                    .eq('group_id', currentGroupId);

                if (cloudDeltas.length > 0) {
                    console.log(`🔄 [SYNC] Βρέθηκαν ${cloudDeltas.length} αλλαγές στη Μπάντα.`);
                    const localMap = new Map(currentLibrary.map(s => [s.id, s]));
                    let myPersonalData = JSON.parse(localStorage.getItem('mnotes_data') || "[]");
                    let personalDataChanged = false;

                    for (const cloudSong of cloudDeltas) {
                        if (cloudSong.is_deleted) {
                            // 🗑️ Διεγραμμένο τραγούδι: ρώτα για κλώνους ΜΟΝΟ αν υπήρχε τοπικά
                            if (!String(cloudSong.id).startsWith('demo') && localMap.has(cloudSong.id)) {
                                let existingClone = myPersonalData.find(s => s.parent_id === cloudSong.id);
                                let existingIndependent = myPersonalData.find(s => s.title === cloudSong.title && s.parent_id !== cloudSong.id);

                                if (existingClone) {
                                    if (await mConfirm(t('msg_master_deleted_clone', `📢 Η μπάντα διέγραψε το "${cloudSong.title}".\nΈχεις ήδη έναν Κλώνο στα Προσωπικά σου.\nΘέλεις να τον ενημερώσεις με την τελευταία έκδοση;`))) {
                                        existingClone.body = cloudSong.body;
                                        existingClone.key = cloudSong.key;
                                        existingClone.updated_at = new Date().toISOString();
                                        personalDataChanged = true;
                                        await supabaseClient.from('songs').upsert(window.sanitizeForDatabase(existingClone, currentUser.id, null));
                                    }
                                } else if (existingIndependent) {
                                    if (await mConfirm(t('msg_master_deleted_indep', `📢 Η μπάντα διέγραψε το "${cloudSong.title}".\nΒρέθηκε ίδιο στα Προσωπικά. Να αντικατασταθούν οι στίχοι σου;`))) {
                                        existingIndependent.body = cloudSong.body;
                                        existingIndependent.key = cloudSong.key;
                                        existingIndependent.updated_at = new Date().toISOString();
                                        personalDataChanged = true;
                                        await supabaseClient.from('songs').upsert(window.sanitizeForDatabase(existingIndependent, currentUser.id, null));
                                    }
                                } else {
                                    if (await mConfirm(t('msg_master_deleted_keep', `📢 Διεγράφη το "${cloudSong.title}". Θέλετε να κρατήσετε ένα προσωπικό αντίγραφο;`))) {
                                        const personalCopy = {
                                            ...cloudSong,
                                            id: "s_" + Date.now() + "_" + Math.random().toString(36).substring(2,7),
                                            group_id: null,
                                            user_id: currentUser.id,
                                            is_clone: true,
                                            parent_id: cloudSong.id,
                                            conductorNotes: "",
                                            is_deleted: false,
                                            updated_at: new Date().toISOString()
                                        };
                                        myPersonalData.push(personalCopy);
                                        personalDataChanged = true;
                                        await supabaseClient.from('songs').insert([window.sanitizeForDatabase(personalCopy, currentUser.id, null)]);
                                    }
                                }
                            }
                            // ✅ Αφαίρεση από τον χάρτη — ΔΕΝ ξαναπροστίθεται
                            localMap.delete(cloudSong.id);

                        } else {
                            // ✅ Μη-διεγραμμένο τραγούδι: ενημέρωσε τον χάρτη με την cloud έκδοση
                            localMap.set(cloudSong.id, cloudSong);

                            // Ενημέρωση Κλώνων αν το Master είναι νεότερο
                            if (!String(cloudSong.id).startsWith('demo')) {
                                let existingClone = myPersonalData.find(s => s.parent_id === cloudSong.id);
                                if (existingClone) {
                                    const masterTime = new Date(cloudSong.updated_at || 0).getTime();
                                    const cloneTime  = new Date(existingClone.updated_at || 0).getTime();

                                    if (masterTime > cloneTime) {
                                        // 🔍 diverged_at: έχει ήδη απορρίψει αυτή την έκδοση;
                                        const myOverride = overrides?.find(o => o.song_id === cloudSong.id);
                                        const divergedAt = myOverride?.diverged_at
                                            ? new Date(myOverride.diverged_at).getTime() : 0;

                                        if (divergedAt >= masterTime) {
                                            // ✅ Ήδη απέρριψε — badge μόνο, χωρίς prompt
                                            if (!existingClone._diverged_bands) existingClone._diverged_bands = [];
                                            if (!existingClone._diverged_bands.includes(currentGroupId))
                                                existingClone._diverged_bands.push(currentGroupId);
                                        } else {
                                            // 🆕 Νέα αλλαγή — diff prompt
                                            const diffMsg = `📢 Το τραγούδι "${cloudSong.title}" ενημερώθηκε από τη μπάντα.\nΈχετε παλαιότερο προσωπικό κλώνο.\n\nΑριστερά: ο κλώνος σας\nΔεξιά: η νέα έκδοση της μπάντας`;
                                            const updateClone = await promptSongDiff(existingClone, cloudSong, diffMsg);
                                            if (updateClone) {
                                                // ΑΠΟΔΟΧΗ: ενημέρωση + καθαρισμός diverged_at
                                                existingClone.body       = cloudSong.body;
                                                existingClone.key        = cloudSong.key;
                                                existingClone.intro      = cloudSong.intro;
                                                existingClone.interlude  = cloudSong.interlude;
                                                existingClone.updated_at = new Date().toISOString();
                                                existingClone._diverged_bands = (existingClone._diverged_bands || [])
                                                    .filter(g => g !== currentGroupId);
                                                personalDataChanged = true;
                                                if (navigator.onLine && typeof supabaseClient !== 'undefined') {
                                                    await supabaseClient.from('songs')
                                                        .upsert(window.sanitizeForDatabase(existingClone, currentUser.id, null));
                                                    if (myOverride?.id) {
                                                        await supabaseClient.from('personal_overrides')
                                                            .update({ diverged_at: null }).eq('id', myOverride.id);
                                                    }
                                                }
                                            } else {
                                                // ΑΠΟΡΡΙΨΗ: badge + εγγραφή diverged_at
                                                if (!existingClone._diverged_bands) existingClone._diverged_bands = [];
                                                if (!existingClone._diverged_bands.includes(currentGroupId))
                                                    existingClone._diverged_bands.push(currentGroupId);
                                                if (navigator.onLine && typeof supabaseClient !== 'undefined') {
                                                    await supabaseClient.from('personal_overrides').upsert({
                                                        user_id:     currentUser.id,
                                                        song_id:     cloudSong.id,
                                                        group_id:    currentGroupId,
                                                        diverged_at: new Date().toISOString()
                                                    }, { onConflict: 'user_id, song_id, group_id' });
                                                }
                                            }
                                        }
                                    }
                                }
                            }

                        }
                    }
                    currentLibrary = Array.from(localMap.values());
                    allLocalSongs = currentLibrary; // 🚀 FIX: Ensure we save the fetched songs to localStorage
                    if (personalDataChanged) safeSetLocal('mnotes_data', JSON.stringify(myPersonalData));
                }

                currentLibrary = currentLibrary.map(song => {
                    const userOverride = overrides?.find(o => o.song_id === song.id);
                    if (userOverride) {
                        song.personal_notes = userOverride.personal_notes || userOverride.notes || "";
                        song.personal_transpose = userOverride.local_transpose || 0;
                        song.personal_capo = userOverride.local_capo || 0;
                        
                        // ✅ Merge ή Override συνδέσεων: Αν υπάρχει override, το προτιμάμε
                        if (userOverride.recordings && userOverride.recordings.length > 0) song.recordings = userOverride.recordings;
                        if (userOverride.attachments && userOverride.attachments.length > 0) song.attachments = userOverride.attachments;
                        if (userOverride.rhythms && userOverride.rhythms.length > 0) song.rhythms = userOverride.rhythms;
                        
                        song.has_override = true;
                    }
                    return song;
                });
            }

            safeSetLocal(syncTimeKey, syncAttemptTime);
        }

        // 🛡️ Safety net: αφαίρεση διπλότυπων βάσει id (κρατάμε το πιο πρόσφατο)
        const dedupMap = new Map();
        for (const song of currentLibrary) {
            const existing = dedupMap.get(song.id);
            if (!existing || new Date(song.updated_at || 0) > new Date(existing.updated_at || 0)) {
                dedupMap.set(song.id, song);
            }
        }
        currentLibrary = Array.from(dedupMap.values());

        // 🏷️ DIVERGED BADGE: Φόρτωση απορρίψεων από personal_overrides (για personal context)
        // Ώστε το badge ⚠️ να εμφανίζεται ακόμα κι αν ο χρήστης δεν έχει επισκεφτεί μπάντα
        if (currentGroupId === 'personal' && currentUser && navigator.onLine && typeof supabaseClient !== 'undefined') {
            try {
                const { data: divergedRows } = await supabaseClient
                    .from('personal_overrides')
                    .select('song_id, group_id, diverged_at')
                    .eq('user_id', currentUser.id)
                    .not('diverged_at', 'is', null);

                if (divergedRows && divergedRows.length > 0) {
                    // song_id στο personal_overrides = το band song id = parent_id του κλώνου
                    const divergedBySongId = {};
                    for (const row of divergedRows) {
                        if (!divergedBySongId[row.song_id]) divergedBySongId[row.song_id] = [];
                        divergedBySongId[row.song_id].push(row.group_id);
                    }
                    currentLibrary = currentLibrary.map(song => {
                        const bands = divergedBySongId[song.parent_id];
                        if (bands && bands.length > 0) song._diverged_bands = bands;
                        return song;
                    });
                }
            } catch (e) {
                console.warn('[DIVERGED BADGE] Fetch error:', e);
            }
        }

        // 🌟 ΥΒΡΙΔΙΚΗ ΠΡΟΒΟΛΗ (HYBRID VIEW): Αν είμαστε σε μπάντα, προσθέτουμε και τους

        // αυστηρά προσωπικούς κλώνους που ανήκουν στα τραγούδια αυτής της μπάντας.
        if (currentGroupId !== 'personal') {
            try {
                const personalDataRaw = localStorage.getItem('mnotes_data');
                if (personalDataRaw) {
                    const myPersonalSongs = JSON.parse(personalDataRaw);
                    const bandMasterIds = new Set(currentLibrary.map(s => s.id));

                    // Βρίσκουμε τους κλώνους που έχουμε στα Προσωπικά και έχουν parent_id 
                    // που ανήκει στη λίστα των τραγουδιών της μπάντας.
                    const myBandClones = myPersonalSongs.filter(s =>
                        !s.group_id && s.parent_id && bandMasterIds.has(s.parent_id)
                    ).map(ensureSongStructure);

                    if (myBandClones.length > 0) {
                        currentLibrary = currentLibrary.concat(myBandClones);
                        console.log(`[HYBRID VIEW] Προστέθηκαν ${myBandClones.length} προσωπικοί κλώνοι στην προβολή της μπάντας.`);
                    }
                }
            } catch (err) {
                console.error("Hybrid View Error:", err);
            }
        }

        // ΕΔΩ ΔΕΝ κάνουμε setItem στο mnotes_band_xx με τους κλώνους μέσα! 
        // Το localStorage της μπάντας πρέπει να έχει μόνο τα τραγούδια της μπάντας.
        // 🛡️ ROOT CAUSE FIX: Αποθηκεύουμε ΠΑΝΤΑ το αφιλτράριστο σύνολο.
        // Το φιλτράρισμα για την οθόνη γίνεται ΜΟΝΟ στο renderSidebar (library.js).
        // Ποτέ ξανά δεν κόβουμε δεδομένα κατά την αποθήκευση!
        const libraryToSave = currentGroupId === 'personal'
            ? allLocalSongs
            : allLocalSongs.filter(s => s.group_id === currentGroupId);

        safeSetLocal(storageKey, JSON.stringify(libraryToSave));

        window.library = currentLibrary; // Όμως η μνήμη της εφαρμογής θα έχει το Hybrid Array για το UI!
        library = window.library;

        if (typeof applySortAndRender === 'function') {
            applySortAndRender();
        } else if (typeof renderSidebar === 'function') {
            renderSidebar();
        }

        // Οι ετικέτες ξαναχτίζονται ΚΑΘΕ φορά που αλλάζει η library — αλλιώς
        // το φίλτρο δείχνει τις ετικέτες του προηγούμενου περιβάλλοντος, ή
        // καμία αν ο συγχρονισμός έφερε τα τραγούδια μετά την αρχικοποίηση.
        if (typeof populateTags === 'function') populateTags();

        if (library.length > 0) {
            const viewState = localStorage.getItem('mnotes_view_state');
            
            const songStillExists = currentSongId ? library.find(s => s.id === currentSongId) : null;
            if (!songStillExists && viewState !== 'editor') {
                currentSongId = library[0].id;
            }
            
            // Μην πετάς τον χρήστη έξω από τον Editor αν είχε μείνει εκεί!
            if (viewState !== 'editor') {
                if (window.innerWidth > 1024) {
                    if (typeof toViewer === 'function') toViewer(true);
                } else {
                    if (typeof switchDrawerTab === 'function') {
                        switchDrawerTab('library');
                    } else {
                        const sidebar = document.getElementById('sidebar');
                        if (sidebar) sidebar.classList.add('active');
                    }
                }
            } else {
                // Αν ήταν στον editor, βεβαιώσου ότι είναι ανοιχτός (σε περίπτωση που το timeout του app.js άργησε)
                if (typeof switchToEditor === 'function') switchToEditor();
            }
        }
        if (typeof window.checkDataIntegrity === 'function') window.checkDataIntegrity();
        if (typeof checkMailbox === 'function') checkMailbox();

    } catch (err) {
        console.error("❌ [SYNC FATAL ERROR]:", err);
    } finally {
        setTimeout(() => { isSyncing = false; }, 500);
        isAppInitialLoad = false;
        try { sessionStorage.removeItem('mnotes_force_syncing'); } catch (e) {}
        if (typeof hideLoader === 'function') hideLoader();
    }
}

// ==========================================
// IMPORT ΛΕΙΤΟΥΡΓΙΑ 
// ==========================================

// -----------------------------------------------------------
// ΝΕΟ: Εμφάνιση Παραθύρου Σύγκρισης (Preview Diff Modal)
// -----------------------------------------------------------
function promptSongDiff(localSong, newSong, message) {
    return new Promise((resolve) => {
        const modal = document.getElementById('diffModal');
        if (!modal) {
            mConfirm(message).then(resolve);
            return;
        }

        document.getElementById('diffMessage').innerText = message;

        const localTimeStr = localSong.updated_at ? new Date(localSong.updated_at).toLocaleString() : 'Άγνωστο';
        const newTimeStr = newSong.updated_at ? new Date(newSong.updated_at).toLocaleString() : 'Άγνωστο';

        document.getElementById('diffLocalTime').innerText = localTimeStr;
        document.getElementById('diffNewTime').innerText = newTimeStr;

        if (typeof window.renderArea === 'function') {
            window.renderArea('diffLocalBody', localSong.body || "");
            window.renderArea('diffNewBody', newSong.body || "");
        } else {
            document.getElementById('diffLocalBody').innerText = localSong.body || "";
            document.getElementById('diffNewBody').innerText = newSong.body || "";
        }

        modal.style.display = 'flex';

        const btnSkip = document.getElementById('btnDiffSkip');
        const btnReplace = document.getElementById('btnDiffReplace');

        const cleanup = () => {
            modal.style.display = 'none';
            btnSkip.removeEventListener('click', onSkip);
            btnReplace.removeEventListener('click', onReplace);
        };

        const onSkip = () => { cleanup(); resolve(false); };
        const onReplace = () => { cleanup(); resolve(true); };

        btnSkip.addEventListener('click', onSkip);
        btnReplace.addEventListener('click', onReplace);

        // Αρχικοποίηση tabs σε mobile: πάντα ξεκινάμε από το "Μπάντα"
        diffShowTab('local', document.querySelector('#diffModal .diff-tab'));
    });
}

// 📱 Tab switcher για το diff modal σε mobile
window.diffShowTab = function(which, clickedTab) {
    const localPanel = document.getElementById('diffPanelLocal');
    const newPanel   = document.getElementById('diffPanelNew');
    if (!localPanel || !newPanel) return;

    // Ενεργοποίηση σωστού panel
    localPanel.classList.toggle('diff-panel-visible', which === 'local');
    newPanel.classList.toggle('diff-panel-visible',   which === 'new');

    // Ενεργοποίηση tab button
    const allTabs = document.querySelectorAll('#diffModal .diff-tab');
    allTabs.forEach(t => t.classList.remove('active'));
    if (clickedTab) clickedTab.classList.add('active');
};

function promptTransferConflict(songTitle, targetWorkspaceName, isToBand) {
    return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        overlay.id = 'transferConflictModal';
        overlay.style.cssText = 'position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.85); display:flex; align-items:center; justify-content:center; z-index:7000; backdrop-filter: blur(4px);';
        
        const cloneLabel = isToBand ? "Αποθήκευση ως Νέα Έκδοση Μπάντας" : "Αποθήκευση ως Κλώνος";
        const cloneDesc = isToBand ? "Σύνδεση ως υπο-έκδοση του υπάρχοντος τραγουδιού της μπάντας." : "Δημιουργία νέας προσωπικής εκδοχής συνδεδεμένης με το υπάρχον τραγούδι.";
        
        overlay.innerHTML = `${typeof t === 'function' ? t('auto_msg_16', "\n            <div style=\"background:var(--bg-panel); padding:30px; border-radius:16px; width:360px; text-align:center; border: 1px solid var(--border-color); box-shadow: 0 10px 40px rgba(0,0,0,0.5); box-sizing: border-box;\">\n                <i class=\"fas fa-exclamation-triangle\" style=\"font-size:2.5rem; color:#f59e0b; margin-bottom:15px;\"></i>\n                <h3 style=\"margin-top:0; color:var(--text-main); font-size:1.3rem;\">Το τραγούδι υπάρχει ήδη!</h3>\n                <p style=\"font-size:0.9rem; color:var(--text-muted); margin-bottom:20px; line-height:1.4;\">\n                    Το τραγούδι <b style=\"color:var(--text-main)\">\"") : "\n            <div style=\"background:var(--bg-panel); padding:30px; border-radius:16px; width:360px; text-align:center; border: 1px solid var(--border-color); box-shadow: 0 10px 40px rgba(0,0,0,0.5); box-sizing: border-box;\">\n                <i class=\"fas fa-exclamation-triangle\" style=\"font-size:2.5rem; color:#f59e0b; margin-bottom:15px;\"></i>\n                <h3 style=\"margin-top:0; color:var(--text-main); font-size:1.3rem;\">Το τραγούδι υπάρχει ήδη!</h3>\n                <p style=\"font-size:0.9rem; color:var(--text-muted); margin-bottom:20px; line-height:1.4;\">\n                    Το τραγούδι <b style=\"color:var(--text-main)\">\""}${songTitle}${typeof t === 'function' ? t('auto_msg_15', "\"</b> υπάρχει ήδη στο περιβάλλον προορισμού (<span style=\"color:var(--accent)\">") : "\"</b> υπάρχει ήδη στο περιβάλλον προορισμού (<span style=\"color:var(--accent)\">"}${targetWorkspaceName}${typeof t === 'function' ? t('auto_msg_14', "</span>).\n                </p>\n                \n                <button id=\"btn-replace\" style=\"display:flex; flex-direction:column; align-items:flex-start; gap:4px; width:100%; margin-bottom:12px; padding:12px; background:var(--accent); color:#000; font-weight:bold; border:none; border-radius:10px; cursor:pointer;\">\n                    <span style=\"font-size:0.95rem;\"><i class=\"fas fa-exchange-alt\"></i> Αντικατάσταση υπάρχοντος</span>\n                    <span style=\"font-weight:normal; font-size:0.75rem; text-align:left; opacity:0.8;\">Ενημέρωση στίχων/τόνου του υπάρχοντος τραγουδιού.</span>\n                </button>\n                \n                <button id=\"btn-new\" style=\"display:flex; flex-direction:column; align-items:flex-start; gap:4px; width:100%; margin-bottom:12px; padding:12px; background:var(--accent); color:#000; font-weight:bold; border:none; border-radius:10px; cursor:pointer;\">\n                    <span style=\"font-size:0.95rem;\"><i class=\"fas fa-plus\"></i> Αποθήκευση ως Νέο</span>\n                    <span style=\"font-weight:normal; font-size:0.75rem; text-align:left; opacity:0.8;\">Δημιουργία νέου, ανεξάρτητου τραγουδιού.</span>\n                </button>\n                \n                <button id=\"btn-clone\" style=\"display:flex; flex-direction:column; align-items:flex-start; gap:4px; width:100%; margin-bottom:16px; padding:12px; background:var(--accent); color:#000; font-weight:bold; border:none; border-radius:10px; cursor:pointer;\">\n                    <span style=\"font-size:0.95rem;\"><i class=\"fas fa-clone\"></i> ") : "</span>).\n                </p>\n                \n                <button id=\"btn-replace\" style=\"display:flex; flex-direction:column; align-items:flex-start; gap:4px; width:100%; margin-bottom:12px; padding:12px; background:var(--accent); color:#000; font-weight:bold; border:none; border-radius:10px; cursor:pointer;\">\n                    <span style=\"font-size:0.95rem;\"><i class=\"fas fa-exchange-alt\"></i> Αντικατάσταση υπάρχοντος</span>\n                    <span style=\"font-weight:normal; font-size:0.75rem; text-align:left; opacity:0.8;\">Ενημέρωση στίχων/τόνου του υπάρχοντος τραγουδιού.</span>\n                </button>\n                \n                <button id=\"btn-new\" style=\"display:flex; flex-direction:column; align-items:flex-start; gap:4px; width:100%; margin-bottom:12px; padding:12px; background:var(--accent); color:#000; font-weight:bold; border:none; border-radius:10px; cursor:pointer;\">\n                    <span style=\"font-size:0.95rem;\"><i class=\"fas fa-plus\"></i> Αποθήκευση ως Νέο</span>\n                    <span style=\"font-weight:normal; font-size:0.75rem; text-align:left; opacity:0.8;\">Δημιουργία νέου, ανεξάρτητου τραγουδιού.</span>\n                </button>\n                \n                <button id=\"btn-clone\" style=\"display:flex; flex-direction:column; align-items:flex-start; gap:4px; width:100%; margin-bottom:16px; padding:12px; background:var(--accent); color:#000; font-weight:bold; border:none; border-radius:10px; cursor:pointer;\">\n                    <span style=\"font-size:0.95rem;\"><i class=\"fas fa-clone\"></i> "}${cloneLabel}</span>
                    <span style="font-weight:normal; font-size:0.75rem; text-align:left; opacity:0.8;">${cloneDesc}${typeof t === 'function' ? t('auto_msg_13', "</span>\n                </button>\n                \n                <button id=\"btn-cancel\" style=\"padding:10px; width:100%; background:transparent; border:1px solid var(--border-color); color:var(--text-muted); border-radius:10px; cursor:pointer; font-weight:bold;\">\n                    Ακύρωση\n                </button>\n            </div>\n        ") : "</span>\n                </button>\n                \n                <button id=\"btn-cancel\" style=\"padding:10px; width:100%; background:transparent; border:1px solid var(--border-color); color:var(--text-muted); border-radius:10px; cursor:pointer; font-weight:bold;\">\n                    Ακύρωση\n                </button>\n            </div>\n        "}`;
        
        document.body.appendChild(overlay);

        // Το overlay είναι στοιχείο (createElement), όχι document. Το
        // Element.getElementById ΔΕΝ υπάρχει — μόνο το querySelector.
        // Τα κουμπιά γεννιούνται δυναμικά· το markup ζει στο translations.js.
        overlay.querySelector('#btn-replace').onclick = () => { overlay.remove(); resolve('replace'); };
        overlay.querySelector('#btn-new').onclick     = () => { overlay.remove(); resolve('new'); };
        overlay.querySelector('#btn-clone').onclick   = () => { overlay.remove(); resolve('clone'); };
        overlay.querySelector('#btn-cancel').onclick  = () => { overlay.remove(); resolve('cancel'); };
    });
}

window.processImportedData = async function (data) {
    console.log("📥 Import Started (Forced Personal Context)...");
    if (!data) return;

    let newSongs = Array.isArray(data) ? data : (data.songs ? data.songs : [data]);
    if (typeof window.soloImportSongs === 'function') {
        const res = window.soloImportSongs(newSongs, { tombstones: data && data.tombstones });
        if (res && res.ok) {
            if (typeof applySortAndRender === 'function') applySortAndRender();
            if (typeof showToast === 'function') {
                showToast(`Εισαγωγή: ${res.addedCount} νέα, ${res.updatedCount} ενημερώσεις`, 'success');
            }
        }
        return;
    }
    const userSongs = (window.library || []).filter(s => !String(s.id).includes('demo'));

    const limits = typeof getUserLimits === 'function' ? getUserLimits() : { maxGuestSongs: 5, maxSongs: 40 };

    // Μετράμε ΤΡΑΓΟΥΔΙΑ, όχι εγγραφές: οι εκδόσεις με κοινή ρίζα είναι ένα.
    // Μετράμε επίσης το ΤΕΛΙΚΟ σύνολο (υπάρχοντα + εισαγόμενα μαζί) αντί για
    // άθροισμα — αλλιώς η επανεισαγωγή τραγουδιών που ήδη έχεις φούσκωνε τον
    // αριθμό και σε μπλόκαρε χωρίς λόγο.
    const projectedCount = (typeof window.countDistinctSongs === 'function')
        ? window.countDistinctSongs(userSongs.concat(newSongs))
        : userSongs.length + newSongs.length;

    if (typeof currentUser === 'undefined' || !currentUser) {
        if (projectedCount > limits.maxGuestSongs) {
            if (typeof showToast === 'function') showToast(t('msg_import_guest_limit', `Η εισαγωγή ξεπερνάει το όριο επισκεπτών! (Max: ${limits.maxGuestSongs})`), "warning");
            const authMsg = document.getElementById('authMsg');
            if (authMsg) authMsg.innerText = t('msg_create_free_acc', "Δημιουργήστε έναν ΔΩΡΕΑΝ λογαριασμό για να εισάγετε απεριόριστα τραγούδια!");
            const authModal = document.getElementById('authModal');
            if (authModal) authModal.style.display = 'flex';
            return;
        }
    } else {
        if (projectedCount > limits.maxSongs) {
            if (typeof promptUpgrade === 'function') {
                promptUpgrade(t('msg_unlimited_songs', 'Απεριόριστα Τραγούδια'));
            } else {
                alert(t('msg_import_limit_reached', `Η εισαγωγή απορρίφθηκε: Ξεπερνάει το όριο του πακέτου σας (Επιτρέπονται έως ${limits.maxSongs} τραγούδια συνολικά).`));
            }
            return;
        }
    }

    if (typeof currentGroupId !== 'undefined' && currentGroupId !== 'personal') {
        console.log("🔄 Context Switch: Μεταφορά στην Προσωπική Βιβλιοθήκη για την εισαγωγή.");
        if (typeof switchContext === 'function') await switchContext('personal');
    }

    if (typeof switchSidebarTab === 'function') switchSidebarTab('library');

    let importCount = 0;
    let updateCount = 0;

    if (!window.library) window.library = [];

    let batchCloudPayloads = [];
    let batchOfflineQueue = [];
    const isProCloud = (typeof canUserPerform === 'function') && canUserPerform('USE_SUPABASE');

    let resolvedSongs = newSongs;
    if (typeof window.fetchPersonalOwnedIdsForImport === 'function' && typeof window.resolveImportedSongIdentities === 'function') {
        const idCtx = await window.fetchPersonalOwnedIdsForImport(newSongs.map(s => s && s.id));
        resolvedSongs = window.resolveImportedSongIdentities(newSongs, idCtx);
    }

    for (let song of resolvedSongs) {
        let cleanSong = typeof ensureSongStructure === 'function' ? ensureSongStructure(song) : song;

        if (!cleanSong.id || String(cleanSong.id).startsWith('demo')) {
            cleanSong.id = "s_" + Date.now() + "_" + Math.random().toString(36).substring(2,7);
        }

        // 🚀 ΔΙΟΡΘΩΣΗ: Αν είμαστε σε Personal Context, καθαρίζουμε το group_id 
        // για να μην "χαθούν" τα τραγούδια σε παλιές μπάντες που υπήρχαν στο export.
        if (currentGroupId === 'personal') {
            cleanSong.group_id = null;
        }

        const existingIndex = window.library.findIndex(s => s.id === cleanSong.id);
        let needsSync = false;

        if (existingIndex !== -1) {
            const existingSong = window.library[existingIndex];
            const importedTime = new Date(cleanSong.updated_at || 0).getTime();
            const localTime = new Date(existingSong.updated_at || 0).getTime();

            if (importedTime === localTime) {
                console.log(`| Skip: ${cleanSong.title} (Same version)`);
                continue;
            }

            const ageStatus = importedTime > localTime ? t('msg_newer', "ΝΕΟΤΕΡΗ") : t('msg_older', "ΠΑΛΑΙΟΤΕΡΗ");
            const msg = t('msg_import_conflict', `Στη βιβλιοθήκη σας βρέθηκε μια ${ageStatus} έκδοση του τραγουδιού με τίτλο "${cleanSong.title}".\n\nΝα γίνει αντικατάσταση;`);

            const userAgrees = await promptSongDiff(existingSong, cleanSong, msg);

            if (userAgrees) {
                cleanSong.recordings = existingSong.recordings || [];
                cleanSong.attachments = existingSong.attachments || [];
                window.library[existingIndex] = cleanSong;
                updateCount++;
                needsSync = true;
            }
        } else {
            if (!cleanSong.updated_at) cleanSong.updated_at = new Date().toISOString();
            window.library.push(cleanSong);
            importCount++;
            needsSync = true;
        }

        if (needsSync && isProCloud && currentUser) {
            if (typeof window.enqueueOrBatchImportedSong === 'function') {
                window.enqueueOrBatchImportedSong(cleanSong, {
                    userId: currentUser.id,
                    groupId: null,
                    hasUser: true,
                    isProCloud: isProCloud,
                    isOnline: navigator.onLine,
                    batchCloudPayloads: batchCloudPayloads,
                    batchOfflineQueue: batchOfflineQueue
                });
            }
        }
    }

    let cloudUploadFailed = false;
    let cloudUploadErrMsg = '';
    if (typeof window.uploadImportedSongsBatch === 'function') {
        try {
            const upRes = await window.uploadImportedSongsBatch(batchCloudPayloads, batchOfflineQueue);
            if (upRes && !upRes.ok) {
                cloudUploadFailed = true;
                cloudUploadErrMsg = (upRes.error && upRes.error.message) ? upRes.error.message : 'Cloud error';
            }
        } catch (err) {
            console.error("Batch Upsert Error:", err);
            cloudUploadFailed = true;
            cloudUploadErrMsg = err.message || 'Cloud error';
        }
    }

    let finalTargetId = null;

    if (importCount > 0 || updateCount > 0) {
        library = window.library;
        if (typeof saveData === 'function') saveData();
        if (typeof applySortAndRender === 'function') applySortAndRender();

        if (cloudUploadFailed) {
            if (typeof showToast === 'function') {
                showToast(t('msg_import_cloud_failed', `Αποθηκεύτηκε στη συσκευή, αλλά απέτυχε ο συγχρονισμός στο Cloud (${cloudUploadErrMsg}).`), 'error');
            }
        } else {
            let msg = "";
            if (importCount > 0) msg += `${importCount} ${t('msg_new_songs', 'Νέα')} ✅ `;
            if (updateCount > 0) msg += `${updateCount} ${t('msg_updated_songs', 'Ενημερώθηκαν')} 🔄`;
            if (typeof showToast === 'function') showToast(msg.trim());
        }

        if (newSongs.length > 0) finalTargetId = newSongs[newSongs.length - 1].id;
        else if (window.library.length > 0) finalTargetId = window.library[window.library.length - 1].id;

        if (finalTargetId && typeof loadSong === 'function') {
            currentSongId = finalTargetId;
            loadSong(finalTargetId);
            if (window.innerWidth > 1024) {
                if (typeof toViewer === 'function') toViewer(true);
            } else {
                if (typeof switchDrawerTab === 'function') switchDrawerTab('stage');
            }
        }
    } else {
        if (typeof showToast === 'function') showToast(t('msg_no_imports', "Δεν έγιναν νέες εισαγωγές ή αντικαταστάσεις."));
    }
};

// --- UPLOAD VISIBILITY PROMPT HELPER ---
async function askVisibilityRole() {
    const isEn = (typeof currentLang !== 'undefined' && currentLang === 'en');
    const confirmed = await window.mConfirm(
        isEn 
        ? "Do you want to upload this file as PUBLIC (shared with the entire band)? Click 'OK' for Public, or 'Cancel' to save it as PRIVATE (personal override)."
        : "Θέλετε να ανεβάσετε αυτό το αρχείο ως ΚΟΙΝΟΧΡΗΣΤΟ (για όλη την μπάντα); Πατήστε 'OK' για Κοινόχρηστο, ή 'Άκυρο' για να αποθηκευτεί ως ΠΡΟΣΩΠΙΚΟ."
    );
    return confirmed ? 'public' : 'private';
}
window.askVisibilityRole = askVisibilityRole;

// --- AUDIO & ATTACHMENT RECORDING SAVING ---
/**
 * Α7 -- Ατομική προσθήκη σε jsonb πίνακα (recordings / attachments / rhythms).
 * Ένα αίτημα, χωρίς κατέβασμα ολόκληρου του πίνακα και χωρίς race condition
 * όταν δύο συσκευές γράφουν ταυτόχρονα.
 * Αν το RPC δεν έχει εγκατασταθεί, πέφτει στην παλιά read-modify-write.
 */
async function appendJsonbItem(scope, field, item) {
    if (!navigator.onLine) return false;   // offline -> κατευθείαν στο fallback
    const isGlobal = (scope === 'song');
    try {
        const { error } = isGlobal
            ? await supabaseClient.rpc('song_append_item', {
                p_song_id: currentSongId, p_field: field, p_item: item })
            : await supabaseClient.rpc('override_append_item', {
                p_song_id: currentSongId,
                p_group_id: (currentGroupId === 'personal' ? null : currentGroupId),
                p_field: field, p_item: item });
        if (error) throw error;
        return true;
    } catch (e) {
        console.warn("ℹ️ [Α7] Χωρίς RPC, fallback σε read-modify-write:", e.message || e);
        return false;
    }
}

async function appendJsonbFallback(isGlobal, field, item) {
    // 🛡️ OFFLINE: καμία κλήση δικτύου. Η αλλαγή μπαίνει στην ουρά και
    // ανεβαίνει μόλις επανέλθει η σύνδεση (processSyncQueue).
    if (!navigator.onLine) {
        const s = library.find(x => x.id === currentSongId);
        if (s) {
            if (!Array.isArray(s[field])) s[field] = [];
            s[field].push(item);
            if (typeof saveToLocalStorage === 'function') saveToLocalStorage(s);
            if (typeof addToSyncQueue === 'function' && typeof window.sanitizeForDatabase === 'function') {
                addToSyncQueue('SAVE_SONG', window.sanitizeForDatabase(
                    s, currentUser.id, (currentGroupId === 'personal' ? null : currentGroupId)));
            }
        }
        if (typeof showToast === 'function') {
            showToast(t('msg_err_offline', "Είσαι εκτός σύνδεσης. Η αλλαγή αποθηκεύτηκε τοπικά και θα συγχρονιστεί μόλις συνδεθείς."), "info");
        }
        return;
    }

    if (isGlobal) {
        const sel = {}; sel[field] = null;
        const { data } = await supabaseClient.from('songs').select(field).eq('id', currentSongId).single();
        const arr = (data && data[field]) ? data[field] : [];
        arr.push(item);
        const payload = {}; payload[field] = arr; payload.updated_at = new Date().toISOString();
        const { error } = await supabaseClient.from('songs').update(payload).eq('id', currentSongId);
        if (error) alert(t('msg_err_central_save', "Σφάλμα κεντρικής αποθήκευσης: ") + error.message);
    } else {
        const { data } = await supabaseClient.from('personal_overrides')
            .select('id, ' + field)
            .eq('user_id', currentUser.id).eq('song_id', currentSongId)
            .eq('group_id', currentGroupId).maybeSingle();
        const arr = (data && data[field]) ? data[field] : [];
        arr.push(item);
        const payload = {}; payload[field] = arr;
        if (data) {
            await supabaseClient.from('personal_overrides').update(payload).eq('id', data.id);
        } else {
            await supabaseClient.from('personal_overrides').insert([Object.assign(
                { user_id: currentUser.id, song_id: currentSongId, group_id: currentGroupId }, payload)]);
        }
    }
}


async function addRecordingToCurrentSong(newRec) {
    if (!currentSongId || typeof currentUser === 'undefined' || !currentUser) return;

    let saveToGlobal = false;
    if (currentGroupId === 'personal') {
        saveToGlobal = true;
    } else if (roleCan('ADD_PUBLIC_RECORDING')) {
        const choice = await askVisibilityRole();
        if (!choice) return;
        saveToGlobal = (choice === 'public');
    }

    if (!(await appendJsonbItem(saveToGlobal ? 'song' : 'override', 'recordings', newRec))) {
        await appendJsonbFallback(saveToGlobal, 'recordings', newRec);
    }

    const s = library.find(x => x.id === currentSongId);
    if (s) {
        if (!s.recordings) s.recordings = [];
        if (!s.recordings.find(r => r.id === newRec.id)) s.recordings.push(newRec);
    }
}

async function addAttachmentToCurrentSong(newDoc) {
    if (!currentSongId || typeof currentUser === 'undefined' || !currentUser) return;

    let saveToGlobal = false;
    if (currentGroupId === 'personal') {
        saveToGlobal = true;
    } else if (roleCan('ADD_PUBLIC_ATTACHMENT')) {
        const choice = await askVisibilityRole();
        if (!choice) return;
        saveToGlobal = (choice === 'public');
    }

    if (!(await appendJsonbItem(saveToGlobal ? 'song' : 'override', 'attachments', newDoc))) {
        await appendJsonbFallback(saveToGlobal, 'attachments', newDoc);
    }

    const s = library.find(x => x.id === currentSongId);
    if (s) {
        if (!s.attachments) s.attachments = [];
        if (!s.attachments.find(a => a.id === newDoc.id)) s.attachments.push(newDoc);
    }
}

async function saveAsOverride(songData) {
    if (!roleCan('SAVE_OVERRIDE')) {
        if (typeof showToast === 'function') showToast(typeof t === 'function' ? t('msg_err_viewer_no_edit', "Οι επισκέπτες δεν έχουν αυτό το δικαίωμα.") : "Οι επισκέπτες δεν έχουν αυτό το δικαίωμα.", "error");
        return;
    }
    if (!currentSongId || !currentUser) return;
    console.log("💾 Saving personal override layer...");

    let s = window.library.find(x => x.id === currentSongId);

    const pNotesEl = document.getElementById('inpPersonalNotes');
    const pNotes = (pNotesEl && pNotesEl.offsetParent !== null) ? pNotesEl.value.trim() : (s ? s.personal_notes || s.notes || "" : "");

    const pTrans = state.t || 0;

    let pCapo = (s && s.personal_capo !== undefined) ? s.personal_capo : 0;
    if (songData && songData.capo !== undefined) {
        pCapo = parseInt(songData.capo, 10) || 0;
    }
    if (s) {
        s.personal_transpose = pTrans;
        s.personal_capo = pCapo;
        s.personal_notes = pNotes;
        s.has_override = true;

        // ⚠️ Ήταν δύο σφάλματα μαζί: στα προσωπικά έγραφε στο 'mnotes_library',
        // κλειδί που ΔΕΝ διαβάζει κανείς (οι προσωπικές παραλλαγές χάνονταν),
        // και στη μπάντα έγραφε ΟΛΗ την υβριδική library στο mnotes_band_<id>.
        window.persistContextLibrary(window.library);
    }

    const payload = {
        user_id: currentUser.id,
        song_id: currentSongId,
        group_id: currentGroupId === 'personal' ? null : currentGroupId,
        local_transpose: pTrans,
        local_capo: pCapo,
        personal_notes: pNotes,
        recordings: songData && songData.recordings ? songData.recordings : (s ? s.recordings || [] : []),
        attachments: songData && songData.attachments ? songData.attachments : (s ? s.attachments || [] : []),
        rhythms: songData && songData.rhythms ? songData.rhythms : (s ? s.rhythms || [] : [])
    };

    if (navigator.onLine) {
        const { error } = await supabaseClient
            .from('personal_overrides')
            .upsert(payload, { onConflict: 'user_id, song_id, group_id' });

        if (error) {
            console.error("Override Save Error:", error);
            throw error;
        }
    } else {
        addToSyncQueue('SAVE_OVERRIDE', payload);
        console.log(t('msg_offline_override_saved', "✈️ Είστε Offline. Οι ρυθμίσεις αποθηκεύτηκαν τοπικά."));
    }
}

async function saveSong(manualSongData = null) {
    if (!roleCan('EDIT_SONG')) {
        if (typeof showToast === 'function') showToast(typeof t === 'function' ? t('msg_err_viewer_no_edit', "Οι επισκέπτες δεν έχουν αυτό το δικαίωμα.") : "Οι επισκέπτες δεν έχουν αυτό το δικαίωμα.", "error");
        return false;
    }
    let songData;
    let isNewSong = false;
    let existingSong = null;
    let internalId = null;

    if (manualSongData) {
        console.log("💾 [SAVE] Saving manual song data (e.g. from Asset Manager)");
        songData = manualSongData;
        existingSong = library.find(s => s.id === songData.id);
        internalId = songData.id;
    } else {
        console.log(`📂 [SAVE] Building song data from UI. SongID: ${currentSongId || 'NEW'}, Context: ${currentGroupId}`);
        
        const titleInp = document.getElementById('inpTitle');
        const bodyInp = document.getElementById('inpBody');

        const title = titleInp ? titleInp.value.trim() : "";
        const body = bodyInp ? bodyInp.value.trim() : "";

        if (!title || !body) {
            showToast(typeof t === 'function' ? t('msg_title_body_req', "Απαιτείται τίτλος και περιεχόμενο") : "Απαιτείται τίτλος και περιεχόμενο", "error");
            return false;
        }

        isNewSong = !currentSongId || currentSongId === 'null';
        internalId = currentSongId;
        if (isNewSong) {
            internalId = "s_" + Date.now() + "_" + Math.random().toString(36).substring(2,7);
        }

        const personalNotes = document.getElementById('inpPersonalNotes')?.value.trim() || "";
        const tagsRaw = document.getElementById('inpTags')?.value || "";
        const tagsArray = tagsRaw.split(',').map(tag => tag.trim()).filter(tag => tag !== "");

        existingSong = library.find(x => x.id === internalId);
        const preservedConductorNotes = existingSong ? (existingSong.conductorNotes || "") : "";

        songData = {
            id: internalId,
            title: title,
            artist: document.getElementById('inpArtist')?.value.trim() || "",
            key: document.getElementById('inpKey')?.value.trim() || "",
            body: body,
            intro: document.getElementById('inpIntro')?.value.trim() || "",
            interlude: document.getElementById('inpInter')?.value.trim() || "",
            conductorNotes: preservedConductorNotes,
            notes: personalNotes,
            video: document.getElementById('inpVideo')?.value.trim() || "",
            capo: document.getElementById('inpCapo')?.value.trim() || "",
            capo_print: document.getElementById('chkCapoPrint')?.checked || false,
            tags: tagsArray,
            recordings: existingSong ? (existingSong.recordings || []) : [],
            attachments: existingSong ? (existingSong.attachments || []) : [],
            rhythms: existingSong ? (existingSong.rhythms || []) : [],
            rhythm: existingSong ? (existingSong.rhythm || { bpm: 100 }) : { bpm: 100 },
            is_clone: existingSong ? !!existingSong.is_clone : false,
            parent_id: existingSong ? (existingSong.parent_id || null) : null,
            user_id: existingSong ? (existingSong.user_id || (currentUser ? currentUser.id : null)) : (currentUser ? currentUser.id : null),
            updated_at: new Date().toISOString()
        };
        
        if (isNewSong && typeof window.countSongsForLimit === 'function' && typeof window.onSongLimitReached === 'function') {
            const curCount = window.countSongsForLimit(library);
            const limits = typeof getUserLimits === 'function' ? getUserLimits() : { maxSongs: 20 };
            const maxSongs = typeof limits.maxSongs === 'number' ? limits.maxSongs : 20;
            if (curCount >= maxSongs) {
                window.onSongLimitReached('save_new', { currentCount: curCount, maxSongs });
                return false;
            }
        }

        if (isNewSong) currentSongId = internalId;
    }

    try {
        if (currentGroupId === 'personal') {
            // Α1-στ: αν το currentSongId δεν ανήκει στα προσωπικά του χρήστη, δίνουμε νέο κωδικό
            const uid = (typeof currentUser !== 'undefined' && currentUser) ? currentUser.id : null;
            const isOwnedPersonal = existingSong && (typeof window.isPersonalOwnedSong === 'function'
                ? window.isPersonalOwnedSong(existingSong, uid)
                : (!existingSong.group_id && (!uid || !existingSong.user_id || existingSong.user_id === uid)));
            if (!isNewSong && !manualSongData && !isOwnedPersonal) {
                const freshId = "s_" + Date.now() + "_" + Math.random().toString(36).substring(2, 7);
                songData.id = freshId;
                songData.group_id = null;
                songData.user_id = uid;
                songData.parent_id = null;
                songData.is_clone = false;
                internalId = freshId;
                currentSongId = freshId;
                window.currentSongId = freshId;
            }
            if (typeof saveToLocalStorage === 'function') saveToLocalStorage(songData);
            if (isNewSong && typeof window.onSongCountChanged === 'function' && typeof window.countSongsForLimit === 'function') {
                window.onSongCountChanged(window.countSongsForLimit(library));
            }

            const canCloud = (typeof canUserPerform === 'function')
                             && canUserPerform('USE_SUPABASE');

            if (canCloud) {
                // Η saveToCloud κάνει η ίδια τον έλεγχο navigator.onLine
                // και βάζει την αλλαγή στην ουρά αν είμαστε offline.
                // ΜΗΝ ξαναβάλεις έλεγχο navigator.onLine εδώ: ήταν αυτός
                // που έκοβε τη διαδρομή και χανόταν η αλλαγή. (10/09/2026)
                const cloudRes = await saveToCloud(songData, null);
                if (cloudRes && cloudRes.failedPermanent) {
                    showToast(t('msg_sync_failed_permanent', "Αποθηκεύτηκε στη συσκευή, αλλά το Cloud απέρριψε την εγγραφή. Δες Ρυθμίσεις."), 'error');
                } else if ((cloudRes && cloudRes.queued) || !navigator.onLine) {
                    showToast(t('msg_saved_offline_queued', "Αποθηκεύτηκε (offline) 📴"), 'warning');
                } else {
                    showToast(t('msg_saved_cloud', "Αποθηκεύτηκε στο Cloud! ☁️"), 'success');
                }
            } else {
                // Guest ή tier χωρίς cloud: πραγματικά μόνο τοπικά.
                showToast(t('msg_saved_local', "Αποθηκεύτηκε Τοπικά! 💾"), 'info');
            }
        }
        else {
            if (isNewSong) {
                showToast(t('msg_err_new_song_band', "Τα νέα τραγούδια δημιουργούνται στην Προσωπική Βιβλιοθήκη και μετά κοινοποιούνται στη Μπάντα."), "error");
                return false;
            }

            const isAdmin = roleCan('EDIT_BAND_MASTER');
            const isMasterSong = existingSong && !existingSong.is_clone;

            if (isAdmin && isMasterSong) {
                // ✅ ADMIN ΕΠΕΞΕΡΓΑΖΕΤΑΙ MASTER: Απευθείας αποθήκευση με προειδοποίηση
                const confirmed = await mConfirm(
                    t('msg_admin_edit_master_warning',
                        `Η αποθήκευση πρόκειται να αλλάξει το τραγούδι της μπάντας (Ναι / Όχι)`)
                );
                if (!confirmed) return false;

                const cloudRes = await saveToCloud(songData, currentGroupId);
                if (cloudRes && cloudRes.failedPermanent) {
                    songData._syncError = { code: String(cloudRes.error?.code || cloudRes.error?.status || '403'), message: String(cloudRes.error?.message || 'Permission denied') };
                } else {
                    delete songData._syncError;
                }
                // Ενημέρωση τοπικής βιβλιοθήκης
                const idx = library.findIndex(s => s.id === currentSongId);
                if (idx > -1) library[idx] = { ...library[idx], ...songData };
                window.persistContextLibrary(library);
                if (cloudRes && cloudRes.failedPermanent) {
                    showToast(t('msg_sync_failed_permanent', "Αποθηκεύτηκε στη συσκευή, αλλά το Cloud απέρριψε την εγγραφή. Δες Ρυθμίσεις."), 'error');
                } else if (cloudRes && cloudRes.queued) {
                    showToast(t('msg_saved_offline_queued', "Αποθηκεύτηκε (offline) 📴"), 'warning');
                } else {
                    showToast(t('msg_master_updated', "Το Master τραγούδι της μπάντας ενημερώθηκε! 🎸"), 'success');
                }

            } else if (isAdmin && !isMasterSong) {
                // Admin επεξεργάζεται τον δικό του κλώνο — αποθήκευση κανονικά
                const cloudRes = await saveToCloud(songData, currentGroupId);
                if (cloudRes && cloudRes.failedPermanent) {
                    songData._syncError = { code: String(cloudRes.error?.code || cloudRes.error?.status || '403'), message: String(cloudRes.error?.message || 'Permission denied') };
                } else {
                    delete songData._syncError;
                }
                const idx = library.findIndex(s => s.id === currentSongId);
                if (idx > -1) library[idx] = { ...library[idx], ...songData };
                window.persistContextLibrary(library);
                if (cloudRes && cloudRes.failedPermanent) {
                    showToast(t('msg_sync_failed_permanent', "Αποθηκεύτηκε στη συσκευή, αλλά το Cloud απέρριψε την εγγραφή. Δες Ρυθμίσεις."), 'error');
                } else if (cloudRes && cloudRes.queued) {
                    showToast(t('msg_saved_offline_queued', "Αποθηκεύτηκε (offline) 📴"), 'warning');
                } else {
                    showToast(t('msg_saved_cloud', "Αποθηκεύτηκε στο Cloud! ☁️"), 'success');
                }

            } else {
                // 👥 ΑΠΛΟ ΜΕΛΟΣ: 

                // Αν επεξεργάζεται το Master, δημιουργούμε αυτόματα προσωπικό κλώνο
                if (isMasterSong) {
                    console.log("🛡️ Member edited Master body. Forcing personal clone creation...");
                    if (typeof window.createNewVersion === 'function') {
                        // Η createNewVersion θα δημιουργήσει κλώνο στα προσωπικά με νέο ID και θα αλλάξει το currentSongId
                        await window.createNewVersion();
                        
                        // Τώρα το currentSongId δείχνει στον κλώνο.
                        // Πρέπει να αποθηκεύσουμε τις νέες αλλαγές (songData) στον κλώνο.
                        songData.id = currentSongId;
                        songData.parent_id = internalId; // Το παλιό master ID
                        songData.is_clone = true;
                        
                        if (typeof saveAsOverride === 'function') await saveAsOverride({ ...songData });
                        
                        await saveToCloud(songData, null);
                        
                        // Ενημέρωση τοπικής βιβλιοθήκης για τον κλώνο
                        const idx = library.findIndex(s => s.id === currentSongId);
                        if (idx > -1) library[idx] = { ...library[idx], ...songData };
                        
                        const personalDataRaw = localStorage.getItem('mnotes_data');
                        let myPersonalData = personalDataRaw ? JSON.parse(personalDataRaw) : [];
                        const pIdx = myPersonalData.findIndex(s => s.id === currentSongId);
                        if (pIdx > -1) myPersonalData[pIdx] = { ...myPersonalData[pIdx], ...songData };
                        else myPersonalData.push(window.ensureSongStructure({...songData}));
                        
                        safeSetLocal('mnotes_data', JSON.stringify(myPersonalData));
                        
                        // ⚠️ Η ΠΡΟΩΡΗ ΕΞΟΔΟΣ ΕΙΝΑΙ ΣΚΟΠΙΜΗ — ΜΗΝ ΤΗΝ ΑΦΑΙΡΕΣΕΙΣ.
                        // Η ουρά της saveSong καλεί loadContextData(), που ξαναφορτώνει το
                        // περιβάλλον ΤΗΣ ΜΠΑΝΤΑΣ. Ο κλώνος όμως είναι προσωπικός
                        // (group_id: null) και δεν υπάρχει σε εκείνη τη βιβλιοθήκη — οπότε
                        // το loadSong() δεν βρίσκει τίποτα και η οθόνη μένει κενή.
                        // Δοκιμάστηκε 31/08 και έσπασε ολόκληρη τη ροή.
                        return true;
                    }
                } else {
                    // Απλό μέλος επεξεργάζεται τον δικό του κλώνο
                    if (typeof saveAsOverride === 'function') await saveAsOverride({ ...songData });
                    
                    await saveToCloud(songData, null);
                    const idx = library.findIndex(s => s.id === currentSongId);
                    if (idx > -1) library[idx] = { ...library[idx], ...songData };
                    
                    const personalDataRaw = localStorage.getItem('mnotes_data');
                    let myPersonalData = personalDataRaw ? JSON.parse(personalDataRaw) : [];
                    const pIdx = myPersonalData.findIndex(s => s.id === currentSongId);
                    if (pIdx > -1) myPersonalData[pIdx] = { ...myPersonalData[pIdx], ...songData, id: currentSongId };
                    else myPersonalData.push(window.ensureSongStructure({...songData, id: currentSongId}));
                    
                    safeSetLocal('mnotes_data', JSON.stringify(myPersonalData));
                    showToast(typeof t === 'function' ? t('msg_saved_cloud', "Αποθηκεύτηκε στο Cloud! ☁️") : "Αποθηκεύτηκε στο Cloud! ☁️", 'success');
                }
            }
        }

        const targetId = currentSongId;
        if (typeof loadContextData === 'function') await loadContextData({ showToast: false });

        if (typeof loadSong === 'function') loadSong(targetId);
        else if (typeof toViewer === 'function') toViewer(true);

        if (typeof switchView === 'function') switchView('view-details');

        lastSaveTimestamp = Date.now();
        if (typeof hasUnsavedChanges !== 'undefined') hasUnsavedChanges = false;
        console.log("🏁 [SAVE] Επιτυχής ολοκλήρωση.");

    } catch (err) {
        console.error("❌ [SAVE ERROR]:", err);
        showToast(t('msg_err_save', "Σφάλμα κατά την αποθήκευση"), "error");
    }
}

function classifyCloudError(error) {
    if (!error) return 'retryable';
    const status = Number(error.status ?? error.statusCode ?? 0);
    const code = String(error.code || '').toUpperCase();
    const msg = String(error.message || '').toLowerCase();

    // 401 / PGRST301 (λήξη σύνδεσης), 408 (timeout) & 429 (rate limit) -> retryable
    if (status === 401 || status === 408 || status === 429) return 'retryable';
    if (code === 'PGRST301') return 'retryable';
    if (status >= 400 && status < 500) return 'permanent';
    if (code === '42501' || code === 'PGRST116') return 'permanent';
    if (/403|forbidden|row-level security|permission denied/.test(msg)) return 'permanent';

    return 'retryable';
}
window.classifyCloudError = classifyCloudError;

function getFailedSyncItems() {
    try {
        const list = JSON.parse(localStorage.getItem('mnotes_sync_failed') || '[]');
        return Array.isArray(list) ? list : [];
    } catch (err) {
        console.warn('[SYNC] Ανάγνωση mnotes_sync_failed απέτυχε:', err);
        return [];
    }
}

function saveFailedSyncItems(items) {
    try {
        if (!Array.isArray(items) || items.length === 0) {
            localStorage.removeItem('mnotes_sync_failed');
        } else if (typeof safeSetLocal === 'function') {
            safeSetLocal('mnotes_sync_failed', JSON.stringify(items));
        } else {
            localStorage.setItem('mnotes_sync_failed', JSON.stringify(items));
        }
    } catch (err) {
        console.warn('[SYNC] Αποθήκευση mnotes_sync_failed απέτυχε:', err);
    }
    if (typeof updateOfflineState === 'function') updateOfflineState();
}

function markLocalSongSyncError(songId, groupId, syncErrObj) {
    if (!songId) return;
    if (typeof library !== 'undefined' && Array.isArray(library)) {
        const idx = library.findIndex(s => s && s.id === songId);
        if (idx > -1) {
            if (syncErrObj) library[idx]._syncError = syncErrObj;
            else delete library[idx]._syncError;
        }
    }
    const keys = groupId ? [`mnotes_band_${groupId}`] : ['mnotes_data'];
    for (const key of keys) {
        try {
            const raw = localStorage.getItem(key);
            if (!raw) continue;
            const arr = JSON.parse(raw);
            if (!Array.isArray(arr)) continue;
            let changed = false;
            for (const s of arr) {
                if (s && s.id === songId) {
                    if (syncErrObj) s._syncError = syncErrObj;
                    else delete s._syncError;
                    changed = true;
                }
            }
            if (changed) {
                if (typeof safeSetLocal === 'function') safeSetLocal(key, JSON.stringify(arr));
                else localStorage.setItem(key, JSON.stringify(arr));
            }
        } catch (err) {
            console.warn('[SYNC] markLocalSongSyncError failed for', key, err);
        }
    }
}

function addToFailedSync(payload, error) {
    if (!payload || !payload.id) return;
    const errorCode = String((error && (error.code || error.status || error.statusCode)) || '403');
    const errorMessage = String((error && error.message) || 'Permission denied');
    const entry = {
        id: payload.id,
        title: payload.title || payload.id,
        group_id: payload.group_id || null,
        payload,
        errorCode,
        errorMessage,
        timestamp: Date.now()
    };
    const list = getFailedSyncItems().filter(item => item && item.id !== payload.id);
    list.push(entry);
    saveFailedSyncItems(list);
    markLocalSongSyncError(payload.id, payload.group_id || null, { code: errorCode, message: errorMessage });
}
window.addToFailedSync = addToFailedSync;

function removeFailedSyncItem(songId) {
    const list = getFailedSyncItems();
    const removed = list.find(item => item && item.id === songId);
    const next = list.filter(item => item && item.id !== songId);
    saveFailedSyncItems(next);
    if (removed) {
        markLocalSongSyncError(songId, removed.group_id || null, null);
    }
}

async function saveToCloud(songData, groupId) {
    if (!currentUser) return { skipped: true };

    const safePayload = window.sanitizeForDatabase(songData, currentUser.id, groupId);

    if (!navigator.onLine) {
        addToSyncQueue('SAVE_SONG', safePayload);
        return { queued: true };
    }

    try {
        const { error } = await supabaseClient.from('songs').upsert(safePayload);
        if (error) throw error;
        removeFailedSyncItem(safePayload.id);
        markLocalSongSyncError(safePayload.id, groupId || null, null);
        return { ok: true };
    } catch (err) {
        if (classifyCloudError(err) === 'permanent') {
            addToFailedSync(safePayload, err);
            return { failedPermanent: true, error: err };
        }
        addToSyncQueue('SAVE_SONG', safePayload);
        return { queued: true, error: err };
    }
}

function saveToLocalStorage(songData) {
    const isPersonal = currentGroupId === 'personal';
    const storageKey = isPersonal ? 'mnotes_data' : `mnotes_band_${currentGroupId}`;

    const existingIdx = library.findIndex(s => s.id === currentSongId);
    if (existingIdx > -1) {
        library[existingIdx] = { ...library[existingIdx], ...songData, id: currentSongId };
        console.log(`[LOCAL STORAGE] Ενημερώθηκε το υπάρχον τραγούδι: ${currentSongId}`);
    } else {
        const newSong = ensureSongStructure(songData);
        library.push(newSong);
        currentSongId = newSong.id;
        console.log(`[LOCAL STORAGE] Αποθηκεύτηκε νέο τραγούδι: ${currentSongId}`);
    }

    const localDataRaw = localStorage.getItem(storageKey);
    let localData = localDataRaw ? JSON.parse(localDataRaw) : [];
    const localIdx = localData.findIndex(s => s.id === currentSongId);
    if (localIdx > -1) {
        localData[localIdx] = { ...localData[localIdx], ...songData, id: currentSongId };
    } else {
        localData.push(ensureSongStructure({...songData, id: currentSongId}));
    }
    safeSetLocal(storageKey, JSON.stringify(localData));
}

async function cloneToPersonal() {
    if (!roleCan('CLONE_SONG')) {
        if (typeof showToast === 'function') showToast(typeof t === 'function' ? t('msg_err_viewer_no_edit', "Οι επισκέπτες δεν έχουν αυτό το δικαίωμα.") : "Οι επισκέπτες δεν έχουν αυτό το δικαίωμα.", "error");
        return;
    }
    let sourceSong = library.find(s => s.id === currentSongId);

    if (!sourceSong) {
        showToast(typeof t === 'function' ? t('msg_song_not_found', "Δεν βρέθηκε το τραγούδι") : "Δεν βρέθηκε το τραγούδι", "error");
        return;
    }

    if (!currentUser) {
        showToast(typeof t === 'function' ? t('msg_login_required', "Πρέπει να είστε συνδεδεμένος") : "Πρέπει να είστε συνδεδεμένος", "error");
        return;
    }

    console.log("📥 [CLONE] Έναρξη λήψης από μπάντα (Διασφάλιση μοναδικότητας ID)...");

    const masterId = sourceSong.parent_id || sourceSong.id;
    let myPersonalData = JSON.parse(localStorage.getItem('mnotes_data') || '[]');

    // Ελέγχουμε αν ο χρήστης έχει ήδη κάποια έκδοση αυτού του τραγουδιού στα προσωπικά του
    const cleanTitle = sourceSong.title.trim().toLowerCase();
    const cleanArtist = (sourceSong.artist || "").trim().toLowerCase();
    const existingPersonal = myPersonalData.find(s => 
        !s.group_id && 
        s.user_id === currentUser.id &&
        ((s.id === masterId || s.parent_id === masterId) ||
         (s.title.trim().toLowerCase() === cleanTitle && (s.artist || "").trim().toLowerCase() === cleanArtist))
    );

    let choice = 'new';
    if (existingPersonal) {
        choice = await promptTransferConflict(sourceSong.title, 'Προσωπική Βιβλιοθήκη', false);
        if (choice === 'cancel') return;
    }

    let personalCopy;
    let isUpdate = false;

    if (choice === 'replace' && existingPersonal) {
        isUpdate = true;
        personalCopy = {
            ...existingPersonal,
            body: sourceSong.body,
            key: sourceSong.key,
            intro: sourceSong.intro,
            interlude: sourceSong.interlude,
            notes: sourceSong.notes || existingPersonal.notes || "",
            conductor_notes: sourceSong.conductor_notes || existingPersonal.conductor_notes || "",
            video: sourceSong.video || existingPersonal.video || "",
            tags: sourceSong.tags || existingPersonal.tags || [],
            capo: (sourceSong.capo !== undefined && sourceSong.capo !== null) ? sourceSong.capo : existingPersonal.capo,
            capo_print: (sourceSong.capo_print !== undefined && sourceSong.capo_print !== null) ? sourceSong.capo_print : existingPersonal.capo_print,
            updated_at: new Date().toISOString()
        };
    } else {
        const newId = "s_" + Date.now() + "_" + Math.random().toString(36).substring(2,7);
        personalCopy = {
            ...sourceSong,
            id: newId,
            parent_id: choice === 'clone' ? existingPersonal.id : null,
            group_id: null,
            user_id: currentUser.id,
            is_clone: choice === 'clone',
            updated_at: new Date().toISOString(),
            // Οι σύνδεσμοι αρχείων (recordings/attachments/rhythms) έρχονται από το ...sourceSong.
            // Είναι διευθύνσεις, όχι αντίγραφα — δεν κοστίζουν αποθηκευτικό χώρο.
            has_override: false, // Καθαρισμός override fields
            personal_notes: "",
            personal_transpose: 0
        };
    }

    try {
        if (isUpdate) {
            const idx = myPersonalData.findIndex(s => s.id === personalCopy.id);
            if (idx > -1) myPersonalData[idx] = personalCopy;
            else myPersonalData.push(personalCopy);
        } else {
            myPersonalData.push(personalCopy);
        }
        safeSetLocal('mnotes_data', JSON.stringify(myPersonalData));

        if (navigator.onLine && typeof supabaseClient !== 'undefined') {
            const payload = typeof window.sanitizeForDatabase === 'function'
                ? window.sanitizeForDatabase(personalCopy, currentUser.id, null)
                : personalCopy;
            let error;
            if (isUpdate) {
                const { error: err } = await supabaseClient.from('songs').update(payload).eq('id', personalCopy.id);
                error = err;
            } else {
                const { error: err } = await supabaseClient.from('songs').insert([payload]);
                error = err;
            }
            if (error) throw error;
        } else if (typeof addToSyncQueue === 'function') {
            addToSyncQueue('SAVE_SONG', personalCopy);
        }

        showToast(t('msg_cloned_success', `Το "${sourceSong.title}" προστέθηκε στις προσωπικές σας εκδόσεις! 🏠`), "success");

        if (await mConfirm(t('msg_clone_go_personal', "Θέλετε να μεταβείτε στην Προσωπική σας Βιβλιοθήκη τώρα;"))) {
            if (typeof switchContext === 'function') await switchContext('personal');
        }
    } catch (dbErr) {
        console.error("❌ [CLONE DB ERROR]:", dbErr);
        showToast(t('msg_err_clone_db', "Σφάλμα κατά την αποθήκευση στη βάση."), "error");
    }
}

// ΠΑΛΑΙΟΣ κώδικας cloneToPersonal - αφαιρέθηκε. Νέα λογική παραπάνω.
async function _legacy_cloneToPersonal_removed(sourceSong) {

    console.log("📥 [CLONE] Έναρξη διαδικασίας λήψης από την μπάντα...");

    // 1. Εντοπισμός του Master ID (ή αν είναι ήδη master, το ίδιο το id)
    const masterId = sourceSong.parent_id || sourceSong.id;
    const masterSong = (sourceSong.parent_id) ? library.find(s => s.id === sourceSong.parent_id) : sourceSong;

    // 2. Εντοπισμός όλων των σχετικών εκδόσεων (Master + κλώνοι του ίδιου χρήστη) στην τρέχουσα μπάντα
    const relatedSongs = library.filter(s => s.id === masterId || s.parent_id === masterId);

    // 3. Φόρτωση Προσωπικής Βιβλιοθήκης
    let myPersonalData = JSON.parse(localStorage.getItem('mnotes_data') || "[]");

    // 4. Έλεγχος για αντιστοιχία ID
    // Υπάρχει αντιστοιχία αν βρεθεί τραγούδι με το ίδιο ID ή το ίδιο Parent ID στα προσωπικά
    const hasIdMatch = myPersonalData.some(s => s.id === masterId || s.parent_id === masterId);

    // 5. Έλεγχος για αντιστοιχία Τίτλου (αν δεν βρέθηκε ID)
    let hasTitleMatch = false;
    if (!hasIdMatch && masterSong) {
        const cleanMasterTitle = masterSong.title.trim().toLowerCase();
        hasTitleMatch = myPersonalData.some(s => s.title.trim().toLowerCase() === cleanMasterTitle);
    }

    let personalDataChanged = false;
    let newSongsToSave = [];
    const downloadNote = typeof t === 'function' ? t('msg_song_downloaded_from_band', "Λήψη από τη βιβλιοθήκη της μπάντας.") : "Λήψη από τη βιβλιοθήκη της μπάντας.";

    // 6. Επεξεργασία κάθε σχετικού τραγουδιού
    for (const song of relatedSongs) {
        const newId = "s_" + Date.now() + "_" + Math.random().toString(36).substring(2,7);

        // Δημιουργία αντιγράφου για τα προσωπικά
        const clonedSong = {
            ...song,
            id: newId,
            group_id: null,
            user_id: currentUser.id,
            is_clone: true,
            parent_id: masterId,
            updated_at: new Date().toISOString()
        };

        // Καθαρισμός overrides αν πρόκειται για "καθαρή" λήψη (προαιρετικό, αλλά εδώ ακολουθούμε την επιθυμία του χρήστη)
        // Αν υπάρχει ID match, προσθέτουμε τη σημείωση
        if (hasIdMatch) {
            if (!clonedSong.personal_notes) clonedSong.personal_notes = downloadNote;
            else if (!clonedSong.personal_notes.includes(downloadNote)) {
                clonedSong.personal_notes = downloadNote + "\n" + clonedSong.personal_notes;
            }
            // Ενημέρωση και του γενικού πεδίου notes αν χρειάζεται
            if (!clonedSong.notes) clonedSong.notes = downloadNote;
            else if (!clonedSong.notes.includes(downloadNote)) {
                clonedSong.notes = downloadNote + "\n" + clonedSong.notes;
            }
        }

        myPersonalData.push(clonedSong);
        newSongsToSave.push(clonedSong);
        personalDataChanged = true;
    }

    if (personalDataChanged) {
        try {
            // Τοπική αποθήκευση
            safeSetLocal('mnotes_data', JSON.stringify(myPersonalData));

            // Αποθήκευση στο Cloud (Supabase)
            if (navigator.onLine && typeof supabaseClient !== 'undefined') {
                const payloads = newSongsToSave.map(s =>
                    typeof window.sanitizeForDatabase === 'function'
                        ? window.sanitizeForDatabase(s, currentUser.id, null)
                        : s
                );
                const { error } = await supabaseClient.from('songs').insert(payloads);
                if (error) throw error;
            } else if (typeof addToSyncQueue === 'function') {
                newSongsToSave.forEach(s => addToSyncQueue('SAVE_SONG', s));
            }

            // Ειδοποίηση επιτυχίας
            showToast(typeof t === 'function' ? t('msg_cloned_success', "Το τραγούδι προστέθηκε στα Προσωπικά σας! 🏠") : "Το τραγούδι προστέθηκε στα Προσωπικά σας! 🏠", "success");

            // Ειδική ειδοποίηση για Title Match
            if (hasTitleMatch) {
                alert(typeof t === 'function' ? t('msg_same_title_downloaded', "Ένα τραγούδι με τον ίδιο τίτλο αποθηκεύτηκε στη βιβλιοθήκη σας. Παρακαλούμε ελέγξτε το!") : "Ένα τραγούδι με τον ίδιο τίτλο αποθηκεύτηκε στη βιβλιοθήκη σας. Παρακαλούμε ελέγξτε το!");
            }

            // Ερώτηση για μετάβαση στα Προσωπικά
            if (await mConfirm(typeof t === 'function' ? t('msg_clone_go_personal', "Το τραγούδι αντιγράφηκε επιτυχώς! Θέλετε να μεταβείτε στην Προσωπική σας Βιβλιοθήκη τώρα;") : "Το τραγούδι αντιγράφηκε επιτυχώς! Θέλετε να μεταβείτε στην Προσωπική σας Βιβλιοθήκη τώρα;")) {
                if (typeof switchContext === 'function') await switchContext('personal');
            }

        } catch (err) {
            console.error("❌ [CLONE ERROR]:", err);
            showToast(typeof t === 'function' ? t('msg_err_clone', "Αποτυχία αντιγραφής") : "Αποτυχία αντιγραφής", "error");
        }
    }
}

/* =========================================
   HELPER FUNCTIONS & PARSING
   ========================================= */
function ensureSongStructure(song) {
    if (!song) song = {};
    if (!song.id) song.id = "s_" + Date.now() + "_" + Math.random().toString(36).substring(2,7);

    const cleaned = {
        id: song.id,
        title: song.title || "Untitled",
        artist: song.artist || "",
        key: song.key || "",
        body: song.body || "",
        intro: song.intro || "",
        interlude: song.interlude || "",
        video: song.video || "",
        tags: Array.isArray(song.playlists) ? song.playlists : (song.tags || []),
        notes: song.notes || "",
        capo: (song.capo !== undefined && song.capo !== null && song.capo !== "" && !isNaN(song.capo)) ? parseInt(song.capo, 10) : null,
        capo_print: !!song.capo_print,

        created_at: song.created_at || (window.getCreationTimeFromId && window.getCreationTimeFromId(song.id) ? new Date(window.getCreationTimeFromId(song.id)).toISOString() : null),
        updated_at: song.updated_at || song.updatedAt || new Date().toISOString(),
        last_viewed: song.last_viewed || null,

        group_id: song.group_id || null,
        parent_id: song.parent_id || null,
        user_id: song.user_id || null,
        is_clone: !!song.is_clone,
        is_deleted: !!song.is_deleted,
        conductorNotes: song.conductorNotes || song.conductor_notes || "",
        migrated_from: song.migrated_from || null,
        recordings: Array.isArray(song.recordings) ? song.recordings : [],
        attachments: Array.isArray(song.attachments) ? song.attachments : [],
        rhythms: Array.isArray(song.rhythms) ? song.rhythms : [],

        personal_notes: song.personal_notes || "",
        has_override: !!song.has_override
    };

    if (typeof song.personal_transpose !== 'undefined' && song.personal_transpose !== null) {
        cleaned.personal_transpose = song.personal_transpose;
    }
    if (typeof song.personal_capo !== 'undefined' && song.personal_capo !== null) {
        cleaned.personal_capo = song.personal_capo;
    }
    if (song.custom_chords) {
        cleaned.custom_chords = song.custom_chords;
    }

    cleaned.updatedAt = cleaned.updated_at;
    if (typeof window.normalizeSongForEdition === 'function') {
        window.normalizeSongForEdition(cleaned);
    }

    return cleaned;
}

function parseSongLogic(song) {
    if (typeof state === 'undefined') window.state = { t: 0, c: 0, meta: {}, parsedChords: [] };
    state.meta = song;
    state.parsedChords = [];
    if (!song.body) return;

    var lines = song.body.split('\n');
    lines.forEach(line => {
        line = line.trimEnd();
        if (line.trim() === "") {
            state.parsedChords.push({ type: 'br' });
            return;
        }

        if (line.indexOf('!') === -1 && line.indexOf('[') === -1) {
            state.parsedChords.push({ type: 'lyricOnly', text: line });
            return;
        }

        var tokens = [], buffer = "", i = 0;
        while (i < line.length) {
            var char = line[i];

            if (char === '!') {
                var nextChar = (i + 1 < line.length) ? line[i + 1] : '';

                var isPunctuation = nextChar === '' || nextChar === ' ' || /^[.,;?!:'"\-]$/.test(nextChar);
                var isGreek = nextChar >= '\u0370' && nextChar <= '\u03FF';

                if (isPunctuation || isGreek) {
                    buffer += char;
                    i++;
                    continue;
                }

                if (buffer.length > 0) { tokens.push({ c: "", t: buffer }); buffer = ""; }
                i++; // Προσπερνάμε το '!'
                var chordBuf = "", stopChord = false;
                while (i < line.length && !stopChord) {
                    var c = line[i];
                    if (c === '!' || c === ' ' || c === '[' || (c >= '\u0370' && c <= '\u03FF')) {
                        stopChord = true;
                        if (c === ' ') i++; // Καταπίνουμε το κενό
                    } else {
                        chordBuf += c; i++;
                    }
                }
                tokens.push({ c: chordBuf, t: "" });
            }
            else if (char === '[') {
                if (buffer.length > 0) { tokens.push({ c: "", t: buffer }); buffer = ""; }
                i++; // Προσπερνάμε το '['
                var chordBuf = "", stopChord = false;
                while (i < line.length && !stopChord) {
                    var c = line[i];
                    if (c === ']') {
                        stopChord = true; i++; // Προσπερνάμε το ']'
                    } else {
                        chordBuf += c; i++;
                    }
                }
                tokens.push({ c: chordBuf, t: "" });
            }
            else {
                buffer += char; i++;
            }
        }

        if (buffer.length > 0) {
            if (tokens.length > 0 && tokens[tokens.length - 1].t === "") tokens[tokens.length - 1].t = buffer;
            else tokens.push({ c: "", t: buffer });
        }
        state.parsedChords.push({ type: 'mixed', tokens: tokens });
    });
}

function syncWorkspaceChrome() {
    const sidebar = document.getElementById('sidebar');
    if (!sidebar) return;
    const isSolo = (typeof window.currentEdition === 'function' ? window.currentEdition() === 'solo' : window.MNOTES_EDITION === 'solo');
    const groups = (!isSolo && typeof myGroups !== 'undefined' && Array.isArray(myGroups)) ? myGroups : [];
    const hasBands = groups.length >= 1;
    const isBandCtx = !isSolo && currentGroupId !== 'personal';

    sidebar.classList.toggle('has-bands', hasBands);
    sidebar.classList.toggle('is-band-context', isBandCtx);
    const mainZone = document.getElementById('mainZone');
    if (mainZone) mainZone.classList.toggle('is-band-context', isBandCtx);
    document.documentElement.style.setProperty('--nav-width', hasBands ? '404px' : '300px');

    const rail = document.getElementById('workspaceRail');
    if (!rail) return;
    rail.innerHTML = '';
    if (!hasBands) return;

    let isStrictViewer = false;
    if (typeof userLimits !== 'undefined' && userLimits.tierKey === 'solo_free') {
        if (groups.every(g => g.role === 'viewer')) isStrictViewer = true;
    }

    const addRailBtn = (id, iconClass, titleText, roleText, isActive) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'workspace-rail-btn' + (isActive ? ' is-active' : '');
        btn.dataset.groupId = id;
        btn.onclick = () => switchContext(id);
        const top = document.createElement('span');
        top.className = 'workspace-rail-name';
        top.innerHTML = `<i class="${iconClass}"></i> `;
        top.appendChild(document.createTextNode(titleText));
        btn.appendChild(top);
        if (roleText) {
            const sub = document.createElement('span');
            sub.className = 'workspace-rail-role';
            sub.textContent = roleText;
            btn.appendChild(sub);
        }
        rail.appendChild(btn);
    };

    if (!isStrictViewer) {
        addRailBtn(
            'personal',
            'fas fa-user',
            typeof t === 'function' ? t('lbl_personal', 'Προσωπική') : 'Προσωπική',
            '',
            currentGroupId === 'personal'
        );
    }

    groups.forEach(g => {
        const bandName = g.groups?.name || (typeof t === 'function' ? t('lbl_unknown_band', 'Άγνωστη μπάντα') : 'Άγνωστη μπάντα');
        const roleKey = g.role === 'maestro' || g.role === 'owner' || g.role === 'leader'
            ? 'role_maestro'
            : (g.role === 'viewer' ? 'role_viewer' : 'role_member');
        const roleLabel = typeof t === 'function' ? t(roleKey, g.role) : g.role;
        addRailBtn(g.group_id, 'fas fa-users', bandName, roleLabel, currentGroupId === g.group_id);
    });
}

function updateGroupDropdown() {
    const sel = document.getElementById('selGroup');
    if (!sel) return;

    let isStrictViewer = false;
    if (typeof userLimits !== 'undefined' && userLimits.tierKey === 'solo_free') {
        if (myGroups.length > 0 && myGroups.every(g => g.role === 'viewer')) {
            isStrictViewer = true;
        }
    }

    sel.innerHTML = '';
    if (!isStrictViewer) {
        sel.innerHTML = `<option value="personal">${t('opt_personal_lib', '🏠 My Personal Library')}</option>`;
    } else if (currentGroupId === 'personal' && myGroups.length > 0) {
        currentGroupId = myGroups[0].group_id;
    }

    myGroups.forEach(g => {
        const opt = document.createElement('option');
        opt.value = g.group_id;
        const bandName = g.groups?.name || t('lbl_unknown_band', 'Unknown Band');
        opt.innerText = `🎸 ${bandName} (${g.role})`;
        sel.appendChild(opt);
    });

    sel.value = currentGroupId;
    syncWorkspaceChrome();
}

// --- OFFLINE SYNC SYSTEM ---
/* Ενιαία κατάσταση δικτύου/συγχρονισμού.
   ΔΕΝ βασίζεται μόνο στο navigator.onLine: εκείνο λέει «υπάρχει διεπαφή
   δικτύου», όχι «έχω internet». Σε captive portal μαγαζιού είναι true ενώ
   κάθε εγγραφή αποτυγχάνει — και η ένδειξη θα έλεγε «όλα καλά» τη στιγμή
   που τίποτα δεν στέλνεται. (09/09/2026) */
function getPendingSyncCount() {
    try {
        const q = JSON.parse(localStorage.getItem('mnotes_sync_queue') || "[]");
        const qLen = Array.isArray(q) ? q.length : 0;
        const fLen = getFailedSyncItems().length;
        return qLen + fLen;
    } catch (err) {
        console.warn('[SYNC] Ανάγνωση ουράς απέτυχε:', err);
        return 0;
    }
}

function updateOfflineState() {
    const pending = getPendingSyncCount();
    const offline = !navigator.onLine;

    // Sidebar: δείχνει και τις δύο καταστάσεις.
    const badge = document.getElementById('offlineBadge');
    if (badge) {
        if (pending > 0) {
            badge.className = 'net-badge pending';
            badge.innerHTML = `<i class="fas fa-cloud-arrow-up"></i> ${pending}`;
            badge.title = t('msg_pending_changes', 'Αλλαγές που δεν έχουν σταλεί');
            badge.style.display = 'inline-flex';
        } else if (offline) {
            badge.className = 'net-badge offline';
            badge.innerHTML = `<i class="fas fa-plane"></i>`;
            badge.title = t('msg_offline_mode', 'Λειτουργία Offline.');
            badge.style.display = 'inline-flex';
        } else {
            badge.style.display = 'none';
        }
    }

    /* Player: ΜΟΝΟ όταν υπάρχει κάτι να χαθεί. Σκέτο «offline» είναι θόρυβος
       στη σκηνή — ο μουσικός ξέρει ότι το μαγαζί δεν έχει internet. */
    const stage = document.getElementById('stagePendingBadge');
    if (stage) {
        stage.innerText = `⏳ ${pending}`;
        stage.style.display = (pending > 0) ? 'inline-flex' : 'none';
    }
}

window.updateOfflineState = updateOfflineState;

function addToSyncQueue(type, data) {
    let queue = JSON.parse(localStorage.getItem('mnotes_sync_queue') || "[]");
    queue.push({ type, data, timestamp: Date.now() });
    safeSetLocal('mnotes_sync_queue', JSON.stringify(queue));
    updateOfflineState();
}

async function processSyncQueue() {
    if (!navigator.onLine) return;
    let queue = JSON.parse(localStorage.getItem('mnotes_sync_queue') || "[]");
    if (queue.length === 0) return;

    console.log(`♻️ Syncing ${queue.length} pending changes...`);
    const failedItems = [];
    let permanentFailedCount = 0;
    for (const item of queue) {
        try {
            if (item.type === 'SAVE_SONG') {
                console.log(`🚨 [SYNC QUEUE] Ανέβασμα τραγουδιού:`, item.data.title || item.data.id);
                const { error: upsertErr } = await supabaseClient.from('songs').upsert(item.data);
                if (upsertErr) throw upsertErr;
                removeFailedSyncItem(item.data.id);
                markLocalSongSyncError(item.data.id, item.data.group_id || null, null);

            } else if (item.type === 'MIGRATE_BAND_MASTER_DELETE') {
                // Εκκρεμής migration από offline διαγραφή Band Master
                const { songId, groupId, bandName } = item.data;
                console.log(`🔄 [SYNC QUEUE] Εκτέλεση εκκρεμούς migration για Master ${songId}...`);

                const migratedAt = new Date().toISOString();
                const autoTag = `ex-${bandName}`;
                const migratedFromMeta = { band_id: groupId, band_name: bandName, original_song_id: songId, deleted_at: migratedAt };

                const { data: allClones, error: clonesErr } = await supabaseClient
                    .from('songs')
                    .select('id, group_id, user_id, title, artist, updated_at, recordings, attachments, body, key, intro, interlude, notes, video, tags, parent_id, is_clone, is_deleted, conductor_notes, rhythms, migrated_from, capo, capo_print')
                    .eq('parent_id', songId)
                    .eq('is_clone', true);

                if (clonesErr) throw clonesErr;

                if (allClones && allClones.length > 0) {
                    // Ομαδοποίηση ανά χρήστη
                    const clonesByUser = {};
                    allClones.forEach(c => {
                        if (!clonesByUser[c.user_id]) clonesByUser[c.user_id] = [];
                        clonesByUser[c.user_id].push(c);
                    });

                    for (const [userId, userClones] of Object.entries(clonesByUser)) {
                        userClones.sort((a, b) =>
                            (window.getCreationTimeFromId ? window.getCreationTimeFromId(a.id) : 0) -
                            (window.getCreationTimeFromId ? window.getCreationTimeFromId(b.id) : 0)
                        );
                        const newRoot = userClones.find(c => !c.is_deleted) || userClones[0];
                        const newRootTags = Array.isArray(newRoot.tags) ? [...newRoot.tags] : [];
                        if (!newRootTags.includes(autoTag)) newRootTags.push(autoTag);

                        const { error: rootErr } = await supabaseClient.from('songs').update({
                            parent_id: null, is_clone: false, group_id: null,
                            tags: newRootTags, migrated_from: migratedFromMeta, updated_at: migratedAt
                        }).eq('id', newRoot.id);
                        if (rootErr) throw rootErr;

                        for (const sibling of userClones) {
                            if (sibling.id === newRoot.id) continue;
                            const sibTags = Array.isArray(sibling.tags) ? [...sibling.tags] : [];
                            if (!sibTags.includes(autoTag)) sibTags.push(autoTag);
                            const { error: sibErr } = await supabaseClient.from('songs').update({
                                parent_id: newRoot.id, group_id: null,
                                tags: sibTags, migrated_from: migratedFromMeta, updated_at: migratedAt
                            }).eq('id', sibling.id);
                            if (sibErr) throw sibErr;
                        }
                        console.log(`✅ [SYNC QUEUE] Migration ολοκληρώθηκε για ${userClones.length} clone(s) του χρήστη ${userId}`);
                    }
                } else {
                    console.log(`ℹ️ [SYNC QUEUE] Δεν βρέθηκαν clones για migration του Master ${songId}`);
                }

            } else if (item.type === 'SAVE_OVERRIDE') {
                const { error: overrideErr } = await supabaseClient.from('personal_overrides').upsert(item.data);
                if (overrideErr) throw overrideErr;
            }
        } catch (itemErr) {
            console.error(`⚠️ [SYNC QUEUE] Σφάλμα σε item τύπου ${item.type}:`, itemErr);
            if (item.type === 'SAVE_SONG' && classifyCloudError(itemErr) === 'permanent') {
                addToFailedSync(item.data, itemErr);
                permanentFailedCount++;
            } else {
                failedItems.push(item);   // ξαναδοκιμάζεται· δεν χάνεται
            }
            // Συνεχίζουμε με τα υπόλοιπα items — δεν κολλάμε
        }
    }
    /* Η ουρά ΔΕΝ σβήνεται ολόκληρη: κρατιούνται όσα items απέτυχαν, ώστε να
       ξαναδοκιμαστούν. Πριν, ένα captive portal μαγαζιού (όπου το
       navigator.onLine είναι true αλλά κάθε upsert πέφτει) έσβηνε ολόκληρη
       τη βραδιά και εμφάνιζε «All changes synced with cloud». (09/09/2026) */
    if (failedItems.length > 0) {
        safeSetLocal('mnotes_sync_queue', JSON.stringify(failedItems));
        console.warn(`⚠️ [SYNC QUEUE] ${failedItems.length} από ${queue.length} απέτυχαν — παραμένουν στην ουρά.`);
        showToast(t('msg_sync_partial', `Συγχρονίστηκαν ${queue.length - failedItems.length} από ${queue.length}. Οι υπόλοιπες θα ξαναδοκιμαστούν.`), 'warning');
    } else {
        localStorage.removeItem('mnotes_sync_queue');
        if (permanentFailedCount > 0) {
            showToast(t('msg_sync_failed_permanent', "Αποθηκεύτηκε στη συσκευή, αλλά το Cloud απέρριψε την εγγραφή. Δες Ρυθμίσεις."), 'error');
        } else {
            showToast(t('msg_sync_cloud_success', "Συγχρονίστηκε με το Cloud! ☁️"), 'success');
        }
    }
    updateOfflineState();
    await loadContextData();
}

// --- SONG TRANSFER & PROPOSALS ---
async function transferSong(targetContext, action) {
    if (!canUserPerform('USE_SUPABASE')) {
        if(typeof promptUpgrade === 'function') promptUpgrade(t('msg_share_band', 'Κοινοποίηση σε Μπάντα'));
        return;
    }

    if (action === 'transfer_personal') {
        if (typeof cloneToPersonal === 'function') {
            await cloneToPersonal();
            return;
        }
    }

    const sourceSong = library.find(s => s.id === currentSongId);
    if (!sourceSong) return;

    const masterId = sourceSong.parent_id || sourceSong.id;
    const newId = "s_" + Date.now() + "_" + Math.random().toString(36).substring(2,7);

    const newSongData = {
        id: newId,        // 🔒 ΠΑΝΤΑ νέο μοναδικό ID — το masterId ΠΟΤΕ δεν χρησιμοποιείται ως record ID
        title: sourceSong.title,
        artist: sourceSong.artist,
        body: sourceSong.body,
        key: sourceSong.key,
        intro: sourceSong.intro,
        interlude: sourceSong.interlude,
        notes: sourceSong.notes || "",
        video: sourceSong.video || "",
        tags: sourceSong.tags || [],
        user_id: currentUser.id,
        group_id: targetContext,
        recordings: [],
        attachments: [],
        /* ΚΑΤΑΓΩΓΗ, ΟΧΙ ΕΚΔΟΣΗ. Το parent_id σημαίνει «έκδοση μέσα στο ίδιο
           περιβάλλον» για τις getVersionGroup / getSongRootId / _versionCount.
           Η μεταφορά σε μπάντα είναι καταγωγή από άλλο περιβάλλον (migrated_from). (11/09/2026) */
        parent_id: null,
        migrated_from: {
            source: 'personal',
            original_song_id: masterId,
            user_id: currentUser.id,
            transferred_at: new Date().toISOString()
        },
        is_clone: false,
        is_deleted: false
    };

    try {
        if (action === 'transfer_band') {
            // ════════════════════════════════════════════════════════
            // 🧬 ΕΛΕΓΧΟΣ ΤΑΥΤΟΤΗΤΑΣ ΣΕ 2 ΕΠΙΠΕΔΑ (SUPABASE = πηγή αλήθειας)
            // ════════════════════════════════════════════════════════

            // Επίπεδο 1: DNA chain — ακριβής αντιστοίχιση μέσω parent_id ή id
            const { data: existingByDNA } = await supabaseClient
                .from('songs')
                .select('id, parent_id, title, artist')
                .eq('group_id', targetContext)
                .or(`id.eq.${masterId},parent_id.eq.${masterId}`)
                .limit(1);

            let existingInTarget = (existingByDNA && existingByDNA.length > 0) ? existingByDNA[0] : null;
            let matchedByFallback = false;

            // Επίπεδο 2: Fallback — ίδιος τίτλος + καλλιτέχνης (για παλιά records χωρίς parent_id)
            if (!existingInTarget && sourceSong.title) {
                const { data: existingByTitle } = await supabaseClient
                    .from('songs')
                    .select('id, parent_id, title, artist')
                    .eq('group_id', targetContext)
                    .ilike('title', sourceSong.title.trim())
                    .limit(5);

                if (existingByTitle && existingByTitle.length > 0) {
                    // Σύγκριση και καλλιτέχνη αν υπάρχει
                    const titleMatch = existingByTitle.find(s =>
                        (!sourceSong.artist && !s.artist) ||
                        (sourceSong.artist && s.artist &&
                         s.artist.trim().toLowerCase() === sourceSong.artist.trim().toLowerCase())
                    ) || existingByTitle[0];
                    existingInTarget = titleMatch;
                    matchedByFallback = true;
                }
            }

            const targetGroup = (typeof myGroups !== 'undefined' && myGroups) ? myGroups.find(g => g.group_id === targetContext) : null;
            const targetWorkspaceName = targetGroup?.groups?.name || targetGroup?.name || 'Μπάντα';

            if (existingInTarget) {
                const choice = await promptTransferConflict(sourceSong.title, targetWorkspaceName, true);
                if (choice === 'cancel') return;

                if (choice === 'replace') {
                    // ✅ Βρέθηκε — φέρνουμε το πλήρες record από το cloud για σύγκριση/ενημέρωση
                    const { data: fullExisting } = await supabaseClient
                        .from('songs')
                        .select('id, group_id, user_id, title, artist, updated_at, recordings, attachments, body, key, intro, interlude, notes, video, tags, parent_id, is_clone, is_deleted, conductor_notes, rhythms, migrated_from, capo, capo_print')
                        .eq('id', existingInTarget.id)
                        .single();

                    const bandVersion = fullExisting || existingInTarget;

                    newSongData.id = bandVersion.id;
                    newSongData.parent_id = bandVersion.parent_id || masterId;
                    newSongData.is_clone = bandVersion.is_clone || false;
                    newSongData.body = sourceSong.body;
                    newSongData.key = sourceSong.key;
                    newSongData.intro = sourceSong.intro || "";
                    newSongData.interlude = sourceSong.interlude || "";
                    newSongData.notes = sourceSong.notes || bandVersion.notes || "";
                    newSongData.video = sourceSong.video || bandVersion.video || "";
                    newSongData.tags = sourceSong.tags || bandVersion.tags || [];
                } else if (choice === 'clone') {
                    newSongData.id = newId;
                    newSongData.parent_id = existingInTarget.id;
                    newSongData.is_clone = true;
                } else {
                    // 'new'
                    newSongData.id = newId;
                    newSongData.parent_id = null;
                    newSongData.is_clone = false;
                }
            } else {
                // Δεν υπάρχει σύγκρουση — δημιουργείται ως νέο master της μπάντας (το migrated_from έχει οριστεί)
                newSongData.id = newId;
                newSongData.parent_id = null;
                newSongData.is_clone = false;
            }
            // else: δεν υπάρχει πουθενά → newId παραμένει — νέο record



            const payload = typeof window.sanitizeForDatabase === 'function'
                ? window.sanitizeForDatabase(newSongData, currentUser.id, targetContext)
                : newSongData;
            const { error } = await supabaseClient.from('songs').upsert([payload]);
            if (error) throw error;

            // 🚀 ΑΜΕΣΗ ΕΓΧΥΣΗ ΣΤΟ ΤΟΠΙΚΟ ΚΑΣ ΤΗΣ ΜΠΑΝΤΑΣ για άμεση εμφάνιση
            const targetBandSongs = JSON.parse(localStorage.getItem(`mnotes_band_${targetContext}`) || "[]");
            const existingIndex = targetBandSongs.findIndex(s => s.id === newSongData.id);
            if (existingIndex > -1) targetBandSongs[existingIndex] = newSongData;
            else targetBandSongs.push(newSongData);
            safeSetLocal(`mnotes_band_${targetContext}`, JSON.stringify(targetBandSongs));

            await migrateAttachmentsToOverrides(sourceSong, targetContext);
            showToast(t('msg_transfer_success', "Το τραγούδι μεταφέρθηκε επιτυχώς! ✅"), "success");


            
        } else if (action === 'propose_members') {
            newSongData.id = newId;
            newSongData.parent_id = masterId;
            newSongData.is_clone = true;
            await submitProposal(newSongData, targetContext);
        }
    } catch (err) {
        console.error("Transfer Error:", err);
        showToast(t('msg_err_transfer', "Σφάλμα κατά τη μεταφορά"), "error");
    }
}

async function migrateAttachmentsToOverrides(sourceSong, newGroupId) {
    let recs = sourceSong.recordings || [];
    let docs = sourceSong.attachments || [];

    if (recs.length === 0 && docs.length === 0 && !sourceSong.personal_notes) return;

    const payload = {
        user_id: currentUser.id,
        song_id: sourceSong.id,
        group_id: newGroupId,
        recordings: recs.map(r => ({ ...r, origin: 'private' })),
        attachments: docs.map(d => ({ ...d, origin: 'private' })),
        local_transpose: state.t || 0,
        local_capo: 0, // Το capo είναι πάντα εφήμερο, δεν αποθηκεύεται
        personal_notes: document.getElementById('inpPersonalNotes')?.value || ""
    };

    await supabaseClient.from('personal_overrides').upsert(payload, { onConflict: 'user_id, song_id, group_id' });
}

async function submitProposal(songData, groupId) {
    if (!currentUser) return;
    try {
        const {
            id,
            user_id,
            group_id,
            recordings,
            attachments,
            updated_at,
            parent_id,
            is_clone,
            is_deleted,
            ...proposalFields
        } = songData;

        // Το σχήμα του πίνακα proposals είναι ΣΥΜΠΑΓΕΣ: όλα τα πεδία του
        // τραγουδιού ζουν μέσα στο suggested_data (jsonb). Παλιότερα γράφαμε
        // title/body/key/... ως ξεχωριστές στήλες και song_id/proposed_by —
        // στήλες που δεν υπάρχουν. Το PostgREST απέρριπτε ΟΛΟΚΛΗΡΟ το αίτημα,
        // οπότε καμία πρόταση δεν έφευγε ποτέ.
        const { error } = await supabaseClient.from('proposals').insert([{
            from_user_id: currentUser.id,
            group_id: groupId,
            proposal_type: 'song',
            target_song_id: id,
            suggested_data: proposalFields,
            status: 'pending'
        }]);
        if (error) throw error;
        showToast((typeof t === 'function') ? t('msg_proposal_sent', "Η πρόταση στάλθηκε με επιτυχία! 📩") : "Η πρόταση στάλθηκε με επιτυχία! 📩", "success");
    } catch (err) {
        console.error("Proposal Error:", err);
        showToast((typeof t === 'function') ? t('msg_err_transfer', "Σφάλμα κατά την κοινοποίηση") : "Σφάλμα κατά την κοινοποίηση", "error");
    }
}

function applyEditorPlaceholders() {
    const fields = [
        { id: 'inpTitle', key: 'placeholder_title' },
        { id: 'inpArtist', key: 'placeholder_artist' },
        { id: 'inpVideo', key: 'placeholder_video' },
        { id: 'inpKey', key: 'placeholder_key' },
        { id: 'tagInput', key: 'placeholder_tags' },
        { id: 'inpIntro', key: 'placeholder_intro' },
        { id: 'inpInter', key: 'placeholder_inter' },
        { id: 'inpBody', key: 'placeholder_body' },
        { id: 'inpPersonalNotes', key: 'placeholder_notes_priv' }
    ];

    fields.forEach(f => {
        const el = document.getElementById(f.id);
        if (el) el.placeholder = t(f.key);
    });
}

async function applySimulation() {
    const simTier = document.getElementById('debugTier').value;
    const simRole = document.getElementById('debugRole').value;

    console.log(`🧪 SIMULATING: Tier=${simTier}, Role=${simRole}`);

    if (!userProfile) userProfile = { id: 'sim_user' };
    userProfile.subscription_tier = simTier;

    currentRole = simRole;

    if (simRole === 'owner') {
        currentGroupId = 'personal';
        document.body.classList.remove('band-mode');
        document.body.classList.add('personal-mode');
    } else {
        if (currentGroupId === 'personal') currentGroupId = 'simulated_band_id';

        document.body.classList.remove('personal-mode');
        document.body.classList.add('band-mode');
    }

    updateUIForRole();

    if (typeof renderSidebar === 'function') renderSidebar();

    if (currentSongId) {
        const s = library.find(x => x.id === currentSongId);
        if (s && typeof renderPlayer === 'function') renderPlayer(s);
    }

    showToast(`Simulation Applied: ${simTier.toUpperCase()} / ${simRole.toUpperCase()}`);
}

/* =========================================
   BAND MANAGER LOGIC
   ========================================= */

async function promoteItem(songId, itemType, itemObjStr) {
    if (!songId || !currentUser || currentGroupId === 'personal') return;

    const itemObj = JSON.parse(decodeURIComponent(itemObjStr));
    const isGod = roleCan('PROMOTE_BAND_ITEM');

    try {
        if (isGod) {
            const { data: globalSong, error: fetchErr } = await supabaseClient.from('songs').select(itemType).eq('id', songId).maybeSingle();
            if (fetchErr) throw fetchErr;

            if (!globalSong) {
                alert(t('msg_save_first', "Το τραγούδι δεν υπάρχει στο Cloud της μπάντας. Πατήστε 'Save' στο τραγούδι πρώτα!"));
                return;
            }

            let globalItems = (globalSong && globalSong[itemType]) ? globalSong[itemType] : [];

            if (!globalItems.find(i => i.id === itemObj.id)) {
                globalItems.push(itemObj);
                await supabaseClient.from('songs').update({ [itemType]: globalItems }).eq('id', songId);
            }

            const { data: myOverride } = await supabaseClient
                .from('personal_overrides')
                .select(`id, ${itemType}`)
                .eq('user_id', currentUser.id)
                .eq('song_id', songId)
                .eq('group_id', currentGroupId)
                .maybeSingle();

            if (myOverride && myOverride[itemType]) {
                let personalItems = myOverride[itemType].filter(i => i.id !== itemObj.id);
                await supabaseClient.from('personal_overrides').update({ [itemType]: personalItems }).eq('id', myOverride.id);
            }

            showToast(t('msg_file_made_public', "Το αρχείο έγινε Δημόσιο για την μπάντα! 📢"));

        } else {
            const proposalPayload = {
                group_id: currentGroupId,
                from_user_id: currentUser.id,
                proposal_type: 'asset',
                target_song_id: songId,
                status: 'pending',
                suggested_data: {
                    title: `Νέο ${itemType === 'attachments' ? 'Αρχείο' : 'Ηχητικό'}: ${itemObj.name}`,
                    item_type: itemType,
                    item: itemObj
                }
            };

            const { error: propErr } = await supabaseClient.from('proposals').insert([proposalPayload]);
            if (propErr) throw propErr;

            showToast(t('msg_proposal_sent', "Η πρόταση στάλθηκε στον Maestro! 📩"));
        }

        await loadContextData();
        if (typeof toViewer === 'function') toViewer(true);

    } catch (error) {
        console.error("Promote Error:", error);
        alert(t('msg_err_perms_change', "Σφάλμα κατά την αλλαγή δικαιωμάτων: ") + error.message);
    }
}

// --- GIFT CODES & SPECIAL UNLOCKS ---

/**
 * Δοκιμάζει τον κωδικό ως πρόσκληση μπάντας.
 * Επιστρέφει true αν χειρίστηκε τον κωδικό (επιτυχία Ή γνωστή αποτυχία),
 * false μόνο αν ο κωδικός δεν αφορά μπάντα — οπότε ο καλών συνεχίζει.
 *
 * ΔΕΝ μπαίνει έλεγχος tier: ο δωρεάν μουσικός ΠΡΕΠΕΙ να μπορεί να δεχθεί
 * θέση που πληρώνει ο αρχηγός (εύρημα Ε2). Ο client δεν ξέρει αν υπάρχει
 * ελεύθερη θέση — μόνο η βάση το ξέρει.
 */
async function tryJoinBandWithCode(cleanCode) {
    try {
        const { error } = await supabaseClient.rpc('join_band_by_code', { p_code: cleanCode });

        if (!error) {
            alert(t('band_join_ok', "Μπήκες στη μπάντα! Η εφαρμογή θα ανανεωθεί."));
            window.location.reload();
            return true;
        }

        const reason = String(error.message || '');

        if (reason.includes('invalid_code')) return false;   // δεν είναι κωδικός μπάντας

        if (reason.includes('banned')) {
            alert(t('band_banned', "🚫 Η είσοδός σας έχει απαγορευτεί οριστικά από τον διαχειριστή."));
        } else if (reason.includes('already_member')) {
            alert(t('band_already_member', "Είστε ήδη μέλος αυτής της μπάντας!"));
        } else if (reason.includes('band_full')) {
            alert(t('band_full_two_paths',
                "Η μπάντα συμπλήρωσε τις θέσεις που καλύπτει το πακέτο της.\n\n" +
                "• Με δικό σου Pro μπαίνεις αμέσως — δεν πιάνεις θέση της μπάντας.\n" +
                "• Αλλιώς, ζήτησε από τον αρχηγό να προσθέσει μία θέση."));
            if (typeof promptUpgrade === 'function') {
                promptUpgrade(t('upgrade_join_band', "Αναβάθμιση για Συμμετοχή σε Μπάντα"));
            }
        } else {
            console.error("Join band error:", error);
            alert(t('msg_err_redeem', "Προέκυψε σφάλμα κατά την εξαργύρωση: ") + error.message);
        }
        return true;

    } catch (err) {
        console.error("Join band exception:", err);
        return false;
    }
}
window.tryJoinBandWithCode = tryJoinBandWithCode;

async function redeemGiftCode() {
    const promptMsg = t('msg_enter_gift_code', "Εισάγετε τον κωδικό δώρου σας:");
    const codeInput = (typeof window.mDialog === 'function')
        ? await window.mDialog({ type: 'prompt', message: promptMsg })
        : (typeof window.mPrompt === 'function' ? await window.mPrompt(promptMsg, '') : null);
    if (!codeInput) return;

    if (!currentUser) {
        if (typeof showToast === 'function') {
            showToast(t('msg_gift_unauthenticated', "Παρακαλώ συνδεθείτε πρώτα."), 'warning');
        }
        return;
    }

    let raw = String(codeInput).trim();
    if (raw.includes('join=')) {
        raw = raw.split('join=')[1].split('&')[0].split('#')[0];
    }
    const cleanCode = decodeURIComponent(raw).trim().toUpperCase();
    if (!cleanCode) {
        if (typeof showToast === 'function') {
            showToast(t('msg_gift_empty_code', "Παρακαλώ εισάγετε έναν κωδικό."), 'warning');
        }
        return;
    }

    try {
        const { data: res, error } = await supabaseClient.rpc('redeem_gift_code', { p_code: cleanCode });
        if (error) throw error;

        if (!res || !res.ok) {
            const reason = res && res.reason;
            if (reason === 'not_found') {
                const joined = await tryJoinBandWithCode(cleanCode);
                if (joined) return;
                if (typeof showToast === 'function') {
                    showToast(t('msg_err_code_not_found', "Ο κωδικός δεν βρέθηκε ή έχει ήδη εξαργυρωθεί."), 'error');
                }
                return;
            }
            const reasonMessages = {
                already_used: ['msg_gift_already_used', "Αυτός ο κωδικός έχει ήδη εξαργυρωθεί.", 'warning'],
                expired: ['msg_err_code_expired', "Λυπούμαστε, αυτός ο κωδικός προσφοράς έχει λήξει!", 'warning'],
                invalid_code: ['msg_gift_invalid_code', "Μη έγκυρος κωδικός δώρου.", 'error'],
                rate_limited: ['msg_gift_rate_limited', "Πολλές προσπάθειες, δοκίμασε σε μία ώρα.", 'warning'],
                unauthenticated: ['msg_gift_unauthenticated', "Παρακαλώ συνδεθείτε πρώτα.", 'warning'],
                empty_code: ['msg_gift_empty_code', "Παρακαλώ εισάγετε έναν κωδικό.", 'warning']
            };
            const entry = reasonMessages[reason] || ['msg_err_redeem', "Προέκυψε σφάλμα κατά την εξαργύρωση.", 'error'];
            if (typeof showToast === 'function') {
                showToast(t(entry[0], entry[1]), entry[2]);
            }
            return;
        }

        const { data: prof } = await supabaseClient
            .from('profiles')
            .select('special_unlocks')
            .eq('id', currentUser.id)
            .single();
        if (prof && prof.special_unlocks) {
            userProfile.special_unlocks = prof.special_unlocks;
        }

        const cacheKey = `mnotes_user_profile_${currentUser.id}`;
        if (typeof safeSetLocal === 'function') safeSetLocal(cacheKey, JSON.stringify(userProfile));
        if (typeof updateUIForRole === 'function') updateUIForRole();

        if (typeof showToast === 'function') {
            if (res.reward_type === 'extra_bands') {
                showToast(t('msg_gift_extra_band', `Συγχαρητήρια! Κερδίσατε δικαίωμα για +${res.reward_value} μπάντα! 🎉`), 'success');
            } else if (res.reward_type === 'tier_upgrade') {
                if (res.duration_days && parseInt(res.duration_days, 10) > 0) {
                    showToast(t('msg_gift_tier_temp', `Το προφίλ σας αναβαθμίστηκε προσωρινά! ⏱️`), 'success');
                } else {
                    showToast(t('msg_gift_tier_perm', `Συγχαρητήρια! Το προφίλ σας αναβαθμίστηκε! 🚀`), 'success');
                }
            } else if (res.reward_type === 'extra_storage') {
                showToast(t('msg_gift_storage', `Κερδίσατε +${res.reward_value}MB έξτρα χώρο στο Cloud! 💾`), 'success');
            } else if (res.reward_type === 'rhythm_credits') {
                showToast(t('msg_gift_rhythm', `Κερδίσατε ${res.reward_value} δωρεάν ρυθμούς (Beats) για το Drum Store! 🥁`), 'success');
            } else if (res.reward_type === 'solo_edition') {
                showToast(t('msg_gift_solo_edition', "Ο κωδικός Solo ενεργοποιήθηκε στο προφίλ σας! 🎁"), 'success');
            }
        }
    } catch (err) {
        console.error("Gift Code Error:", err);
        if (typeof showToast === 'function') {
            showToast(t('msg_err_redeem', "Προέκυψε σφάλμα κατά την εξαργύρωση.") + (err && err.message ? ` (${err.message})` : ''), 'error');
        }
    }
}

async function deleteCurrentSong() {
    if (!currentSongId) return;

    const s = library.find(x => x.id === currentSongId);
    if (!s) return;

    const isMyClone = s.is_clone && s.user_id === currentUser?.id;
    const isBandMaster = currentGroupId !== 'personal' && !s.is_clone;
    const isGod = roleCan('DELETE_MASTER_SONG');

    if (isBandMaster && !isGod) {
        showToast(t('msg_err_delete_master', "Δεν έχετε δικαίωμα διαγραφής του κεντρικού τραγουδιού."), "error");
        return;
    }
    if (currentGroupId !== 'personal' && s.is_clone && !isMyClone) {
        showToast(t('msg_err_delete_other_clone', "Δεν μπορείτε να διαγράψετε τον κλώνο άλλου χρήστη."), "error");
        return;
    }

    // Έλεγχος αν είναι personal master με versions
    const isPersonalMaster = currentGroupId === 'personal' && !s.parent_id && !s.is_clone;
    const personalVersions = isPersonalMaster
        ? library.filter(v => v.parent_id === s.id && !v.is_deleted && !v.group_id)
        : [];

    let confirmMsg = t('msg_confirm_delete', `Οριστική διαγραφή του "${s.title}";`);

    if (isBandMaster) {
        confirmMsg = t('msg_critical_delete_master', `⚠️ ΚΡΙΣΙΜΗ ΠΡΟΕΙΔΟΠΟΙΗΣΗ ⚠️\n\nΠρόκειται να διαγράψετε το κεντρικό τραγούδι "${s.title}" από την ΚΟΙΝΗ βιβλιοθήκη της Μπάντας!\n\nΑυτό θα αφαιρέσει το τραγούδι από όλα τα μέλη. Είστε ΑΠΟΛΥΤΑ σίγουροι;`);
    } else if (isMyClone) {
        confirmMsg = t('msg_confirm_delete_clone', `Οριστική διαγραφή του προσωπικού σας κλώνου για το "${s.title}";`);
    } else if (isPersonalMaster && personalVersions.length > 0) {
        confirmMsg = `⚠️ Το τραγούδι "${s.title}" έχει ${personalVersions.length} εκδόσεις.\n\nΗ διαγραφή θα αφαιρέσει ΚΑΙ τις ${personalVersions.length} εκδόσεις μαζί.\n\nΕίστε σίγουροι;`;
    }

    if (!(await mConfirm(confirmMsg, true))) return;

    try {
        console.log(`🗑️ [DELETE] Εκκίνηση διαγραφής για: ${s.title}`);
        const prevVisibleIdx = (window.visiblePlaylist || []).findIndex(x => x.id === s.id);

        // ─── Graceful Migration: μεταφορά προσωπικών clones στην προσωπική βιβλιοθήκη ───
        if (isBandMaster && canUserPerform('USE_SUPABASE') && navigator.onLine) {
            try {
                const bandName = (typeof currentGroupName !== 'undefined' && currentGroupName)
                    ? currentGroupName
                    : currentGroupId;
                const migratedAt = new Date().toISOString();
                const migratedFromMeta = { band_id: currentGroupId, band_name: bandName, original_song_id: s.id, deleted_at: migratedAt };
                const autoTag = `ex-${bandName}`;

                // Φέρνουμε όλους τους clones αυτού του Band Master από τη Supabase (ακόμα και τους διεγραμμένους)
                const { data: allClones } = await supabaseClient
                    .from('songs')
                    .select('id, group_id, user_id, title, artist, updated_at, recordings, attachments, body, key, intro, interlude, notes, video, tags, parent_id, is_clone, is_deleted, conductor_notes, rhythms, migrated_from, capo, capo_print')
                    .eq('parent_id', s.id)
                    .eq('is_clone', true);

                if (allClones && allClones.length > 0) {
                    // Ομαδοποίηση ανά χρήστη
                    const clonesByUser = {};
                    allClones.forEach(c => {
                        if (!clonesByUser[c.user_id]) clonesByUser[c.user_id] = [];
                        clonesByUser[c.user_id].push(c);
                    });

                    for (const [userId, userClones] of Object.entries(clonesByUser)) {
                        // Ταξινόμηση ΟΛΩΝ των κλώνων του χρήστη βάσει ημερομηνίας δημιουργίας
                        userClones.sort((a, b) =>
                            window.getCreationTimeFromId(a.id) - window.getCreationTimeFromId(b.id)
                        );
                        
                        // Επιλέγουμε ως newRoot τον παλαιότερο ΕΝΕΡΓΟ clone.
                        // Αν όλοι είναι διεγραμμένοι, παίρνουμε τον παλαιότερο διεγραμμένο.
                        let newRoot = userClones.find(c => !c.is_deleted) || userClones[0];

                        const newRootTags = Array.isArray(newRoot.tags) ? [...newRoot.tags] : [];
                        if (!newRootTags.includes(autoTag)) newRootTags.push(autoTag);

                        // Ο επιλεγμένος clone γίνεται standalone Master
                        await supabaseClient.from('songs').update({
                            parent_id: null,
                            is_clone: false,
                            group_id: null,
                            tags: newRootTags,
                            migrated_from: migratedFromMeta,
                            updated_at: migratedAt
                        }).eq('id', newRoot.id);

                        // Όλοι οι υπόλοιποι δείχνουν στο νέο root
                        for (const sibling of userClones) {
                            if (sibling.id === newRoot.id) continue;
                            const sibTags = Array.isArray(sibling.tags) ? sibling.tags : [];
                            if (!sibTags.includes(autoTag)) sibTags.push(autoTag);
                            await supabaseClient.from('songs').update({
                                parent_id: newRoot.id,
                                group_id: null,
                                tags: sibTags,
                                migrated_from: migratedFromMeta,
                                updated_at: migratedAt
                            }).eq('id', sibling.id);
                        }
                        console.log(`✅ [MIGRATE] ${userClones.length} clone(s) μεταφέρθηκαν στη βιβλιοθήκη του χρήστη ${userId}`);
                    }
                }
            } catch (migErr) {
                console.error("⚠️ [MIGRATE ERROR] Σφάλμα κατά τη μετανάστευση clones:", migErr);
                // Δεν σταματάμε - συνεχίζουμε με τη διαγραφή του Master
            }
        }
        // ─────────────────────────────────────────────────────────────────────────────────

        if (canUserPerform('USE_SUPABASE') && !String(currentSongId).startsWith('demo')) {
            const payload = { is_deleted: true, updated_at: new Date().toISOString() };

            if (navigator.onLine) {
                await supabaseClient.from('songs').update(payload).eq('id', currentSongId);
                
                // Καθαρισμός προσαρτημάτων (overrides) για το Master ΚΑΙ όλες τις εκδόσεις του
                const idsToCleanup = [currentSongId];
                if (!isBandMaster && personalVersions.length > 0) {
                    idsToCleanup.push(...personalVersions.map(v => v.id));
                }
                await supabaseClient.from('personal_overrides').delete().in('song_id', idsToCleanup);

                // Cascade hard delete personal versions (μόνο για personal master, όχι band)
                if (!isBandMaster && personalVersions.length > 0) {
                    const vIds = personalVersions.map(v => v.id);
                    await supabaseClient.from('songs').delete().in('id', vIds);
                }
            } else {
                addToSyncQueue('SAVE_SONG', { id: currentSongId, ...payload });
                // Αν διαγράφεται Band Master offline, η migration δεν μπορεί να τρέξει τώρα.
                // Την βάζουμε στην ουρά για εκτέλεση μόλις ξανασυνδεθούμε.
                if (isBandMaster) {
                    const bandName = (typeof myGroups !== 'undefined')
                        ? (myGroups.find(g => g.group_id === currentGroupId)?.name || currentGroupId)
                        : currentGroupId;
                    addToSyncQueue('MIGRATE_BAND_MASTER_DELETE', {
                        songId: currentSongId,
                        groupId: currentGroupId,
                        bandName
                    });
                    console.log(`📋 [OFFLINE] Η migration για το Master ${currentSongId} προγραμματίστηκε για sync.`);
                }
            }
        }

        const allToRemove = isBandMaster
            ? new Set([currentSongId]) // Οι clones μεταφέρθηκαν, δεν διαγράφονται
            : new Set([currentSongId, ...personalVersions.map(v => v.id)]);

        const removedSongsForCleanup = (window.library || []).filter(x => allToRemove.has(x.id));

        // 🚀 [V2.1.7] In-place ενημέρωση της βιβλιοθήκης για να συγχρονιστούν όλες οι αναφορές (Badges, Counts κλπ)
        const updatedLibrary = window.library.filter(x => !allToRemove.has(x.id));
        if (typeof window.setLibrary === 'function') {
            window.setLibrary(updatedLibrary);
        } else {
            window.library.length = 0; 
            window.library.push(...updatedLibrary);
            if (typeof library !== 'undefined') library = window.library;
        }
        
        window.persistContextLibrary(window.library);
        if (typeof window.recordSongTombstones === 'function') {
            window.recordSongTombstones(Array.from(allToRemove));
        }
        if (typeof window.soloCleanupSongAssets === 'function') {
            window.soloCleanupSongAssets(removedSongsForCleanup, window.library);
        }

        // --- Καθαρισμός Setlists από "φαντάσματα" ---
        // ⚠️ Η ΣΕΙΡΑ ΕΧΕΙ ΣΗΜΑΣΙΑ. Το saveSetlists() κάνει, για την ΕΝΕΡΓΗ λίστα,
        // allSetlists[ενεργή].songs = liveSetlist. Αν τρέξει ΠΡΙΝ καθαριστεί το
        // liveSetlist, ξαναγράφει μέσα το τραγούδι που μόλις διαγράφηκε: έφευγε
        // από τη βιβλιοθήκη αλλά έμενε στην ενεργή λίστα, αόρατο (δεν βρισκόταν
        // πια στο library για να ζωγραφιστεί) αλλά μετρημένο στο πλήθος.
        // Πρώτα το liveSetlist, μετά οι υπόλοιπες λίστες, μετά η αποθήκευση.
        if (typeof liveSetlist !== 'undefined') {
            window.liveSetlist = liveSetlist.filter(id => !allToRemove.has(id));
        }
        if (typeof allSetlists !== 'undefined') {
            Object.keys(allSetlists).forEach(name => {
                if (allSetlists[name].songs) {
                    allSetlists[name].songs = allSetlists[name].songs.filter(id => !allToRemove.has(id));
                }
            });
            if (typeof saveSetlists === 'function') saveSetlists();
        }
        if (typeof updateSetlistDropdown === 'function') updateSetlistDropdown();

        currentSongId = null;
        renderSidebar();

        showToast(isBandMaster
            ? t('msg_master_deleted', "Το κεντρικό τραγούδι διαγράφηκε. Οι προσωπικές εκδόσεις των μελών μεταφέρθηκαν αυτόματα στις βιβλιοθήκες τους.")
            : t('msg_song_deleted', "Το τραγούδι διαγράφηκε."),
            isBandMaster ? "warning" : "info"
        );

        // Πάντα επιστροφή στον Viewer μετά τη διαγραφή (επόμενο/προηγούμενο στη visiblePlaylist)
        if (window.visiblePlaylist && window.visiblePlaylist.length > 0) {
            const nextIdx = prevVisibleIdx >= 0 ? Math.min(prevVisibleIdx, window.visiblePlaylist.length - 1) : 0;
            loadSong(window.visiblePlaylist[nextIdx].id);
        } else if (typeof window.renderEmptyStage === 'function') {
            window.renderEmptyStage();
        }
        if (typeof toViewer === 'function') toViewer(false);

    } catch (err) {
        console.error("❌ [DELETE ERROR]:", err);
        showToast(t('msg_err_delete', "Σφάλμα κατά τη διαγραφή"), "error");
    }
}

window.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
        const editorEl = document.getElementById('view-editor');

        // 🛡️ Μπλόκ αν ο editor είναι ανοιχτός
        if (editorEl && editorEl.classList.contains('active-view')) {
            console.log("🛡️ Auto-Sync Blocked: Ο editor είναι ανοιχτός.");
            return;
        }

        // 🛡️ Μπλόκ αν υπάρχουν αναποθήκευτες αλλαγές (ακόμα και αν ο editor δεν φαίνεται active)
        if (typeof hasUnsavedChanges !== 'undefined' && hasUnsavedChanges) {
            console.log("🛡️ Auto-Sync Blocked: Υπάρχουν αναποθήκευτες αλλαγές στον editor.");
            return;
        }

        if (Date.now() - lastSaveTimestamp < 5000) {
            console.log("🛡️ Auto-Sync Blocked: Πρόσφατη αποθήκευση.");
            return;
        }

        console.log("🔄 Auto-Sync: Φόρτωση νέων δεδομένων από Cloud...");
        if (typeof loadContextData === 'function') loadContextData();
    }
});

function checkBaseChanges(newData, oldData) {
    if (!oldData) return true;

    const normalize = (str) => (str || "").replace(/\r\n/g, '\n').trim();

    return normalize(newData.body) !== normalize(oldData.body) ||
        normalize(newData.title) !== normalize(oldData.title) ||
        normalize(newData.key) !== normalize(oldData.key);
}

// --- createOrUpdateClone removed ---


async function revertClone(cloneSong) {
    if (!(await mConfirm(typeof t === 'function' ? t('msg_confirm_revert', "Είστε σίγουροι; Οι δικοί σας στίχοι...") : "Είστε σίγουροι; Οι δικοί σας στίχοι...", true))) return;

    try {
        if (typeof canUserPerform === 'function' && canUserPerform('USE_SUPABASE')) {
            await supabaseClient.from('songs').delete().eq('id', cloneSong.id);
        }

        let storageKey = currentGroupId === 'personal' ? 'mnotes_data' : 'mnotes_band_' + currentGroupId;
        let localData = JSON.parse(localStorage.getItem(storageKey) || "[]");

        localData = localData.filter(s => s.id !== cloneSong.id);
        safeSetLocal(storageKey, JSON.stringify(localData));

        window.library = localData;
        library = window.library;

        showToast(typeof t === 'function' ? t('msg_clone_reverted', "Ο κλώνος ακυρώθηκε. Επιστροφή στο κοινό.") : "Ο κλώνος ακυρώθηκε. Επιστροφή στο κοινό.");

        if (cloneSong.parent_id) {
            currentSongId = cloneSong.parent_id;
            await switchContext(currentGroupId);
        } else {
            currentSongId = null;
            if (typeof toViewer === 'function') toViewer(true);
        }
    } catch (err) {
        console.error("Revert Error:", err);
        showToast(t('msg_err_revert', "Σφάλμα κατά την ακύρωση."), "error");
    }
}

async function syncEditorFromBand() {
    if (currentGroupId !== 'personal' || !currentSongId) return;

    try {
        const localSong = library.find(s => s.id === currentSongId);
        if (!localSong) return;

        const searchId = localSong.parent_id || currentSongId;

        showToast(t('msg_search_band_updates', "Αναζήτηση ενημερώσεων στη Μπάντα... 🔍"));

        const { data: masterSong, error } = await supabaseClient
            .from('songs')
            .select('id, group_id, user_id, title, artist, updated_at, recordings, attachments, body, key, intro, interlude, notes, video, tags, parent_id, is_clone, is_deleted, conductor_notes, rhythms, migrated_from, capo, capo_print')
            .eq('id', searchId)
            .not('group_id', 'is', null)
            .maybeSingle();

        if (error || !masterSong) {
            showToast(t('msg_err_no_band_source', "Δεν βρέθηκε πηγή συγχρονισμού στη Μπάντα."), "error");
            return;
        }

        const localTime = new Date(localSong.updated_at || 0).getTime();
        const masterTime = new Date(masterSong.updated_at).getTime();

        let confirmMsg = t('msg_band_version_found', `🔄 Βρέθηκε νέα έκδοση στη Μπάντα. Θέλετε να τη φορτώσετε στον Editor;`);
        if (localTime > masterTime) {
            confirmMsg = t('msg_local_version_newer', `⚠️ ΠΡΟΣΟΧΗ: Το δικό σου τραγούδι είναι πιο πρόσφατο.\n\nΘέλεις να το αντικαταστήσεις με την έκδοση της Μπάντας;`);
        }

        if (!confirm(confirmMsg)) return;

        document.getElementById('inpTitle').value = masterSong.title;
        document.getElementById('inpArtist').value = masterSong.artist || "";
        document.getElementById('inpKey').value = masterSong.key || "";
        document.getElementById('inpBody').value = masterSong.body || "";
        document.getElementById('inpIntro').value = masterSong.intro || "";
        document.getElementById('inpInter').value = masterSong.interlude || "";
        if (typeof window.updateHighlights === 'function') window.updateHighlights();

        showToast(t('msg_band_data_loaded', "Τα δεδομένα φορτώθηκαν! Πατήστε Αποθήκευση για οριστικοποίηση. ✅"));

    } catch (err) {
        console.error("❌ Sync Editor Error:", err);
        showToast(t('msg_err_sync', "Σφάλμα κατά τον συγχρονισμό"), "error");
    }
}



// ===========================================================
// BULK DELETE & WITHDRAWAL 
// ===========================================================
async function emptyTrashSetlist() {
    const trashKey = "🗑️ Κάδος";
    const trashList = allSetlists[trashKey]?.songs || [];

    if (trashList.length === 0) {
        if (typeof showToast === 'function') showToast(t('msg_trash_empty', "Ο κάδος είναι ήδη άδειος!"), "warning");
        return;
    }

    const isBandContext = (currentGroupId !== 'personal');
    const isGod = roleCan('WITHDRAW_BAND_SONG');

    if (isBandContext && !isGod) {
        if (typeof showToast === 'function') showToast(t('msg_err_withdraw_perms', "Μόνο οι διαχειριστές μπορούν να αποσύρουν τραγούδια από τη μπάντα."), "error");
        return;
    }

    let confirmMsg = "";
    if (!isBandContext) {
        confirmMsg = t('msg_confirm_empty_trash', `ΠΡΟΣΟΧΗ: Θα διαγραφούν ΟΡΙΣΤΙΚΑ ${trashList.length} τραγούδια από την προσωπική σας βιβλιοθήκη.\n\nΑυτή η ενέργεια ΔΕΝ αναιρείται. Είστε σίγουροι;`);
    } else {
        confirmMsg = t('msg_confirm_withdraw_band', `ΑΠΟΣΥΡΣΗ ΤΡΑΓΟΥΔΙΩΝ:\nΘα αποσύρετε ${trashList.length} τραγούδια από το κοινό ρεπερτόριο της μπάντας.\n\n(Όσα μέλη έχουν δημιουργήσει προσωπικούς κλώνους αυτών των τραγουδιών, θα τους διατηρήσουν στην προσωπική τους βιβλιοθήκη). Συμφωνείτε;`);
    }

    if (!confirm(confirmMsg)) return;

    try {
        console.log(`🗑️ [BULK DELETE] Ξεκινάει ο καθαρισμός ${trashList.length} τραγουδιών...`);

        if (canUserPerform('USE_SUPABASE') && navigator.onLine) {

            if (isBandContext) {
                const payload = { is_deleted: true, updated_at: new Date().toISOString() };
                const { error } = await supabaseClient.from('songs').update(payload).in('id', trashList);
                if (error) throw error;

                await supabaseClient.from('personal_overrides').delete().in('song_id', trashList);
            } else {
                // Διαχωρισμός Masters και Versions για την προσωπική βιβλιοθήκη
                const masters = [];
                const versions = [];
                
                trashList.forEach(id => {
                    const s = library.find(x => x.id === id);
                    const isMaster = s && !s.parent_id && !s.is_clone;
                    
                    if (isMaster) {
                        masters.push(id);
                    } else {
                        versions.push(id);
                    }
                });

                const payload = { is_deleted: true, updated_at: new Date().toISOString() };
                
                // Soft delete για τα Masters
                if (masters.length > 0) {
                    await supabaseClient.from('songs').update(payload).in('id', masters);
                }
                
                // Hard delete για τις Versions
                if (versions.length > 0) {
                    await supabaseClient.from('songs').delete().in('id', versions);
                }
            }
        } else if (!navigator.onLine) {
            const payload = { is_deleted: true, updated_at: new Date().toISOString() };
            trashList.forEach(id => {
                addToSyncQueue('SAVE_SONG', { id: id, ...payload });
            });
        }

        const removedTrashSongs = (window.library || []).filter(s => trashList.includes(s.id));
        window.library = window.library.filter(s => !trashList.includes(s.id));
        library = window.library;
        window.persistContextLibrary(window.library);
        if (typeof window.recordSongTombstones === 'function') {
            window.recordSongTombstones(trashList);
        }
        if (typeof window.soloCleanupSongAssets === 'function') {
            window.soloCleanupSongAssets(removedTrashSongs, window.library);
        }

        allSetlists[trashKey].songs = [];
        liveSetlist = [];

        if (typeof saveSetlists === 'function') saveSetlists(trashKey);

        if (typeof showToast === 'function') {
            showToast(isBandContext ? t('msg_withdraw_success', "Τα τραγούδια αποσύρθηκαν επιτυχώς.") : t('msg_delete_success', "Η διαγραφή ολοκληρώθηκε."), "success");
        }

        if (trashList.includes(currentSongId)) {
            currentSongId = null;
            if (library.length > 0) {
                if (typeof loadSong === 'function') loadSong(library[0].id);
            } else {
                if (typeof toEditor === 'function') toEditor();
            }
        }

        if (typeof updateSetlistDropdown === 'function') updateSetlistDropdown();
        if (typeof renderSidebar === 'function') renderSidebar();

    } catch (err) {
        console.error("❌ [BULK DELETE ERROR]:", err);
        if (typeof showToast === 'function') showToast(t('msg_err_generic_retry', "Προέκυψε σφάλμα. Προσπαθήστε ξανά."), "error");
    }
}

// ============================================================
// 🧹 DUPLICATE CLEANUP
// ============================================================

window.cleanDuplicates = async function () {
    if (currentGroupId !== 'personal') {
        showToast((typeof t === 'function' ? t('auto_msg_12', "Καθαρισμός μόνο σε Προσωπική Βιβλιοθήκη") : "Καθαρισμός μόνο σε Προσωπική Βιβλιοθήκη"), 'info');
        return;
    }
    // Group personal master songs by title (no parent, not clone)
    const masters = library.filter(s => !s.is_clone && !s.parent_id && !s.group_id && !s.is_deleted);
    const byTitle = {};
    for (const s of masters) {
        const key = (s.title || '').trim().toLowerCase();
        if (!byTitle[key]) byTitle[key] = [];
        byTitle[key].push(s);
    }
    const dupeGroups = Object.values(byTitle).filter(g => g.length > 1);
    if (dupeGroups.length === 0) {
        showToast(t('msg_no_dupes', '✅ Δεν βρέθηκαν διπλότυπα!'), 'success');
        return;
    }
    const totalDupes = dupeGroups.reduce((acc, g) => acc + g.length - 1, 0);
    const confirmed = await mConfirm(
        `${typeof t === 'function' ? t('auto_msg_11', "🧹 Βρέθηκαν ") : "🧹 Βρέθηκαν "}${dupeGroups.length}${typeof t === 'function' ? t('auto_msg_10', " τραγούδια με διπλότυπα (") : " τραγούδια με διπλότυπα ("}${totalDupes}${typeof t === 'function' ? t('auto_msg_9', " επιπλέον εγγραφές).\\n\\nΘα κρατηθεί μόνο το πιο πρόσφατο αντίγραφο κάθε τίτλου.\\n\\nΣυνέχεια;") : " επιπλέον εγγραφές).\\n\\nΘα κρατηθεί μόνο το πιο πρόσφατο αντίγραφο κάθε τίτλου.\\n\\nΣυνέχεια;"}`, true
    );
    if (!confirmed) return;

    let deleted = 0;
    for (const group of dupeGroups) {
        // Keep the most recently updated song
        group.sort((a, b) => new Date(b.updated_at || 0) - new Date(a.updated_at || 0));
        const toDelete = group.slice(1); // everything except the newest
        for (const s of toDelete) {
            s.is_deleted = true;
            s.updated_at = new Date().toISOString();
            if (canUserPerform('USE_SUPABASE') && !String(s.id).startsWith('demo') && navigator.onLine) {
                await supabaseClient.from('songs')
                    .update({ is_deleted: true, updated_at: s.updated_at })
                    .eq('id', s.id);
            }
            deleted++;
        }
    }
    window.library = library.filter(s => !s.is_deleted);
    library = window.library;
    safeSetLocal('mnotes_data', JSON.stringify(library.filter(s => !s.group_id)));
    renderSidebar();
    if (library.length > 0) loadSong(library[0].id);
    showToast(`${typeof t === 'function' ? t('auto_msg_8', "🧹 Καθαρισμός: ") : "🧹 Καθαρισμός: "}${deleted}${typeof t === 'function' ? t('auto_msg_7', " διπλότυπα αφαιρέθηκαν.") : " διπλότυπα αφαιρέθηκαν."}`, 'success');
};

window.resetCloud = async function () {
    if (!currentUser) { showToast(t('msg_login_required_short', 'Πρέπει να είστε συνδεδεμένοι'), 'error'); return; }
    if (!navigator.onLine) { showToast(t('msg_internet_required', 'Απαιτείται σύνδεση internet'), 'error'); return; }

    // Step 1: Clean local duplicates first
    console.log('🧹 [RESET] Step 1: Local cleanup...');
    await window.cleanDuplicates();

    const localSongs = library.filter(s => !s.group_id && !s.is_deleted);
    const confirmed = await mConfirm(
        `${typeof t === 'function' ? t('auto_msg_6', "☁️ ΕΠΑΝΑΦΟΡΤΩΣΗ CLOUD\\n\\nΘα σβηστούν ΟΛΕΣ οι εγγραφές σου από τη Supabase\\nκαι θα ανεβούν εκ νέου ") : "☁️ ΕΠΑΝΑΦΟΡΤΩΣΗ CLOUD\\n\\nΘα σβηστούν ΟΛΕΣ οι εγγραφές σου από τη Supabase\\nκαι θα ανεβούν εκ νέου "}${localSongs.length}${typeof t === 'function' ? t('auto_msg_5', " τραγούδια.\\n\\nΣυνέχεια;") : " τραγούδια.\\n\\nΣυνέχεια;"}`, true
    );
    if (!confirmed) return;

    showToast(t('msg_cloud_deleting', 'Εκκαθάριση cloud...'), 'info');

    // Step 2: Soft-delete ALL user songs in Supabase
    const { error: delError } = await supabaseClient
        .from('songs')
        .update({ is_deleted: true, updated_at: new Date().toISOString() })
        .eq('user_id', currentUser.id)
        .is('group_id', null);

    if (delError) { console.error('Delete error:', delError); showToast(t('msg_cloud_error', 'Σφάλμα cloud'), 'error'); return; }

    // Step 3: Re-upload all local songs in batches of 20
    console.log(`☁️ [RESET] Ανέβασμα ${localSongs.length} τραγουδιών...`);
    const batchSize = 20;
    let uploaded = 0;
    for (let i = 0; i < localSongs.length; i += batchSize) {
        const batch = localSongs.slice(i, i + batchSize).map(s => window.sanitizeForDatabase(s, currentUser.id, null));
        const { error: upError } = await supabaseClient.from('songs').upsert(batch);
        if (upError) { console.error('Upload error batch', i, upError); }
        else { uploaded += batch.length; }
        showToast(t('msg_cloud_upload_progress', `Ανέβασμα... {current}/{total}`).replace('{current}', Math.min(i + batchSize, localSongs.length)).replace('{total}', localSongs.length), 'info');
    }

    // Step 4: Reset sync timestamps so next sync fetches everything fresh
    Object.keys(localStorage).filter(k => k.startsWith('mnotes_last_sync')).forEach(k => localStorage.removeItem(k));

    showToast(t('msg_cloud_upload_success', `Επιτυχία! Ανέβηκαν {uploaded}/{total} τραγούδια.`).replace('{uploaded}', uploaded).replace('{total}', localSongs.length), 'success');
    console.log('✅ [RESET] Cloud reset complete!');
};

// ============================================================
// 🔀 VERSIONING SYSTEM
// ============================================================

window.getCreationTimeFromId = function (id) {
    const sId = String(id);
    const match = sId.match(/^(?:s|demo)_(\d{13})/);
    if (match) return parseInt(match[1], 10);
    const parts = sId.split('_');
    if (parts.length > 1) {
        const ts = parseInt(parts[1].substring(0, 13), 10);
        if (!isNaN(ts) && ts > 1000000000000) return ts;
    }
    return 0;
};

/**
 * Η ΡΙΖΑ μιας οικογένειας εκδόσεων.
 * Ακολουθεί την αλυσίδα parent_id μέχρι το αρχικό τραγούδι. Αν ο γονέας δεν
 * είναι φορτωμένος (π.χ. κλώνος τραγουδιού μπάντας ενώ βρισκόμαστε στα
 * προσωπικά), το parent_id είναι ήδη σταθερό αναγνωριστικό ρίζας — οπότε δύο
 * κλώνοι του ίδιου απόντος master συνεχίζουν να συμπίπτουν.
 */
window.getSongRootId = function (song, pool) {
    if (!song) return null;
    const list = pool || window.library || [];
    let rootId = song.id;
    let current = song;
    let safety = 0;
    while (current && current.parent_id && current.parent_id !== current.id && safety < 10) {
        rootId = current.parent_id;
        const next = list.find(x => x.id === rootId);
        if (!next) break;
        current = next;
        safety++;
    }
    return rootId;
};

/**
 * Πόσα ΤΡΑΓΟΥΔΙΑ έχει ο χρήστης — όχι πόσες εγγραφές.
 * Τρεις εκδόσεις του «Μινόρε της Αυγής» με κοινή ρίζα είναι ένα τραγούδι.
 * Αυτή είναι η μονάδα μέτρησης για τα όρια των πακέτων.
 *
 * Χωρίς όρισμα διαβάζει την προσωπική βιβλιοθήκη, ώστε η μέτρηση να μην
 * εξαρτάται από το αν βρισκόμαστε σε μπάντα ή στα προσωπικά.
 */
window.countDistinctSongs = function (pool) {
    let list = pool;
    if (!list) {
        try { list = JSON.parse(localStorage.getItem('mnotes_data') || '[]'); }
        catch (e) { list = window.library || []; }
    }
    if (typeof window.countSongsForLimit === 'function') {
        return window.countSongsForLimit(list);
    }
    const real = (list || []).filter(s =>
        s && s.id && !s.is_deleted && !String(s.id).includes('demo')
    );
    const roots = new Set();
    for (const s of real) roots.add(window.getSongRootId(s, real));
    return roots.size;
};

window.getVersionGroup = function (songId) {
    const song = library.find(s => s.id === songId);
    if (!song) return [];

    // Follow the chain to the "True Master" (the one with no parent_id or pointing to itself)
    let masterId = song.id;
    let current = song;
    let safetyCounter = 0;
    while (current && current.parent_id && current.parent_id !== current.id && safetyCounter < 10) {
        masterId = current.parent_id;
        let nextParent = library.find(s => s.id === masterId);
        if (!nextParent) break; // Parent not in library (might be deleted or not synced yet)
        current = nextParent;
        safetyCounter++;
    }

    const master = library.find(s => s.id === masterId);

    return library
        .filter(s => {
            if (s.is_deleted) return false;
            if (s.id === masterId) return true;
            // Include personal clones or clones belonging to the current group
            if (s.parent_id === masterId && s.id !== masterId) {
                if (!s.group_id || (typeof currentGroupId !== 'undefined' && s.group_id === currentGroupId)) {
                    return true;
                }
            }
            return false;
        })
        .sort((a, b) => window.getCreationTimeFromId(a.id) - window.getCreationTimeFromId(b.id));
};

window.switchVersion = function (dir) {
    const group = window.getVersionGroup(currentSongId);
    if (group.length <= 1) return;
    const idx = group.findIndex(s => s.id === currentSongId);
    let newIdx = (idx + dir + group.length) % group.length;
    const newSong = group[newIdx];

    // 🔖 Αποθήκευση επιλεγμένης έκδοσης
    const masterId = group[0].id; // Πάντα το πρώτο (παλαιότερο) = Master
    let activeVersions = JSON.parse(localStorage.getItem('mnotes_active_version') || '{}');
    activeVersions[masterId] = newSong.id;
    safeSetLocal('mnotes_active_version', JSON.stringify(activeVersions));

    loadSong(newSong.id);
};

window.createNewVersion = async function () {
    if (!currentSongId) return;
    const song = library.find(s => s.id === currentSongId);
    if (!song) return;
    if (!currentUser) { showToast(t('msg_login_required', 'Πρέπει να είστε συνδεδεμένος'), 'error'); return; }

    const masterId = song.parent_id || song.id;
    const newVersion = ensureSongStructure({
        ...song,
        id: 's_' + Date.now() + '_' + Math.random().toString(36).substring(2,7),
        parent_id: masterId,
        is_clone: true,
        group_id: null,
        user_id: currentUser.id,
        is_deleted: false,
        updated_at: new Date().toISOString()
    });

    // Προσθήκη στην τρέχουσα μνήμη (Hybrid View)
    library.push(newVersion);
    window.library = library;

    // Ασφαλής αποθήκευση ΜΟΝΟ στα προσωπικά δεδομένα (χωρίς να διαγράφει τα υπόλοιπα)
    let myPersonalData = JSON.parse(localStorage.getItem('mnotes_data') || '[]');
    myPersonalData.push(newVersion);
    safeSetLocal('mnotes_data', JSON.stringify(myPersonalData));

    if (canUserPerform('USE_SUPABASE') && navigator.onLine) {
        await supabaseClient.from('songs').insert([window.sanitizeForDatabase(newVersion, currentUser.id, null)]);
    }

    currentSongId = newVersion.id;
    window.currentSongId = newVersion.id;
    renderSidebar();
    loadSong(newVersion.id);
    showToast(t('msg_version_created', '🔀 Νέα έκδοση δημιουργήθηκε'));

    // Redirect to viewer
    if (typeof toViewer === 'function') {
        toViewer(true);
    }
};

window.promoteToMaster = async function (keepOthers) {
    if (!currentSongId) return;
    const version = library.find(s => s.id === currentSongId);
    if (!version || (!version.parent_id && !version.is_clone)) {
        showToast(t('msg_already_master', 'Αυτό είναι ήδη το Master'), 'info');
        return;
    }

    const group = window.getVersionGroup(currentSongId);
    const oldMasterId = group.length > 0 ? group[0].id : (version.parent_id || version.id);
    const oldMaster = library.find(s => s.id === oldMasterId);
    const versionId = currentSongId;
    const deletedAt = new Date().toISOString();

    // Αν είναι τραγούδι μπάντας, το νέο Master πρέπει να πάρει το group_id
    const targetGroupId = oldMaster ? oldMaster.group_id : null;

    if (keepOthers) {
        for (const s of group) {
            const isNewMaster = (s.id === versionId);
            s.parent_id = isNewMaster ? null : versionId;
            s.is_clone = !isNewMaster;
            s.updated_at = deletedAt;
            
            // Μεταφορά του group_id στο νέο Master αν μιλάμε για μπάντα
            if (isNewMaster) {
                s.group_id = targetGroupId;
            }

            if (canUserPerform('USE_SUPABASE') && navigator.onLine) {
                await supabaseClient.from('songs')
                    .update({ 
                        parent_id: s.parent_id, 
                        is_clone: s.is_clone, 
                        group_id: s.group_id,
                        updated_at: s.updated_at 
                    })
                    .eq('id', s.id);
            }
        }
        safeSetLocal('mnotes_data', JSON.stringify(library.filter(s => !s.group_id)));
        renderSidebar();
        loadSong(versionId);
        showToast(t('msg_promoted_kept', '⭐ Ορίστηκε ως Master. Εκδόσεις διατηρήθηκαν.'));
    } else {
        const toDelete = group.filter(s => s.id !== versionId);
        for (const s of toDelete) {
            s.is_deleted = true;
            s.updated_at = deletedAt;
            if (canUserPerform('USE_SUPABASE') && !String(s.id).startsWith('demo') && navigator.onLine) {
                await supabaseClient.from('songs').update({ is_deleted: true, updated_at: s.updated_at }).eq('id', s.id);
            }
        }
        version.parent_id = null;
        version.is_clone = false;
        version.group_id = targetGroupId; // Μεταφορά στη μπάντα
        version.updated_at = deletedAt;
        
        if (canUserPerform('USE_SUPABASE') && navigator.onLine) {
            await supabaseClient.from('songs')
                .update({ 
                    parent_id: null, 
                    is_clone: false, 
                    group_id: targetGroupId,
                    updated_at: version.updated_at 
                })
                .eq('id', versionId);
        }
        window.library = library.filter(s => !s.is_deleted);
        library = window.library;
        safeSetLocal('mnotes_data', JSON.stringify(library.filter(s => !s.group_id)));
        renderSidebar();
        loadSong(versionId);
        showToast(t('msg_promoted_clean', '⭐ Master ενημερώθηκε. Παλιές εκδόσεις διαγράφηκαν.'));
    }
};

/* Διαγνωστικό εργαλείο — καλείται ΜΟΝΟ χειροκίνητα από την κονσόλα.
   Δεν τρέχει αυτόματα και δεν αλλάζει τίποτα. Σκοπός: να βρεθεί γιατί
   το τοπικό πλήθος δεν συμφωνεί ποτέ με το Supabase, με αποτέλεσμα
   Full Sync σε κάθε φόρτωση. (11/09/2026) */
window.diagnoseLibrary = async function () {
    if (!currentUser) { console.warn('[DIAG] Απαιτείται σύνδεση.'); return; }

    const raw = localStorage.getItem('mnotes_data');
    const local = raw ? JSON.parse(raw) : [];

    const { data: cloud, error } = await supabaseClient
        .from('songs')
        .select('id, title, user_id, group_id, is_deleted, parent_id, is_clone, updated_at')
        .eq('user_id', currentUser.id);

    if (error) { console.error('[DIAG] Αποτυχία ανάκτησης:', error); return; }

    const cloudActive  = cloud.filter(s => !s.is_deleted);
    const cloudDeleted = cloud.filter(s =>  s.is_deleted);

    const localIds       = new Set(local.map(s => String(s.id)));
    const cloudActiveIds = new Set(cloudActive.map(s => String(s.id)));

    const onlyLocal = local.filter(s => !cloudActiveIds.has(String(s.id)));
    const onlyCloud = cloudActive.filter(s => !localIds.has(String(s.id)));

    console.log('════════ [DIAG] ΣΥΝΟΨΗ ════════');
    console.log('Τοπικά (mnotes_data):', local.length);
    console.log('Supabase ενεργά:', cloudActive.length);
    console.log('Supabase διαγραμμένα:', cloudDeleted.length);
    console.log('Μόνο τοπικά:', onlyLocal.length);
    console.log('Μόνο στο cloud:', onlyCloud.length);

    console.log('──────── Μόνο τοπικά ────────');
    console.table(onlyLocal.map(s => ({
        id: s.id,
        title: s.title,
        isDemo: String(s.id).includes('demo'),
        user_id: s.user_id,
        matchesUser: s.user_id === currentUser.id,
        group_id: s.group_id,
        is_deleted: s.is_deleted,
        is_clone: s.is_clone,
        parent_id: s.parent_id,
        updated_at: s.updated_at
    })));

    console.log('──────── Μόνο στο cloud ────────');
    console.table(onlyCloud.map(s => ({
        id: s.id, title: s.title, group_id: s.group_id,
        is_clone: s.is_clone, parent_id: s.parent_id, updated_at: s.updated_at
    })));

    /* Τοπικές κατηγορίες που ΔΕΝ μετριούνται στο Supabase count — κάθε μία
       από αυτές αρκεί για μόνιμη ασυμφωνία. */
    console.log('──────── Κατηγορίες τοπικών ────────');
    console.log('demo ids:', local.filter(s => String(s.id).includes('demo')).length);
    console.log('is_deleted τοπικά:', local.filter(s => s.is_deleted).length);
    console.log('λάθος user_id:', local.filter(s => s.user_id && s.user_id !== currentUser.id).length);
    console.log('χωρίς user_id:', local.filter(s => !s.user_id).length);
    console.log('με group_id:', local.filter(s => s.group_id).length);

    const dupIds = local.map(s => String(s.id))
        .filter((id, i, arr) => arr.indexOf(id) !== i);
    console.log('διπλότυπα ids τοπικά:', [...new Set(dupIds)]);
    console.log('═══════════════════════════════');
};

/* Εφάπαξ ασφαλής μετανάστευση: parent_id -> migrated_from ΜΟΝΟ για μεταφορές προς μπάντα.
   Μεταφορά = το parent_id δείχνει σε τραγούδι ΑΛΛΟΥ περιβάλλοντος (π.χ. προσωπικό).
   Εξ ορισμού τρέχει σε DRY RUN (dryRun = true) για προεπισκόπηση.
   Όταν εκτελεστεί (dryRun = false), καθαρίζει και τα sync keys για άμεσο καθαρό reload. (11/09/2026) */
window.migrateTransferLinks = async function (dryRun = true) {
    if (!currentUser) { console.warn('[MIGRATE] Απαιτείται σύνδεση.'); return; }

    const { data: all, error } = await supabaseClient
        .from('songs')
        .select('id, title, group_id, parent_id, is_clone, migrated_from')
        .eq('user_id', currentUser.id);
    if (error) { console.error('[MIGRATE] Αποτυχία ανάγνωσης:', error); return; }

    const byId = new Map(all.map(s => [String(s.id), s]));
    const targets = all.filter(s => {
        if (!s.group_id || !s.parent_id || s.is_clone) return false;
        const parent = byId.get(String(s.parent_id));
        if (!parent) return false; // Γονέας άγνωστος: ΔΕΝ αγγίζεται
        return (parent.group_id || null) !== (s.group_id || null);
    });

    console.log(`[MIGRATE] Βρέθηκαν ${targets.length} μεταφορές προς μετατροπή.`);
    console.table(targets.map(s => ({
        id: s.id,
        title: s.title,
        group_id: s.group_id,
        parent_id: s.parent_id,
        exei_hdh_migrated_from: !!s.migrated_from
    })));

    if (dryRun) {
        console.warn('[MIGRATE] 🟡 DRY RUN — καμία αλλαγή στη βάση. Ελέγξτε τον πίνακα παραπάνω.');
        console.warn('[MIGRATE] Για εκτέλεση καλέστε: await migrateTransferLinks(false)');
        return;
    }

    let ok = 0, fail = 0;
    for (const s of targets) {
        const payload = {
            parent_id: null,
            migrated_from: s.migrated_from || {
                source: 'personal',
                original_song_id: s.parent_id,
                user_id: currentUser.id,
                transferred_at: new Date().toISOString()
            }
        };
        const { error: upErr } = await supabaseClient.from('songs').update(payload).eq('id', s.id);
        if (upErr) { console.error('[MIGRATE] Απέτυχε:', s.id, upErr); fail++; }
        else ok++;
    }
    console.log(`[MIGRATE] ✅ Ολοκληρώθηκε! Επιτυχίες: ${ok}, Αποτυχίες: ${fail}.`);

    // Καθαρισμός sync cache timestamps για άμεση ανανέωση
    localStorage.removeItem('mnotes_last_sync_personal');
    if (typeof myGroups !== 'undefined' && Array.isArray(myGroups)) {
        myGroups.forEach(g => localStorage.removeItem(`mnotes_last_sync_${g.group_id}`));
    }
    console.warn('[MIGRATE] 🔄 Έγινε reset των sync timestamps. Παρακαλώ κάντε ανανέωση (Refresh) της σελίδας.');
};

window.checkDataIntegrity = function () {
    if (!library || library.length === 0) return;

    let anomalies = [];
    const mastersMap = new Map();

    library.forEach(s => {
        if (s.is_deleted) return;

        // 1. Corrupted Versions: has parent_id but crosses context without being a clone,
        // or points to non-existent parent in the same context
        if (s.parent_id && !s.is_clone) {
            const parent = library.find(p => p.id === s.parent_id);
            const crossesContext = parent && (parent.group_id || null) !== (s.group_id || null);
            if (!parent || crossesContext) {
                anomalies.push({ type: 'CROSS_CONTEXT_PARENT', song: s });
            }
        }

        const key = s.parent_id || s.id;
        if (!mastersMap.has(key)) mastersMap.set(key, []);
        mastersMap.get(key).push(s);
    });

    for (const [pid, group] of mastersMap) {
        // Έλεγχος διπλότυπων masters ανά context (group_id)
        const byContext = {};
        group.forEach(s => {
            if (!s.is_clone) {
                const ctx = s.group_id || 'personal';
                byContext[ctx] = (byContext[ctx] || 0) + 1;
            }
        });
        for (const [ctx, masterCount] of Object.entries(byContext)) {
            if (masterCount > 1) {
                const dupMasters = group.filter(s => !s.is_clone && (s.group_id || 'personal') === ctx);
                anomalies.push({ type: 'DUPLICATE_MASTERS', songs: dupMasters, parent_id: pid, context: ctx });
            }
        }
    }

    if (anomalies.length > 0) {
        console.warn("⚠️ [INTEGRITY] Found data anomalies:", anomalies);

        /* Ανάλυση ανά τύπο — χωρίς αυτό ο πίνακας των 25 αντικειμένων
           δεν λέει τίποτα. Δεν αλλάζει καμία συμπεριφορά. (11/09/2026) */
        const byType = {};
        anomalies.forEach(a => { byType[a.type] = (byType[a.type] || 0) + 1; });
        console.warn('[INTEGRITY] Ανά τύπο:', byType);

        console.table(anomalies.map(a => {
            const s = a.song || (a.songs && a.songs[0]) || {};
            return {
                type: a.type,
                id: s.id,
                title: s.title,
                group_id: s.group_id,
                parent_id: s.parent_id || a.parent_id,
                is_clone: s.is_clone,
                is_deleted: s.is_deleted,
                πλήθος: a.songs ? a.songs.length : 1
            };
        }));

        if (typeof window.showIntegrityWarning === 'function') {
            window.showIntegrityWarning(anomalies);
        }
    }
};
/* =========================================
   APP STATE PERSISTENCE
   ========================================= */
window.saveAppState = function (groupId, viewMode, sidebarTab) {
    const currentStateRaw = localStorage.getItem('mnotes_app_state');
    let state = {};
    if (currentStateRaw) {
        try {
            state = JSON.parse(currentStateRaw);
        } catch (e) { }
    }

    if (groupId) {
        // Safety: Αν το groupId ξεκινάει από 's_' (εκτός αν είναι 'personal'), 
        // πιθανότατα είναι Song ID που πέρασε κατά λάθος. Το αγνοούμε.
        if (groupId !== 'personal' && String(groupId).startsWith('s_')) {
            console.warn("⚠️ [AppState] Blocked saving invalid groupId:", groupId);
        } else {
            state.groupId = groupId;
        }
    }
    if (viewMode) state.viewMode = viewMode;
    if (sidebarTab) state.sidebarTab = sidebarTab;

    safeSetLocal('mnotes_app_state', JSON.stringify(state));
    console.log('?? [AppState] Saved:', state);
};



window.pendingProposals = [];

async function checkMailbox() {
    if (!currentUser) return;
    if (typeof myGroups === 'undefined' || !myGroups || myGroups.length === 0) return;
    
    try {
        const myGroupIds = myGroups.map(g => g.group_id);
        const { data, error } = await supabaseClient
            .from('proposals')
            .select('*')
            .in('group_id', myGroupIds)
            .eq('status', 'pending');

        if (error || !data) return;

        const dismissed = JSON.parse(localStorage.getItem('mnotes_dismissed_proposals') || '[]');
        // Βλέπουμε μόνο τις προτάσεις που ΔΕΝ στείλαμε εμείς και ΔΕΝ έχουμε απορρίψει/αποδεχτεί ήδη.
        // Ο αποστολέας είναι το from_user_id (όχι proposed_by, στήλη που δεν υπάρχει —
        // ήταν ο λόγος που έβλεπες και τις δικές σου προτάσεις στα εισερχόμενα).
        // Ξεδιπλώνουμε το suggested_data ώστε το UI να βρίσκει title/body/key
        // εκεί που τα περιμένει· οι πραγματικές στήλες της γραμμής υπερισχύουν.
        window.pendingProposals = data
            .filter(p => !dismissed.includes(p.id) && p.from_user_id !== currentUser.id)
            // Οι προτάσεις αρχείου ('asset') δεν έχουν ακόμα χειριστή αποδοχής:
            // αν εμφανίζονταν εδώ, η αποδοχή θα δημιουργούσε άκυρο τραγούδι.
            .filter(p => p.proposal_type !== 'asset')
            .map(p => Object.assign({}, p.suggested_data || {}, p));

        const mailboxIcon = document.getElementById('btnMailbox');
        if (mailboxIcon) {
            if (window.pendingProposals.length > 0) {
                mailboxIcon.style.display = 'block'; // Εμφάνιση στο drawer
                const badge = document.getElementById('mailboxBadge');
                if (badge) badge.innerText = window.pendingProposals.length;
            } else {
                mailboxIcon.style.display = 'none';
            }
        }
    } catch (e) {
        console.error("Mailbox check error:", e);
    }
}

window.showMailboxModal = function() {
    if (!window.pendingProposals || window.pendingProposals.length === 0) return;

    let html = window.pendingProposals.map(p => {
        const bandName = myGroups.find(g => g.group_id === p.group_id)?.groups?.name || 'Μπάντα';
        return `
        <div style="background:var(--bg-panel); border:1px solid var(--border-color); padding:10px; border-radius:8px; margin-bottom:10px; display:flex; justify-content:space-between; align-items:center;">
            <div style="text-align:left;">
                <div style="font-weight:bold; color:var(--text-main);">${p.title}</div>
                <div style="font-size:0.8rem; color:var(--text-muted);"><i class="fas fa-users"></i> ${bandName}</div>
            </div>
            <div style="display:flex; gap:8px;">
                <button onclick="acceptProposal('${p.id}')" class="icon-btn accent" title="Αποθήκευση στα Προσωπικά"><i class="fas fa-download"></i></button>
                <button onclick="dismissProposal(event, '${p.id}')" class="icon-btn danger" title="Απόρριψη"><i class="fas fa-times"></i></button>
            </div>
        </div>`;
    }).join('');

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.style.cssText = 'position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.85); display:flex; align-items:center; justify-content:center; z-index:6000; backdrop-filter: blur(4px);';
    
    overlay.innerHTML = `${typeof t === 'function' ? t('auto_msg_4', "\n        <div style=\"background:var(--bg-panel); padding:20px; border-radius:16px; width:340px; text-align:center; border: 1px solid var(--border-color); box-shadow: 0 10px 40px rgba(0,0,0,0.5);\">\n            <i class=\"fas fa-inbox\" style=\"font-size:2rem; color:var(--accent); margin-bottom:15px;\"></i>\n            <h3 style=\"margin-top:0; color:var(--text-main); font-size:1.3rem;\">Εισερχόμενες Προτάσεις</h3>\n            <p style=\"font-size:0.9rem; color:var(--text-muted); margin-bottom:20px;\">Τραγούδια που κοινοποιήθηκαν στις μπάντες σας.</p>\n            <div style=\"max-height: 350px; overflow-y: auto; padding: 2px;\">\n                ") : "\n        <div style=\"background:var(--bg-panel); padding:20px; border-radius:16px; width:340px; text-align:center; border: 1px solid var(--border-color); box-shadow: 0 10px 40px rgba(0,0,0,0.5);\">\n            <i class=\"fas fa-inbox\" style=\"font-size:2rem; color:var(--accent); margin-bottom:15px;\"></i>\n            <h3 style=\"margin-top:0; color:var(--text-main); font-size:1.3rem;\">Εισερχόμενες Προτάσεις</h3>\n            <p style=\"font-size:0.9rem; color:var(--text-muted); margin-bottom:20px;\">Τραγούδια που κοινοποιήθηκαν στις μπάντες σας.</p>\n            <div style=\"max-height: 350px; overflow-y: auto; padding: 2px;\">\n                "}${html}${typeof t === 'function' ? t('auto_msg_3', "\n            </div>\n            <button onclick=\"document.body.removeChild(this.closest('.modal-overlay'));\" style=\"margin-top:15px; padding:10px; width:100%; background:transparent; border:1px solid var(--border-color); color:var(--text-muted); border-radius:10px; cursor:pointer;\">Κλείσιμο</button>\n        </div>\n    ") : "\n            </div>\n            <button onclick=\"document.body.removeChild(this.closest('.modal-overlay'));\" style=\"margin-top:15px; padding:10px; width:100%; background:transparent; border:1px solid var(--border-color); color:var(--text-muted); border-radius:10px; cursor:pointer;\">Κλείσιμο</button>\n        </div>\n    "}`;
    document.body.appendChild(overlay);
};

window.acceptProposal = async function(propId) {
    const prop = window.pendingProposals.find(p => p.id === propId);
    if (!prop) return;

    // Κλείνουμε το mailbox modal
    const overlay = document.querySelector('.modal-overlay:last-of-type');
    if (overlay) overlay.remove();

    // Φόρτωση Προσωπικής Βιβλιοθήκης
    let myPersonalData = JSON.parse(localStorage.getItem('mnotes_data') || '[]');
    
    // Έλεγχος αν υπάρχει ήδη τραγούδι με τον ίδιο τίτλο και καλλιτέχνη
    const cleanPropTitle = prop.title.trim().toLowerCase();
    const cleanPropArtist = (prop.artist || "").trim().toLowerCase();
    const existingSong = myPersonalData.find(s => 
        !s.group_id &&
        s.title.trim().toLowerCase() === cleanPropTitle && 
        (s.artist || "").trim().toLowerCase() === cleanPropArtist
    );

    if (existingSong) {
        // Υπάρχει σύγκρουση! Εμφανίζουμε το modal επιλογής
        const choice = await promptTransferConflict(prop.title, 'Προσωπική Βιβλιοθήκη', false);
        if (choice === 'cancel') {
            window.showMailboxModal();
            return;
        }
        await processAcceptedProposal(prop, existingSong, choice);
    } else {
        // Δεν υπάρχει σύγκρουση, προχωράμε ως νέο
        await processAcceptedProposal(prop, null, 'new');
    }
};

async function processAcceptedProposal(prop, existingSong, mode) {
    let personalSong;
    let isUpdate = false;
    let dismissedPropId = prop.id;

    if (mode === 'replace' && existingSong) {
        isUpdate = true;
        personalSong = {
            ...existingSong,
            body: prop.body,
            key: prop.key,
            intro: prop.intro,
            interlude: prop.interlude,
            notes: prop.notes || existingSong.notes || "",
            video: prop.video || existingSong.video || "",
            tags: prop.tags || existingSong.tags || [],
            updated_at: new Date().toISOString()
        };
    } else {
        const newSongId = "s_" + Date.now() + "_" + Math.random().toString(36).substring(2,7);
        personalSong = {
            id: newSongId,
            title: prop.title,
            artist: prop.artist,
            body: prop.body,
            key: prop.key,
            intro: prop.intro,
            interlude: prop.interlude,
            notes: prop.notes || "",
            video: prop.video || "",
            tags: prop.tags || [],
            user_id: currentUser.id,
            group_id: null,
            updated_at: new Date().toISOString(),
            parent_id: mode === 'clone' ? existingSong.id : null,
            is_clone: mode === 'clone'
        };
    }

    try {
        let myPersonalData = JSON.parse(localStorage.getItem('mnotes_data') || '[]');
        if (isUpdate) {
            const idx = myPersonalData.findIndex(s => s.id === personalSong.id);
            if (idx > -1) myPersonalData[idx] = personalSong;
            else myPersonalData.push(personalSong);
        } else {
            myPersonalData.push(personalSong);
        }
        safeSetLocal('mnotes_data', JSON.stringify(myPersonalData));

        // Αποθήκευση στη Supabase
        if (navigator.onLine && typeof supabaseClient !== 'undefined') {
            const payload = typeof window.sanitizeForDatabase === 'function'
                ? window.sanitizeForDatabase(personalSong, currentUser.id, null)
                : personalSong;
            
            let error;
            if (isUpdate) {
                const { error: err } = await supabaseClient.from('songs').update(payload).eq('id', personalSong.id);
                error = err;
            } else {
                const { error: err } = await supabaseClient.from('songs').insert([payload]);
                error = err;
            }
            if (error) throw error;
        } else if (typeof addToSyncQueue === 'function') {
            addToSyncQueue('SAVE_SONG', personalSong);
        }

        // Σημειώνουμε την πρόταση ως dismissed
        let dismissed = JSON.parse(localStorage.getItem('mnotes_dismissed_proposals') || '[]');
        if (!dismissed.includes(dismissedPropId)) dismissed.push(dismissedPropId);
        safeSetLocal('mnotes_dismissed_proposals', JSON.stringify(dismissed));

        showToast((typeof t === 'function') ? t('msg_proposal_accepted', "Το τραγούδι προστέθηκε στα Προσωπικά σας!") : "Το τραγούδι προστέθηκε στα Προσωπικά σας!", "success");

        checkMailbox();

        if (typeof currentGroupId !== 'undefined' && currentGroupId === 'personal' && typeof loadContextData === 'function') {
            loadContextData();
        }
    } catch (e) {
        console.error("Accept error:", e);
        showToast((typeof t === 'function' ? t('auto_msg_2', "Σφάλμα αποθήκευσης") : "Σφάλμα αποθήκευσης"), "error");
    }
}

// Το e περνιέται πλέον ρητά. Παλιότερα η συνάρτηση διάβαζε το καθολικό
// `event` — σιωπηρή, παρωχημένη δυνατότητα που δουλεύει μόνο σε ορισμένα
// προγράμματα περιήγησης. Αόρατο μέχρι τώρα, γιατί οι προτάσεις δεν
// έφταναν ποτέ στο γραμματοκιβώτιο· τώρα που φτάνουν, ο κώδικας τρέχει.
window.dismissProposal = function(e, propId) {
    let dismissed = JSON.parse(localStorage.getItem('mnotes_dismissed_proposals') || '[]');
    if (!dismissed.includes(propId)) dismissed.push(propId);
    safeSetLocal('mnotes_dismissed_proposals', JSON.stringify(dismissed));
    
    // Αφαιρούμε από το DOM άμεσα για καλό UX
    const btn = e && e.currentTarget;
    if (btn) {
        const row = btn.closest('div[style*="justify-content:space-between"]');
        if (row) row.remove();
    }
    
    checkMailbox();
};



window.forceFullSync = async function() {
    if (!navigator.onLine) {
        if(typeof showToast==="function") showToast(typeof t==="function"?t("msg_err_offline"):"You are offline", "error");
        return;
    }
    if (typeof canUserPerform === 'function' && !canUserPerform('CLOUD_SYNC')) {
        if(typeof showToast==="function") showToast(typeof t==="function"?t("msg_sync_not_available", "Ο συγχρονισμός Cloud δεν είναι διαθέσιμος στο πακέτο σας."):"Ο συγχρονισμός Cloud δεν είναι διαθέσιμος στο πακέτο σας.", "error");
        return;
    }
    const pendingCount = (typeof getPendingSyncCount === 'function') ? getPendingSyncCount() : 0;
    if (pendingCount > 0) {
        const titles = [];
        try {
            const q = JSON.parse(localStorage.getItem('mnotes_sync_queue') || "[]");
            if (Array.isArray(q)) q.forEach(it => { if (it && it.data) titles.push(it.data.title || it.data.id); });
        } catch (e) {}
        getFailedSyncItems().forEach(it => { if (it) titles.push(it.title || it.id); });
        const uniqueTitles = [...new Set(titles.filter(Boolean))];
        const titleList = uniqueTitles.slice(0, 5).join(', ') + (uniqueTitles.length > 5 ? ` (+${uniqueTitles.length - 5})` : '');
        const baseMsg = typeof t === 'function'
            ? t('msg_sync_pending_queue', `Υπάρχουν ${pendingCount} εκκρεμείς αλλαγές προς συγχρονισμό. Περιμένετε να ολοκληρωθεί ο συγχρονισμός πριν την επαναφορά.`)
            : `Υπάρχουν ${pendingCount} εκκρεμείς αλλαγές προς συγχρονισμό. Περιμένετε να ολοκληρωθεί ο συγχρονισμός πριν την επαναφορά.`;
        const fullMsg = titleList ? `${baseMsg} [${titleList}]` : baseMsg;
        if (typeof showToast === "function") showToast(fullMsg, "warning");
        return fullMsg;
    }
    const syncTimeKey = "mnotes_last_sync_" + currentGroupId;
    const storageKey = currentGroupId === "personal" ? "mnotes_data" : "mnotes_band_" + currentGroupId;
    localStorage.removeItem(syncTimeKey);
    localStorage.removeItem(storageKey);
    try { sessionStorage.setItem('mnotes_force_syncing', '1'); } catch (e) {}
    if(typeof showToast==="function") showToast((typeof t === 'function' ? t('auto_msg_1', "Εκκίνηση Πλήρους Συγχρονισμού... 🔄") : "Εκκίνηση Πλήρους Συγχρονισμού... 🔄"));
    setTimeout(() => { location.reload(); }, 800);
};

window.renderFailedSyncList = function() {
    const container = document.getElementById('failedSyncSection');
    if (!container) return;
    const items = getFailedSyncItems();
    if (!items.length) {
        container.style.display = 'none';
        container.innerHTML = '';
        return;
    }
    const esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const heading = typeof t === 'function' ? t('lbl_failed_sync_title', 'Αποτυχημένοι συγχρονισμοί Cloud') : 'Αποτυχημένοι συγχρονισμοί Cloud';
    const btnNew = typeof t === 'function' ? t('btn_save_as_new_sync', 'Αντιγραφή ως νέο') : 'Αντιγραφή ως νέο';
    const btnDel = typeof t === 'function' ? t('btn_delete_local_sync', 'Διαγραφή τοπικού') : 'Διαγραφή τοπικού';
    container.style.display = 'block';
    container.innerHTML = `
        <h4 style="color:#ff6b6b; margin-bottom:10px; font-size:0.85em; text-transform:uppercase;">⚠️ ${esc(heading)} (${items.length})</h4>
        <div style="display:flex; flex-direction:column; gap:8px;">
            ${items.map(it => `
                <div style="padding:8px 10px; border-radius:6px; background:rgba(255,80,80,0.08); border:1px solid rgba(255,80,80,0.25); font-size:0.85rem;">
                    <div style="font-weight:bold; margin-bottom:3px;">${esc(it.title || it.id)}</div>
                    <div style="font-size:0.75rem; color:var(--text-muted); margin-bottom:6px;">${esc(it.errorCode)}: ${esc(it.errorMessage)}</div>
                    <div style="display:flex; gap:6px; flex-wrap:wrap;">
                        <button type="button" class="modal-btn accent" style="padding:4px 8px; font-size:0.75rem;" onclick="retryFailedSyncAsNew('${esc(it.id)}')">${esc(btnNew)}</button>
                        <button type="button" class="modal-btn" style="padding:4px 8px; font-size:0.75rem; color:#ff6b6b;" onclick="deleteFailedLocalSong('${esc(it.id)}')">${esc(btnDel)}</button>
                    </div>
                </div>
            `).join('')}
        </div>
    `;
};

window.retryFailedSyncAsNew = async function(songId) {
    const items = getFailedSyncItems();
    const entry = items.find(it => it && it.id === songId);
    if (!entry || !entry.payload) return;

    const uid = (typeof currentUser !== 'undefined' && currentUser) ? currentUser.id : null;
    const freshId = "s_" + Date.now() + "_" + Math.random().toString(36).substring(2, 7);
    const cloned = {
        ...entry.payload,
        id: freshId,
        group_id: null,
        user_id: uid,
        parent_id: null,
        is_clone: false,
        updated_at: new Date().toISOString()
    };
    delete cloned._syncError;

    // Αποθήκευση στα προσωπικά τοπικά
    try {
        const raw = localStorage.getItem('mnotes_data');
        const list = raw ? JSON.parse(raw) : [];
        list.push(typeof window.ensureSongStructure === 'function' ? window.ensureSongStructure(cloned) : cloned);
        safeSetLocal('mnotes_data', JSON.stringify(list));
    } catch (e) {}

    removeFailedSyncItem(songId);
    if (typeof saveToCloud === 'function') await saveToCloud(cloned, null);
    if (typeof window.renderFailedSyncList === 'function') window.renderFailedSyncList();
    if (typeof loadContextData === 'function') await loadContextData({ showToast: false });
    if (typeof showToast === 'function') showToast(t('msg_saved_cloud', "Αποθηκεύτηκε στο Cloud! ☁️"), 'success');
};

window.deleteFailedLocalSong = function(songId) {
    const items = getFailedSyncItems();
    const entry = items.find(it => it && it.id === songId);
    const groupId = entry ? entry.group_id : null;
    removeFailedSyncItem(songId);

    if (typeof library !== 'undefined' && Array.isArray(library)) {
        const idx = library.findIndex(s => s && s.id === songId);
        if (idx > -1) library.splice(idx, 1);
    }
    const keys = groupId ? [`mnotes_band_${groupId}`] : ['mnotes_data'];
    for (const key of keys) {
        try {
            const raw = localStorage.getItem(key);
            if (!raw) continue;
            const arr = JSON.parse(raw).filter(s => s && s.id !== songId);
            safeSetLocal(key, JSON.stringify(arr));
        } catch (e) {}
    }
    if (typeof renderSidebar === 'function') renderSidebar();
    if (typeof window.renderFailedSyncList === 'function') window.renderFailedSyncList();
};

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        classifyCloudError,
        getPendingSyncCount,
        getFailedSyncItems,
        addToFailedSync,
        removeFailedSyncItem,
        saveToCloud,
        processSyncQueue,
        forceFullSync: window.forceFullSync
    };
}
