// =========================================
// BASIC METRONOME (Για την Free/Live έκδοση) 
// Σταθερά τέταρτα με ρυθμιζόμενη συχνότητα
// =========================================
const BasicMetronome = {
    isPlaying: false,
    bpm: 100,
    pitch: 800, // Προεπιλεγμένη συχνότητα (σε Hz)
    volume: 0.8, // ✨ ΝΕΟ: Προεπιλεγμένη ένταση (0.0 έως 1.0)
    timerID: null,
    nextNoteTime: 0,
    audioCtx: null,
    currentBeat: 0,
    beatCount: 4,
    onBeat: null,
    onStateChange: null,

    toggle: function() {
        if (!this.audioCtx) {
            this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        }
        
        const icon = document.getElementById('iconPlayRhythm');

        if (this.isPlaying) {
            // Σταμάτημα
            clearTimeout(this.timerID);
            this.isPlaying = false;
            this.currentBeat = 0;
            if (this.audioCtx) this.audioCtx.suspend();
            if (icon) { icon.classList.remove('fa-stop'); icon.classList.add('fa-play'); }
            if (typeof this.onStateChange === 'function') this.onStateChange(false);
            console.log("⏹️ [BasicMetronome] Σταμάτησε.");
        } else {
            // Ξεκίνημα
            if (this.audioCtx.state === 'suspended' || this.audioCtx.state === 'interrupted') {
                this.audioCtx.resume();
            }
            this.currentBeat = 0;
            this.nextNoteTime = this.audioCtx.currentTime + 0.05;
            this.isPlaying = true;
            if (icon) { icon.classList.remove('fa-play'); icon.classList.add('fa-stop'); }
            if (typeof this.onStateChange === 'function') this.onStateChange(true);
            console.log(`▶️ [BasicMetronome] Ξεκίνησε στα ${this.bpm} BPM | ${this.pitch}Hz | Ένταση: ${this.volume}`);
            this.schedule();
        }
    },

    schedule: function() {
        const secondsPerBeat = 60.0 / this.bpm;
        
        // Προγραμματίζουμε τα χτυπήματα
        while (this.nextNoteTime < this.audioCtx.currentTime + 0.1) {
            this.playClick(this.nextNoteTime);
            const beatIdx = this.currentBeat;
            this.currentBeat = (this.currentBeat + 1) % (this.beatCount || 4);
            if (typeof this.onBeat === 'function') this.onBeat(beatIdx, this.beatCount || 4);
            this.nextNoteTime += secondsPerBeat;
        }
        this.timerID = setTimeout(() => this.schedule(), 25);
    },

    playClick: function(time) {
        // ✨ ΝΕΟ: Αν το volume είναι κλειστό, δεν παράγουμε ήχο
        if (this.volume <= 0.01) return;

        const osc = this.audioCtx.createOscillator();
        const gain = this.audioCtx.createGain();
        
        osc.connect(gain);
        gain.connect(this.audioCtx.destination);
        
        // Όλα τα χτυπήματα παίρνουν τη συχνότητα που έχει επιλέξει ο χρήστης
        osc.frequency.value = this.pitch;
        osc.type = 'sine'; // Ήχος καθαρού ημιτόνου
        
        // ✨ ΝΕΟ: Envelope που σέβεται την ένταση του χρήστη
        gain.gain.setValueAtTime(this.volume, time);
        gain.gain.exponentialRampToValueAtTime(0.001, time + 0.05); 
        
        osc.start(time);
        osc.stop(time + 0.05);
    },

    setBpm: function(val) {
        let v = parseInt(val);
        if (isNaN(v) || v <= 0) return;
        this.bpm = v;
        const disp = document.getElementById('dispBpm');
        if(disp) disp.innerText = this.bpm;
        console.log(`⏱️ [BasicMetronome] Αλλαγή BPM: ${this.bpm}`);
    },

    setPitch: function(val) {
        this.pitch = parseInt(val);
        console.log(`🎚️ [BasicMetronome] Αλλαγή Pitch: ${this.pitch}Hz`);
    },

    // ✨ ΝΕΟ: Η συνάρτηση που έψαχνε το slider για την ένταση
    setVolume: function(val) {
        this.volume = parseFloat(val);
        console.log(`🔊 [BasicMetronome] Αλλαγή Έντασης: ${this.volume}`);
    }
};
