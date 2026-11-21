const CACHE_NAME = 'mnotes-solo-v2.7.5T.211126-b665889';

/* ΚΡΙΣΙΜΑ: χωρίς αυτά το mNotes δεν ανοίγει offline.
   Αν έστω ένα αποτύχει, η εγκατάσταση του SW ΑΠΟΤΥΓΧΑΝΕΙ και ο browser
   ξαναπροσπαθεί. Καλύτερα καθόλου offline παρά ψεύτικο offline: το παλιό
   catch κατάπινε το σφάλμα και η εφαρμογή δήλωνε έτοιμη με μισοάδεια
   cache. (07/09/2026) */
const CORE_ASSETS = [
    './',
    'index.html',
    'style.css',
    'manifest.json',
    'js/edition.js',
    'js/config.js',
    'js/supabase.min.js',
    'js/sortable.min.js',
    'js/data.js',
    'js/translations.js',
    'js/storage.js',
    'js/auth.js',
    'js/permissions.js',
    'libs/fflate.min.js',
    'js/modules/package.js',
    'js/solo/local-storage-policy.js',
    'js/solo/local-assets.js',
    'js/solo/backup.js',
    'js/logic.js',
    'js/floating-tools.js',
    'js/tuner.js',
    'js/ui.js',
    'js/release-notes.js',
    'js/chord-player.js',
    'js/chord-assistant.js',
    'js/chord-oracle.js',
    'js/harmony-dictionary.js',
    'js/chords.js',
    'js/app.js',
    'js/modules/utils.js',
    'js/modules/setlist-manager.js',
    'js/modules/assets.js',
    'js/modules/played-set.js',
    'js/modules/player.js',
    'js/modules/editor.js',
    'js/modules/library.js',
    'js/modules/settings.js',
    'js/modules/ui-utils.js',
    'js/modules/rhythm.js',
    'js/modules/theory.js',
    'js/modules/visuals.js',
    'js/modules/band.js',
    'js/modules/export.js',
    'js/sample-kit-data.js',
    'js/universal-percussion-engine.js',
    'js/custom-kits.js',
    'js/drum-machine.js',
    'js/mnotes-rhythm-runtime.js',
    'js/basicmetronome.js',
    'fa/css/all.min.css'
];

/* ΠΡΟΑΙΡΕΤΙΚΑ: η απουσία τους χαλάει την εμφάνιση ή μια δευτερεύουσα
   λειτουργία, δεν εμποδίζει το άνοιγμα. Αποτυχία καταγράφεται και
   αγνοείται. */
const OPTIONAL_ASSETS = [
    'release-notes.json',
    'icon-192solo.png',
    'icon-512solo.png',
    'libs/jspdf.umd.min.js',
    'libs/pdf.min.js',
    'libs/pdf.worker.min.js',
    'libs/abcjs-basic-min.js',
    'libs/abcjs-audio.css',
    'libs/diff.min.js',
    'fa/webfonts/fa-solid-900.woff2',
    'fa/webfonts/fa-regular-400.woff2',
    'fonts/RobotoCondensed-Regular.ttf',
    'fonts/RobotoCondensed-Bold.ttf',
    'fonts/RobotoCondensed-Light.ttf',
    'samples/sample-songs.mnote'
];

/* Το mStudio θέλει περιβάλλον γραφείου και μένει ΠΑΝΤΑ network-only.
   Ο SW ζει στη ρίζα, άρα το scope του είναι όλο το origin και θα έπιανε
   και τα αιτήματα του mstudio.html — γι' αυτό η εξαίρεση είναι ρητή. */
const NETWORK_ONLY = [
    'sw.js'
];

self.addEventListener('install', (event) => {
    event.waitUntil((async () => {
        const cache = await caches.open(CACHE_NAME);

        // ΧΩΡΙΣ catch: η αποτυχία πρέπει να ρίξει την εγκατάσταση.
        await cache.addAll(CORE_ASSETS);
        console.log('📦 [SW] Core assets cached:', CORE_ASSETS.length);

        // Ένα-ένα, ώστε ένα χαλασμένο να μην παρασύρει τα υπόλοιπα.
        await Promise.all(OPTIONAL_ASSETS.map(url =>
            cache.add(url).catch(err =>
                console.warn('⚠️ [SW] Προαιρετικό απέτυχε:', url, err))
        ));
    })());
});

self.addEventListener('fetch', (event) => {
    const req = event.request;

    if (req.method !== 'GET') return;

    const url = req.url;
    if (url.includes('supabase.co') || url.includes('google')) return;
    if (NETWORK_ONLY.some(p => url.includes(p))) return;

    event.respondWith((async () => {
        /* ignoreSearch: ΑΠΑΡΑΙΤΗΤΟ. Τα script tags φέρουν ?v=<έκδοση> ενώ η
           cache κρατά καθαρά ονόματα· χωρίς αυτό καμία αντιστοίχιση δεν
           πετυχαίνει και το offline δεν λειτουργεί καθόλου. Η ενημέρωση
           γίνεται μέσω του CACHE_NAME, όχι μέσω του query string. */
        const cached = await caches.match(req, { ignoreSearch: true });
        if (cached) return cached;

        try {
            const res = await fetch(req);
            if (res && res.ok && url.includes('rhythm-engine/kits/')) {
                const cache = await caches.open(CACHE_NAME);
                cache.put(req, res.clone());
            }
            return res;
        } catch (err) {
            // Offline και εκτός cache: για πλοήγηση δώσε την εφαρμογή.
            if (req.mode === 'navigate') {
                const shell = await caches.match('index.html', { ignoreSearch: true });
                if (shell) return shell;
            }
            console.error('📴 [SW] Offline, εκτός cache:', url);
            return new Response('Offline', { status: 503, statusText: 'Offline' });
        }
    })());
});

self.addEventListener('activate', (event) => {
    event.waitUntil((async () => {
        const keys = await caches.keys();
        await Promise.all(keys.map(k => {
            if (k.startsWith('mnotes-solo-v') && k !== CACHE_NAME) {
                console.log('🧹 [SW] Διαγραφή παλιάς cache:', k);
                return caches.delete(k);
            }
        }));
        await self.clients.claim();
        console.log('🚀 [SW] Ενεργός:', CACHE_NAME);
    })());
});

/* Ελεγχόμενη ενημέρωση. ΔΕΝ καλείται skipWaiting() στο install: ο νέος SW
   θα αναλάμβανε ενώ η παλιά σελίδα τρέχει ακόμα, και με ignoreSearch η
   σελίδα θα έτρεχε μισά αρχεία παλιάς και μισά νέας έκδοσης — πιθανότατα
   πάνω στη σκηνή. Ο νέος SW περιμένει· ο χρήστης αποφασίζει. (07/09/2026) */
self.addEventListener('message', (event) => {
    if (event.data === 'SKIP_WAITING') self.skipWaiting();
});
