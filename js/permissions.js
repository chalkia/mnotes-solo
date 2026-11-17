/**
 * mNotes Permissions & Tier System (js/permissions.js)
 * Η κεντρική πηγή αλήθειας για τα δικαιώματα πρόσβασης.
 *
 * =========================================================================
 * ΕΠΕΞΗΓΗΣΗ ΡΟΛΩΝ ΒΑΣΗΣ ΔΕΔΟΜΕΝΩΝ (SUPABASE) vs ΣΥΝΔΡΟΜΩΝ (TIERS)
 * =========================================================================
 * Τα Tiers αφορούν την πληρωμή/συνδρομή του χρήστη (π.χ. Maestro, Ensemble).
 * Οι "Ρόλοι" αφορούν τη θέση ενός χρήστη ΜΕΣΑ σε μια συγκεκριμένη μπάντα,
 * και ρυθμίζουν τι μπορεί να κάνει στη βιβλιοθήκη της μπάντας.
 * 
 * | DB Role (Supabase) | Περιγραφή / Δικαιώματα                                               |
 * |--------------------|----------------------------------------------------------------------|
 * | owner              | Ιδιοκτήτης/Ιδρυτής. Πλήρη δικαιώματα διαχείρισης. Μπορεί να διώξει,  |
 * |                    | να αναβαθμίσει (promotes), να διαλύσει τη μπάντα (disband), και να   |
 * |                    | απονείμει Sponsored Tickets. (Συνήθως έχει πακέτο Maestro/Ensemble)  |
 * |--------------------|----------------------------------------------------------------------|
 * | admin              | Διαχειριστής. Επεξεργάζεται Master αρχεία, ρυθμούς κλπ.              |
 * |                    | ΔΕΝ μπορεί να διώξει τον owner ή να διαλύσει την μπάντα.             |
 * |--------------------|----------------------------------------------------------------------|
 * | member             | Απλό μέλος. Μπορεί να παίξει τραγούδια, να φτιάξει δικά του setlists |
 * |                    | και personal overrides. ΔΕΝ επεξεργάζεται τα κεντρικά Master αρχεία. |
 * |--------------------|----------------------------------------------------------------------|
 * | viewer             | Μόνο ανάγνωση. Δεν μπορεί να πειράξει τίποτα, ούτε overrides. Συνήθως|
 * |                    | ρόλος που δίνεται προσωρινά. Το πακέτο Ensemble υποστηρίζει          |
 * |                    | απεριόριστους δωρεάν Viewers για προσωρινές λίστες.                  |
 * =========================================================================
 */

const TIER_CONFIG = {
    guest: { 
        label: "Guest",
        canCloudSync: false, 
        maxBandsOwned: 0,
        maxSongs: 0,
        maxGuestSongs: 5,
        maxSetlists: 1,
        hasAdvancedDrums: false,
        storageLimitMB: 0,
        includedBandMates: 0,
        includedViewers: 0,
        hasUnlimitedViewers: false
    },
    solo_free: { 
        label: "Free",
        canCloudSync: false, 
        maxBandsOwned: 0,
        maxSongs: 40,
        maxSetlists: 1,
        hasAdvancedDrums: false,
        storageLimitMB: 0,
        includedBandMates: 0,
        includedViewers: 0,
        hasUnlimitedViewers: false
    },
    edition_solo_free: {
        label: "Solo Free",
        canCloudSync: false,
        maxBandsOwned: 0,
        maxSongs: 20,
        maxGuestSongs: 20,
        maxSetlists: 20,
        hasAdvancedDrums: false,
        storageLimitMB: 0,
        includedBandMates: 0,
        includedViewers: 0,
        hasUnlimitedViewers: false
    },
    edition_solo_paid: {
        label: "Solo",
        canCloudSync: false,
        maxBandsOwned: 0,
        maxSongs: 999,
        maxGuestSongs: 999,
        maxSetlists: 999,
        hasAdvancedDrums: true,
        storageLimitMB: 0,
        includedBandMates: 0,
        includedViewers: 0,
        hasUnlimitedViewers: false
    },
    solo_plus: { 
        label: "Plus",
        canCloudSync: true, 
        maxBandsOwned: 0,
        maxSongs: 999,
        maxSetlists: 20,
        hasAdvancedDrums: true,
        storageLimitMB: 0,
        includedBandMates: 0,
        includedViewers: 0,
        hasUnlimitedViewers: false
    },
    band_mate: { 
        label: "Mate",
        canCloudSync: true, 
        maxBandsOwned: 1,
        maxSongs: 9999,
        maxSetlists: 50,
        hasAdvancedDrums: true,
        storageLimitMB: 200,
        includedBandMates: 0,
        includedViewers: 0,
        hasUnlimitedViewers: false
    },
    band_maestro: { 
        label: "Maestro",
        canCloudSync: true, 
        maxBandsOwned: 5,
        maxSongs: 99999,
        maxSetlists: 150,
        hasAdvancedDrums: true,
        storageLimitMB: 4500,
        includedBandMates: 0,
        includedViewers: 0,
        hasUnlimitedViewers: false
    },
    ensemble: { 
        label: "Ensemble",
        canCloudSync: true, 
        maxBandsOwned: 15,
        maxSongs: 99999,
        maxSetlists: 9999,
        hasAdvancedDrums: true,
        storageLimitMB: 15000,
        includedBandMates: 9,
        includedViewers: 0,
        hasUnlimitedViewers: true
    }
};

