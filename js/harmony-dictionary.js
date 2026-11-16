/**
 * mnotes — harmony-dictionary.js
 *
 * ΤΟ ΛΕΞΙΚΟ. Δύο επίπεδα, και ο διαχωρισμός τους είναι όλη η ουσία:
 *
 *   SCALES  — σύνολα διαστημάτων. ΜΟΝΑΔΙΚΑ. Δεν υπάρχουν δύο εγγραφές με τα
 *             ίδια ημιτόνια. Εδώ γίνεται η ανίχνευση, χωρίς ισοπαλίες.
 *
 *   IDIOMS  — πολιτισμικές ταυτότητες πάνω σε μια κλίμακα. Το Χιτζάζ, το
 *             φλαμένκο και το κλέζμερ Freygish είναι Η ΙΔΙΑ κλίμακα με
 *             διαφορετικό όνομα, διαφορετικά βάρη και διαφορετικές δανεικές
 *             συγχορδίες. Τρία ιδιώματα, μία εγγραφή κλίμακας.
 *
 * Προσθήκη νέας παράδοσης = ένα αντικείμενο στο IDIOMS. Αν η κλίμακα υπάρχει
 * ήδη (συνήθως υπάρχει), δεν αγγίζεις καθόλου το SCALES.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ΠΡΟΣΟΧΗ: κανένα ιδίωμα δεν έχει επικυρωθεί από μουσικό της παράδοσης.
 * Το πεδίο `validated` είναι παντού false. Τα βάρη είναι μορφωμένη εικασία,
 * όχι αυθεντία — και ακριβώς γι' αυτό υπάρχει το learning.js.
 * ─────────────────────────────────────────────────────────────────────────
 */

/* ══════════════════════════ 1. ΚΛΙΜΑΚΕΣ ═══════════════════════════════════ */

export const SCALES = {
  ionian:            { intervals: [0, 2, 4, 5, 7, 9, 11], prior: 1.00, name: 'Ionian / Major' },
  aeolian:           { intervals: [0, 2, 3, 5, 7, 8, 10], prior: 0.95, name: 'Aeolian / Natural minor' },
  dorian:            { intervals: [0, 2, 3, 5, 7, 9, 10], prior: 0.35, name: 'Dorian' },
  phrygian:          { intervals: [0, 1, 3, 5, 7, 8, 10], prior: 0.30, name: 'Phrygian' },
  lydian:            { intervals: [0, 2, 4, 6, 7, 9, 11], prior: 0.10, name: 'Lydian' },
  mixolydian:        { intervals: [0, 2, 4, 5, 7, 9, 10], prior: 0.35, name: 'Mixolydian' },
  harmonic_minor:    { intervals: [0, 2, 3, 5, 7, 8, 11], prior: 0.55, name: 'Harmonic minor' },
  melodic_minor:     { intervals: [0, 2, 3, 5, 7, 9, 11], prior: 0.20, name: 'Melodic minor' },
  phrygian_dominant: { intervals: [0, 1, 4, 5, 7, 8, 10], prior: 0.45, name: 'Phrygian dominant' },
  double_harmonic:   { intervals: [0, 1, 4, 5, 7, 8, 11], prior: 0.25, name: 'Double harmonic' },
  hungarian_minor:   { intervals: [0, 2, 3, 6, 7, 8, 11], prior: 0.15, name: 'Hungarian minor' },
  /* Ουκρανικός δώριος / Mi Sheberakh / Nikriz. Έλειπε — και δεν είναι εξωτικό:
     σε corpus 249 κλέζμερ μελωδιών (Beregovski) καλύπτει ~20% του ρεπερτορίου. */
  altered_dorian:    { intervals: [0, 2, 3, 6, 7, 9, 10], prior: 0.12, name: 'Altered / Ukrainian Dorian' },
};

/* ══════════════════════════ 2. ΙΔΙΩΜΑΤΑ ═══════════════════════════════════ */

