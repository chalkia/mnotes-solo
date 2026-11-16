/**
 * mnotes — chord-oracle.js
 * Πρόταση συγχορδίας που λείπει, με βάση τονικότητα + τρόπο (mode/δρόμο).
 *
 * Αρχή σχεδίασης: ΧΩΡΙΖΟΥΜΕ τη *λειτουργία* (ποια βαθμίδα) από το *ντύσιμο*
 * (πώς γράφεται: C / Cmaj7 / C7). Το μουσικό είδος αγγίζει ΜΟΝΟ το ντύσιμο.
 * Χωρίς εξαρτήσεις — τρέχει εξ ολοκλήρου client-side μέσα στο PWA.
 */
import { SCALES, IDIOMS, IDIOMS_BY_SCALE, scaleExtras, buildModes, labelFor, scalePrior } from './harmony-dictionary.js';


/* ─────────────────────────── 0. Βασικά μουσικά utilities ────────────────── */

const SHARP_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const FLAT_NAMES  = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
const LETTER_PC   = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

const mod12 = n => ((n % 12) + 12) % 12;

/** Διαστήματα κάθε ποιότητας συγχορδίας, σε ημιτόνια από τη θεμέλιο. */
const QUALITY_TONES = {
  maj:  [0, 4, 7],        min:  [0, 3, 7],
  dim:  [0, 3, 6],        aug:  [0, 4, 8],
  sus4: [0, 5, 7],        sus2: [0, 2, 7],
  '7':  [0, 4, 7, 10],    maj7: [0, 4, 7, 11],
  min7: [0, 3, 7, 10],    m7b5: [0, 3, 6, 10],
  dim7: [0, 3, 6, 9],     '6':  [0, 4, 7, 9],
  min6: [0, 3, 7, 9],     minmaj7: [0, 3, 7, 11],
};

