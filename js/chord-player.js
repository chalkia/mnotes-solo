const ChordPlayer = {
    audioCtx: null,
    baseFreqs: [82.41, 110.00, 146.83, 196.00, 246.94, 329.63], // E2, A2, D3, G3, B3, E4

    init: function() {
        if (!this.audioCtx) {
            this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        }
        if (this.audioCtx.state === 'suspended') {
            this.audioCtx.resume();
        }
    },

    play: function(frets) {
        this.init();
        const now = this.audioCtx.currentTime;
        const strumDelay = 0.035; // 35ms between strings

        // Keep track of active notes for a slight mix/overlap
        frets.forEach((fret, stringIndex) => {
            if (fret === -1 || fret === '-1') return; // Muted string

            const freq = this.baseFreqs[stringIndex] * Math.pow(2, parseInt(fret) / 12);
            this.playNote(freq, now + (stringIndex * strumDelay));
        });
    },

    playNote: function(freq, startTime) {
        const osc = this.audioCtx.createOscillator();
        const gainNode = this.audioCtx.createGain();

        // Plucked string characteristic: a mix of triangle and sine works well
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, startTime);

        // Filter to make it less harsh (soften the high harmonics)
        const filter = this.audioCtx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(2500, startTime);
        
        osc.connect(filter);
        filter.connect(gainNode);
        gainNode.connect(this.audioCtx.destination);

        // ADSR Envelope
        gainNode.gain.setValueAtTime(0, startTime);
        gainNode.gain.linearRampToValueAtTime(0.6, startTime + 0.015); // Fast attack
        gainNode.gain.exponentialRampToValueAtTime(0.001, startTime + 2.5); // Natural decay

        osc.start(startTime);
        osc.stop(startTime + 2.5);
    }
};

window.ChordPlayer = ChordPlayer;