/**
 * Πεδία:
 *   scale       ποια κλίμακα χρησιμοποιεί (κλειδί του SCALES)
 *   label       ονόματα ανά γλώσσα· ο χρήστης βλέπει το δικό του
 *   tradition   ομαδοποίηση για προτίμηση ανά τοπική ρύθμιση
 *   functional  true = ισχύει η δυτική λειτουργική αρμονία (V→I κ.λπ.)
 *   flats       προτίμηση ύφεσης στην ορθογραφία
 *   weights     συχνότητα χρήσης των 7 βαθμίδων ΣΤΗΝ ΠΡΑΞΗ (0..1)
 *   extraChords συγχορδίες που ΠΑΙΖΟΝΤΑΙ αλλά δεν προκύπτουν από την κλίμακα.
 *               Η βαλβίδα θεωρίας-vs-πράξης. Χωρίς αυτήν το φλαμένκο είναι
 *               αδύνατο να περιγραφεί — δες `flamenco` παρακάτω.
 *   validated   το έχει ελέγξει μουσικός της παράδοσης;
 */
export const IDIOMS = {

  /* ─────────────────────────── Δυτικά ─────────────────────────── */

  pop_major: {
    scale: 'ionian', tradition: 'western', functional: true, validated: false,
    label: { el: 'Μείζονα', en: 'Major', es: 'Mayor' },
    weights: [1.00, 0.55, 0.25, 0.85, 0.95, 0.70, 0.12],
    extraChords: [
      { semitone: 10, quality: 'maj', w: 0.30, note: 'bVII δανεική (rock)' },
      { semitone: 2,  quality: '7',   w: 0.22, note: 'V/V' },
    ],
  },

  jazz_major: {
    scale: 'ionian', tradition: 'jazz', functional: true, validated: false,
    label: { el: 'Μείζονα (jazz)', en: 'Major (jazz)' },
    weights: [1.00, 0.85, 0.35, 0.70, 0.90, 0.55, 0.30],   // η ii κυριαρχεί (ii-V-I)
    extraChords: [{ semitone: 2, quality: '7', w: 0.35, note: 'V/V' }],
  },

  pop_minor: {
    scale: 'aeolian', tradition: 'western', functional: true, validated: false,
    label: { el: 'Ελάσσονα', en: 'Minor', es: 'Menor' },
    weights: [1.00, 0.22, 0.60, 0.75, 0.60, 0.72, 0.68],
    extraChords: [{ semitone: 7, quality: '7', w: 0.75, note: 'V7 από αρμονική' }],
  },

  classical_minor: {
    scale: 'harmonic_minor', tradition: 'western', functional: true, validated: false,
    label: { el: 'Αρμονική ελάσσονα', en: 'Harmonic minor' },
    weights: [1.00, 0.30, 0.15, 0.75, 0.92, 0.70, 0.12],
    extraChords: [{ semitone: 10, quality: 'maj', w: 0.35, note: 'bVII από φυσική' }],
  },

  jazz_minor: {
    scale: 'melodic_minor', tradition: 'jazz', functional: true, validated: false,
    label: { el: 'Μελωδική ελάσσονα', en: 'Melodic minor' },
    weights: [1.00, 0.55, 0.15, 0.60, 0.80, 0.20, 0.20],
    extraChords: [],
  },

  celtic_mixolydian: {
    scale: 'mixolydian', tradition: 'celtic', functional: false, validated: false,
    label: { el: 'Μιξολυδικός (κέλτικο)', en: 'Mixolydian (Celtic)' },
    weights: [1.00, 0.50, 0.08, 0.80, 0.40, 0.35, 0.85],   // το bVII είναι το χρώμα
    extraChords: [],
  },

  celtic_dorian: {
    scale: 'dorian', tradition: 'celtic', functional: false, validated: false,
    label: { el: 'Δώριος (κέλτικο)', en: 'Dorian (Celtic)' },
    weights: [1.00, 0.45, 0.35, 0.80, 0.40, 0.10, 0.75],   // i με IV ματζόρε
    extraChords: [],
  },

  /* ──────────────────── Ελληνικοί λαϊκοί δρόμοι ─────────────────── */

  hitzaz: {
    scale: 'phrygian_dominant', tradition: 'greek', functional: false, validated: false,
    label: { el: 'Χιτζάζ', en: 'Hijaz', tr: 'Hicaz' },
    weights: [1.00, 0.82, 0.05, 0.85, 0.10, 0.20, 0.55],
    extraChords: [
      { semitone: 8, quality: 'maj', w: 0.55, note: 'bVI ματζόρε (πράξη)' },
      { semitone: 7, quality: 'min', w: 0.35, note: 'v μινόρε (πράξη)' },
    ],
  },

  hitzazkiar: {
    scale: 'double_harmonic', tradition: 'greek', functional: false, validated: false,
    label: { el: 'Χιτζασκιάρ', en: 'Hijazkiar', tr: 'Hicazkâr' },
    weights: [1.00, 0.80, 0.05, 0.80, 0.15, 0.20, 0.15],
    extraChords: [{ semitone: 8, quality: 'maj', w: 0.50, note: 'bVI ματζόρε (πράξη)' }],
  },

  ousak: {
    scale: 'phrygian', tradition: 'greek', functional: false, validated: false,
    label: { el: 'Ουσάκ', en: 'Ussak', tr: 'Uşşak' },
    weights: [1.00, 0.80, 0.20, 0.72, 0.25, 0.45, 0.55],
    extraChords: [{ semitone: 9, quality: 'min', w: 0.25, note: '6η φυσική στο ανιόν' }],
  },

  kiourdi: {
    scale: 'aeolian', tradition: 'greek', functional: false, validated: false,
    label: { el: 'Κιουρδί', en: 'Kiourdi', tr: 'Kürdi' },
    weights: [1.00, 0.20, 0.55, 0.78, 0.55, 0.70, 0.65],
    extraChords: [{ semitone: 7, quality: '7', w: 0.55, note: 'δεσπόζουσα στην πτώση' }],
  },

  niavent: {
    scale: 'harmonic_minor', tradition: 'greek', functional: false, validated: false,
    label: { el: 'Νιαβέντ', en: 'Niavent', tr: 'Nihavend' },
    weights: [1.00, 0.25, 0.15, 0.78, 0.85, 0.65, 0.10],
    extraChords: [{ semitone: 10, quality: 'maj', w: 0.30, note: 'bVII από φυσική' }],
  },

  rast: {
    scale: 'mixolydian', tradition: 'greek', functional: false, validated: false,
    label: { el: 'Ραστ (συγκερασμένο)', en: 'Rast (tempered)', tr: 'Rast' },
    weights: [1.00, 0.45, 0.20, 0.70, 0.55, 0.45, 0.55],
    extraChords: [],
  },

  /* ────────── Ίδιες κλίμακες, άλλες παραδόσεις — εδώ φαίνεται η αξία ────── */

  flamenco: {
    scale: 'phrygian_dominant', tradition: 'flamenco', functional: false, validated: false,
    label: { el: 'Φλαμένκο', es: 'Frigio dominante', en: 'Flamenco (Phrygian dominant)' },
    weights: [1.00, 0.90, 0.05, 0.85, 0.15, 0.35, 0.30],
    extraChords: [
      /**
       * ΤΟ ΚΡΙΣΙΜΟ: η ανδαλουσιανή πτώση είναι iv–bIII–bII–I (Am G F E στο Μι).
       * Το G είναι ΣΟΛ ΦΥΣΙΚΟ — δεν υπάρχει στη φρυγική δεσπόζουσα, που έχει
       * σολ δίεση. Το φλαμένκο χρησιμοποιεί ΚΑΙ ΤΑ ΔΥΟ. Καμία επταφθογγική
       * κλίμακα δεν το εκφράζει· χωρίς αυτή την εγγραφή, η πιο διάσημη
       * ακολουθία του είδους ανιχνεύεται ως απλή ελάσσονα.
       */
      { semitone: 3,  quality: 'maj', w: 0.85, note: 'bIII — ανδαλουσιανή πτώση' },
      { semitone: 10, quality: 'min', w: 0.25, note: 'bvii' },
    ],
  },

  /**
   * Οι τέσσερις κλέζμερ τρόποι και οι συχνότητές τους προέρχονται από μελέτη
   * 249 μελωδιών του Beregovski (Malin, MTO 2025):
   *   Magen Avot (ελάσσονα) 35% · Freygish 25% · Altered Dorian 20% · Major 20%
   * ΠΡΟΣΟΧΗ: το corpus είναι ΜΟΝΟ ΜΕΛΩΔΙΚΟ — «melodies only, without chords».
   * Άρα οι συχνότητες τρόπων είναι τεκμηριωμένες, τα ΒΑΡΗ ΣΥΓΧΟΡΔΙΩΝ όχι.
   */
  klezmer_altered_dorian: {
    scale: 'altered_dorian', tradition: 'klezmer', functional: false, validated: false,
    prior: 0.55,
    label: { el: 'Μι Σεμπεράχ (κλέζμερ)', en: 'Mi Sheberakh / Altered Dorian' },
    weights: [1.00, 0.30, 0.45, 0.20, 0.70, 0.35, 0.55],
    extraChords: [],
  },

  klezmer_minor: {
    scale: 'aeolian', tradition: 'klezmer', functional: false, validated: false,
    prior: 0.95,
    label: { el: 'Μάγκεν Αβότ (κλέζμερ)', en: 'Magen Avot' },
    weights: [1.00, 0.20, 0.55, 0.80, 0.60, 0.65, 0.60],
    extraChords: [{ semitone: 7, quality: '7', w: 0.60, note: 'δεσπόζουσα' }],
  },

  freygish: {
    scale: 'phrygian_dominant', tradition: 'klezmer', functional: false, validated: false,
    prior: 0.70,
    label: { el: 'Φρέιγκις (κλέζμερ)', en: 'Freygish / Ahava Raba', he: 'אהבה רבה' },
    weights: [1.00, 0.78, 0.05, 0.85, 0.10, 0.25, 0.45],
    extraChords: [
      { semitone: 3,  quality: 'maj', w: 0.50, note: 'bIII' },
      { semitone: 10, quality: 'maj', w: 0.45, note: 'bVII ματζόρε' },
    ],
  },

  balkan_gypsy: {
    scale: 'hungarian_minor', tradition: 'balkan', functional: false, validated: false,
    label: { el: 'Βαλκανικός (τσιγγάνικος)', en: 'Hungarian / Gypsy minor' },
    weights: [1.00, 0.20, 0.30, 0.25, 0.85, 0.50, 0.10],
    extraChords: [],
  },

  balkan_harmonic: {
    scale: 'harmonic_minor', tradition: 'balkan', functional: false, validated: false,
    label: { el: 'Βαλκανικός (αρμονική)', en: 'Balkan harmonic minor' },
    weights: [1.00, 0.25, 0.20, 0.70, 0.88, 0.60, 0.10],
    extraChords: [{ semitone: 10, quality: 'maj', w: 0.35, note: 'bVII' }],
  },
};