/** Κανονικοποίηση καταλήξεων: ό,τι γράφει ο χρήστης -> βασική ποιότητα. */
function normQuality(raw) {
  let s = (raw || '').trim();
  s = s.replace(/^\((.*)\)$/, '$1');
  // πετάμε επεκτάσεις/αλλοιώσεις που δεν αλλάζουν τη λειτουργία
  s = s.replace(/\((?:b|#)?\d+\)/g, '').replace(/(?:b|#)(?:5|9|11|13)/g, '');
  s = s.replace(/add\d+/gi, '');
  const t = s.toLowerCase();
  if (t === '' || t === 'maj' || t === 'major' || t === 'M') return 'maj';
  if (/^(m7b5|min7b5|ø|half-?dim)/.test(t))                  return 'm7b5';
  if (/^(dim7|°7|o7)/.test(t))                               return 'dim7';
  if (/^(dim|°|o)$/.test(t))                                 return 'dim';
  if (/^(aug|\+)$/.test(t))                                  return 'aug';
  if (/^(maj7|ma7|Δ7?|j7)/.test(t))                          return 'maj7';
  if (/^(m|min|-)(maj7|Δ)/.test(t))                          return 'minmaj7';
  if (/^(m|min|-)(6)/.test(t))                               return 'min6';
  if (/^(m|min|-)(7|9|11|13)/.test(t))                       return 'min7';
  if (/^(m|min|-)/.test(t))                                  return 'min';
  if (/^sus2/.test(t))                                       return 'sus2';
  if (/^sus/.test(t))                                        return 'sus4';
  if (/^6/.test(t))                                          return '6';
  if (/^(7|9|11|13)/.test(t))                                return '7';
  return t === '' ? 'maj' : null;
}

/** "Bbm7/F" -> { root:10, quality:'min7', bass:5 } */
export function parseChord(sym) {
  if (!sym || typeof sym !== 'string') return null;
  const m = /^([A-G])([#b]?)([^/]*)(?:\/([A-G][#b]?))?$/.exec(sym.trim());
  if (!m) return null;
  const acc = m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0;
  const root = mod12(LETTER_PC[m[1]] + acc);
  let bass = null;
  if (m[4]) {
    const b = /^([A-G])([#b]?)$/.exec(m[4]);
    bass = mod12(LETTER_PC[b[1]] + (b[2] === '#' ? 1 : b[2] === 'b' ? -1 : 0));
  }
  const quality = normQuality(m[3]);
  if (!quality) return null;
  return { sym: sym.trim(), root, quality, bass, tones: QUALITY_TONES[quality].map(i => mod12(root + i)) };
}

/** Ονομασία φθόγγου· preferFlats καθορίζεται από τον τρόπο (οι δρόμοι θέλουν ύφεση). */
function noteName(pc, preferFlats) {
  return (preferFlats ? FLAT_NAMES : SHARP_NAMES)[mod12(pc)];
}

/** Τονικότητες που γράφονται με υφέσεις (κύκλος των πεμπτών). */
const FLAT_TONICS = new Set([5, 10, 3, 8, 1, 6]);           // F Bb Eb Ab Db Gb
/** Χρωματικά «χαμηλωμένες» βαθμίδες: γράφονται πάντα με ύφεση (bIII, bVI, bVII…). */
const LOWERED = new Set([1, 3, 6, 8, 10]);

/**
 * ΓΡΑΦΗ ΑΛΛΟΙΩΣΕΩΝ — ακολουθεί τον ΧΡΗΣΤΗ, όχι τη θεωρία.
 *
 * Οι κιθαρίστες γράφουν συχνά A# αντί για Bb επειδή σκέφτονται σε διέσεις
 * στο ταστιέρα, ακόμα κι όταν η κλίμακα λέει ύφεση. Είναι λάθος να τους
 * «διορθώνουμε»: το τραγούδι είναι δικό τους.
 *
 * Η αντιστοίχιση δεν επηρεάζεται καθόλου — το A# και το Bb είναι ο ίδιος
 * φθόγγος (pitch class 10) παντού μέσα στη μηχανή. Αλλάζει ΜΟΝΟ η εμφάνιση.
 *
 *   'auto'  → από το ίδιο το τραγούδι· αν δεν έχει αλλοιώσεις, από τη θεωρία
 *   'sharp' → πάντα διέσεις
 *   'flat'  → πάντα υφέσεις
 */
export let ACCIDENTAL_PREFERENCE = 'auto';
export function setAccidentalPreference(p) { ACCIDENTAL_PREFERENCE = p; }

/** Τι γράφει ΣΤΗΝ ΠΡΑΞΗ αυτό το τραγούδι; Πλειοψηφία των αλλοιώσεων. */
export function detectAccidentalStyle(chordSyms = []) {
  let sharp = 0, flat = 0;
  for (const sym of chordSyms) {
    if (!sym) continue;
    const m = /^[A-G]([#b])/.exec(sym.trim());
    if (m) (m[1] === '#' ? sharp++ : flat++);
  }
  if (!sharp && !flat) return null;
  return sharp === flat ? null : (sharp > flat ? 'sharp' : 'flat');
}

/** Ορθογραφία σε σχέση με την τονική· `hint` υπερισχύει της θεωρίας. */
function spellRelative(tonicPc, relSemitone, modeId, hint = null) {
  const style = hint !== undefined && hint !== null ? hint : (ACCIDENTAL_PREFERENCE === 'auto' ? null : ACCIDENTAL_PREFERENCE);
  if (style === 'sharp') return noteName(tonicPc + relSemitone, false);
  if (style === 'flat')  return noteName(tonicPc + relSemitone, true);
  const mode = MODES[modeId];
  const inScale = mode.intervals.includes(relSemitone);
  const flats = mode.flats || FLAT_TONICS.has(mod12(tonicPc)) || (!inScale && LOWERED.has(relSemitone));
  return noteName(tonicPc + relSemitone, flats);
}

/**
 * «Οικογένεια» ποιότητας: το Cmaj7, το C6 και το C είναι η ΙΔΙΑ λειτουργία.
 * Χωρίς αυτό, ένα jazz τραγούδι δεν αναγνωρίζεται ποτέ σωστά.
 */
const QUALITY_FAMILY = {
  maj: 'maj', maj7: 'maj', '6': 'maj', '7': 'maj',
  min: 'min', min7: 'min', min6: 'min', minmaj7: 'min',
  dim: 'dim', dim7: 'dim', m7b5: 'dim',
  aug: 'aug', sus4: 'sus', sus2: 'sus',
};
const sameFamily = (a, b) => QUALITY_FAMILY[a] === QUALITY_FAMILY[b]
  || QUALITY_FAMILY[a] === 'sus' || QUALITY_FAMILY[b] === 'sus';

/* ───────── 1. Τρόποι: έρχονται από το λεξικό (harmony-dictionary.js) ────── */

/**
 * Δεν ορίζονται πια εδώ. Το λεξικό χωρίζει ΚΛΙΜΑΚΕΣ (μοναδικά σύνολα
 * διαστημάτων) από ΙΔΙΩΜΑΤΑ (πολιτισμικές ταυτότητες πάνω σε μια κλίμακα).
 * Το `MODES` είναι επίπεδη όψη των ιδιωμάτων, ώστε ο υπόλοιπος κώδικας να
 * μείνει ανέγγιχτος.
 */
export const MODES = buildModes();

/** Αλλαγή γλώσσας ετικετών εν θερμώ (ο χρήστης αλλάζει locale). */
export function setLanguage(lang) {
  const fresh = buildModes(lang);
  for (const k of Object.keys(MODES)) delete MODES[k];
  Object.assign(MODES, fresh);
}

/* ────────────── 2. Παραγωγή λεξιλογίου συγχορδιών από τον τρόπο ─────────── */

const TRIAD_MAP = { '4,3': 'maj', '3,4': 'min', '3,3': 'dim', '4,4': 'aug' };

/**
 * Προφίλ μαθημένο από τη βιβλιοθήκη του χρήστη (βλ. learning.js).
 * Αν είναι null, ισχύουν τα χειροκίνητα βάρη — δηλαδή το app δουλεύει
 * από την πρώτη μέρα και απλώς βελτιώνεται όσο γεμίζει η βιβλιοθήκη.
 */
let LEARNED = null;
export function applyLearnedProfile(profile) { LEARNED = profile; }
export function getLearnedProfile() { return LEARNED; }

/**
 * Χτίζει τρίφωνα σε τρίτες πάνω σε κάθε βαθμίδα, ΜΟΝΟ με φθόγγους του τρόπου.
 * Έτσι δεν συντηρούμε πίνακα συγχορδιών ανά δρόμο — μόνο 7 αριθμούς βάρους.
 */
export function deriveVocabulary(modeId) {
  const mode = MODES[modeId];
  if (!mode) throw new Error(`Άγνωστος τρόπος: ${modeId}`);
  const sc = mode.intervals;
  const out = [];
  const learned = typeof LEARNED !== 'undefined' && LEARNED ? LEARNED[modeId] : null;
  const weights = (learned && learned.weights) ? learned.weights : mode.weights;

  sc.forEach((_, i) => {
    const [r, t, f] = [sc[i], sc[(i + 2) % 7], sc[(i + 4) % 7]];
    const i1 = mod12(t - r), i2 = mod12(f - t);
    const quality = TRIAD_MAP[`${i1},${i2}`];
    if (!quality) return;                       // μη τριτοδομήσιμη βαθμίδα
    out.push({ degree: i, semitone: r, quality, prior: weights[i], derived: true });
  });

  [...(mode.extraChords || []), ...((learned && learned.extras) ? learned.extras : [])].forEach(e => {
    const dup = out.find(c => c.semitone === e.semitone && c.quality === e.quality);
    if (dup) { dup.prior = Math.max(dup.prior, e.w); dup.note = e.note; return; }
    const clash = out.findIndex(c => c.semitone === e.semitone);
    if (clash >= 0 && out[clash].prior < 0.25) out.splice(clash, 1);  // η πράξη νικά τη θεωρία
    out.push({ degree: null, semitone: e.semitone, quality: e.quality, prior: e.w, derived: false, note: e.note });
  });

  return out.filter(c => c.prior > 0.03).sort((a, b) => b.prior - a.prior);
}

/** Λειτουργική βαθμίδα -> γραπτό σύμβολο, με βάση το προφίλ ύφους. */
export const STYLE_PROFILES = {
  simple: { label: 'Απλό (τρίφωνα)',  map: q => q },
  pop:    { label: 'Pop / Έντεχνο',   map: (q, deg) => (deg === 4 ? '7' : q) },
  laiko:  { label: 'Λαϊκό',           map: (q, deg) => (deg === 4 || deg === 6 ? (q === 'maj' ? '7' : q) : q) },
  jazz:   { label: 'Jazz', map: (q, deg) => {
    if (q === 'maj') return deg === 4 ? '7' : 'maj7';        // η V γίνεται δεσπόζουσα, όχι maj7
    return { min: 'min7', dim: 'm7b5', aug: 'aug', '7': '7' }[q] || q;
  } },
};

const QUALITY_SUFFIX = { maj: '', min: 'm', dim: 'dim', aug: 'aug', '7': '7',
  maj7: 'maj7', min7: 'm7', m7b5: 'm7b5', dim7: 'dim7', '6': '6', min6: 'm6',
  sus4: 'sus4', sus2: 'sus2', minmaj7: 'mMaj7' };

export function spellChord(cand, tonicPc, modeId, styleId = 'simple', accidentals = null) {
  const q = (STYLE_PROFILES[styleId] || STYLE_PROFILES.simple).map(cand.quality, cand.degree);
  return spellRelative(tonicPc, cand.semitone, modeId, accidentals) + (QUALITY_SUFFIX[q] || '');
}

/* ──────────────── 3. Αναγνώριση τονικότητας + τρόπου από τις συγχορδίες ─── */

/**
 * Δεν ρωτάμε τον χρήστη «τι είδος είναι». Το συμπεραίνουμε από τις συγχορδίες
 * που ΗΔΗ υπάρχουν — αν το τραγούδι έχει C, Fm, Db, είναι Χιτζάζ, τελεία.
 */
/**
 * ΔΥΟ ΦΑΣΕΙΣ — και ο λόγος είναι ουσιώδης.
 *
 * Φάση Α: βαθμολογούμε ΚΛΙΜΑΚΕΣ, όχι ιδιώματα. Οι κλίμακες είναι μοναδικές,
 *   άρα δεν υπάρχει ισοπαλία. Αν βαθμολογούσαμε ιδιώματα, το Χιτζάζ και το
 *   φλαμένκο —που έχουν ταυτόσημα διαστήματα— θα ισοβαθμούσαν σε κάθε
 *   τραγούδι και ο νικητής θα κρινόταν από θόρυβο.
 *
 * Φάση Β: μέσα στη νικήτρια κλίμακα, ποιο ιδίωμα εξηγεί καλύτερα ΑΥΤΕΣ τις
 *   συγχορδίες; Το σολ ματζόρε σε φρυγική δεσπόζουσα λέει «φλαμένκο»· η
 *   έλλειψή του και ένα λα ματζόρε λένε «Χιτζάζ».
 *
 * Στη φάση Α το λεξιλόγιο κάθε κλίμακας περιλαμβάνει την ΕΝΩΣΗ των δανεικών
 * συγχορδιών όλων των ιδιωμάτων της — αλλιώς η ανδαλουσιανή πτώση δεν θα
 * αναγνωριζόταν ποτέ ως φρυγική δεσπόζουσα.
 */
/** Ρυθμιστικές παράμετροι ανίχνευσης — εκτεθειμένες για βαθμονόμηση. */
export const TUNING = { priorWeight: 0.12, edgeBonus: 2.4, traditionBonus: 0.05, tonicFreq: 1.5, songBigram: 2.0, bigramSlots: 2 }

/**
 * ΠΑΡΑΜΕΤΡΟΙ ΑΝΑ ΠΑΡΑΔΟΣΗ — δεν υπάρχει ένα κούρδισμα που να ταιριάζει σε όλους.
 *
 * Μετρημένο σε τέσσερα σώματα (95 ελληνικά, 106 ποπ/ροκ, 126 φολκ, 73 jazz):
 *
 *              tonicFreq=0   tonicFreq=1.5
 *   ελληνικά       91%           96%     ← το χρειάζεται
 *   ποπ/ροκ        77%           80%     ← το χρειάζεται
 *   φολκ           89%           84%     ← ΤΟ ΒΛΑΠΤΕΙ
 *   jazz           25%           18%     ← ΤΟ ΒΛΑΠΤΕΙ
 *
 * Ο λόγος είναι μουσικός. Στο λαϊκό και στην ποπ η τονική κυριαρχεί με
 * επανάληψη. Στη jazz η ii και η V εμφανίζονται τόσο συχνά όσο η I (αλυσίδες
 * ii-V-I), και στο βρετανικό φολκ η αρμονία είναι τροπική με πολύ I-bVII-IV.
 * Το «η συχνότερη συγχορδία είναι η τονική» είναι ελληνική/ποπ παραδοχή.
 */
export const TUNING_BY_TRADITION = {
  greek:    { tonicFreq: 1.5, edgeBonus: 2.4 },
  western:  { tonicFreq: 1.5, edgeBonus: 2.4 },
  flamenco: { tonicFreq: 1.5, edgeBonus: 2.4 },
  klezmer:  { tonicFreq: 1.2, edgeBonus: 2.0 },
  balkan:   { tonicFreq: 1.2, edgeBonus: 2.0 },
  celtic:   { tonicFreq: 0.0, edgeBonus: 1.8 },
  jazz:     { tonicFreq: 0.0, edgeBonus: 1.8 },
};

/** Ενεργές παράμετροι: η πρώτη προτιμώμενη παράδοση καθορίζει το κούρδισμα. */
function tuning(traditions) {
  const t = (traditions || PREFERRED_TRADITIONS)[0];
  return { ...TUNING, ...(TUNING_BY_TRADITION[t] || {}) };
}
/* Οι δύο τιμές βγήκαν από σάρωση σε 95 τραγούδια με δηλωμένη τονικότητα:
   91.6% → 96.8% συμφωνία. Επιλέχθηκε το κέντρο σταθερής περιοχής, όχι η
   αιχμή — μια αιχμή σε 95 δείγματα είναι θόρυβος, όχι εύρημα. */;

/**
 * ΠΡΟΤΙΜΩΜΕΝΕΣ ΠΑΡΑΔΟΣΕΙΣ — εδώ ζει η «διεθνοποίηση».
 * Το Χιτζάζ και το φλαμένκο είναι η ίδια κλίμακα με σχεδόν ίδια βάρη· ποιο
 * όνομα θα δει ο χρήστης δεν το κρίνει η μουσική, το κρίνει ΠΟΙΟΣ είναι ο
 * χρήστης. Ένας Έλληνας βλέπει «Χιτζάζ», ένας Ισπανός «Frigio dominante»,
 * για τις ίδιες ακριβώς συγχορδίες. Οι διακριτικές ενδείξεις (π.χ. το σολ
 * ματζόρε της ανδαλουσιανής πτώσης) εξακολουθούν να υπερισχύουν.
 */
export let PREFERRED_TRADITIONS = ['greek', 'western'];
export function setTraditions(list) { PREFERRED_TRADITIONS = list; }

/** Απόλυτο σύνολο φθόγγων μιας (τονικής, κλίμακας) — για σύγκριση περιστροφών. */
const pitchSet = (tonic, scaleId) =>
  SCALES[scaleId].intervals.map(i => mod12(tonic + i)).sort((a, b) => a - b).join(',');

export function detectMode(chordSyms, { topN = 3, traditions = null, lang = null, accidentals } = {}) {
  const chords = chordSyms.map(parseChord).filter(Boolean);
  if (!chords.length) return [];
  const acc = accidentals !== undefined && accidentals !== null ? accidentals : detectAccidentalStyle(chordSyms);
  const TU = tuning(traditions);

  /* ── Φάση Α: κλίμακες ── */
  const scaleVocabCache = {};
  const vocabOf = scaleId => (scaleVocabCache[scaleId] = scaleVocabCache[scaleId] || (() => {
    const sc = SCALES[scaleId].intervals;
    const out = [];
    sc.forEach((_, i) => {
      const [r, t, f] = [sc[i], sc[(i + 2) % 7], sc[(i + 4) % 7]];
      const q = TRIAD_MAP[`${mod12(t - r)},${mod12(f - t)}`];
      if (q) out.push({ semitone: r, quality: q, borrowed: false });
    });
    for (const e of scaleExtras(scaleId)) {
      if (!out.some(c => c.semitone === e.semitone && c.quality === e.quality))
        out.push({ semitone: e.semitone, quality: e.quality, borrowed: true });
    }
    return out;
  })());

  const scaleHits = [];
  for (let tonic = 0; tonic < 12; tonic++) {
    for (const scaleId of Object.keys(SCALES)) {
      const tones = new Set(SCALES[scaleId].intervals.map(i => mod12(tonic + i)));
      const vocab = vocabOf(scaleId);
      let score = 0;

      chords.forEach((ch, idx) => {
        const rel = mod12(ch.root - tonic);
        const exact  = vocab.find(v => v.semitone === rel && v.quality === ch.quality);
        const family = vocab.find(v => v.semitone === rel && sameFamily(v.quality, ch.quality));
        const loose  = vocab.find(v => v.semitone === rel);
        if (exact)       score += exact.borrowed ? 0.90 : 1.30;
        else if (family) score += family.borrowed ? 0.75 : 1.10;
        else if (loose)  score += 0.30;
        score += 0.45 * (ch.tones.filter(t => tones.has(t)).length / ch.tones.length);
        if ((idx === 0 || idx === chords.length - 1) && rel === 0) score += TU.edgeBonus;
      });

      /**
       * Prior κλίμακας. Χωρίς αυτό, ο μιξολυδικός «κλέβει» τραγούδια από τη
       * μείζονα: το Am-F-C-G διαβάζεται εξίσου καλά ως Σολ μιξολυδικός, και
       * χωρίς πληροφορία συχνότητας δεν υπάρχει λόγος να προτιμηθεί το
       * συμβατικό Ντο μείζονα. Οι σπάνιες κλίμακες πρέπει να κερδίζουν με
       * σαφή διαφορά, όχι οριακά.
       */
      /**
       * ΣΥΧΝΟΤΗΤΑ ΤΗΣ ΤΟΝΙΚΗΣ — έλειπε εντελώς, και ήταν η μεγαλύτερη αδυναμία.
       * Μετρημένο σε βιβλιοθήκη 100 τραγουδιών: το «Αγάπη μου επικίνδυνη» έχει
       * Dm 18 φορές, πρώτη και τελευταία συγχορδία Dm, και αναγνωριζόταν ως
       * Σιb μείζονα — επειδή όλες οι συγχορδίες του χωρούσαν στη Σιb, χωρίς
       * να μετράει πουθενά ποια ακούγεται ως σπίτι.
       */
      /**
       * Μετράμε μόνο όσες συγχορδίες θα μπορούσαν να ΕΙΝΑΙ η τονική αυτού του
       * τρόπου — δηλαδή έχουν και τη σωστή ποιότητα. Μετρώντας σκέτους
       * θεμέλιους, το «Ποτε Βούδας» έχανε: Am×7 συν A×2 νικούσαν το Em×8,
       * παρότι η Λα κιουρδί περιμένει Am και όχι A.
       */
      const tonicTriad = vocab.find(v => v.semitone === 0);
      const tonicShare = chords.filter(c =>
        c.root === tonic && (!tonicTriad || sameFamily(c.quality, tonicTriad.quality))
      ).length / chords.length;
      score += TU.tonicFreq * tonicShare * chords.length;

      const prior = scalePrior(scaleId, traditions || PREFERRED_TRADITIONS);
      scaleHits.push({ tonic, scaleId,
        score: (score / chords.length) * (1 - TU.priorWeight + TU.priorWeight * prior) });
    }
  }
  scaleHits.sort((a, b) => b.score - a.score);

  /* ── Φάση Β: ιδίωμα μέσα στη νικήτρια κλίμακα ── */
  const results = scaleHits.slice(0, Math.max(topN * 3, 8)).map(hit => {
    const candidates = (IDIOMS_BY_SCALE[hit.scaleId] || [])
      .filter(id => !traditions || traditions.includes(IDIOMS[id].tradition));
    if (!candidates.length) return null;

    const ranked = candidates.map(idiomId => {
      const idiom = IDIOMS[idiomId];
      const vocab = deriveVocabulary(idiomId);
      let fit = 0;
      chords.forEach(ch => {
        const rel = mod12(ch.root - hit.tonic);
        const m = vocab.find(v => v.semitone === rel && v.quality === ch.quality)
               || vocab.find(v => v.semitone === rel && sameFamily(v.quality, ch.quality));
        fit += m ? m.prior : -0.15;                 // ποινή για ασυμβίβαστη συγχορδία
      });
      let f = fit / chords.length;
      const rank = PREFERRED_TRADITIONS.indexOf(idiom.tradition);
      if (rank >= 0) f += TUNING.traditionBonus / (rank + 1);
      return { idiomId, fit: f, tradition: idiom.tradition };
    }).sort((a, b) => b.fit - a.fit);

    const win = ranked[0];
    return {
      tonic: hit.tonic, scaleId: hit.scaleId, modeId: win.idiomId,
      tonicName: spellRelative(hit.tonic, 0, win.idiomId, acc),
      label: `${spellRelative(hit.tonic, 0, win.idiomId, acc)} ${lang ? labelFor(win.idiomId, lang) : MODES[win.idiomId].label}`,
      score: hit.score,
      idiomFit: +win.fit.toFixed(3),
      alternatives: ranked.slice(1, 3).map(r => ({ modeId: r.idiomId, fit: +r.fit.toFixed(3) })),
    };
  }).filter(Boolean);

  /**
   * ΣΧΕΤΙΚΟΙ ΤΡΟΠΟΙ. Το Ντο μείζονα και το Λα ελάσσονα έχουν τους ΙΔΙΟΥΣ
   * φθόγγους· το ίδιο το Μι φλαμένκο με το Λα ελάσσονα. Η ακολουθία
   * Am-F-C-G δεν μπορεί να λυθεί από το ύψος των φθόγγων — θέλει μελωδία ή
   * έμφαση. Αντί να προσποιούμαστε βεβαιότητα, το δηλώνουμε: για ΤΙΣ ΠΡΟΤΑΣΕΙΣ
   * δεν έχει σημασία, γιατί οι σχετικοί τρόποι μοιράζονται το ίδιο λεξιλόγιο.
   */
  const best = (results[0] && results[0].score) ? results[0].score : 1;
  const bestSet = results[0] && pitchSet(results[0].tonic, results[0].scaleId);
  return results.slice(0, topN).map(r => ({
    ...r,
    confidence: +(r.score / best).toFixed(3),
    sameNotesAsTop: r !== results[0] && pitchSet(r.tonic, r.scaleId) === bestSet,
  }));
}

/* ───────────────────── 4. Πίνακες μετάβασης (λειτουργικοί) ──────────────── */

/** P(επόμενη βαθμίδα | τρέχουσα). Γραμμές: I ii iii IV V vi vii */
export const TRANSITIONS = {
  major: [
    [0.05, 0.15, 0.08, 0.25, 0.25, 0.18, 0.04],
    [0.10, 0.05, 0.03, 0.10, 0.55, 0.10, 0.07],
    [0.10, 0.08, 0.05, 0.25, 0.10, 0.37, 0.05],
    [0.35, 0.12, 0.03, 0.05, 0.35, 0.08, 0.02],
    [0.55, 0.05, 0.02, 0.10, 0.05, 0.20, 0.03],
    [0.10, 0.30, 0.05, 0.22, 0.23, 0.05, 0.05],
    [0.60, 0.05, 0.10, 0.05, 0.15, 0.05, 0.00],
  ],
  minor: [
    [0.05, 0.08, 0.15, 0.25, 0.22, 0.15, 0.10],
    [0.15, 0.05, 0.05, 0.10, 0.50, 0.10, 0.05],
    [0.15, 0.05, 0.05, 0.15, 0.15, 0.35, 0.10],
    [0.40, 0.05, 0.10, 0.05, 0.30, 0.05, 0.05],
    [0.60, 0.03, 0.07, 0.10, 0.05, 0.12, 0.03],
    [0.20, 0.05, 0.10, 0.10, 0.35, 0.05, 0.15],
    [0.30, 0.03, 0.30, 0.07, 0.10, 0.15, 0.05],
  ],
};

/**
 * Στους δρόμους ΔΕΝ ισχύει η δυτική λειτουργική λογική: η κίνηση είναι
 * βαρύτητα προς την τονική + βηματική κίνηση τετραχόρδου. Άρα δεν φτιάχνουμε
 * πίνακα — παράγουμε την πιθανότητα από το prior + την απόσταση θεμελίων.
 */
function transitionProb(fromCand, toCand, modeId) {
  const mode = MODES[modeId];

  /**
   * Αν υπάρχει πίνακας μαθημένος από τη βιβλιοθήκη του χρήστη, αυτός
   * υπερισχύει — και του χειρόγραφου πίνακα και του τύπου για τους δρόμους.
   * Μετρημένο: ο τύπος έβαζε την bII πρώτη επιλογή μετά την τονική, ενώ στα
   * πραγματικά δεδομένα είναι πέμπτη με 5%· πρώτη είναι η bVII με 34%.
   */
  const learned = typeof LEARNED !== 'undefined' && LEARNED && LEARNED.__transitions ? LEARNED.__transitions[mode.functional ? 'functional' : 'modal'] : null;
  if (learned && fromCand && toCand) {
    const row = learned[fromCand.semitone];
    if (row && row[toCand.semitone] != null) return Math.max(row[toCand.semitone], 0.005);
  }

  if (mode.functional) {
    if (fromCand && fromCand.degree != null && toCand && toCand.degree != null) {
      const table = ((typeof LEARNED !== 'undefined' && LEARNED && LEARNED[modeId]) ? LEARNED[modeId].transitions : null)
                 || (MODES[modeId].scale === 'ionian' ? TRANSITIONS.major : TRANSITIONS.minor);
      return Math.max(table[fromCand.degree][toCand.degree], 0.01);
    }
    // Δανεική/χρωματική συγχορδία σε λειτουργικό τρόπο: υπαρκτή αλλά σαφώς
    // λιγότερο πιθανή — δεν την ανταγωνιζόμαστε με τις διατονικές.
    return Math.max(0.30 * ((toCand && toCand.prior != null) ? toCand.prior : 0.10), 0.01);
  }
  if (!toCand) return 0.15;
  let p = toCand.prior * 0.6;
  if (toCand.semitone === 0) p += 0.25;                                  // βαρύτητα τονικής
  if (fromCand) {
    const step = Math.min(mod12(toCand.semitone - fromCand.semitone),
                          mod12(fromCand.semitone - toCand.semitone));
    if (step === 1 || step === 2) p += 0.20;                             // βηματική κίνηση
    if (step === 5) p += 0.10;                                           // κίνηση κατά 4η/5η
    if (fromCand.semitone === toCand.semitone) p *= 0.15;                // όχι επανάληψη
  }
  return Math.max(p, 0.01);
}

/* ───────────── 4β. Ανίχνευση επανάληψης ΜΕΣΑ στο γραμμένο υλικό ─────────── */

/**
 * ΣΗΜΑΝΤΙΚΗ ΔΙΟΡΘΩΣΗ ΣΧΕΔΙΑΣΗΣ:
 * Στα πραγματικά chord sheets οι συγχορδίες γράφονται ΜΙΑ φορά — στην πρώτη
 * εμφάνιση της ενότητας — και ο μουσικός τις επαναλαμβάνει από μόνος του.
 * Άρα «ψάξε την ίδια ενότητα αλλού στο τραγούδι» σχεδόν ποτέ δεν εφαρμόζεται.
 *
 * Η επανάληψη όμως δεν χάνεται· κατεβαίνει επίπεδο. Μέσα στην ΜΙΑ γραμμένη
 * ενότητα υπάρχει σχεδόν πάντα περιοδικότητα: 2-, 4- ή 8-μετρο λούπα, ή δύο
 * φράσεις με ίδια αρμονία. Αυτό είναι πάλι αναζήτηση, όχι πρόβλεψη.
 */

export const chordKey = sym => {
  const p = parseChord(sym);
  return p ? `${p.root}:${QUALITY_FAMILY[p.quality]}` : null;
};

/** Βρίσκει την αρμονική περίοδο (λούπα) και διαβάζει το κενό από αυτήν. */
export function findByPeriodicity(slots, idx) {
  const n = slots.length;
  const keys = slots.map(s => (s ? chordKey(s) : null));

  for (let p = 2; p <= Math.min(8, Math.floor(n / 2)); p++) {
    let agree = 0, disagree = 0;
    for (let i = 0; i + p < n; i++) {
      if (!keys[i] || !keys[i + p]) continue;
      keys[i] === keys[i + p] ? agree++ : disagree++;
    }
    if (agree < 2) continue;                       // πολύ λίγα στοιχεία
    const rate = agree / (agree + disagree);
    if (rate < 0.75) continue;                     // η περίοδος δεν στέκει

    // ψήφοι από τις θέσεις της ίδιας κλάσης υπολοίπου
    const votes = {};
    for (let j = idx % p; j < n; j += p) {
      if (j !== idx && slots[j]) votes[slots[j]] = (votes[slots[j]] || 0) + 1;
    }
    const ranked = Object.entries(votes).sort((a, b) => b[1] - a[1]);
    if (!ranked.length) continue;
    // Ισοπαλία ψήφων = η «περίοδος» είναι ψευδής (π.χ. τονική κάθε δεύτερη θέση).
    // Δεν διαλέγουμε στην τύχη — αφήνουμε το αρμονικό σκέλος να αποφασίσει.
    if (ranked.length > 1 && ranked[0][1] === ranked[1][1]) continue;

    const [sym, count] = ranked[0];

    /**
     * Η βεβαιότητα ΔΕΝ εξαρτάται από τη γενική συνοχή του μοτίβου αλλά από
     * το πόσες φορές έχουμε δει ΑΥΤΗ τη θέση συμπληρωμένη. Με μία μόνο
     * παρατήρηση κάνουμε προέκταση από ένα δείγμα — και αν η θέση τύχει να
     * είναι αυτή που παραλλάσσει, βγάζουμε σίγουρο λάθος.
     */
    let conf = count >= 3 ? 0.95 : count === 2 ? 0.88 : 0.72;
    conf += 0.10 * Math.min(agree, 4) / 4;                  // ισχύς του μοτίβου
    conf *= rate;

    /**
     * Πτώση φράσης: η τελευταία θέση κάθε μοτίβου είναι ακριβώς εκεί που η
     * μουσική αλλάζει (ανοιχτή vs κλειστή πτώση: …D Em | …D G). Με μία μόνο
     * επιβεβαίωση, εκεί δεν έχουμε δικαίωμα να είμαστε σίγουροι.
     */
    const atCadence = idx % p === p - 1;
    if (atCadence && count < 2) conf *= 0.80;

    return {
      chord: sym, period: p, votes: count,
      confidence: +Math.min(0.95, conf).toFixed(3),
      reason: `Η ενότητα επαναλαμβάνει μοτίβο ${p} συγχορδιών · στην ίδια θέση παίζει ${sym}`
            + (count >= 2 ? ` (${count} φορές)` : ' (μία φορά — προσοχή)'),
    };
  }
  return null;
}

/** Το ίδιο μοτίβο εμφανίζεται αλλού στο τραγούδι (π.χ. στροφή ↔ ρεφρέν). */
export function findBySubsequence(allSlots, globalIdx) {
  const keys = allSlots.map(s => (s ? chordKey(s) : null));
  const n = keys.length;

  /**
   * ΜΟΝΟ παράθυρο 4. Μετρημένο σε πραγματικό ελληνικό setlist: τα παράθυρα
   * των 3 συγχορδιών έπιαναν 16 επιπλέον θέσεις με ακρίβεια κάτω από τη
   * μηχανή που θα τις χειριζόταν αλλιώς — δηλαδή ΕΒΛΑΠΤΑΝ, δηλώνοντας
   * ταυτόχρονα 70% βεβαιότητα. Το top-3 ανέβηκε 60% → 62.4% με την αφαίρεσή τους.
   */
  for (const win of [4]) {                      // μεγαλύτερο παράθυρο = ισχυρότερη ένδειξη
    for (let off = 0; off < win; off++) {
      const start = globalIdx - off;
      if (start < 0 || start + win > n) continue;
      const pattern = keys.slice(start, start + win);
      if (pattern.filter(Boolean).length < win - 1) continue;   // θέλουμε ένα μόνο κενό

      const hits = [];
      for (let i = 0; i + win <= n; i++) {
        if (i === start) continue;
        let ok = true;
        for (let k = 0; k < win; k++) {
          if (pattern[k] === null) { if (!keys[i + k]) { ok = false; break; } continue; }
          if (keys[i + k] !== pattern[k]) { ok = false; break; }
        }
        if (ok) hits.push(allSlots[i + off]);
      }
      const uniq = [...new Set(hits.filter(Boolean))];
      if (uniq.length === 1) {
        return {
          chord: uniq[0],
          /**
           * Μετρημένη ακρίβεια σε πραγματικό corpus: 54%. Η αρχική εκτίμηση
           * 0.82 ήταν υπεραισιόδοξη κατά ~25 μονάδες. Χρειάζεται νέα
           * βαθμονόμηση σε μεγαλύτερη βιβλιοθήκη — 9 τραγούδια δεν αρκούν
           * για οριστικό αριθμό, αλλά αρκούν για να δείξουν ότι το 0.82 ήταν λάθος.
           */
          confidence: 0.70,
          reason: `Το ίδιο μοτίβο ${win} συγχορδιών εμφανίζεται αλλού στο τραγούδι με ${uniq[0]} σε αυτή τη θέση`,
        };
      }
    }
  }
  return null;
}

/* ───────── 4γ. Συμφιλίωση δηλωμένης τονικότητας με τις συγχορδίες ───────── */

/**
 * Το δηλωμένο `key` ΔΕΝ είναι αυθεντία.
 *
 * Τραγούδια που έχουν εισαχθεί από τρίτες πηγές δηλώνουν συχνά τη ΣΧΕΤΙΚΗ
 * ΜΕΙΖΟΝΑ ενώ το κομμάτι είναι εμφανώς ελάσσονα (π.χ. «Φα» αντί για «Ρε
 * ελάσσονα»). Ταυτόχρονα, όπου η ανίχνευση ισοβαθμεί, η δήλωση είναι
 * πολύτιμος διαιτητής — μετρημένο: «Το φιλί δεν είναι κρίμα» βγάζει
 * Φα μείζονα 1.000 έναντι Ρε ελάσσονα 0.994, και το δηλωμένο Dm έχει δίκιο.
 *
 * Άρα: δεκτή ως ένδειξη όταν (α) είναι κοντά στην κορυφή ΚΑΙ (β) η ίδια η
 * τονική της εμφανίζεται πραγματικά ως συγχορδία στο τραγούδι.
 */
function tonicSupport(chords, tonic) {
  let n = 0;
  chords.forEach((ch, i) => {
    if (!ch || ch.root !== tonic) return;
    n += (i === 0 || i === chords.length - 1) ? 2 : 1;
  });
  return n / Math.max(chords.length, 1);
}

export function reconcileKey(chordSyms, declaredKey, opts = {}) {
  const { margin = 0.90, supportRatio = 0.55 } = opts;
  const chords = chordSyms.map(parseChord).filter(Boolean);
  const detection = detectMode(chordSyms, { topN: 12 });
  if (!detection.length) return null;

  const top = detection[0];
  const decl = declaredKey && parseChord(declaredKey);
  if (!decl) return { ...top, source: 'detected', declaredKey: null };

  const match = detection.find(d => d.tonic === decl.root);
  const supDecl = tonicSupport(chords, decl.root);
  const supTop  = tonicSupport(chords, top.tonic);

  const closeEnough = match && match.score / top.score >= margin;
  const supported   = supTop === 0 || supDecl / supTop >= supportRatio;

  if (match && closeEnough && supported) {
    return { ...match, source: 'declared', declaredKey, agrees: match === top };
  }

  /* Η δήλωση δεν στέκει. Είναι ο κλασικός σχετικός τρόπος; */
  // ΠΡΟΣΟΧΗ: /m/.test('maj') είναι true — το «maj» περιέχει «m».
  const declMinor = QUALITY_FAMILY[decl.quality] === 'min' || QUALITY_FAMILY[decl.quality] === 'dim';
  const relOfDeclared = mod12(decl.root + (declMinor ? 3 : 9));
  const isRelative = relOfDeclared === top.tonic;
  return {
    ...top, source: 'detected', declaredKey, agrees: false,
    warning: isRelative
      ? `Το τραγούδι δηλώνει ${declaredKey} αλλά οι συγχορδίες δείχνουν τον σχετικό του τρόπο — τυπικό λάθος εισαγωγής`
      : `Το τραγούδι δηλώνει ${declaredKey} αλλά οι συγχορδίες δείχνουν ${top.label}`,
  };
}

/* ──────────────────────── 5. Η κύρια συνάρτηση πρότασης ─────────────────── */

/**
 * Ιεραρχία ενδείξεων — από την ισχυρότερη στην ασθενέστερη.
 * Το κλειδί: σε ένα songbook η ίδια ενότητα επαναλαμβάνεται. Αν λείπει
 * συγχορδία στο 1ο ρεφρέν και το 2ο ρεφρέν την έχει, δεν είναι πρόβλεψη —
 * είναι αναζήτηση, με ~100% ακρίβεια. Αυτό ελέγχουμε ΠΡΩΤΑ.
 *
 * @param song  { key?, mode?, style?, sections:[{ id, name, chords:[string|null] }] }
 * @param slot  { sectionIndex, chordIndex }
 */
/**
 * @param ignoreRepetition Αγνοεί περιοδικότητα και μοτίβα, αναγκάζοντας
 *   αρμονική συλλογιστική.
 *
 *   ΓΙΑΤΙ ΥΠΑΡΧΕΙ: όταν ο χρήστης θέλει να ΑΝΤΙΚΑΤΑΣΤΗΣΕΙ μια συγχορδία που
 *   δεν του αρέσει, θα την αλλάξει σε ΟΛΕΣ τις επαναλήψεις της. Άρα η
 *   απάντηση «η ίδια θέση αλλού έχει X» διαβάζει ακριβώς τα αντίγραφα που
 *   κι εκείνος θα άλλαζε — είναι κυκλική. Για αυτή τη χρήση η επανάληψη δεν
 *   είναι τεκμήριο.
 */
export function detectModeFromString(declStr, parsedChord = null) {
  if (!declStr) return 'pop_major';
  const norm = declStr.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  
  if (norm.includes('χιτζαζ') || norm.includes('hitzaz')) return 'laiko_hitzaz';
  if (norm.includes('ουσακ') || norm.includes('ousak')) return 'laiko_ousak';
  if (norm.includes('κιουρντι') || norm.includes('kiourdi')) return 'laiko_kiourdi';
  if (norm.includes('σαμπα') || norm.includes('sabah')) return 'laiko_sabah';
  if (norm.includes('ραστ') || norm.includes('rast')) return 'laiko_rast';
  if (norm.includes('χιουζαμ') || norm.includes('houzam')) return 'laiko_houzam';
  if (norm.includes('σεγκαχ') || norm.includes('segah')) return 'laiko_segah';
  if (norm.includes('νιαβεντ') || norm.includes('niavent')) return 'laiko_niavent';
  if (norm.includes('αρμονικη') || norm.includes('harmonic')) return 'classical_minor';
  if (norm.includes('δωρικος') || norm.includes('dorian')) return 'dorian';
  if (norm.includes('φρυγικος') || norm.includes('phrygian')) return 'phrygian';
  if (norm.includes('λυδικος') || norm.includes('lydian')) return 'lydian';
  if (norm.includes('μιξολυδικος') || norm.includes('mixolydian')) return 'mixolydian';
  if (norm.includes('ματζορε') || norm.includes('μειζονα') || norm.includes('major')) return 'pop_major';
  if (norm.includes('μινορε') || norm.includes('ελασσονα') || norm.includes('minor')) return 'pop_minor';
  
  if (parsedChord && (parsedChord.quality === 'm' || parsedChord.quality === 'min' || parsedChord.quality === 'min7')) {
    return 'pop_minor';
  }
  return 'pop_major';
}

export function suggestMissing(song, slot, { topN = 3, ignoreRepetition = false } = {}) {
  const sections = song.sections || [];
  const target = sections[slot.sectionIndex];
  if (!target) throw new Error('Άκυρη ενότητα');

  // — Επίπεδο 0: τονικότητα & τρόπος (δηλωμένα ή συμπερασμένα)
  const allChords = sections.flatMap(s => s.chords).filter(Boolean);
  let tonic = song.key, modeId = song.mode, detection = null;
  let keyWarning = null, keySource = 'declared';
  if (tonic == null || !modeId) {
    detection = detectMode(allChords, { topN: 12 });
    /* Removed exception for empty chords */
    /**
     * Αν το τραγούδι ΔΗΛΩΝΕΙ τονικότητα (τα .mnote τη δηλώνουν), δεν τη
     * μαντεύουμε — διαλέγουμε τον καλύτερο τρόπο ΜΕΣΑ σε αυτή την τονική.
     * Μετρημένο σε πραγματικό setlist: η ανίχνευση έπεφτε έξω σε τραγούδι με
     * εισαγωγή που ξεκινά από άλλη συγχορδία («Το φιλί δεν είναι κρίμα»,
     * εισαγωγή σε Φα, τραγούδι σε Ρε ελάσσονα).
     */
    
    const declStr = song.declaredKey || (tonic != null && typeof tonic === 'number' ? noteName(tonic, false) + 'm' : null) || (typeof tonic === 'string' ? tonic : null);
    let pick = null;
    if (!allChords.length && declStr) {
        const p = parseChord(declStr);
        if (p) {
            pick = { tonic: p.root, modeId: detectModeFromString(declStr, p), source: 'declared', warning: null };
        }
    } else if (detection.length > 0) {
        const rec = reconcileKey(allChords, declStr);
        pick = rec || detection[0];
    }
    if (!pick) throw new Error('Αδύνατη η εύρεση τονικότητας');
    keyWarning = pick.warning || null;
    keySource = pick.source || 'detected';
    tonic = pick.tonic;

    modeId ||= pick.modeId;
    detection = detection.slice(0, 3);
  }
  const style = song.style || 'simple';
  /**
   * Η γραφή του τραγουδιού υπερισχύει της θεωρίας. Το `song.accidentals`
   * επιτρέπει ρητή δήλωση· αλλιώς κοιτάμε τι γράφει ήδη ο χρήστης εδώ.
   */
  const accidentals = song.accidentals !== undefined && song.accidentals !== null ? song.accidentals : detectAccidentalStyle(allChords);
  const vocab = deriveVocabulary(modeId);
  const asCand = sym => {
    const p = parseChord(sym); if (!p) return null;
    const rel = mod12(p.root - tonic);
    return vocab.find(v => v.semitone === rel && v.quality === p.quality)
        || vocab.find(v => v.semitone === rel && sameFamily(v.quality, p.quality))
        || vocab.find(v => v.semitone === rel)
        || { degree: null, semitone: rel, quality: p.quality, prior: 0.05, foreign: true };
  };

  const wrap = (hit, evidence) => ({
    key: { tonic, tonicName: spellRelative(tonic, 0, modeId, accidentals), modeId,
           label: MODES[modeId].label, source: keySource, warning: keyWarning },
    detection, evidence,
    suggestions: [{ chord: hit.chord, confidence: hit.confidence, reason: hit.reason }],
    lowConfidence: hit.confidence < 0.6,
  });

  // — Επίπεδο 1α: περιοδικότητα ΜΕΣΑ στη γραμμένη ενότητα (η συνηθισμένη περίπτωση)
  const periodic = ignoreRepetition ? null : findByPeriodicity(target.chords, slot.chordIndex);
  if (periodic) return wrap(periodic, 'periodicity');

  // — Επίπεδο 1β: το ίδιο μοτίβο αλλού στο τραγούδι
  const flat = sections.flatMap(s => s.chords);
  const offset = sections.slice(0, slot.sectionIndex).reduce((a, s) => a + s.chords.length, 0);
  const sub = ignoreRepetition ? null : findBySubsequence(flat, offset + slot.chordIndex);
  if (sub) return wrap(sub, 'subsequence');

  // — Επίπεδο 1γ: παράλληλη ενότητα γραμμένη δεύτερη φορά (σπάνιο, αλλά δωρεάν)
  const parallel = ignoreRepetition ? [] : sections.filter((s, i) =>
    i !== slot.sectionIndex &&
    (s.name || '').toLowerCase() === (target.name || '').toLowerCase() &&
    s.chords.length === target.chords.length &&
    s.chords[slot.chordIndex]);
  if (parallel.length) {
    const tally = {};
    parallel.forEach(s => { const c = s.chords[slot.chordIndex]; tally[c] = (tally[c] || 0) + 1; });
    const [sym, n] = Object.entries(tally).sort((a, b) => b[1] - a[1])[0];
    return {
      key: { tonic, tonicName: noteName(tonic, MODES[modeId].flats), modeId, label: MODES[modeId].label },
      detection, evidence: 'parallel-section',
      suggestions: [{
        chord: sym, confidence: n === parallel.length ? 0.97 : 0.80,
        reason: `Η ίδια θέση στην ενότητα «${target.name}» αλλού στο τραγούδι έχει ${sym}` +
                (n === parallel.length ? '' : ` (${n} από ${parallel.length} φορές)`),
      }],
    };
  }

  // — Επίπεδο 2+3: αρμονικό συμφραζόμενο + prior τρόπου
  const prevSym = [...target.chords.slice(0, slot.chordIndex)].reverse().find(Boolean)
               || [...sections.slice(0, slot.sectionIndex).flatMap(s => s.chords)].reverse().find(Boolean);
  const nextSym = target.chords.slice(slot.chordIndex + 1).find(Boolean)
               || sections.slice(slot.sectionIndex + 1).flatMap(s => s.chords).find(Boolean);
  const prev = prevSym ? asCand(prevSym) : null;
  const next = nextSym ? asCand(nextSym) : null;

  const isLast = slot.chordIndex === target.chords.length - 1;
  const isPenult = slot.chordIndex === target.chords.length - 2;

  /**
   * ΤΙ ΕΚΑΝΕ ΗΔΗ ΑΥΤΟ ΤΟ ΤΡΑΓΟΥΔΙ.
   *
   * Μετρημένο σε τέσσερα σώματα: μια αφελής βάση «τι ακολούθησε την ίδια
   * συγχορδία νωρίτερα σε ΑΥΤΟ το τραγούδι» πιάνει, με 3 προτάσεις, 72.5%
   * στα ελληνικά και 86.3% στο βρετανικό φολκ — δηλαδή νικάει ολόκληρη τη
   * θεωρητική μηχανή. Και είναι συμπληρωματική: το καθένα πιάνει ~14% που
   * το άλλο χάνει.
   *
   * Η περιοδικότητα και η αναζήτηση μοτίβου απαιτούν ολόκληρο επαναλαμβανόμενο
   * σχήμα ή παράθυρο τεσσάρων. Αυτό εδώ είναι πολύ πιο ανεκτικό: αρκεί να έχει
   * ξαναϋπάρξει η ίδια μετάβαση μία φορά.
   */
  const songBigram = {};
  if (prevSym) {
    const prevKey = chordKey(prevSym);
    for (const sec of sections) {
      const cs = sec.chords;
      for (let i = 0; i < cs.length - 1; i++) {
        if (!cs[i] || !cs[i + 1]) continue;
        if (chordKey(cs[i]) !== prevKey) continue;
        const nk = chordKey(cs[i + 1]);
        if (nk && nk !== prevKey) songBigram[nk] = (songBigram[nk] || 0) + 1;
      }
    }
  }
  const bigramTotal = Object.values(songBigram).reduce((a, b) => a + b, 0);

  // Βάρη: όταν ΥΠΑΡΧΕΙ συμφραζόμενο, αυτό πρέπει να υπερισχύει του prior.
  const W_PRIOR = (prev || next) ? 1.0 : 2.0;
  const W_CTX = 1.3;

  /**
   * Συγχορδίες που ΕΧΟΥΝ ΞΑΝΑΚΟΛΟΥΘΗΣΕΙ την προηγούμενη μέσα σε αυτό το
   * τραγούδι μπαίνουν ως υποψήφιες ΑΚΟΜΑ ΚΙ ΑΝ δεν ανήκουν στον τρόπο.
   * Χωρίς αυτό, ο όρος bigram ενισχύει μόνο ό,τι ήδη σκεφτόμασταν — και οι
   * δανεικές, που είναι ακριβώς οι δύσκολες, δεν μπαίνουν ποτέ στη λίστα.
   */
  const FAMILY_TO_QUALITY = { maj: 'maj', min: 'min', dim: 'dim', aug: 'aug', sus: 'sus4' };
  const extraCands = [];
  /* Κάθε συγχορδία που ακούγεται ήδη στο τραγούδι είναι υποψήφια, ακόμη κι αν
     δεν ανήκει στον τρόπο. Ένα κομμάτι που έχει μέσα του μια χρωματική δεν
     πρέπει να την ξεχνάει η μηχανή επειδή δεν χωράει στην κλίμακα. */
  const inSong = new Set(allChords.map(c => chordKey(c)).filter(Boolean));
  for (const key of new Set([...Object.keys(songBigram), ...inSong])) {
    const [rootStr, fam] = key.split(':');
    const semi = mod12(+rootStr - tonic);
    const quality = FAMILY_TO_QUALITY[fam];
    if (!quality) continue;
    if (vocab.some(v => v.semitone === semi && sameFamily(v.quality, quality))) continue;
    extraCands.push({ degree: null, semitone: semi, quality, prior: 0.10,
                      note: 'εμφανίστηκε ήδη σε αυτή τη θέση' });
  }

  const scored = [...vocab, ...extraCands].map(cand => {
    let logScore = W_PRIOR * Math.log(cand.prior + 0.02);
    if (prev) logScore += W_CTX * Math.log(transitionProb(prev, cand, modeId));
    if (next) logScore += W_CTX * Math.log(transitionProb(cand, next, modeId));
    // πτωτικά μπόνους
    if (isLast && cand.semitone === 0) logScore += 0.8;
    if (isPenult && MODES[modeId].functional && cand.degree === 4) logScore += 0.5;
    if (isPenult && !MODES[modeId].functional && cand.semitone === 1) logScore += 0.5; // bII->I στους δρόμους
    // μια συγχορδία που ήδη ακούγεται στο τραγούδι είναι πιο πιθανή
    const used = allChords.some(s => { const c = asCand(s); return c && c.semitone === cand.semitone && c.quality === cand.quality; });
    if (used) logScore += 0.45;

    // …και πολύ πιο πιθανή αν έχει ΞΑΝΑΚΟΛΟΥΘΗΣΕΙ αυτή ακριβώς τη συγχορδία
    if (bigramTotal) {
      const key = `${mod12(tonic + cand.semitone)}:${QUALITY_FAMILY[cand.quality]}`;
      const seen = songBigram[key] || 0;
      if (seen) logScore += TUNING.songBigram * Math.log(1 + seen / bigramTotal * 4);
    }
    return { cand, logScore };
  });

  const max = Math.max(...scored.map(s => s.logScore));
  const exp = scored.map(s => ({ ...s, p: Math.exp(s.logScore - max) }));
  const sum = exp.reduce((a, b) => a + b.p, 0);

  const ranked = exp.sort((a, b) => b.p - a.p).map(({ cand, p }) => ({
    cand, chord: spellChord(cand, tonic, modeId, style, accidentals),
    confidence: +(p / sum).toFixed(3),
    reason: buildReason(cand, prev, next, prevSym, nextSym, modeId, isLast),
  }));

  /**
   * ΔΕΣΜΕΥΜΕΝΕΣ ΘΕΣΕΙΣ.
   *
   * Με τρεις μόνο προτάσεις και δύο πηγές που πιάνουν διαφορετικά πράγματα
   * (~14% η καθεμία που η άλλη χάνει), η ανάμειξη σε ένα σκορ αφήνει τη
   * θεωρία να πνίγει την εμπειρία του ίδιου του τραγουδιού. Κρατάμε λοιπόν
   * τις πρώτες θέσεις για ό,τι έχει ΞΑΝΑΚΟΛΟΥΘΗΣΕΙ αυτή τη συγχορδία εδώ.
   * Μετρημένο: 69.5% → 78% top-3 στα ελληνικά.
   */
  const slots = Math.min(TUNING.bigramSlots, topN - 1);
  let suggestions;
  if (slots > 0 && allChords.length) {
    /* Πρώτα όσες έχουν ξανακολουθήσει αυτή τη συγχορδία, μετά —όταν δεν
       υπάρχει τέτοια ένδειξη— οι συχνότερες του τραγουδιού. Στην αρχή ενός
       τραγουδιού η δεύτερη λίστα κάνει όλη τη δουλειά. */
    const freq = {};
    for (const sym of allChords) { const k = chordKey(sym); if (k) freq[k] = (freq[k] || 0) + 1; }
    const order = [...new Set([
      ...Object.entries(songBigram).sort((a, b) => b[1] - a[1]).map(x => x[0]),
      ...Object.entries(freq).sort((a, b) => b[1] - a[1]).map(x => x[0]),
    ])];
    const reserved = [];
    for (const key of order) {
      if (reserved.length >= slots) break;
      const hit = ranked.find(r => chordKey(r.chord) === key && !reserved.includes(r));
      if (hit) reserved.push(hit);
    }
    suggestions = [...reserved, ...ranked.filter(r => !reserved.includes(r))].slice(0, topN);
  } else {
    suggestions = ranked.slice(0, topN);
  }
  suggestions = suggestions.map(({ cand, ...rest }) => rest);

  return {
    key: { tonic, tonicName: spellRelative(tonic, 0, modeId, accidentals), modeId,
           label: MODES[modeId].label, source: keySource, warning: keyWarning },
    detection, evidence: prev || next ? 'harmonic-context' : 'mode-prior',
    context: { prev: prevSym || null, next: nextSym || null },
    suggestions,
    // Ειλικρίνεια: «δεν ξέρω» όταν είτε η κορυφή είναι χαμηλή, είτε οι δύο
    // πρώτες είναι ισοπαλία. Καλύτερα παλέτα παρά αυτοπεποίθηση χωρίς κάλυμμα.
    lowConfidence: suggestions[0].confidence < 0.45
      || (suggestions[1] && suggestions[0].confidence - suggestions[1].confidence < 0.12),
  };
}

/** Ρωμαϊκό σύμβολο από την απόσταση σε ημιτόνια — δουλεύει και για τους δρόμους. */
const ROMAN_BY_SEMITONE = ['I', 'bII', 'II', 'bIII', 'III', 'IV', '#IV', 'V', 'bVI', 'VI', 'bVII', 'VII'];
function buildReason(cand, prev, next, prevSym, nextSym, modeId, isLast) {
  const bits = [];
  const r = ROMAN_BY_SEMITONE[cand.semitone];
  const minorish = cand.quality === 'min' || cand.quality === 'dim' || cand.quality === 'min7';
  bits.push(`${minorish ? r.toLowerCase() : r} βαθμίδα`);
  if (cand.note) bits.push(cand.note);
  if (prevSym && nextSym) bits.push(`γέφυρα ${prevSym} → ${nextSym}`);
  else if (prevSym) bits.push(`μετά από ${prevSym}`);
  else if (nextSym) bits.push(`πριν από ${nextSym}`);
  if (isLast) bits.push('τέλος φράσης');
  if (!MODES[modeId].functional) bits.push('τυπική κίνηση του δρόμου');
  return bits.join(' · ');
}

export default { parseChord, MODES, STYLE_PROFILES, deriveVocabulary, spellChord, detectMode, suggestMissing, reconcileKey };