/**
 * Μετατρέπει τα διάφορα aliases του database σε εσωτερικά κλειδιά του TIER_CONFIG
 */
function mapTierKey(rawTier) {
    if (!rawTier) return 'solo_free';
    const clean = String(rawTier).toLowerCase().trim();
    const map = {
        'free': 'solo_free', 'solo_free': 'solo_free',
        'solo': 'solo_plus', 'plus': 'solo_plus', 'solo_plus': 'solo_plus',
        'pro': 'band_mate', 'member': 'band_mate', 'band_mate': 'band_mate', 'mate': 'band_mate',
        'owner': 'band_maestro', 'leader': 'band_maestro', 'band_leader': 'band_maestro', 'maestro': 'band_maestro', 'band_maestro': 'band_maestro',
        'ensemble': 'ensemble',
        'edition_solo_paid': 'edition_solo_paid'
    };
    return map[clean] || 'solo_free';
}

/**
 * Επιστρέφει τα ενεργά special unlocks του προφίλ (αγνοώντας τα αν έχουν λήξει)
 * @param {object|null} profile
 * @returns {object}
 */
function getActiveUnlocks(profile) {
    if (!profile || typeof profile !== 'object') return {};
    const unlocks = profile.special_unlocks || {};
    if (unlocks.expires_at) {
        const expireDate = new Date(unlocks.expires_at).getTime();
        if (Date.now() > expireDate) {
            return {};
        }
    }
    return unlocks;
}

/**
 * Επιστρέφει το ενεργό ακατέργαστο tier string (λαμβάνοντας υπόψη ενεργό gift_tier)
 * @param {object|null} profile
 * @returns {string|null}
 */
function getActiveTierRaw(profile) {
    if (!profile || typeof profile !== 'object') return null;
    const unlocks = getActiveUnlocks(profile);
    return unlocks.gift_tier || profile.subscription_tier || profile.tier || null;
}

function currentEdition() {
    return (typeof window !== 'undefined' && window.MNOTES_EDITION === 'solo') ? 'solo' : 'pro';
}

/**
 * Επιστρέφει τα όρια και τις δυνατότητες του τρέχοντος χρήστη
 */
function getUserLimits() {
    // Αν δεν υπάρχει profile ή user, επιστρέφει Guest (ή Solo Free στη Solo)
    const prof = (typeof userProfile !== 'undefined' && userProfile) ? userProfile : (typeof window !== 'undefined' ? window.userProfile : null);
    if (!prof) {
        return currentEdition() === 'solo' ? TIER_CONFIG['edition_solo_free'] : TIER_CONFIG['guest'];
    }

    const unlocks = getActiveUnlocks(prof);
    const activeTierRaw = getActiveTierRaw(prof);
    const tierKey = mapTierKey(activeTierRaw);
    const baseConfig = TIER_CONFIG[tierKey] || TIER_CONFIG['solo_free'];

    const extraStorage = parseInt(unlocks.extra_storage_mb || 0, 10);
    const extraBands = parseInt(unlocks.extra_bands || 0, 10);
    const extraSeats = parseInt(unlocks.extra_seats || 0, 10);
    const extraViewers = parseInt(unlocks.extra_viewers || 0, 10);

    return {
        ...baseConfig,
        tierKey: tierKey,
        storageLimitMB: baseConfig.storageLimitMB + extraStorage,
        maxBandsOwned: baseConfig.maxBandsOwned + extraBands,
        includedBandMates: baseConfig.includedBandMates + extraSeats,
        includedViewers: baseConfig.includedViewers + extraViewers
    };
}

