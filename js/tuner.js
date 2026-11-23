/* ===========================================================
   CHROMATIC & INSTRUMENT TUNER MODULE - mNotes Pro
   =========================================================== */

(function(globalScope) {
    // Pre-allocated FFT workspaces keyed by FFT size (M = 2*N) to avoid per-frame allocations
    const fftWorkspaces = {};

    function getFftWorkspace(size) {
        if (fftWorkspaces[size]) return fftWorkspaces[size];
        const half = size >> 1;
        const re = new Float64Array(size);
        const im = new Float64Array(size);
        const cosTable = new Float64Array(half);
        const sinTable = new Float64Array(half);
        const bitRev = new Int32Array(size);
        const nsdf = new Float64Array(half);

        for (let i = 0; i < half; i++) {
            const angle = (-2 * Math.PI * i) / size;
            cosTable[i] = Math.cos(angle);
            sinTable[i] = Math.sin(angle);
        }

        let bits = 0;
        while ((1 << bits) < size) bits++;
        for (let i = 0; i < size; i++) {
            let rev = 0;
            for (let b = 0; b < bits; b++) {
                if ((i >> b) & 1) rev |= 1 << (bits - 1 - b);
            }
            bitRev[i] = rev;
        }

        const ws = { size, re, im, cosTable, sinTable, bitRev, nsdf };
        fftWorkspaces[size] = ws;
        return ws;
    }

    function fftInPlace(ws) {
        const { size, re, im, cosTable, sinTable, bitRev } = ws;

        for (let i = 0; i < size; i++) {
            const j = bitRev[i];
            if (i < j) {
                const tr = re[i]; re[i] = re[j]; re[j] = tr;
                const ti = im[i]; im[i] = im[j]; im[j] = ti;
            }
        }

        for (let halfLen = 1; halfLen < size; halfLen <<= 1) {
            const step = halfLen << 1;
            const tableStep = size / step;
            for (let i = 0; i < size; i += step) {
                let k = 0;
                for (let j = 0; j < halfLen; j++) {
                    const idx1 = i + j;
                    const idx2 = idx1 + halfLen;
                    const cos = cosTable[k];
                    const sin = sinTable[k];
                    const tRe = re[idx2] * cos - im[idx2] * sin;
                    const tIm = re[idx2] * sin + im[idx2] * cos;
                    re[idx2] = re[idx1] - tRe;
                    im[idx2] = im[idx1] - tIm;
                    re[idx1] += tRe;
                    im[idx1] += tIm;
                    k += tableStep;
                }
            }
        }
    }

    function nextPow2(n) {
        let p = 1;
        while (p < n) p <<= 1;
        return p;
    }

    function computeRmsAndPeak(buffer) {
        if (!buffer || !buffer.length) return { rms: 0, peak: 0, energy: 0 };
        const len = buffer.length;
        let energy = 0;
        let peak = 0;
        for (let i = 0; i < len; i++) {
            const s = buffer[i];
            energy += s * s;
            const a = s < 0 ? -s : s;
            if (a > peak) peak = a;
        }
        return { rms: Math.sqrt(energy / len), peak, energy };
    }

    function parabolicPeak(arr, idx, maxIdx) {
        let trueIdx = idx;
        let val = arr[idx];
        if (idx > 0 && idx < maxIdx) {
            const y1 = arr[idx - 1];
            const y2 = arr[idx];
            const y3 = arr[idx + 1];
            const a = (y1 + y3 - 2 * y2) / 2;
            const b = (y3 - y1) / 2;
            if (a < 0) {
                const delta = Math.max(-1, Math.min(1, -b / (2 * a)));
                trueIdx = idx + delta;
                val = Math.min(1, y2 - (b * b) / (4 * a));
            }
        }
        return { idx: trueIdx, val };
    }

    /**
     * McLeod Pitch Method (NSDF + key maxima + parabolic interpolation).
     * Uses O(N log N) FFT-based autocorrelation with reusable buffers and peak normalization.
     * Pure function (no DOM/Web Audio) so it can be tested directly in Node.
     *
     * @param {Float32Array|number[]} buffer
     * @param {number} sampleRate
     * @param {{ min?: number, max?: number, minRms?: number, minClarity?: number, cutoff?: number, direct?: boolean }} [opts]
     * @returns {{ freq: number, clarity: number, rms: number } | null}
     */
    function detectPitch(buffer, sampleRate, opts) {
        if (!buffer || !buffer.length || !sampleRate) return null;
        const options = opts || {};
        const minFreq = options.min || 30;
        const maxFreq = options.max || 4000;
        const minRms = options.minRms !== undefined ? options.minRms : 0.0005;
        // 0.80 accommodates real acoustic instruments (inharmonicity, body resonance, decay) while rejecting noise
        const minClarity = options.minClarity !== undefined ? options.minClarity : 0.8;
        const cutoff = options.cutoff !== undefined ? options.cutoff : 0.9;
        const useDirect = !!options.direct;

        const len = buffer.length;
        const { rms, peak, energy } = computeRmsAndPeak(buffer);
        if (rms < minRms || peak === 0) return null;

        const minLag = Math.max(2, Math.floor(sampleRate / maxFreq));
        const maxLag = Math.min(len - 3, Math.ceil(sampleRate / minFreq));
        if (maxLag <= minLag) return null;

        const searchEnd = Math.min(len - 2, maxLag + 1);
        const invPeak = 1 / peak;
        const invPeakSq = invPeak * invPeak;

        const fftSize = nextPow2(len * 2);
        const ws = getFftWorkspace(fftSize);
        const nsdf = ws.nsdf;
        nsdf[0] = 1;

        if (useDirect) {
            let m = 2 * energy * invPeakSq;
            for (let tau = 1; tau <= searchEnd; tau++) {
                const prev = buffer[tau - 1] * invPeak;
                const tail = buffer[len - tau] * invPeak;
                m -= prev * prev + tail * tail;
                if (m <= 0) {
                    nsdf[tau] = 0;
                    continue;
                }
                let acf = 0;
                const limit = len - tau;
                for (let j = 0; j < limit; j++) {
                    acf += (buffer[j] * invPeak) * (buffer[j + tau] * invPeak);
                }
                nsdf[tau] = (2 * acf) / m;
            }
        } else {
            const { re, im } = ws;
            for (let i = 0; i < len; i++) {
                re[i] = buffer[i] * invPeak;
                im[i] = 0;
            }
            for (let i = len; i < fftSize; i++) {
                re[i] = 0;
                im[i] = 0;
            }

            fftInPlace(ws);

            for (let k = 0; k < fftSize; k++) {
                re[k] = re[k] * re[k] + im[k] * im[k];
                im[k] = 0;
            }

            // |X|^2 is real and even, so forward FFT / fftSize yields the exact inverse FFT
            fftInPlace(ws);

            const invFftSize = 1 / fftSize;
            let m = 2 * energy * invPeakSq;
            for (let tau = 1; tau <= searchEnd; tau++) {
                const prev = buffer[tau - 1] * invPeak;
                const tail = buffer[len - tau] * invPeak;
                m -= prev * prev + tail * tail;
                if (m <= 0) {
                    nsdf[tau] = 0;
                    continue;
                }
                const acf = re[tau] * invFftSize;
                nsdf[tau] = (2 * acf) / m;
            }
        }

        // Collect key maxima (highest peak in each positive lobe after initial zero crossing)
        const keyMaxima = [];
        let seenNegative = false;
        let inPositive = false;
        let curMaxTau = 0;
        let curMaxVal = -Infinity;

        for (let tau = 1; tau <= searchEnd; tau++) {
            const val = nsdf[tau];
            if (!seenNegative) {
                if (val <= 0) seenNegative = true;
                continue;
            }
            if (val > 0) {
                if (!inPositive) {
                    inPositive = true;
                    curMaxTau = tau;
                    curMaxVal = val;
                } else if (val > curMaxVal) {
                    curMaxTau = tau;
                    curMaxVal = val;
                }
            } else if (inPositive) {
                if (curMaxTau >= minLag && curMaxTau <= maxLag) {
                    keyMaxima.push({ tau: curMaxTau, val: curMaxVal });
                }
                inPositive = false;
                curMaxVal = -Infinity;
            }
        }
        if (inPositive && curMaxTau >= minLag && curMaxTau <= maxLag) {
            keyMaxima.push({ tau: curMaxTau, val: curMaxVal });
        }

        if (keyMaxima.length === 0) return null;

        let nmax = -Infinity;
        for (let i = 0; i < keyMaxima.length; i++) {
            if (keyMaxima[i].val > nmax) nmax = keyMaxima[i].val;
        }
        if (nmax < minClarity) return null;

        const threshold = cutoff * nmax;
        let best = null;
        for (let i = 0; i < keyMaxima.length; i++) {
            if (keyMaxima[i].val >= threshold) {
                best = keyMaxima[i];
                break;
            }
        }
        if (!best) return null;

        const p1 = parabolicPeak(nsdf, best.tau, searchEnd);
        const trueTau = p1.idx;
        const clarity = p1.val;

        if (clarity < minClarity || trueTau <= 0) return null;
        const freq = sampleRate / trueTau;
        if (freq < minFreq || freq > maxFreq) return null;

        return { freq, clarity, rms };
    }

    function medianOf(arr) {
        const sorted = arr.slice().sort((a, b) => a - b);
        const mid = Math.floor(sorted.length / 2);
        return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
    }

    /**
     * Adaptive cents-domain pitch smoother:
     * - Moving (3 consecutive measurements in same direction totaling > 4 cents, or 3 same-sign steps > 4 cents): median(3), alpha=0.7
     * - Stable (span < 2 cents over last 3 measurements): median(5), alpha=0.25
     * - Outlier gate: rejects > 50 cent jumps unless persisting 3 consecutive times
     */
    function createPitchSmoother(opts) {
        const options = opts || {};
        const stableWindow = options.windowSize || 5;
        const movingWindow = options.movingWindow || 3;
        const outlierCents = options.outlierCents || 50;
        const outlierStrikes = options.outlierStrikes || 3;
        const movingAlpha = options.movingAlpha || 0.7;
        const stableAlpha = options.stableAlpha || 0.25;

        let history = [];
        let outlierCount = 0;
        let smoothedCents = null;
        let lastRawCents = null;
        let mode = 'stable';

        function updateMode() {
            const len = history.length;
            if (len >= 3) {
                const a = history[len - 3];
                const b = history[len - 2];
                const c = history[len - 1];
                const d1 = b - a;
                const d2 = c - b;
                const sameDir3 = (d1 > 0 && d2 > 0) || (d1 < 0 && d2 < 0);
                if (sameDir3 && Math.abs(c - a) > 4) {
                    mode = 'moving';
                    return;
                }
                if (len >= 4) {
                    const p = history[len - 4];
                    const d0 = a - p;
                    const sameDir4 = (d0 > 0 && d1 > 0 && d2 > 0) || (d0 < 0 && d1 < 0 && d2 < 0);
                    if (sameDir4 && Math.abs(c - p) > 4) {
                        mode = 'moving';
                        return;
                    }
                }
                const span = Math.max(a, b, c) - Math.min(a, b, c);
                if (span < 2) {
                    mode = 'stable';
                }
            }
        }

        return {
            reset: function() {
                history = [];
                outlierCount = 0;
                smoothedCents = null;
                lastRawCents = null;
                mode = 'stable';
            },
            push: function(freq, refFreq) {
                const ref = refFreq || 440;
                const rawCents = 1200 * Math.log2(freq / ref);
                lastRawCents = rawCents;

                if (history.length > 0) {
                    const med = medianOf(history);
                    if (Math.abs(rawCents - med) > outlierCents) {
                        outlierCount++;
                        if (outlierCount < outlierStrikes) {
                            return smoothedCents;
                        }
                        history = [rawCents];
                        outlierCount = 0;
                        mode = 'stable';
                        smoothedCents = rawCents;
                        return smoothedCents;
                    }
                    outlierCount = 0;
                }

                history.push(rawCents);
                if (history.length > stableWindow) history.shift();

                updateMode();

                const activeSlice = mode === 'moving' ? history.slice(-movingWindow) : history;
                const activeAlpha = mode === 'moving' ? movingAlpha : stableAlpha;
                const medAfter = medianOf(activeSlice);

                smoothedCents = smoothedCents === null
                    ? medAfter
                    : smoothedCents + activeAlpha * (medAfter - smoothedCents);
                return smoothedCents;
            },
            getCents: function() {
                return smoothedCents;
            },
            getRawCents: function() {
                return lastRawCents;
            },
            getMode: function() {
                return mode;
            }
        };
    }

    /**
     * Hysteresis state machine for tuning zones:
     * - perfect: enter |cents| <= 5 for >= 150ms, exit |cents| > 7
     * - almost:  5 < |cents| <= 10 (exit > 12)
     * - warn:    10 < |cents| <= 25 (exit > 27)
     * - far:     |cents| > 25 (exit <= 25)
     */
    function createTuningStateMachine() {
        let zone = 'warn';
        let perfectSince = null;

        return {
            reset: function() {
                zone = 'warn';
                perfectSince = null;
            },
            evaluate: function(cents, nowMs) {
                const now = nowMs !== undefined ? nowMs : 0;
                const abs = Math.abs(cents);

                // Perfect hysteresis: enter <= 5 for >= 150ms, exit > 7
                if (zone === 'perfect') {
                    if (abs <= 7) {
                        return 'perfect';
                    }
                    perfectSince = null;
                } else if (abs <= 5) {
                    if (perfectSince === null) perfectSince = now;
                    if (now - perfectSince >= 150) {
                        zone = 'perfect';
                        return zone;
                    }
                } else {
                    perfectSince = null;
                }

                // Almost (5..10, exit > 12), Warn (10..25, exit > 27), Far (> 25)
                if (zone === 'almost') {
                    if (abs <= 12) return 'almost';
                    zone = abs <= 25 ? 'warn' : 'far';
                } else if (zone === 'warn') {
                    if (abs <= 10) zone = 'almost';
                    else if (abs > 27) zone = 'far';
                } else if (zone === 'far') {
                    if (abs <= 10) zone = 'almost';
                    else if (abs <= 25) zone = 'warn';
                } else {
                    // Coming out of 'perfect' (> 7)
                    if (abs <= 12) zone = 'almost';
                    else if (abs <= 25) zone = 'warn';
                    else zone = 'far';
                }

                return zone;
            },
            getZone: function() {
                return zone;
            }
        };
    }

    function tr(key, fallback) {
        if (typeof t === 'function') return t(key, fallback || '');
        if (typeof TRANSLATIONS !== 'undefined' && typeof currentLang !== 'undefined') {
            const dict = TRANSLATIONS[currentLang] || TRANSLATIONS.el || TRANSLATIONS.en;
            if (dict && dict[key]) return dict[key];
        }
        return fallback || '';
    }

    function isTunerDebugEnabled() {
        if (typeof window === 'undefined' || !window.location) return false;
        try {
            return new URLSearchParams(window.location.search).get('tunerDebug') === '1';
        } catch (_) {
            return false;
        }
    }

    const ChromaticTuner = {
        isRunning: false,
        audioCtx: null,
        analyser: null,
        micStream: null,
        rafId: null,
        refFreq: 440,
        detectPitch: detectPitch,
        createPitchSmoother: createPitchSmoother,
        createTuningStateMachine: createTuningStateMachine,

        // ✨ Smoothing, Noise Gate & Hysteresis State
        smoother: createPitchSmoother(),
        stateMachine: createTuningStateMachine(),
        baseAnalysisIntervalMs: 40, // ~25 analyses/sec
        analysisIntervalMs: 40,
        silenceTimeoutMs: 400,
        lastAnalysisTime: 0,
        lastValidTime: 0,
        noiseFloorRms: 0,
        isSilentState: true,
        displayedMidi: null,
        timeBuffer: null,
        elDebug: null,
        isBigViewOpen: false,
        _lastUiState: null,
        _savedLayout: null,
        _hooksInstalled: false,
        _escHandler: null,
        _popHandler: null,

        // ✨ Λεξικό Ορίων & Στόχων Συχνοτήτων ανά Όργανο (Μαγνητικό Κλείδωμα)
        currentInstrument: 'chromatic',
        RANGES: {
            'chromatic': { min: 30, max: 4000 },
            // E2, A2, D3, G3, B3, E4
            'guitar': { min: 70, max: 1200, targets: [40, 45, 50, 55, 59, 64] },
            // E1, A1, D2, G2
            'bass': { min: 30, max: 500, targets: [28, 33, 38, 43] },
            // C3, F3, A3, D4
            'bouzouki': { min: 120, max: 1500, targets: [48, 53, 57, 62] },
            // G3, D4, A4 (Κρητική Λύρα)
            'lyra': { min: 180, max: 1500, targets: [55, 62, 69] },
            // G3, D4, A4, E5
            'violin': { min: 180, max: 3500, targets: [55, 62, 69, 76] },
            // G3, D4, A4, E5
            'mandolin': { min: 180, max: 1500, targets: [55, 62, 69, 76] },
            // C2, F2, A2, D3, G3, C4
            'oud': { min: 50, max: 800, targets: [36, 41, 45, 50, 55, 60] }
        },

        NOTES: ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'],

        // UI Elements Cache
        elGroup: null,
        elInstrument: null,
        elStringsRow: null,
        elNote: null,
        elCents: null,
        elHz: null,
        elBar: null,
        elOverflowLeft: null,
        elOverflowRight: null,
        elStatus: null,
        elBtn: null,
        elBtnLabel: null,
        // Big Display Elements Cache (E2)
        elBigOverlay: null,
        elBigInst: null,
        elBigStringsRow: null,
        elBigNote: null,
        elBigCents: null,
        elBigHz: null,
        elBigBar: null,
        elBigOverflowLeft: null,
        elBigOverflowRight: null,
        elBigStatus: null,

        getFftSize: function(inst, sampleRate) {
            const range = ChromaticTuner.RANGES[inst] || ChromaticTuner.RANGES.chromatic;
            const sr = sampleRate || 48000;
            const needed = Math.ceil((4 * sr) / range.min);
            let size = range.min <= 60 ? 8192 : 4096;
            while (size < needed && size < 16384) size *= 2;
            return Math.min(8192, Math.max(4096, size));
        },

        midiToParts: function(midi) {
            const idx = ((midi % 12) + 12) % 12;
            const oct = Math.floor(midi / 12) - 1;
            return { letter: this.NOTES[idx], octave: oct, label: `${this.NOTES[idx]}${oct}` };
        },

        renderNoteHtml: function(letter, octave) {
            if (!letter || letter === '-') return '-';
            if (octave === undefined || octave === null || octave === '') return letter;
            return `${letter}<span class="tuner-octave">${octave}</span>`;
        },

        renderStringsRow: function(activeMidi, zone) {
            const range = this.RANGES[this.currentInstrument];
            const targets = range && range.targets ? range.targets : null;
            const containers = [this.elStringsRow, this.elBigStringsRow].filter(Boolean);
            for (const row of containers) {
                if (!targets || targets.length === 0) {
                    row.style.display = 'none';
                    row.innerHTML = '';
                    continue;
                }
                row.style.display = 'flex';
                row.innerHTML = targets.map(midi => {
                    const parts = this.midiToParts(midi);
                    const isActive = activeMidi === midi;
                    let cls = 'tuner-string-pill';
                    if (isActive) {
                        cls += ' is-active';
                        if (zone === 'perfect') cls += ' is-perfect';
                        else if (zone === 'almost' || zone === 'warn') cls += ' is-warning';
                    }
                    return `<span class="${cls}" data-midi="${midi}">${parts.label}</span>`;
                }).join('');
            }
        },

        refreshTranslations: function() {
            if (!this.elNote) this.initUI();
            if (this.elInstrument) {
                this.elInstrument.setAttribute('aria-label', tr('tuner_instrument_aria', ''));
            }
            if (this.elBtn) {
                this.elBtn.setAttribute('aria-label', tr('tuner_toggle_aria', ''));
            }
            if (this.elBtnLabel) {
                this.elBtnLabel.innerText = this.isRunning ? tr('tuner_stop', '') : tr('tuner_start', '');
            }
            const openTitle = tr('tuner_big_open_title', '');
            const readout = document.getElementById('tunerReadout');
            const scale = document.getElementById('tunerScale');
            if (readout && openTitle) readout.setAttribute('title', openTitle);
            if (scale && openTitle) scale.setAttribute('title', openTitle);
            if (this.elBigOverlay) {
                this.elBigOverlay.setAttribute('aria-label', tr('tuner_big_title', ''));
            }
            const closeBtn = document.getElementById('btnCloseTunerBig');
            if (closeBtn) {
                closeBtn.setAttribute('aria-label', tr('tuner_big_close', ''));
            }
            if (this.elBigInst && this.elInstrument) {
                const opt = this.elInstrument.options[this.elInstrument.selectedIndex];
                if (opt) this.elBigInst.innerText = opt.innerText;
            }

            if (!this.isRunning) {
                if (this.elStatus) this.elStatus.innerText = '';
                if (this.elBigStatus) this.elBigStatus.innerText = '';
            } else if (this.isSilentState || !this._lastUiState) {
                if (this.elStatus) this.elStatus.innerText = '';
                if (this.elBigStatus) this.elBigStatus.innerText = '';
            } else {
                const s = this._lastUiState;
                this.updateUI(s.note, s.hz, s.cents, s.outOfRange, s.now, s.targetMidi);
            }
        },

        installHooks: function() {
            if (typeof window === 'undefined') return;

            if (typeof window.applyTranslations === 'function' && !window.applyTranslations.__tunerWrapped) {
                const origApply = window.applyTranslations;
                const wrapped = () => {
                    origApply();
                    this.refreshTranslations();
                };
                wrapped.__tunerWrapped = true;
                window.applyTranslations = wrapped;
            }

            if (this._hooksInstalled) return;
            this._hooksInstalled = true;

            if (typeof MutationObserver !== 'undefined' && document.body) {
                const obs = new MutationObserver(() => {
                    if (document.body.classList.contains('play-mode') && this.isBigViewOpen) {
                        this.closeBigView();
                    }
                });
                obs.observe(document.body, { attributes: true, attributeFilter: ['class'] });
            }
        },

        scrollTunerIntoView: function() {
            if (typeof document === 'undefined') return;
            const drawer = document.getElementById('drawerTunerChords');
            if (drawer) drawer.open = true;
            if (this.elGroup && typeof this.elGroup.scrollIntoView === 'function') {
                this.elGroup.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
            }
        },

        onBigOverlayClick: function(e) {
            if (!this.isBigViewOpen || !e) return;
            if (e.target === this.elBigOverlay && typeof window !== 'undefined' && window.innerWidth >= 768) {
                this.closeBigView();
            }
        },

        openBigView: function() {
            if (!this.isRunning) return;
            if (typeof document !== 'undefined' && document.body && document.body.classList.contains('play-mode')) return;
            if (!this.elNote) this.initUI();
            if (!this.elBigOverlay) return;

            this.isBigViewOpen = true;
            this.elBigOverlay.style.display = 'flex';
            if (this.elBigInst && this.elInstrument) {
                const opt = this.elInstrument.options[this.elInstrument.selectedIndex];
                if (opt) this.elBigInst.innerText = opt.innerText;
            }
            this.refreshTranslations();

            if (!this._escHandler) {
                this._escHandler = (e) => {
                    if (e.key === 'Escape' && this.isBigViewOpen) {
                        this.closeBigView();
                    }
                };
                document.addEventListener('keydown', this._escHandler);
            }
            if (!this._popHandler) {
                this._popHandler = () => {
                    if (this.isBigViewOpen) {
                        this.closeBigView(true);
                    }
                };
                window.addEventListener('popstate', this._popHandler);
            }
            try {
                if (!window.history.state || !window.history.state.tunerBig) {
                    window.history.pushState({ ...(window.history.state || {}), tunerBig: true }, '');
                }
            } catch (_) {}
        },

        closeBigView: function(fromPopState) {
            if (!this.isBigViewOpen) return;
            this.isBigViewOpen = false;
            if (this.elBigOverlay) {
                this.elBigOverlay.style.display = 'none';
            }
            if (this._escHandler) {
                document.removeEventListener('keydown', this._escHandler);
                this._escHandler = null;
            }
            if (this._popHandler) {
                window.removeEventListener('popstate', this._popHandler);
                this._popHandler = null;
            }
            if (!fromPopState) {
                try {
                    if (window.history.state && window.history.state.tunerBig) {
                        window.history.back();
                    }
                } catch (_) {}
            }
        },

        resetTrackingState: function() {
            this.smoother.reset();
            this.stateMachine.reset();
            this.displayedMidi = null;
            this._lastUiState = null;
        },

        initUI: function() {
            this.elGroup = document.getElementById('tunerGroup');
            this.elInstrument = document.getElementById('tunerInstrument');
            this.elStringsRow = document.getElementById('tunerStringsRow');
            this.elNote = document.getElementById('tunerNote');
            this.elCents = document.getElementById('tunerCents');
            this.elHz = document.getElementById('tunerHz');
            this.elBar = document.getElementById('tunerIndicator');
            this.elOverflowLeft = document.getElementById('tunerOverflowLeft');
            this.elOverflowRight = document.getElementById('tunerOverflowRight');
            this.elStatus = document.getElementById('tunerStatus');
            this.elBtn = document.getElementById('btnToggleTuner');
            this.elBtnLabel = document.getElementById('btnToggleTunerLabel');

            this.elBigOverlay = document.getElementById('tunerBigOverlay');
            this.elBigInst = document.getElementById('tunerBigInstrument');
            this.elBigStringsRow = document.getElementById('tunerBigStringsRow');
            this.elBigNote = document.getElementById('tunerBigNote');
            this.elBigCents = document.getElementById('tunerBigCents');
            this.elBigHz = document.getElementById('tunerBigHz');
            this.elBigBar = document.getElementById('tunerBigIndicator');
            this.elBigOverflowLeft = document.getElementById('tunerBigOverflowLeft');
            this.elBigOverflowRight = document.getElementById('tunerBigOverflowRight');
            this.elBigStatus = document.getElementById('tunerBigStatus');

            if (isTunerDebugEnabled() && this.elStatus && !this.elDebug) {
                let dbg = document.getElementById('tunerDebugLine');
                if (!dbg) {
                    dbg = document.createElement('div');
                    dbg.id = 'tunerDebugLine';
                    dbg.style.cssText = 'font-size:11px;color:var(--text-muted);margin-top:4px;font-family:monospace;opacity:0.85;';
                    this.elStatus.insertAdjacentElement('afterend', dbg);
                }
                this.elDebug = dbg;
            }
            this.installHooks();
            this.setZoneClasses('idle');
            this.renderStringsRow(null, null);
        },

        setZoneClasses: function(zone) {
            const zoneClasses = ['tuner-zone-idle', 'tuner-zone-far', 'tuner-zone-warn', 'tuner-zone-almost', 'tuner-zone-perfect', 'is-perfect'];
            const targets = [this.elGroup, this.elBigOverlay].filter(Boolean);
            for (const el of targets) {
                el.classList.remove(...zoneClasses);
                if (zone) el.classList.add('tuner-zone-' + zone);
                if (zone === 'perfect') el.classList.add('is-perfect');
            }
        },

        setInstrument: function(inst) {
            if (this.RANGES[inst]) {
                this.currentInstrument = inst;
                this.resetTrackingState();
                if (!this.elNote) this.initUI();
                this.renderStringsRow(null, null);
                if (this.elBigInst && this.elInstrument) {
                    const opt = this.elInstrument.options[this.elInstrument.selectedIndex];
                    if (opt) this.elBigInst.innerText = opt.innerText;
                }
                if (this.analyser && this.audioCtx) {
                    const nextSize = this.getFftSize(inst, this.audioCtx.sampleRate);
                    if (this.analyser.fftSize !== nextSize) {
                        this.analyser.fftSize = nextSize;
                        this.timeBuffer = new Float32Array(nextSize);
                    }
                }
                console.log(`[Tuner] Όργανο: ${inst} | Όρια: ${this.RANGES[inst].min}Hz - ${this.RANGES[inst].max}Hz`);
            }
        },

        toggle: async function() {
            if (!this.elNote) this.initUI();
            this.isRunning ? this.stop() : await this.start();
        },

        start: async function() {
            if (!this.elNote) this.initUI();
            try {
                // Φόρτωση του A4 από τις γενικές ρυθμίσεις του mNotes
                const settings = JSON.parse(localStorage.getItem('mnotes_settings') || "{}");
                this.refFreq = parseInt(settings.refFreq) || 440;

                try {
                    this.micStream = await navigator.mediaDevices.getUserMedia({
                        audio: {
                            echoCancellation: false,
                            noiseSuppression: false,
                            autoGainControl: false
                        }
                    });
                } catch (_) {
                    this.micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
                }

                const AudioCtx = window.AudioContext || window.webkitAudioContext;
                try {
                    this.audioCtx = new AudioCtx({ latencyHint: 'interactive' });
                } catch (_) {
                    this.audioCtx = new AudioCtx();
                }

                const source = this.audioCtx.createMediaStreamSource(this.micStream);
                this.analyser = this.audioCtx.createAnalyser();
                this.analyser.fftSize = this.getFftSize(this.currentInstrument, this.audioCtx.sampleRate);
                this.timeBuffer = new Float32Array(this.analyser.fftSize);
                source.connect(this.analyser);

                this.isRunning = true;
                this.resetTrackingState();
                this.analysisIntervalMs = this.baseAnalysisIntervalMs;
                this.noiseFloorRms = 0;
                this.lastAnalysisTime = 0;
                this.lastValidTime = performance.now();
                this.isSilentState = true;

                if (this.elGroup) {
                    this.elGroup.classList.add('is-running');
                    this.elGroup.classList.remove('is-perfect');
                }
                if (this.elBtn) {
                    this.elBtn.classList.add('is-running');
                    const icon = this.elBtn.querySelector('i');
                    if (icon) icon.className = 'fas fa-stop';
                }
                if (this.elBtnLabel) {
                    this.elBtnLabel.setAttribute('data-i18n', 'tuner_stop');
                    this.elBtnLabel.innerText = tr('tuner_stop', '');
                }
                this.setNeutralDisplay('');
                this.scrollTunerIntoView();

                console.log(`[Tuner] Started with A4 = ${this.refFreq}Hz`);
                this.detect();
            } catch (e) {
                console.error("Tuner Mic Error:", e);
                if (typeof showToast === 'function') showToast(tr('tuner_mic_denied', ''), "error");
            }
        },

        setNeutralDisplay: function(statusText) {
            const noteEls = [this.elNote, this.elBigNote].filter(Boolean);
            const centsEls = [this.elCents, this.elBigCents].filter(Boolean);
            const hzEls = [this.elHz, this.elBigHz].filter(Boolean);
            const barEls = [this.elBar, this.elBigBar].filter(Boolean);
            const statusEls = [this.elStatus, this.elBigStatus].filter(Boolean);
            const arrowEls = [this.elOverflowLeft, this.elOverflowRight, this.elBigOverflowLeft, this.elBigOverflowRight].filter(Boolean);

            for (const el of noteEls) { el.innerHTML = '-'; }
            for (const el of centsEls) { el.innerText = '0c'; }
            for (const el of hzEls) { el.innerText = '0.0 Hz'; }
            for (const el of barEls) {
                el.style.left = '50%';
            }
            for (const el of statusEls) { el.innerText = statusText; }
            for (const el of arrowEls) el.classList.remove('is-visible');
            this.setZoneClasses('idle');
            this.renderStringsRow(null, null);
        },

        stop: function() {
            this.isRunning = false;
            if (this.rafId) cancelAnimationFrame(this.rafId);
            if (this.audioCtx) this.audioCtx.close();
            if (this.micStream) this.micStream.getTracks().forEach(t => t.stop());

            this.closeBigView();
            this.resetTrackingState();
            this.timeBuffer = null;

            if (this.elGroup) {
                this.elGroup.classList.remove('is-running', 'is-perfect');
            }
            if (this.elBtn) {
                this.elBtn.classList.remove('is-running');
                const icon = this.elBtn.querySelector('i');
                if (icon) icon.className = 'fas fa-power-off';
            }
            if (this.elBtnLabel) {
                this.elBtnLabel.setAttribute('data-i18n', 'tuner_start');
                this.elBtnLabel.innerText = tr('tuner_start', '');
            }
            this.setNeutralDisplay('');
            if (this.elDebug) this.elDebug.innerText = "";
        },

        detect: function() {
            if (!this.isRunning) return;
            const now = performance.now();

            if (now - this.lastAnalysisTime >= this.analysisIntervalMs) {
                this.lastAnalysisTime = now;
                if (!this.timeBuffer || this.timeBuffer.length !== this.analyser.fftSize) {
                    this.timeBuffer = new Float32Array(this.analyser.fftSize);
                }
                this.analyser.getFloatTimeDomainData(this.timeBuffer);
                const rangeParams = this.RANGES[this.currentInstrument] || this.RANGES.chromatic;

                const t0 = performance.now();
                const { rms } = computeRmsAndPeak(this.timeBuffer);
                const result = detectPitch(this.timeBuffer, this.audioCtx.sampleRate, {
                    min: rangeParams.min,
                    max: rangeParams.max
                });
                const dt = performance.now() - t0;

                if (dt > 25) {
                    this.analysisIntervalMs = Math.min(120, Math.round(this.analysisIntervalMs * 1.5));
                }

                const aboveNoiseFloor = this.noiseFloorRms === 0 || rms > 3 * this.noiseFloorRms;

                if (result && result.clarity >= 0.8 && aboveNoiseFloor) {
                    this.lastValidTime = now;
                    this.isSilentState = false;

                    const smoothedCents = this.smoother.push(result.freq, this.refFreq);
                    if (smoothedCents !== null) {
                        const activeFreq = this.refFreq * Math.pow(2, smoothedCents / 1200);
                        const n = 69 + smoothedCents / 100;
                        let targetMidi = Math.round(n);
                        let isOutOfRange = false;

                        if (rangeParams.targets) {
                            let closestString = rangeParams.targets[0];
                            let minDiff = Math.abs(n - closestString);

                            for (let i = 1; i < rangeParams.targets.length; i++) {
                                const diff = Math.abs(n - rangeParams.targets[i]);
                                if (diff < minDiff) {
                                    minDiff = diff;
                                    closestString = rangeParams.targets[i];
                                }
                            }

                            if (minDiff > 2.5) {
                                isOutOfRange = true;
                            } else {
                                targetMidi = closestString;
                            }
                        }

                        if (isOutOfRange) {
                            this.displayedMidi = null;
                            this.stateMachine.reset();
                            this.updateUI("-", activeFreq, 0, true, now, null);
                            if (this.elDebug) {
                                this.elDebug.innerText = `rms ${rms.toFixed(4)} | cl ${result.clarity.toFixed(2)} | ${dt.toFixed(1)} ms | out`;
                            }
                        } else {
                            if (this.displayedMidi === null || Math.abs(n - this.displayedMidi) > 0.6) {
                                if (this.displayedMidi !== targetMidi) {
                                    this.displayedMidi = targetMidi;
                                    this.stateMachine.reset();
                                }
                            } else {
                                targetMidi = this.displayedMidi;
                            }

                            const parts = this.midiToParts(targetMidi);
                            const expected = this.refFreq * Math.pow(2, (targetMidi - 69) / 12);
                            const cents = 1200 * Math.log2(activeFreq / expected);
                            const rawNoteCents = 1200 * Math.log2(result.freq / expected);

                            this.updateUI(parts, activeFreq, cents, false, now, targetMidi);

                            if (this.elDebug) {
                                const modeLabel = this.smoother.getMode() === 'moving' ? 'moving' : 'stable';
                                this.elDebug.innerText = `rms ${rms.toFixed(4)} | cl ${result.clarity.toFixed(2)} | ${dt.toFixed(1)} ms | raw ${rawNoteCents >= 0 ? '+' : ''}${rawNoteCents.toFixed(1)}c | sm ${cents >= 0 ? '+' : ''}${cents.toFixed(1)}c | ${modeLabel}`;
                            }
                        }
                    }
                } else {
                    if (this.elDebug) {
                        const cl = result ? result.clarity.toFixed(2) : '-';
                        this.elDebug.innerText = `rms ${rms.toFixed(4)} | cl ${cl} | ${dt.toFixed(1)} ms | -`;
                    }
                    if (!result && rms > 0) {
                        const alpha = rms < this.noiseFloorRms ? 0.2 : 0.05;
                        this.noiseFloorRms = this.noiseFloorRms === 0
                            ? rms
                            : this.noiseFloorRms + alpha * (rms - this.noiseFloorRms);
                    }
                    if (!this.isSilentState && (now - this.lastValidTime > this.silenceTimeoutMs)) {
                        this.isSilentState = true;
                        this.resetTrackingState();
                        this.setNeutralDisplay('');
                    }
                }
            }

            this.rafId = requestAnimationFrame(this.detect.bind(this));
        },

        updateUI: function(note, hz, cents, outOfRange, nowTs, targetMidi) {
            const now = nowTs || performance.now();
            this._lastUiState = { note, hz, cents, outOfRange, now, targetMidi };

            const noteEls = [this.elNote, this.elBigNote].filter(Boolean);
            const centsEls = [this.elCents, this.elBigCents].filter(Boolean);
            const hzEls = [this.elHz, this.elBigHz].filter(Boolean);
            const barEls = [this.elBar, this.elBigBar].filter(Boolean);
            const statusEls = [this.elStatus, this.elBigStatus].filter(Boolean);
            const leftArrows = [this.elOverflowLeft, this.elBigOverflowLeft].filter(Boolean);
            const rightArrows = [this.elOverflowRight, this.elBigOverflowRight].filter(Boolean);

            if (outOfRange) {
                for (const el of noteEls) { el.innerHTML = '-'; }
                for (const el of centsEls) { el.innerText = '0c'; }
                for (const el of hzEls) { el.innerText = hz.toFixed(1) + ' Hz'; }
                for (const el of barEls) {
                    el.style.left = '50%';
                }
                for (const el of statusEls) { el.innerText = tr('tuner_out_of_range', ''); }
                for (const el of leftArrows) el.classList.remove('is-visible');
                for (const el of rightArrows) el.classList.remove('is-visible');
                this.setZoneClasses('idle');
                this.renderStringsRow(null, null);
                return;
            }

            const noteHtml = typeof note === 'string'
                ? note
                : this.renderNoteHtml(note.letter, note.octave);
            const roundedCents = Math.round(cents);
            const centsText = (roundedCents > 0 ? '+' : '') + roundedCents + 'c';
            const hzText = hz.toFixed(1) + ' Hz';

            for (const el of noteEls) el.innerHTML = noteHtml;
            for (const el of centsEls) el.innerText = centsText;
            for (const el of hzEls) el.innerText = hzText;

            const pct = Math.max(2, Math.min(98, 50 + Math.max(-50, Math.min(50, cents))));
            for (const el of barEls) el.style.left = pct + '%';

            for (const el of leftArrows) el.classList.toggle('is-visible', cents < -50);
            for (const el of rightArrows) el.classList.toggle('is-visible', cents > 50);

            const zone = this.stateMachine.evaluate(cents, now);
            this.renderStringsRow(targetMidi !== undefined ? targetMidi : this.displayedMidi, zone);
            this.setZoneClasses(zone);

            let statusText = '';
            if (zone === 'perfect') {
                statusText = tr('tuner_perfect', '');
            } else if (zone === 'almost') {
                statusText = cents < 0 ? tr('tuner_almost_low', '') : tr('tuner_almost_high', '');
            } else if (zone === 'warn') {
                statusText = cents < 0 ? tr('tuner_low', '') : tr('tuner_high', '');
            } else {
                statusText = cents < 0 ? tr('tuner_very_low', '') : tr('tuner_very_high', '');
            }

            for (const el of statusEls) {
                el.innerText = statusText;
            }
        }
    };

    if (typeof document !== 'undefined') {
        document.addEventListener('DOMContentLoaded', () => {
            ChromaticTuner.initUI();
            ChromaticTuner.refreshTranslations();
        });
    }
    if (typeof window !== 'undefined') {
        window.addEventListener('load', () => {
            ChromaticTuner.installHooks();
            ChromaticTuner.refreshTranslations();
        });
    }

    if (globalScope) {
        globalScope.ChromaticTuner = ChromaticTuner;
    }
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = ChromaticTuner;
    }
})(typeof window !== 'undefined' ? window : null);
