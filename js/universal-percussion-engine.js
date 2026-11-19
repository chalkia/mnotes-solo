(function (global) {
  'use strict';

  const VOICES = ['v1', 'v2', 'v3', 'v4', 'v5', 'v6'];
  const DEFAULT_MASTER_GAIN = 0.9;
  const DEFAULT_VOICE_SETTINGS = {
    v1: { gain: 1.00, decay: 0.95 },
    v2: { gain: 0.95, decay: 0.90 },
    v3: { gain: 0.90, decay: 0.90 },
    v4: { gain: 1.00, decay: 1.15 },
    v5: { gain: 0.85, decay: 1.25 },
    v6: { gain: 0.80, decay: 1.60 }
  };

  function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
  function deepClone(x) { return JSON.parse(JSON.stringify(x)); }

  class EventBus {
    constructor() { this.handlers = {}; }
    on(name, fn) {
      if (!this.handlers[name]) this.handlers[name] = [];
      this.handlers[name].push(fn);
      return () => { this.handlers[name] = (this.handlers[name] || []).filter(h => h !== fn); };
    }
    emit(name, payload) {
      (this.handlers[name] || []).forEach(fn => {
        try { fn(payload); } catch (err) { console.error('[Engine] event handler failed', err); }
      });
    }
  }

  class UniversalPercussionEngine {
    constructor(getGridConfig) {
      this.patternGrid = { beatCount: 4, stepsPerBeat: 4, stepCount: 16 };
      this.hasExternalGridConfig = typeof getGridConfig === 'function';
      this.getGridConfig = this.hasExternalGridConfig
        ? getGridConfig
        : () => this.patternGrid;
      this.bus = new EventBus();
      this.audioContext = null;
      this.masterGain = null;
      this.sampleCache = new Map();
      const cfg = this.getGridConfig();
      this.stepCount = cfg.stepCount || 16;
      this.pattern = this._createEmptyPattern(this.stepCount);
      this.bpm = 100;
      this.kitId = 'eastern-real-v1';
      this.kit = null;
      this.isReady = false;
      this.isPlaying = false;
      this.schedulerTimer = null;
      this.currentStep = 0;
      this.nextNoteTime = 0;
      this.lookaheadMs = 25;
      this.scheduleAheadTime = 0.12;
      this.masterVolume = DEFAULT_MASTER_GAIN;
      this.voiceSettings = deepClone(DEFAULT_VOICE_SETTINGS);
      this.mutedVoices = new Set();
      this.soloVoices = new Set();
      this.metricAccent = { enabled: true, strength: 0.55, userProfile: [] };
      this._rebuildUserProfile(cfg.beatCount || 4, cfg.stepsPerBeat || 4, cfg.stepCount || 16);
      this.kits = this._createKitLibrary();
    }

    on(name, fn) { return this.bus.on(name, fn); }
    emit(name, payload) { this.bus.emit(name, payload); }

    async init() {
      if (this.isReady) return;
      const Ctx = global.AudioContext || global.webkitAudioContext;
      if (!Ctx) throw new Error('Web Audio API is not available.');
      this.audioContext = new Ctx();
      this.masterGain = this.audioContext.createGain();
      this.masterGain.gain.value = this.masterVolume;
      this.masterGain.connect(this.audioContext.destination);
      this.isReady = true;
      this.emit('ready', { engineVersion: '1.0.0-fixed' });
    }

    async ensureReady(resume = false) {
      if (!this.isReady) await this.init();
      if (resume && this.audioContext) {
        if (this.audioContext.state === 'suspended' || this.audioContext.state === 'interrupted') {
          console.log(`[Engine] AudioContext is ${this.audioContext.state}. Attempting to resume...`);
          await this.audioContext.resume();
          console.log(`[Engine] AudioContext state after resume: ${this.audioContext.state}`);
        }
      }
    }

    async loadCustomKit(kitRecord) {
      if (!kitRecord || !kitRecord.id || !kitRecord.voices) {
        throw new Error('Invalid custom kit record.');
      }
      const voices = {};
      for (const vId of VOICES) {
        const vData = kitRecord.voices[vId];
        if (vData && vData.audioBase64) {
          voices[vId] = {
            label: vData.label || vId.toUpperCase(),
            samplePaths: [vData.audioBase64]
          };
        }
      }
      this.kits[kitRecord.id] = {
        id: kitRecord.id,
        name: kitRecord.name || kitRecord.id,
        type: 'sample',
        voices,
        defaultVoiceSettings: kitRecord.defaultVoiceSettings || {}
      };
      return this.loadKit(kitRecord.id);
    }

    async loadKit(kitId) {
      await this.ensureReady(false);
      const kit = this.kits[kitId];
      if (!kit) {
        if (kitId === 'eastern-real-v1' && this.kits.standard) {
          console.warn("[Engine] 'eastern-real-v1' unavailable, falling back to 'standard'.");
          return this.loadKit('standard');
        }
        const err = { code: 'KIT_NOT_FOUND', message: `Kit '${kitId}' was not found.` };
        this.emit('error', err);
        throw new Error(err.message);
      }
      if (kit.type === 'sample') {
        try {
          await this._prepareSampleKit(kit);
        } catch (err) {
          if (kitId === 'eastern-real-v1' && this.kits.standard) {
            console.warn("[Engine] Failed to prepare 'eastern-real-v1', falling back to 'standard'.", err);
            return this.loadKit('standard');
          }
          throw err;
        }
      }
      this.kitId = kitId;
      this.kit = kit;
      this.voiceSettings = mergeVoiceSettings(DEFAULT_VOICE_SETTINGS, kit.defaultVoiceSettings || {});
      this.emit('kitLoaded', {
        kitId,
        labels: Object.fromEntries(Object.entries(kit.voices).map(([k, v]) => [k, v.label])),
        voiceCount: Object.keys(kit.voices).length,
        voiceSettings: deepClone(this.voiceSettings)
      });
      return kit;
    }

    setPattern(pattern) {
      const normalized = this._normalizePattern(pattern);
      if (!normalized) {
        this.emit('error', { code: 'PATTERN_INVALID', message: 'Invalid pattern received by engine.' });
        return;
      }
      if (pattern && pattern.grid && typeof pattern.grid === 'object') {
        const beatCount = Number(pattern.grid.beatCount) || 4;
        const stepsPerBeat = Number(pattern.grid.stepsPerBeat) || 4;
        const stepCount = Number(pattern.grid.stepCount) || (beatCount * stepsPerBeat);
        const denominator = Number(pattern.grid.denominator) > 0 ? Number(pattern.grid.denominator) : 4;
        this.patternGrid = { beatCount, stepsPerBeat, stepCount, denominator };
      }
      if (normalized.__voiceSettings) {
        this.voiceSettings = mergeVoiceSettings(this.voiceSettings, normalized.__voiceSettings);
        delete normalized.__voiceSettings;
      }
      if (normalized.__metricAccent) {
        this.setMetricAccentState(normalized.__metricAccent, false);
        delete normalized.__metricAccent;
      }
      this.pattern = normalized;
      const grid = this.getGridConfig ? this.getGridConfig() : this.patternGrid;
      this.stepCount = grid.stepCount || Object.values(this.pattern)[0].length;
      if (!this.metricAccent.userProfile || this.metricAccent.userProfile.length !== this.stepCount) {
        this._rebuildUserProfile(grid.beatCount, grid.stepsPerBeat, this.stepCount);
      }
      this.emit('patternLoaded', {
        stepCount: this.stepCount,
        voiceCount: VOICES.length,
        voiceSettings: deepClone(this.voiceSettings),
        metricAccent: deepClone(this.metricAccent)
      });
    }

    setBpm(bpm) {
      const n = Number(bpm);
      if (!Number.isFinite(n) || n <= 0) return;
      this.bpm = n;
      this.emit('bpmChanged', { bpm: this.bpm });
    }

    setMasterVolume(v) {
      this.masterVolume = clamp(Number(v) || DEFAULT_MASTER_GAIN, 0, 1.5);
      if (this.masterGain && this.audioContext) {
        this.masterGain.gain.setTargetAtTime(this.masterVolume, this.audioContext.currentTime, 0.01);
      }
    }

    setVoiceGain(id, value) {
      if (!VOICES.includes(id)) return;
      this.voiceSettings[id].gain = clamp(Number(value) || 1, 0, 2);
      this.emit('voiceSettingsChanged', { voiceId: id, all: deepClone(this.voiceSettings) });
    }

    setVoiceDecay(id, value) {
      if (!VOICES.includes(id)) return;
      this.voiceSettings[id].decay = clamp(Number(value) || 1, 0.2, 3);
      this.emit('voiceSettingsChanged', { voiceId: id, all: deepClone(this.voiceSettings) });
    }

    setVoiceMute(id, muted) {
      if (!VOICES.includes(id)) return;
      if (muted) this.mutedVoices.add(id);
      else this.mutedVoices.delete(id);
      this.emit('voiceMuteChanged', { voiceId: id, muted: !!muted });
    }

    setVoiceSolo(id, soloed) {
      if (!VOICES.includes(id)) return;
      if (soloed) this.soloVoices.add(id);
      else this.soloVoices.delete(id);
      this.emit('voiceSoloChanged', { voiceId: id, soloed: !!soloed });
    }

    isVoiceAudible(id) {
      if (this.mutedVoices.has(id)) return false;
      if (this.soloVoices.size > 0) return this.soloVoices.has(id);
      return true;
    }

    async triggerAudition(id, velocity = 0.9) {
      if (!VOICES.includes(id)) return;
      await this.ensureReady(true);
      if (!this.audioContext) return;
      this._triggerVoice(id, clamp(Number(velocity) || 0.9, 0.05, 1.5), this.audioContext.currentTime);
    }

    setVoiceSettings(all) {
      this.voiceSettings = mergeVoiceSettings(this.voiceSettings, all || {});
      this.emit('voiceSettingsChanged', { all: deepClone(this.voiceSettings) });
    }

    getVoiceSettings() { return deepClone(this.voiceSettings); }
    setMetricAccentEnabled(enabled, emit = true) { this.metricAccent.enabled = !!enabled; if (emit) this.emit('metricAccentChanged', deepClone(this.metricAccent)); }
    setMetricAccentStrength(value, emit = true) { this.metricAccent.strength = clamp(Number(value) || 0, 0, 1); if (emit) this.emit('metricAccentChanged', deepClone(this.metricAccent)); }
    setMetricAccentState(state, emit = true) {
      if (state && typeof state === 'object') {
        if (typeof state.enabled === 'boolean') this.metricAccent.enabled = state.enabled;
        if (state.strength != null) this.metricAccent.strength = clamp(Number(state.strength) || 0, 0, 1);
        if (Array.isArray(state.userProfile)) this.metricAccent.userProfile = [...state.userProfile];
      }
      if (emit) this.emit('metricAccentChanged', deepClone(this.metricAccent));
    }
    getMetricAccentState() { return deepClone(this.metricAccent); }

    async play() {
      await this.ensureReady(true);
      if (!this.kit) await this.loadKit(this.kitId);
      if (this.isPlaying) return;
      this.isPlaying = true;
      this.currentStep = 0;
      this.nextNoteTime = this.audioContext.currentTime + 0.03;
      this.emit('playbackStarted', { bpm: this.bpm, kitId: this.kitId });
      this._scheduler();
    }

    stop() {
      if (!this.isPlaying) return;
      this.isPlaying = false;
      if (this.schedulerTimer) clearTimeout(this.schedulerTimer);
      this.schedulerTimer = null;
      this.currentStep = 0;
      this.emit('playbackStopped', {});
    }

    pause() {
      if (!this.isPlaying) return;
      this.isPlaying = false;
      if (this.schedulerTimer) clearTimeout(this.schedulerTimer);
      this.schedulerTimer = null;
      this.emit('playbackPaused', {});
    }

    resume() { if (!this.isPlaying) this.play(); }

    getState() {
      const cfg = this.getGridConfig();
      return {
        isReady: this.isReady,
        isPlaying: this.isPlaying,
        bpm: this.bpm,
        kitId: this.kitId,
        currentStep: this.currentStep,
        stepCount: cfg.stepCount || 16,
        voiceSettings: deepClone(this.voiceSettings),
        metricAccent: deepClone(this.metricAccent)
      };
    }

    destroy() {
      this.stop();
      if (this.audioContext && this.audioContext.state !== 'closed') this.audioContext.close().catch(() => {});
      this.audioContext = null;
      this.masterGain = null;
      this.isReady = false;
    }

    _scheduler() {
      if (!this.isPlaying || !this.audioContext) return;
      while (this.nextNoteTime < this.audioContext.currentTime + this.scheduleAheadTime) {
        this._scheduleStep(this.currentStep, this.nextNoteTime);
        this._advanceStep();
      }
      this.schedulerTimer = setTimeout(() => this._scheduler(), this.lookaheadMs);
    }

    getStepDurationSec() {
      const cfg = this.getGridConfig();
      const den = (cfg && Number(cfg.denominator) > 0) ? Number(cfg.denominator) : 4;
      const spb = (cfg && Number(cfg.stepsPerBeat) > 0) ? Number(cfg.stepsPerBeat) : 4;
      return (60 / this.bpm) * (4 / (den * spb));
    }

    _advanceStep() {
      const cfg = this.getGridConfig();
      const stepDuration = this.getStepDurationSec();
      this.nextNoteTime += stepDuration;
      this.currentStep = (this.currentStep + 1) % cfg.stepCount;
    }

    _scheduleStep(stepIndex, when) {
      this.emit('step', stepIndex);
      const stepDuration = this.getStepDurationSec();
      for (const voiceId of VOICES) {
        if (!this.isVoiceAudible(voiceId)) continue;
        const step = this.pattern[voiceId]?.[stepIndex];
        if (!step || !step.on) continue;
        const chance = typeof step.chance === 'number' ? step.chance : 1;
        if (chance < 1 && Math.random() > chance) continue;
        const velocity = typeof step.velocity === 'number' ? step.velocity : 0.8;
        const accent = this._getAccent(stepIndex);
        const finalVelocity = clamp(velocity * this.voiceSettings[voiceId].gain * accent, 0.02, 2);
        const offset = typeof step.offset === 'number' ? step.offset : 0;
        this._triggerVoice(voiceId, finalVelocity, when + (offset * stepDuration));
      }
    }

    _getAccent(stepIndex) {
      if (!this.metricAccent.enabled) return 1;
      const isStrong = this.metricAccent.userProfile && this.metricAccent.userProfile[stepIndex % this.metricAccent.userProfile.length];
      const p = isStrong ? 1.0 : 0.45;
      return 1 + ((p - 1) * this.metricAccent.strength);
    }

    _triggerVoice(voiceId, velocity, time) {
      if (!this.kit || !this.audioContext) return;
      const voice = this.kit.voices[voiceId];
      if (!voice || typeof voice.trigger !== 'function') return;
      voice.trigger(this.audioContext, this.masterGain, velocity, time, this.voiceSettings[voiceId].decay);
    }

    _createEmptyPattern(stepCount) {
      const p = {};
      VOICES.forEach(v => { p[v] = Array.from({ length: stepCount }, () => ({ on: false })); });
      return p;
    }

    _normalizePattern(pattern) {
      if (!pattern || typeof pattern !== 'object') return null;
      const normalized = {};
      const stepCount = Math.max(...VOICES.map(v => Array.isArray(pattern[v]) ? pattern[v].length : 0));
      if (stepCount <= 0) return null;
      for (const v of VOICES) {
        if (!Array.isArray(pattern[v])) return null;
        normalized[v] = Array.from({ length: stepCount }, (_, i) => {
          const s = pattern[v][i];
          if (!s || typeof s !== 'object') return { on: false };
          return {
            on: !!s.on,
            velocity: typeof s.velocity === 'number' ? clamp(s.velocity, 0, 1) : 0.8,
            offset: typeof s.offset === 'number' ? s.offset : 0,
            chance: typeof s.chance === 'number' ? clamp(s.chance, 0, 1) : 1
          };
        });
      }
      if (pattern.voiceSettings) normalized.__voiceSettings = pattern.voiceSettings;
      if (pattern.metricAccent) normalized.__metricAccent = pattern.metricAccent;
      return normalized;
    }

    _rebuildUserProfile(beatCount, stepsPerBeat, stepCount) {
      let newProfile = [];
      const totalSteps = stepCount || (beatCount * stepsPerBeat);
      for (let i = 0; i < totalSteps; i++) {
          if (this.metricAccent.userProfile && i < this.metricAccent.userProfile.length) {
              newProfile.push(!!this.metricAccent.userProfile[i]);
          } else {
              newProfile.push(i % stepsPerBeat === 0);
          }
      }
      this.metricAccent.userProfile = newProfile;
    }

    async _prepareSampleKit(kit) {
      for (const voice of Object.values(kit.voices)) {
        if (!voice.samplePaths || voice.buffers) continue;
        voice.buffers = [];
        for (const relPath of voice.samplePaths) {
          const abs = new URL(relPath, global.location.href).href;
          let buffer = this.sampleCache.get(abs);
          if (!buffer) {
            try {
              const response = await fetch(abs);
              if (!response.ok) throw new Error(`HTTP ${response.status}`);
              const arrayBuffer = await response.arrayBuffer();
              buffer = await this.audioContext.decodeAudioData(arrayBuffer.slice(0));
              this.sampleCache.set(abs, buffer);
            } catch(err) {
              console.warn(`[Engine] Failed to load sample ${relPath}, will fallback to synth.`);
              buffer = null;
            }
          }
          if (buffer) voice.buffers.push(buffer);
        }
        voice._rrIndex = 0;
        if (voice.buffers.length === 0) {
            voice.trigger = this._getFallbackSynthTrigger(voice.label) || ((c,d,v,t,m) => snare(c,d,v,t,m));
        } else {
            voice.trigger = (ctx, dest, vel, time, decayMul) => playSample(ctx, dest, vel, time, voice, decayMul);
        }
      }
    }

    _getFallbackSynthTrigger(label) {
        const lbl = (label || '').toUpperCase();
        if (lbl.includes('KICK') || lbl.includes('LOW') || lbl.includes('DUM')) return (c,d,v,t,m)=>kick(c,d,v,t,m);
        if (lbl.includes('SNARE') || lbl.includes('TEK')) return (c,d,v,t,m)=>snare(c,d,v,t,m);
        if (lbl.includes('HAT') || lbl.includes('KA') || lbl.includes('EDGE')) return (c,d,v,t,m)=>hat(c,d,v,t,m);
        if (lbl.includes('CLAP')) return (c,d,v,t,m)=>clap(c,d,v,t,m);
        if (lbl.includes('TOM') || lbl.includes('BODY')) return (c,d,v,t,m)=>tom(c,d,v,t,m);
        if (lbl.includes('SHAKER') || lbl.includes('METAL') || lbl.includes('JING')) return (c,d,v,t,m)=>jing(c,d,v,t,m);
        return null;
    }

    _createKitLibrary() {
      return {
        standard: {
          type: 'synth',
          defaultVoiceSettings: {
            v1: { gain: 1.0, decay: 0.9 }, v2: { gain: 0.95, decay: 0.9 }, v3: { gain: 0.9, decay: 1.0 },
            v4: { gain: 0.9, decay: 1.05 }, v5: { gain: 0.85, decay: 1.1 }, v6: { gain: 0.8, decay: 1.15 }
          },
          voices: {
            v1: { label: 'KICK', trigger: (c,d,v,t,m)=>kick(c,d,v,t,m) },
            v2: { label: 'SNARE', trigger: (c,d,v,t,m)=>snare(c,d,v,t,m) },
            v3: { label: 'CLAP', trigger: (c,d,v,t,m)=>clap(c,d,v,t,m) },
            v4: { label: 'HAT', trigger: (c,d,v,t,m)=>hat(c,d,v,t,m) },
            v5: { label: 'TOM', trigger: (c,d,v,t,m)=>tom(c,d,v,t,m) },
            v6: { label: 'SHAKER', trigger: (c,d,v,t,m)=>shaker(c,d,v,t,m) }
          }
        },
        eastern: {
          type: 'synth',
          voices: {
            v1: { label: 'DUM', trigger: (c,d,v,t,m)=>dum(c,d,v,t,m) },
            v2: { label: 'TEK', trigger: (c,d,v,t,m)=>tek(c,d,v,t,m) },
            v3: { label: 'KA', trigger: (c,d,v,t,m)=>ka(c,d,v,t,m) },
            v4: { label: 'ROLL', trigger: (c,d,v,t,m)=>roll(c,d,v,t,m) },
            v5: { label: 'CLAP', trigger: (c,d,v,t,m)=>clap(c,d,v,t,m) },
            v6: { label: 'JING', trigger: (c,d,v,t,m)=>jing(c,d,v,t,m) }
          }
        },
        'eastern-real-v1': {
          type: 'sample',
          voices: {
            v1: { label: 'DUM', samplePaths: ['rhythm-engine/kits/eastern_real_v1/v1_doum_main.wav'], gain: 1.0 },
            v2: { label: 'MID', samplePaths: ['rhythm-engine/kits/eastern_real_v1/v2_mid_body.wav'], gain: 0.95 },
            v3: { label: 'MUTE', samplePaths: ['rhythm-engine/kits/eastern_real_v1/v3_mute_dry.wav'], gain: 0.90 },
            v4: { label: 'TEK', samplePaths: ['rhythm-engine/kits/eastern_real_v1/v4_tek_main.wav', 'rhythm-engine/kits/eastern_real_v1/v4_tek_hi_alt.wav'], gain: 1.0 },
            v5: { label: 'ACCENT', samplePaths: ['rhythm-engine/kits/eastern_real_v1/v5_tambourine_accent.wav'], gain: 0.85 },
            v6: { label: 'JINGLE', samplePaths: ['rhythm-engine/kits/eastern_real_v1/v6_jingle_short_a.wav', 'rhythm-engine/kits/eastern_real_v1/v6_jingle_short_b.wav'], gain: 0.80 }
          }
        },
        'rock-acoustic': {
          type: 'sample',
          voices: {
            v1: { label: 'KICK', samplePaths: [global.SAMPLE_KIT_DATA.rockSampleKit.v1[0].data] },
            v2: { label: 'SNARE', samplePaths: [global.SAMPLE_KIT_DATA.rockSampleKit.v2[0].data] },
            v3: { label: 'HAT CL', samplePaths: [global.SAMPLE_KIT_DATA.rockSampleKit.v3[0].data] },
            v4: { label: 'HAT OP', samplePaths: [global.SAMPLE_KIT_DATA.rockSampleKit.v4[0].data] },
            v5: { label: 'TOM', samplePaths: [global.SAMPLE_KIT_DATA.rockSampleKit.v5[0].data] },
            v6: { label: 'CRASH', samplePaths: [global.SAMPLE_KIT_DATA.rockSampleKit.v6[0].data] }
          }
        },
        'synth-808': {
          type: 'sample',
          voices: {
            v1: { label: 'KICK', samplePaths: [global.SAMPLE_KIT_DATA.synth808Kit.v1[0].data] },
            v2: { label: 'SNARE', samplePaths: [global.SAMPLE_KIT_DATA.synth808Kit.v2[0].data] },
            v3: { label: 'HAT CL', samplePaths: [global.SAMPLE_KIT_DATA.synth808Kit.v3[0].data] },
            v4: { label: 'CLAP', samplePaths: [global.SAMPLE_KIT_DATA.synth808Kit.v4[0].data] },
            v5: { label: 'TOM', samplePaths: [global.SAMPLE_KIT_DATA.synth808Kit.v5[0].data] },
            v6: { label: 'COWBELL', samplePaths: [global.SAMPLE_KIT_DATA.synth808Kit.v6[0].data] }
          }
        },
        'cajon-latin': {
          type: 'synth',
          voices: {
            v1: { label: 'CAJ-BASS', trigger: (c,d,v,t,m)=>cajonBass(c,d,v,t,m) },
            v2: { label: 'CAJ-SLAP', trigger: (c,d,v,t,m)=>cajonSlap(c,d,v,t,m) },
            v3: { label: 'CAJ-TAP', trigger: (c,d,v,t,m)=>cajonTap(c,d,v,t,m) },
            v4: { label: 'SHAKER', trigger: (c,d,v,t,m)=>latinShaker(c,d,v,t,m) },
            v5: { label: 'CONGA-L', trigger: (c,d,v,t,m)=>congaLow(c,d,v,t,m) },
            v6: { label: 'CONGA-H', trigger: (c,d,v,t,m)=>congaHigh(c,d,v,t,m) }
          }
        },
        'latin-tango': {
          type: 'sample',
          voices: {
            v1: { label: 'CONGA L', samplePaths: [global.SAMPLE_KIT_DATA.latinSampleKit.v1[0].data] },
            v2: { label: 'CONGA H', samplePaths: [global.SAMPLE_KIT_DATA.latinSampleKit.v2[0].data] },
            v3: { label: 'CLAVE', samplePaths: [global.SAMPLE_KIT_DATA.latinSampleKit.v3[0].data] },
            v4: { label: 'TIMBAL', samplePaths: [global.SAMPLE_KIT_DATA.latinSampleKit.v4[0].data] },
            v5: { label: 'GUIRO', samplePaths: [global.SAMPLE_KIT_DATA.latinSampleKit.v5[0].data] },
            v6: [ { label: 'COWBELL', samplePaths: [global.SAMPLE_KIT_DATA.latinSampleKit.v6[0].data] } ][0]
          }
        },
        'jazz-brush': {
          type: 'sample',
          voices: {
            v1: { label: 'KICK', samplePaths: [global.SAMPLE_KIT_DATA.jazzSampleKit.v1[0].data] },
            v2: { label: 'BRUSH', samplePaths: [global.SAMPLE_KIT_DATA.jazzSampleKit.v2[0].data] },
            v3: { label: 'HAT PDL', samplePaths: [global.SAMPLE_KIT_DATA.jazzSampleKit.v3[0].data] },
            v4: { label: 'RIDE', samplePaths: [global.SAMPLE_KIT_DATA.jazzSampleKit.v4[0].data] },
            v5: { label: 'TOM', samplePaths: [global.SAMPLE_KIT_DATA.jazzSampleKit.v5[0].data] },
            v6: { label: 'CRASH', samplePaths: [global.SAMPLE_KIT_DATA.jazzSampleKit.v6[0].data] }
          }
        },
        'balkan-brass': {
          type: 'sample',
          voices: {
            v1: { label: 'TAPAN D', samplePaths: [global.SAMPLE_KIT_DATA.balkanSampleKit.v1[0].data] },
            v2: { label: 'TAPAN T', samplePaths: [global.SAMPLE_KIT_DATA.balkanSampleKit.v2[0].data] },
            v3: { label: 'SNARE', samplePaths: [global.SAMPLE_KIT_DATA.balkanSampleKit.v3[0].data] },
            v4: { label: 'DARBUKA', samplePaths: [global.SAMPLE_KIT_DATA.balkanSampleKit.v4[0].data] },
            v5: { label: 'TOM', samplePaths: [global.SAMPLE_KIT_DATA.balkanSampleKit.v5[0].data] },
            v6: { label: 'BRASS', samplePaths: [global.SAMPLE_KIT_DATA.balkanSampleKit.v6[0].data] }
          }
        },
        global: {
          type: 'synth',
          voices: {
            v1: { label: 'LOW', trigger: (c,d,v,t,m)=>kick(c,d,v,t,m) },
            v2: { label: 'BODY', trigger: (c,d,v,t,m)=>tom(c,d,v,t,m) },
            v3: { label: 'MID', trigger: (c,d,v,t,m)=>clap(c,d,v,t,m) },
            v4: { label: 'EDGE', trigger: (c,d,v,t,m)=>hat(c,d,v,t,m) },
            v5: { label: 'HAND', trigger: (c,d,v,t,m)=>ka(c,d,v,t,m) },
            v6: { label: 'METAL', trigger: (c,d,v,t,m)=>jing(c,d,v,t,m) }
          }
        }
      };
    }
  }

  function mergeVoiceSettings(base, extra) {
    const out = deepClone(base);
    for (const v of VOICES) {
      if (!extra[v]) continue;
      out[v].gain = clamp(Number(extra[v].gain ?? out[v].gain), 0, 2);
      out[v].decay = clamp(Number(extra[v].decay ?? out[v].decay), 0.2, 3);
    }
    return out;
  }

  function getBeatWeights(beatCount, stepsPerBeat) {
    const b = Number(beatCount) || 4;
    if (b === 2) return [1.00, 0.40];
    if (b === 3) return [1.00, 0.40, 0.60];
    if (b === 4) return [1.00, 0.35, 0.70, 0.45];
    if (b === 5 && stepsPerBeat === 2) return [1.00, 0.40, 0.35, 0.80, 0.45];
    if (b === 7 && stepsPerBeat === 2) return [1.00, 0.40, 0.80, 0.35, 0.70, 0.35, 0.60];
    if (b === 9 && stepsPerBeat === 2) return [1.00, 0.40, 0.80, 0.35, 0.70, 0.35, 0.70, 0.40, 0.60];
    return Array.from({ length: b }, (_, i) => i === 0 ? 1 : 0.40);
  }

  function env(ctx, time, peak, decay) {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, time);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0001, peak), time + 0.001);
    g.gain.exponentialRampToValueAtTime(0.0001, time + Math.max(0.01, decay));
    return g;
  }

  function noiseBuffer(ctx, duration) {
    const len = Math.max(1, Math.floor(ctx.sampleRate * duration));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  }

  function kick(ctx, dest, vel, time, decayMul) {
    const osc = ctx.createOscillator(); osc.type = 'sine';
    osc.frequency.setValueAtTime(140, time); osc.frequency.exponentialRampToValueAtTime(42, time + 0.22 * decayMul);
    const g = env(ctx, time, vel, 0.22 * decayMul); osc.connect(g); g.connect(dest); osc.start(time); osc.stop(time + 0.25 * decayMul);
  }
  function snare(ctx, dest, vel, time, decayMul) {
    const src = ctx.createBufferSource(); src.buffer = noiseBuffer(ctx, 0.16 * decayMul);
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1800;
    const g = env(ctx, time, vel * 0.9, 0.16 * decayMul); src.connect(f); f.connect(g); g.connect(dest); src.start(time); src.stop(time + 0.17 * decayMul);
  }
  function clap(ctx, dest, vel, time, decayMul) {
    [0, 0.012, 0.024].forEach((off, i) => {
      const src = ctx.createBufferSource(); src.buffer = noiseBuffer(ctx, 0.07 * decayMul);
      const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 1400;
      const g = env(ctx, time + off, vel * (1 - i * 0.15), 0.07 * decayMul); src.connect(f); f.connect(g); g.connect(dest); src.start(time + off); src.stop(time + off + 0.08 * decayMul);
    });
  }
  function hat(ctx, dest, vel, time, decayMul) {
    const src = ctx.createBufferSource(); src.buffer = noiseBuffer(ctx, 0.055 * decayMul);
    const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 7000;
    const g = env(ctx, time, vel * 0.6, 0.055 * decayMul); src.connect(f); f.connect(g); g.connect(dest); src.start(time); src.stop(time + 0.06 * decayMul);
  }
  function tom(ctx, dest, vel, time, decayMul) {
    const osc = ctx.createOscillator(); osc.type = 'sine';
    osc.frequency.setValueAtTime(210, time); osc.frequency.exponentialRampToValueAtTime(110, time + 0.18 * decayMul);
    const g = env(ctx, time, vel * 0.95, 0.18 * decayMul); osc.connect(g); g.connect(dest); osc.start(time); osc.stop(time + 0.20 * decayMul);
  }
  function shaker(ctx, dest, vel, time, decayMul) {
    const src = ctx.createBufferSource(); src.buffer = noiseBuffer(ctx, 0.085 * decayMul);
    const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 5000;
    const g = env(ctx, time, vel * 0.45, 0.085 * decayMul); src.connect(f); f.connect(g); g.connect(dest); src.start(time); src.stop(time + 0.09 * decayMul);
  }
  function dum(ctx, dest, vel, time, decayMul) { kick(ctx, dest, vel * 1.1, time, 1.15 * decayMul); }
  function tek(ctx, dest, vel, time, decayMul) {
    const src = ctx.createBufferSource(); src.buffer = noiseBuffer(ctx, 0.09 * decayMul);
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 2800; f.Q.value = 1.2;
    const g = env(ctx, time, vel * 0.8, 0.09 * decayMul); src.connect(f); f.connect(g); g.connect(dest); src.start(time); src.stop(time + 0.10 * decayMul);
  }
  function ka(ctx, dest, vel, time, decayMul) { hat(ctx, dest, vel * 0.9, time, 0.95 * decayMul); }
  function roll(ctx, dest, vel, time, decayMul) { [0,0.018,0.034].forEach((o,i)=>tek(ctx,dest,vel*(0.85-i*0.12),time+o,0.65*decayMul)); }
  function jing(ctx, dest, vel, time, decayMul) {
    const src = ctx.createBufferSource(); src.buffer = noiseBuffer(ctx, 0.11 * decayMul);
    const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 6200;
    const g = env(ctx, time, vel * 0.42, 0.11 * decayMul); src.connect(f); f.connect(g); g.connect(dest); src.start(time); src.stop(time + 0.12 * decayMul);
  }

  // --- ROCK ACOUSTIC KIT SYNTHESIS ---
  function rockKick(ctx, dest, vel, time, decayMul) {
    const osc = ctx.createOscillator(); osc.type = 'sine';
    osc.frequency.setValueAtTime(150, time);
    osc.frequency.exponentialRampToValueAtTime(45, time + 0.08);
    osc.frequency.exponentialRampToValueAtTime(30, time + 0.22 * decayMul);
    const g = env(ctx, time, vel * 1.2, 0.22 * decayMul);
    osc.connect(g); g.connect(dest); osc.start(time); osc.stop(time + 0.25 * decayMul);
  }
  function rockSnare(ctx, dest, vel, time, decayMul) {
    // Drum head pop (sine at 180Hz)
    const osc = ctx.createOscillator(); osc.type = 'sine';
    osc.frequency.setValueAtTime(180, time);
    osc.frequency.linearRampToValueAtTime(120, time + 0.06);
    const gOsc = env(ctx, time, vel * 0.7, 0.08 * decayMul);
    osc.connect(gOsc); gOsc.connect(dest); osc.start(time); osc.stop(time + 0.10 * decayMul);

    // Snare wires (highpassed noise)
    const src = ctx.createBufferSource(); src.buffer = noiseBuffer(ctx, 0.20 * decayMul);
    const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 1000;
    const gNoise = env(ctx, time, vel * 0.9, 0.16 * decayMul);
    src.connect(f); f.connect(gNoise); gNoise.connect(dest); src.start(time); src.stop(time + 0.21 * decayMul);
  }
  function rockTom(ctx, dest, vel, time, decayMul) {
    const osc = ctx.createOscillator(); osc.type = 'sine';
    osc.frequency.setValueAtTime(120, time);
    osc.frequency.exponentialRampToValueAtTime(65, time + 0.30 * decayMul);
    const g = env(ctx, time, vel * 1.0, 0.32 * decayMul);
    osc.connect(g); g.connect(dest); osc.start(time); osc.stop(time + 0.35 * decayMul);
  }
  function rockClosedHat(ctx, dest, vel, time, decayMul) {
    const src = ctx.createBufferSource(); src.buffer = noiseBuffer(ctx, 0.045 * decayMul);
    const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 8500;
    const g = env(ctx, time, vel * 0.45, 0.045 * decayMul);
    src.connect(f); f.connect(g); g.connect(dest); src.start(time); src.stop(time + 0.05 * decayMul);
  }
  function rockOpenHat(ctx, dest, vel, time, decayMul) {
    const src = ctx.createBufferSource(); src.buffer = noiseBuffer(ctx, 0.38 * decayMul);
    const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 8000;
    const g = env(ctx, time, vel * 0.5, 0.38 * decayMul);
    src.connect(f); f.connect(g); g.connect(dest); src.start(time); src.stop(time + 0.40 * decayMul);
  }
  function rockCrash(ctx, dest, vel, time, decayMul) {
    const src = ctx.createBufferSource(); src.buffer = noiseBuffer(ctx, 1.4 * decayMul);
    const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 9000;
    const g = env(ctx, time, vel * 0.7, 1.4 * decayMul);
    src.connect(f); f.connect(g); g.connect(dest); src.start(time); src.stop(time + 1.5 * decayMul);
  }

  // --- SYNTH 808 KIT SYNTHESIS ---
  function eight08Kick(ctx, dest, vel, time, decayMul) {
    const osc = ctx.createOscillator(); osc.type = 'sine';
    osc.frequency.setValueAtTime(130, time);
    osc.frequency.exponentialRampToValueAtTime(38, time + 0.12);
    const g = env(ctx, time, vel * 1.3, 0.85 * decayMul);
    osc.connect(g); g.connect(dest); osc.start(time); osc.stop(time + 0.90 * decayMul);
  }
  function eight08Snare(ctx, dest, vel, time, decayMul) {
    const osc = ctx.createOscillator(); osc.type = 'triangle';
    osc.frequency.setValueAtTime(150, time);
    const gOsc = env(ctx, time, vel * 0.6, 0.12 * decayMul);
    osc.connect(gOsc); gOsc.connect(dest); osc.start(time); osc.stop(time + 0.15 * decayMul);

    const src = ctx.createBufferSource(); src.buffer = noiseBuffer(ctx, 0.18 * decayMul);
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1200;
    const gNoise = env(ctx, time, vel * 0.8, 0.18 * decayMul);
    src.connect(f); f.connect(gNoise); gNoise.connect(dest); src.start(time); src.stop(time + 0.20 * decayMul);
  }
  function eight08Clap(ctx, dest, vel, time, decayMul) {
    [0, 0.012, 0.024].forEach((off, i) => {
      const src = ctx.createBufferSource(); src.buffer = noiseBuffer(ctx, 0.07 * decayMul);
      const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 1100;
      const g = env(ctx, time + off, vel * (0.95 - i * 0.15), 0.07 * decayMul);
      src.connect(f); f.connect(g); g.connect(dest); src.start(time + off); src.stop(time + off + 0.08 * decayMul);
    });
  }
  function eight08ClosedHat(ctx, dest, vel, time, decayMul) {
    // Metal mix using square wave bandpass
    const osc = ctx.createOscillator(); osc.type = 'square'; osc.frequency.value = 800;
    const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 7000;
    const g = env(ctx, time, vel * 0.5, 0.04 * decayMul);
    osc.connect(f); f.connect(g); g.connect(dest); osc.start(time); osc.stop(time + 0.05 * decayMul);
  }
  function eight08OpenHat(ctx, dest, vel, time, decayMul) {
    const osc = ctx.createOscillator(); osc.type = 'square'; osc.frequency.value = 800;
    const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 6500;
    const g = env(ctx, time, vel * 0.5, 0.35 * decayMul);
    osc.connect(f); f.connect(g); g.connect(dest); osc.start(time); osc.stop(time + 0.38 * decayMul);
  }
  function eight08Cowbell(ctx, dest, vel, time, decayMul) {
    const osc1 = ctx.createOscillator(); osc1.type = 'square'; osc1.frequency.value = 800;
    const osc2 = ctx.createOscillator(); osc2.type = 'square'; osc2.frequency.value = 540;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 800; f.Q.value = 2.0;
    const g = env(ctx, time, vel * 0.7, 0.25 * decayMul);
    osc1.connect(f); osc2.connect(f); f.connect(g); g.connect(dest);
    osc1.start(time); osc2.start(time); osc1.stop(time + 0.30 * decayMul); osc2.stop(time + 0.30 * decayMul);
  }

  // --- CAJON LATIN KIT SYNTHESIS ---
  function cajonBass(ctx, dest, vel, time, decayMul) {
    // Low wood thump (triangle wave sweep)
    const osc = ctx.createOscillator(); osc.type = 'triangle';
    osc.frequency.setValueAtTime(105, time);
    osc.frequency.exponentialRampToValueAtTime(50, time + 0.06);
    const gOsc = env(ctx, time, vel * 1.1, 0.14 * decayMul);
    osc.connect(gOsc); gOsc.connect(dest); osc.start(time); osc.stop(time + 0.16 * decayMul);

    // Soft wood texture
    const src = ctx.createBufferSource(); src.buffer = noiseBuffer(ctx, 0.08 * decayMul);
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 180;
    const gNoise = env(ctx, time, vel * 0.45, 0.08 * decayMul);
    src.connect(f); f.connect(gNoise); gNoise.connect(dest); src.start(time); src.stop(time + 0.10 * decayMul);
  }
  function cajonSlap(ctx, dest, vel, time, decayMul) {
    // Crisp wooden slap with snare wires
    const osc = ctx.createOscillator(); osc.type = 'sine';
    osc.frequency.setValueAtTime(300, time);
    const gOsc = env(ctx, time, vel * 0.55, 0.03 * decayMul);
    osc.connect(gOsc); gOsc.connect(dest); osc.start(time); osc.stop(time + 0.04 * decayMul);

    const src = ctx.createBufferSource(); src.buffer = noiseBuffer(ctx, 0.07 * decayMul);
    const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 1800;
    const gNoise = env(ctx, time, vel * 0.85, 0.07 * decayMul);
    src.connect(f); f.connect(gNoise); gNoise.connect(dest); src.start(time); src.stop(time + 0.08 * decayMul);
  }
  function cajonTap(ctx, dest, vel, time, decayMul) {
    // Soft wooden touch click
    const osc = ctx.createOscillator(); osc.type = 'triangle';
    osc.frequency.setValueAtTime(380, time);
    const g = env(ctx, time, vel * 0.4, 0.015 * decayMul);
    osc.connect(g); g.connect(dest); osc.start(time); osc.stop(time + 0.02 * decayMul);
  }
  function latinShaker(ctx, dest, vel, time, decayMul) {
    const src = ctx.createBufferSource(); src.buffer = noiseBuffer(ctx, 0.09 * decayMul);
    const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 6000;
    const g = env(ctx, time, vel * 0.45, 0.09 * decayMul);
    src.connect(f); f.connect(g); g.connect(dest); src.start(time); src.stop(time + 0.10 * decayMul);
  }
  function congaLow(ctx, dest, vel, time, decayMul) {
    const osc = ctx.createOscillator(); osc.type = 'sine';
    osc.frequency.setValueAtTime(140, time);
    const g = env(ctx, time, vel * 0.95, 0.15 * decayMul);
    osc.connect(g); g.connect(dest); osc.start(time); osc.stop(time + 0.17 * decayMul);
  }
  function congaHigh(ctx, dest, vel, time, decayMul) {
    const osc = ctx.createOscillator(); osc.type = 'sine';
    osc.frequency.setValueAtTime(240, time);
    const g = env(ctx, time, vel * 0.9, 0.12 * decayMul);
    osc.connect(g); g.connect(dest); osc.start(time); osc.stop(time + 0.14 * decayMul);
  }

  function playSample(ctx, dest, vel, time, voice, decayMul) {
    if (!voice.buffers || voice.buffers.length === 0) return;
    const idx = voice._rrIndex || 0;
    const buffer = voice.buffers[idx % voice.buffers.length];
    voice._rrIndex = (idx + 1) % voice.buffers.length;
    const src = ctx.createBufferSource(); src.buffer = buffer;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 13000;
    const g = ctx.createGain();
    const peak = Math.max(0.0001, vel * (voice.gain || 1));
    const tail = clamp((0.18 + buffer.duration * 0.55) * decayMul, 0.05, 1.4);
    g.gain.setValueAtTime(peak, time);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0001, peak * 0.65), time + Math.min(0.08, tail * 0.35));
    g.gain.exponentialRampToValueAtTime(0.0001, time + tail);
    src.connect(f); f.connect(g); g.connect(dest);
    src.start(time); src.stop(time + Math.min(buffer.duration + 0.2 * decayMul, 1.8));
  }

  UniversalPercussionEngine.parseTimeSignatureDenominator = function (timeSig) {
    const m = String(timeSig || '').trim().match(/^(\d+)\s*\/\s*(\d+)$/);
    return m ? Number(m[2]) : 4;
  };
  UniversalPercussionEngine.isLegacyEighthTempoAsset = function (asset) {
    if (!asset || typeof asset !== 'object') return false;
    const rev = Number(asset.formatRevision || 0);
    const ts = asset.metadata?.timeSignature || asset.metadata?.meter || '';
    const den = UniversalPercussionEngine.parseTimeSignatureDenominator(ts);
    return rev < 2 && den === 8;
  };
  UniversalPercussionEngine.normalizeLegacyBpmValue = function (bpm, asset) {
    const n = Number(bpm);
    if (!Number.isFinite(n) || n <= 0) return n;
    return UniversalPercussionEngine.isLegacyEighthTempoAsset(asset) ? Math.round(n / 2) : n;
  };

  global.UniversalPercussionEngine = UniversalPercussionEngine;
})(window);