/* ══════════════════ 3. Παράγωγα ευρετήρια και βοηθοί ══════════════════════ */

/**
 * Prior κλίμακας ΠΡΟΣΑΡΜΟΣΜΕΝΟ στις παραδόσεις του χρήστη.
 * Η φρυγική δεσπόζουσα είναι σπάνια στη δυτική ποπ αλλά καλύπτει το 25% του
 * κλέζμερ ρεπερτορίου. Ένα καθολικό prior αδικεί τη μία ή την άλλη πλευρά.
 */
export function scalePrior(scaleId, traditions = null) {
  const base = SCALES[scaleId].prior ?? 0.5;
  if (!traditions) return base;
  const fromIdioms = (IDIOMS_BY_SCALE[scaleId] || [])
    .filter(id => traditions.includes(IDIOMS[id].tradition))
    .map(id => IDIOMS[id].prior)
    .filter(v => typeof v === 'number');
  return fromIdioms.length ? Math.max(...fromIdioms) : base;
}

/** Ιδιώματα ανά κλίμακα — το ευρετήριο που κάνει δυνατή τη 2-φασική ανίχνευση. */
export const IDIOMS_BY_SCALE = Object.entries(IDIOMS).reduce((acc, [id, idiom]) => {
  (acc[idiom.scale] ??= []).push(id);
  return acc;
}, {});