// ── Ορισμός Σταθερών & Πίνακα Ενεργειών (ACTIONS) ──────────────────────────
const GUEST_LIMITS = {
    maxSongs: 5
};

const TIER_ORDER = {
    'free': 1,
    'plus': 2,
    'pro': 3
};

function tierAtLeast(userTier, minRequiredTier) {
    if (!userTier) return false;
    const userRank = TIER_ORDER[userTier] || 0;
    const reqRank = TIER_ORDER[minRequiredTier] || 0;
    return userRank >= reqRank;
}

const ACTIONS = {
    // ── Άξονας 1: Λογαριασμός (Account) ─────────────────────────
    USE_SUPABASE:         { axes: ['account'], minAccount: 'pro' },
    CLOUD_SYNC:           { axes: ['account'], minAccount: 'pro' },
    SAVE_ATTACHMENTS:     { axes: ['account'], minAccount: 'pro' },
    MSTUDIO_ASSETS:       { axes: ['account'], minAccount: 'pro' },
    UNDELETE_SONGS:       { axes: ['account'], minAccount: 'pro' },

    // Ενέργειες που απαιτούσαν band_mate και πάνω -> minAccount: 'pro'
    MSTUDIO_BAND_MGR:     { axes: ['account'], minAccount: 'pro' },
    MSTUDIO_DRUM_MACHINE: { axes: ['account'], minAccount: 'pro' },
    MSTUDIO_ABC:          { axes: ['account'], minAccount: 'pro' },
    ADVANCED_DRUMS:       { axes: ['account'], minAccount: 'pro' },
    USE_RHYTHMS:          { axes: ['account'], minAccount: 'pro' },
    MANAGE_BANDS:         { axes: ['account'], minAccount: 'pro' },

    // Παλιό JOIN_BANDS (διατηρεί 100% την παλιά συμπεριφορά στη Φάση Α)
    JOIN_BANDS:           { axes: ['account'], minAccount: 'pro' },

    // Όρια ποσοστώσεων (στη Φάση Α διαβάζονται από το υπάρχον getUserLimits)
    CREATE_SONG:          { axes: ['account'], limit: 'maxSongs' },
    CREATE_SETLIST:       { axes: ['account'], limit: 'maxSetlists' },
    CREATE_BAND:          { axes: ['account'], limit: 'maxBandsOwned' },

    // Ελεύθερες ενέργειες (χωρίς άξονες περιορισμού)
    CREATE_GUEST_SONG:    { axes: [], limit: 'guestSongs' },
    USE_MSTUDIO:          { axes: ['account'], minAccount: 'pro' },
    PRINT:                { axes: [] },
    GUEST_EXPORT:         { axes: [] },

    // ── Άξονας 2 & 3: Νέος Κανόνας Θέσης (Δεν συνδέεται ακόμα σε καλούντες) ──
    ACCESS_BAND:          { axes: ['account', 'plan'] },

    // ── Άξονας 3: Ρόλοι Μπάντας (Group Roles - Ενέργειες Σκοπού Φάσης Β) ────
    INVITE_BAND_MEMBERS:    { axes: ['role'], roles: ['owner', 'admin', 'maestro'] },
    DELETE_LIBRARY_ASSET:   { axes: ['role'], roles: ['owner', 'admin', 'maestro'] },
    UPLOAD_SHARED_ASSET:    { axes: ['role'], roles: ['owner', 'admin', 'maestro', 'member'] },
    REMOVE_MASTER_ASSET:    { axes: ['role'], roles: ['owner', 'admin', 'maestro'] },
    DELETE_BAND_RECORDING:  { axes: ['role'], roles: ['owner', 'admin'] },
    DELETE_BAND_ATTACHMENT: { axes: ['role'], roles: ['owner', 'admin'] },
    MANAGE_BAND_RHYTHMS:    { axes: ['role'], roles: ['owner', 'maestro'] },
    REORDER_BAND_SETLIST:   { axes: ['role'], roles: ['owner', 'admin', 'maestro'] },
    EDIT_BAND_MASTER:       { axes: ['role'], roles: ['owner', 'admin', 'maestro'] },
    SEE_BAND_VERSION_BAR:   { axes: ['role'], roles: ['owner', 'admin', 'maestro'] },
    WITHDRAW_BAND_SONG:     { axes: ['role'], roles: ['owner', 'admin', 'maestro'] },
    IMPORT_BAND_FILES:      { axes: ['role'], roles: ['owner', 'admin', 'maestro'] },
    UPDATE_BAND_SETLIST:    { axes: ['role'], roles: ['owner', 'admin', 'maestro'] },
    CREATE_BAND_SETLIST:    { axes: ['role'], roles: ['owner', 'admin', 'maestro'] },
    EDIT_BAND_SETLIST:      { axes: ['role'], roles: ['owner', 'admin', 'maestro'] },
    SHARE_SETLIST:          { axes: ['role'], notRoles: ['viewer', 'guest_singer'] },
    ADD_PUBLIC_RECORDING:   { axes: ['role'], roles: ['owner', 'admin', 'maestro'] },
    ADD_PUBLIC_ATTACHMENT:  { axes: ['role'], roles: ['owner', 'admin', 'maestro'] },
    SAVE_OVERRIDE:          { axes: ['role'], notRoles: ['viewer'] },
    EDIT_SONG:              { axes: ['role'], notRoles: ['viewer'] },
    CLONE_SONG:             { axes: ['role'], notRoles: ['viewer'] },
    PROMOTE_BAND_ITEM:      { axes: ['role'], roles: ['owner', 'admin', 'maestro'] },
    DELETE_MASTER_SONG:     { axes: ['role'], roles: ['owner', 'admin', 'maestro'] },
    RESTRICTED_TO_READING:  { axes: ['role'], roles: ['viewer', 'guest_singer'] },

    // Διατηρούνται επίσης όσα είχαν οριστεί στη Φάση Α
    DELETE_BAND_SONG:       { axes: ['role'], roles: ['owner', 'admin', 'maestro'] },
    MANAGE_BAND_MEMBERS:    { axes: ['role'], roles: ['owner', 'admin', 'maestro'] },
    TRANSFER_OWNERSHIP:     { axes: ['role'], roles: ['owner'] },
    DISBAND_GROUP:          { axes: ['role'], roles: ['owner'] }
};

