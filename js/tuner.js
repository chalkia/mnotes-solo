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

        // Parabolic interpolation around best.tau
        const t = best.tau;
        let trueTau = t;
        let clarity = best.val;
        if (t > 0 && t < searchEnd) {
            const y1 = nsdf[t - 1];
            const y2 = nsdf[t];
            const y3 = nsdf[t + 1];
            const a = (y1 + y3 - 2 * y2) / 2;
            const b = (y3 - y1) / 2;
            if (a < 0) {
                const delta = Math.max(-1, Math.min(1, -b / (2 * a)));
                trueTau = t + delta;
                clarity = Math.min(1, y2 - (b * b) / (4 * a));
            }
        }

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
     * Cents-domain pitch smoother: median(5) + 50-cent outlier gate (3-strike switch) + EMA (alpha=0.3).
     */
    function createPitchSmoother(opts) {
        const options = opts || {};
        const windowSize = options.windowSize || 5;
        const outlierCents = options.outlierCents || 50;
        const outlierStrikes = options.outlierStrikes || 3;
        const alpha = options.alpha || 0.3;

        let history = [];
        let outlierCount = 0;
        let smoothedCents = null;

        return {
            reset: function() {
                history = [];
                outlierCount = 0;
                smoothedCents = null;
            },
            push: function(freq, refFreq) {
                const ref = refFreq || 440;
                const rawCents = 1200 * Math.log2(freq / ref);

                if (history.length > 0) {
                    const med = medianOf(history);
                    if (Math.abs(rawCents - med) > outlierCents) {
                        outlierCount++;
                        if (outlierCount < outlierStrikes) {
                            return smoothedCents;
                        }
                        history = [rawCents];
                        outlierCount = 0;
                        smoothedCents = rawCents;
                        return smoothedCents;
                    }
                    outlierCount = 0;
                }

                history.push(rawCents);
                if (history.length > windowSize) history.shift();
                const medAfter = medianOf(history);
                smoothedCents = smoothedCents === null
                    ? medAfter
                    : smoothedCents + alpha * (medAfter - smoothedCents);
                return smoothedCents;
            },
            getCents: function() {
                return smoothedCents;
            }
        };
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

        // ✨ Smoothing, Noise Gate & Hysteresis State
        smoother: createPitchSmoother(),
        baseAnalysisIntervalMs: 40, // ~25 analyses/sec
        analysisIntervalMs: 40,
        silenceTimeoutMs: 400,
        lastAnalysisTime: 0,
        lastValidTime: 0,
        noiseFloorRms: 0,
        isSilentState: true,
        displayedMidi: null,
        perfectSince: null,
        inPerfectZone: false,
        inWarningZone: false,
        timeBuffer: null,
        elDebug: null,

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
        elNote: null,
        elHz: null,
        elBar: null,
        elStatus: null,
        elBtn: null,

        getFftSize: function(inst, sampleRate) {
            const range = ChromaticTuner.RANGES[inst] || ChromaticTuner.RANGES.chromatic;
            const sr = sampleRate || 48000;
            const needed = Math.ceil((4 * sr) / range.min);
            let size = range.min <= 60 ? 8192 : 4096;
            while (size < needed && size < 16384) size *= 2;
            return Math.min(8192, Math.max(4096, size));
        },

        resetTrackingState: function() {
            this.smoother.reset();
            this.displayedMidi = null;
            this.perfectSince = null;
            this.inPerfectZone = false;
            this.inWarningZone = false;
        },

        initUI: function() {
            this.elNote = document.getElementById('tunerNote');
            this.elHz = document.getElementById('tunerHz');
            this.elBar = document.getElementById('tunerIndicator');
            this.elStatus = document.getElementById('tunerStatus');
            this.elBtn = document.getElementById('btnToggleTuner');
            if (this.elBar) {
                this.elBar.style.transition = 'width 80ms linear, background-color 120ms ease';
            }
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
        },

        setInstrument: function(inst) {
            if (this.RANGES[inst]) {
                this.currentInstrument = inst;
                this.resetTrackingState();
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

                this.elBtn.innerHTML = `<i class="fas fa-stop"></i>`;
                this.elBtn.style.color = "var(--danger)";
                this.elBtn.style.borderColor = "var(--danger)";
                this.elStatus.innerText = "Ακούω...";

                console.log(`[Tuner] Started with A4 = ${this.refFreq}Hz`);
                this.detect();
            } catch (e) {
                console.error("Tuner Mic Error:", e);
                if (typeof showToast === 'function') showToast(t('msg_mic_denied', "Δεν δόθηκε άδεια για το μικρόφωνο."), "error");
            }
        },

        stop: function() {
            this.isRunning = false;
            if (this.rafId) cancelAnimationFrame(this.rafId);
            if (this.audioCtx) this.audioCtx.close();
            if (this.micStream) this.micStream.getTracks().forEach(t => t.stop());

            this.resetTrackingState();
            this.timeBuffer = null;

            this.elBtn.innerHTML = `<i class="fas fa-power-off"></i>`;
            this.elBtn.style.color = "var(--accent)";
            this.elBtn.style.borderColor = "var(--accent)";
            this.elNote.innerText = "-";
            this.elNote.style.color = "var(--text-muted)";
            this.elHz.innerText = "0.0 Hz";
            this.elHz.style.color = "var(--text-muted)";
            this.elBar.style.width = "0%";
            this.elStatus.innerText = "Ανενεργό";
            this.elStatus.style.color = "var(--text-muted)";
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

                // Δικλίδα CPU: αν η ανάλυση ξεπεράσει τα 25 ms, επιβράδυνε το διάστημα (έως 120 ms)
                if (dt > 25) {
                    this.analysisIntervalMs = Math.min(120, Math.round(this.analysisIntervalMs * 1.5));
                }

                if (this.elDebug) {
                    const cl = result ? result.clarity.toFixed(2) : '-';
                    this.elDebug.innerText = `rms ${rms.toFixed(4)} | cl ${cl} | ${dt.toFixed(1)} ms`;
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

                        // ✨ ΕΞΥΠΝΟ ΚΛΕΙΔΩΜΑ ΣΤΙΣ ΑΝΟΙΧΤΕΣ ΧΟΡΔΕΣ
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
                            this.perfectSince = null;
                            this.inPerfectZone = false;
                            this.inWarningZone = false;
                            this.updateUI("-", activeFreq, 0, true, now);
                        } else {
                            // Υστέρηση αλλαγής νότας (> 0.6 ημιτόνιο)
                            if (this.displayedMidi === null || Math.abs(n - this.displayedMidi) > 0.6) {
                                if (this.displayedMidi !== targetMidi) {
                                    this.displayedMidi = targetMidi;
                                    this.perfectSince = null;
                                    this.inPerfectZone = false;
                                    this.inWarningZone = false;
                                }
                            } else {
                                targetMidi = this.displayedMidi;
                            }

                            const noteIndex = ((targetMidi % 12) + 12) % 12;
                            const octave = Math.floor(targetMidi / 12) - 1;
                            const noteName = `${this.NOTES[noteIndex]}${octave}`;

                            const expected = this.refFreq * Math.pow(2, (targetMidi - 69) / 12);
                            const cents = 1200 * Math.log2(activeFreq / expected);

                            this.updateUI(noteName, activeFreq, cents, false, now);
                        }
                    }
                } else {
                    // Ενημέρωση κινητού μέσου θορύβου μόνο στα παράθυρα χωρίς τόνο
                    if (!result && rms > 0) {
                        const alpha = rms < this.noiseFloorRms ? 0.2 : 0.05;
                        this.noiseFloorRms = this.noiseFloorRms === 0
                            ? rms
                            : this.noiseFloorRms + alpha * (rms - this.noiseFloorRms);
                    }
                    if (!this.isSilentState && (now - this.lastValidTime > this.silenceTimeoutMs)) {
                        // Σιωπή > 400 ms -> καθαρισμός ιστορικού & "Ακούω..."
                        this.isSilentState = true;
                        this.resetTrackingState();
                        this.elStatus.innerText = "Ακούω...";
                        this.elStatus.style.color = "var(--text-muted)";
                        this.elNote.innerText = "-";
                        this.elNote.style.color = "var(--text-muted)";
                        this.elHz.innerText = "0.0 Hz";
                        this.elHz.style.color = "var(--text-muted)";
                        this.elBar.style.width = "0%";
                        this.elBar.style.backgroundColor = "var(--text-muted)";
                    }
                }
            }

            this.rafId = requestAnimationFrame(this.detect.bind(this));
        },

        updateUI: function(note, hz, cents, outOfRange, nowTs) {
            const now = nowTs || performance.now();

            // ✨ Ένδειξη Εκτός Κλίμακας (Γκριζάρισμα)
            if (outOfRange) {
                this.elNote.innerText = "-";
                this.elHz.innerText = hz.toFixed(1) + " Hz";
                this.elBar.style.width = "50%";
                this.elBar.style.backgroundColor = "var(--text-muted)";
                this.elNote.style.color = "var(--text-muted)";
                this.elHz.style.color = "var(--text-muted)";
                this.elStatus.innerText = "Εκτός Κλίμακας";
                this.elStatus.style.color = "var(--text-muted)";
                return;
            }

            this.elNote.innerText = note;
            this.elHz.innerText = hz.toFixed(1) + " Hz";

            // Bar Width: Left (Flat) to Right (Sharp) | 50% = Perfect
            const fill = Math.max(0, Math.min(100, cents + 50));
            this.elBar.style.width = fill + "%";

            const absCents = Math.abs(cents);

            // Υστέρηση «Τέλεια»: μπαίνει με |cents| <= 3 για >= 300ms, βγαίνει μόνο με |cents| > 5
            if (this.inPerfectZone) {
                if (absCents > 5) {
                    this.inPerfectZone = false;
                    this.perfectSince = null;
                }
            } else if (absCents <= 3) {
                if (this.perfectSince === null) {
                    this.perfectSince = now;
                }
                if (now - this.perfectSince >= 300) {
                    this.inPerfectZone = true;
                }
            } else {
                this.perfectSince = null;
            }

            if (this.inPerfectZone) {
                this.inWarningZone = true;
                this.elBar.style.backgroundColor = "var(--tuner-perfect)";
                this.elNote.style.color = "var(--tuner-perfect)";
                this.elHz.style.color = "var(--tuner-perfect)";
                this.elStatus.innerText = "Τέλεια!";
                this.elStatus.style.color = "var(--tuner-perfect)";
                return;
            }

            // Υστέρηση «Χαμηλή / Υψηλή»: μπαίνει <= 15, βγαίνει > 18
            const warnLimit = this.inWarningZone ? 18 : 15;
            if (absCents <= warnLimit) {
                this.inWarningZone = true;
                this.elBar.style.backgroundColor = "var(--tuner-warning)";
                this.elNote.style.color = "var(--text-main)";
                this.elHz.style.color = "var(--text-main)";
                this.elStatus.innerText = cents < 0 ? "Χαμηλή (Σφίξε)" : "Υψηλή (Χαλάρωσε)";
                this.elStatus.style.color = "var(--tuner-warning)";
            } else {
                this.inWarningZone = false;
                this.elBar.style.backgroundColor = "var(--tuner-danger)";
                this.elNote.style.color = "var(--tuner-danger)";
                this.elHz.style.color = "var(--tuner-danger)";
                this.elStatus.innerText = cents < 0 ? "Πολύ Χαμηλή" : "Πολύ Υψηλή";
                this.elStatus.style.color = "var(--tuner-danger)";
            }
        }
    };

    if (globalScope) {
        globalScope.ChromaticTuner = ChromaticTuner;
    }
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = ChromaticTuner;
    }
})(typeof window !== 'undefined' ? window : null);