/** Όλες οι δανεικές συγχορδίες που δηλώνει ΟΠΟΙΟΔΗΠΟΤΕ ιδίωμα της κλίμακας. */
export function scaleExtras(scaleId) {
  const seen = new Map();
  for (const id of IDIOMS_BY_SCALE[scaleId] || []) {
    for (const e of IDIOMS[id].extraChords || []) {
      const k = `${e.semitone}:${e.quality}`;
      if (!seen.has(k) || seen.get(k).w < e.w) seen.set(k, e);
    }
  }
  return [...seen.values()];
}

/** Ετικέτα στη γλώσσα του χρήστη, με αλυσίδα υποχώρησης. */
export function labelFor(idiomId, lang = 'el') {
  const l = IDIOMS[idiomId]?.label ?? {};
  return l[lang] ?? l.en ?? l.el ?? idiomId;
}

/**
 * Συμβατότητα με το υπάρχον chord-oracle.js: επίπεδη όψη όπου κάθε ιδίωμα
 * μοιάζει με τους παλιούς «τρόπους». Έτσι ο refactor δεν σπάει τίποτα
 * κατάντη — ούτε το learning.js ούτε τα tests.
 */
export function buildModes(lang = 'el') {
  const out = {};
  for (const [id, idiom] of Object.entries(IDIOMS)) {
    out[id] = {
      label: labelFor(id, lang),
      scale: idiom.scale,
      tradition: idiom.tradition,
      intervals: SCALES[idiom.scale].intervals,
      weights: idiom.weights,
      extraChords: idiom.extraChords ?? [],
      functional: idiom.functional,
      flats: idiom.flats ?? autoFlats(idiom.scale),
      validated: idiom.validated,
    };
  }
  return out;
}