/**
 * Επιστρέφει το κανονικοποιημένο επίπεδο λογαριασμού (Άξονας 1)
 * @param {object|null} profile - Το προφίλ του χρήστη (userProfile)
 * @returns {'free'|'plus'|'pro'|null}
 */
function accountTier(profile) {
    if (!profile || typeof profile !== 'object') return null;

    const activeTierRaw = getActiveTierRaw(profile);
    const tierKey = mapTierKey(activeTierRaw);

    // Σύμπτυξη των κλειδιών του TIER_CONFIG στους 3 άξονες
    switch (tierKey) {
        case 'solo_free':
            return 'free';
        case 'solo_plus':
            return 'plus';
        case 'band_mate':
        case 'band_maestro':
        case 'ensemble':
            return 'pro';
        default:
            return 'free';
    }
}

/**
 * Επιστρέφει το πλάνο της μπάντας (Άξονας 2)
 * @param {object|null} group - Το αντικείμενο της μπάντας
 * @returns {'band'|'ensemble'|null}
 */
function bandPlan(group) {
    if (!group || typeof group !== 'object') return null;
    if (group.plan) return String(group.plan).toLowerCase().trim();
    const gid = group.id || group.group_id;
    if (gid && gid !== 'personal') return 'band';
    return null;
}

/**
 * Κατασκευάζει το περιβάλλον ελέγχου πρόσβασης για μια μπάντα (Φάση Β2)
 * @param {object|null} groupData - Το αντικείμενο της ομάδας (από myGroups)
 * @returns {{ account: string|null, plan: string|null, planExpiresAt: string|null, role: string|null }}
 */
function bandAccessCtx(groupData) {
    const profile = (typeof userProfile !== 'undefined') ? userProfile : null;
    const g = (groupData && groupData.groups) ? groupData.groups : null;
    // ΚΡΙΣΙΜΟ: παλιά cache (mnotes_my_groups) δεν έχει καθόλου το κλειδί 'plan'.
    // Απουσία κλειδιού  = παλιά εγγραφή -> τη θεωρούμε 'band' (όλες οι σημερινές
    //                     μπάντες είναι band), αλλιώς κλειδώνονται έξω offline.
    // Κλειδί με τιμή null = συνεργατική μπάντα.
    let plan;
    if (!g || !Object.prototype.hasOwnProperty.call(g, 'plan')) plan = 'band';
    else plan = g.plan ? String(g.plan).toLowerCase().trim() : null;
    return {
        account: profile ? accountTier(profile) : null,
        plan: plan,
        planExpiresAt: g ? (g.plan_expires_at || null) : null,
        role: groupData ? groupData.role : null
    };
}

/**
 * Επιστρέφει τον ρόλο του χρήστη μέσα στην ομάδα (Άξονας 3)
 * @param {object|string|null} groupMember - Το μέλος ή το string του ρόλου
 * @returns {'owner'|'maestro'|'admin'|'member'|'viewer'|'guest_singer'|null}
 */
function roleIn(groupMember) {
    if (!groupMember) return null;
    let r = typeof groupMember === 'string' ? groupMember : (groupMember.role || null);
    if (!r) return null;
    const clean = String(r).toLowerCase().trim();
    const VALID_ROLES = ['owner', 'maestro', 'admin', 'member', 'viewer', 'guest_singer'];
    return VALID_ROLES.includes(clean) ? clean : null;
}

/**
 * Η Ενιαία Πύλη Ελέγχου Δικαιωμάτων (Unified Decision Engine)
 * @param {string} action - Το αναγνωριστικό της ενέργειας
 * @param {object} ctx - Το περιβάλλον ελέγχου { account, plan, role, currentCount, availableSeats, occupiesSeat, limits }
 * @returns {boolean}
 */
const SOLO_DENY = new Set([
    'USE_SUPABASE', 'CLOUD_SYNC', 'SAVE_ATTACHMENTS', 'UNDELETE_SONGS',
    'MSTUDIO_ASSETS', 'MSTUDIO_BAND_MGR', 'MSTUDIO_DRUM_MACHINE', 'MSTUDIO_ABC',
    'USE_MSTUDIO', 'MANAGE_BANDS', 'JOIN_BANDS', 'CREATE_BAND', 'ACCESS_BAND', 'ADVANCED_DRUMS'
]);

function can(action, ctx = {}) {
    if (currentEdition() === 'solo') {
        if (SOLO_DENY.has(action)) return false;
        if (action === 'USE_RHYTHMS') return true;
    }

    const def = ACTIONS[action];
    if (!def) {
        console.warn(`[Permissions] Unknown action: "${action}"`);
        return false;
    }

    // 1. ACCESS_BAND (Έλεγχος πρόσβασης σε μπάντα - Φάση Β2)
    if (action === 'ACCESS_BAND') {
        // Συνεργατική μπάντα: μηδέν προπληρωμένες θέσεις, μπαίνει μόνο ο Pro.
        if (ctx.plan === null) return ctx.account === 'pro';
        // Band / Ensemble: μπαίνει κάθε μέλος. Το ποιος πληρώνει τη θέση
        // κρίθηκε στην πρόσκληση. Η λήξη του πλάνου ΔΕΝ κλείνει την πόρτα —
        // δίνει πρόσβαση μόνο για ανάγνωση (isBandLocked).
        if (ctx.plan === 'band' || ctx.plan === 'ensemble') return true;
        return false;
    }

    // 2. Ενέργειες βασισμένες σε ρόλο (Role-based)
    if (def.notRoles) {
        if (!ctx.role) return true; // Ρόλος undefined/null/'' = επιτρέπεται (ανοιχτό fail-safe για αρνητικούς ελέγχους)
        return !def.notRoles.includes(ctx.role);
    }

    if (def.roles) {
        if (!ctx.role) return false; // Λείπει ρόλος -> false (κλειστό fail-safe για θετικούς ελέγχους)
        return def.roles.includes(ctx.role);
    }

    // 3. Ενέργειες με αριθμητικά όρια (Quotas / limits)
    if (def.limit) {
        const count = typeof ctx.currentCount === 'number' ? ctx.currentCount : 0;
        if (def.limit === 'guestSongs') {
            // Μόνο για μη συνδεδεμένους επισκέπτες (ctx.account === null)
            if (ctx.account !== null) return false;
            const maxGuest = currentEdition() === 'solo' ? TIER_CONFIG.edition_solo_free.maxSongs : GUEST_LIMITS.maxSongs;
            return count < maxGuest;
        }
        const limits = ctx.limits || (typeof getUserLimits === 'function' ? getUserLimits() : null);
        if (!limits) return false;
        const max = limits[def.limit];
        return typeof max === 'number' ? count < max : false;
    }

    // 4. Ελάχιστο απαιτούμενο πακέτο λογαριασμού (minAccount)
    if (def.minAccount) {
        return tierAtLeast(ctx.account, def.minAccount);
    }

    // 5. Ελεύθερες ενέργειες (χωρίς άξονες περιορισμού)
    if (def.axes && def.axes.length === 0) {
        return true;
    }

    return false;
}