/**
 * Η ορθογραφία (δίεση ή ύφεση) προκύπτει από την ΚΛΙΜΑΚΑ, δεν δηλώνεται.
 * Αν η κλίμακα περιέχει χαμηλωμένη βαθμίδα (b2, b3, b5, b6, b7), γράφεται με
 * υφέσεις. Έτσι δεν μπορεί να ξεχαστεί σε νέα εγγραφή — ο μιξολυδικός παίρνει
 * αυτόματα Bb αντί για A#.
 */
const LOWERED_DEGREES = new Set([1, 3, 6, 8, 10]);
export const autoFlats = scaleId =>
  SCALES[scaleId].intervals.some(i => LOWERED_DEGREES.has(i));

/** Έλεγχος ακεραιότητας — τρέχει στα tests, όχι στην παραγωγή. */
export function validateDictionary() {
  const problems = [];
  const bySignature = {};

  for (const [id, s] of Object.entries(SCALES)) {
    const sig = s.intervals.join(',');
    if (bySignature[sig]) problems.push(`Διπλή κλίμακα: ${id} ≡ ${bySignature[sig]} (${sig})`);
    bySignature[sig] = id;
    if (typeof s.prior !== 'number') problems.push(`${id}: λείπει prior`);
    if (s.intervals[0] !== 0) problems.push(`${id}: δεν ξεκινά από 0`);
    if ([...new Set(s.intervals)].length !== s.intervals.length) problems.push(`${id}: διπλά διαστήματα`);
    if (s.intervals.some(i => i < 0 || i > 11)) problems.push(`${id}: διάστημα εκτός οκτάβας`);
  }

  for (const [id, idiom] of Object.entries(IDIOMS)) {
    if (!SCALES[idiom.scale]) problems.push(`${id}: άγνωστη κλίμακα «${idiom.scale}»`);
    if (idiom.weights?.length !== 7) problems.push(`${id}: χρειάζονται ακριβώς 7 βάρη`);
    if (!idiom.label?.en && !idiom.label?.el) problems.push(`${id}: χωρίς ετικέτα`);
    for (const e of idiom.extraChords ?? []) {
      const inScale = SCALES[idiom.scale]?.intervals.includes(e.semitone);
      if (inScale && !e.note) problems.push(`${id}: το extra @${e.semitone} είναι ήδη στην κλίμακα`);
    }
  }
  return problems;
}