/**
 * Ελέγχει δικαιώματα βάσει του τρέχοντος ρόλου (currentRole)
 * ⚠️ ΠΡΟΣΟΧΗ: Διαβάζουμε μόνο το σκέτο αναγνωριστικό currentRole (με typeof guard),
 * ποτέ window.currentRole. Στο browser το 'let currentRole' στο top-level
 * δηλώνεται στο declarative environment record και ΔΕΝ προσαρτάται στο window.
 * @param {string} action
 * @returns {boolean}
 */
function roleCan(action) {
    const r = (typeof currentRole !== 'undefined') ? currentRole : null;
    return can(action, { role: r });
}

/**
 * Ο Κεντρικός Πορτιέρης της Εφαρμογής (Wrapper συμβατότητας Φάσης Α)
 */
function canUserPerform(action, currentCount = 0) {
    const limits = getUserLimits();
    const account = (typeof userProfile !== 'undefined' && userProfile) 
        ? accountTier(userProfile) 
        : null;

    const ctx = {
        account: account,
        limits: limits,
        currentCount: currentCount
    };

    return can(action, ctx);
}

/**
 * Δυναμική προτροπή αναβάθμισης (promptUpgrade)
 * Εμφανίζει το dynamic warning banner στο pricingModal με την κατάλληλη αιτιολογία.
 */
function promptUpgrade(featureName) {
    if (typeof document === 'undefined') return;
    const alertDiv = document.getElementById('pricingBlockAlert');
    const alertText = document.getElementById('pricingBlockAlertText');
    const pricingModal = document.getElementById('pricingModal');
    
    if (alertDiv && alertText && pricingModal) {
        const isEn = (typeof currentLang !== 'undefined' && currentLang === 'en');
        const prefix = isEn ? "Upgrade Required: " : "Απαιτείται Αναβάθμιση: ";
        const suffix = isEn 
            ? `The action "${featureName}" is not available in your current tier.` 
            : `Η ενέργεια "${featureName}" δεν υποστηρίζεται από το τρέχον πακέτο σας.`;
        
        alertText.innerHTML = `<strong>${prefix}</strong> ${suffix}`;
        alertDiv.style.display = 'flex';
        pricingModal.style.display = 'flex';
    } else {
        if (typeof showToast === 'function') {
            const isEn = (typeof currentLang !== 'undefined' && currentLang === 'en');
            const msg = isEn 
                ? `Upgrade required for: ${featureName}` 
                : `Απαιτείται αναβάθμιση για: ${featureName}`;
            showToast(msg, "warning");
        } else if (typeof alert === 'function') {
            alert(`Upgrade required for: ${featureName}`);
        }
    }
}

// ── Καθολική Έκθεση (Global & Module Exports) ─────────────────────────────
if (typeof window !== 'undefined') {
    window.GUEST_LIMITS = GUEST_LIMITS;
    window.TIER_ORDER = TIER_ORDER;
    window.tierAtLeast = tierAtLeast;
    window.ACTIONS = ACTIONS;
    window.getActiveUnlocks = getActiveUnlocks;
    window.getActiveTierRaw = getActiveTierRaw;
    window.accountTier = accountTier;
    window.bandPlan = bandPlan;
    window.bandAccessCtx = bandAccessCtx;
    window.roleIn = roleIn;
    window.currentEdition = currentEdition;
    window.SOLO_DENY = SOLO_DENY;
    window.can = can;
    window.roleCan = roleCan;
    window.canUserPerform = canUserPerform;
    window.promptUpgrade = promptUpgrade;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        ACTIONS,
        SOLO_DENY,
        currentEdition,
        GUEST_LIMITS,
        TIER_CONFIG,
        TIER_ORDER,
        tierAtLeast,
        getActiveUnlocks,
        getActiveTierRaw,
        accountTier,
        bandPlan,
        bandAccessCtx,
        roleIn,
        can,
        roleCan,
        canUserPerform,
        getUserLimits,
        mapTierKey,
        promptUpgrade
    };
}


