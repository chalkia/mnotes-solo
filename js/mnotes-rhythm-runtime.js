/* =========================================
   mnotes-rhythm-runtime.js
   Thin runtime wrapper between mNotes and DrumMachine
   ========================================= */

(function (global) {
  "use strict";

  const REQUIRED_VOICES = ["v1", "v2", "v3", "v4", "v5", "v6"];
  const DEFAULT_FALLBACK_KIT = "eastern-real-v1";

  function isObject(v) {
    return !!v && typeof v === "object" && !Array.isArray(v);
  }

  function isFiniteNumber(v) {
    return typeof v === "number" && Number.isFinite(v);
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function normalizeStep(step) {
    if (!isObject(step)) return { on: false };

    const out = {
      on: !!step.on,
      velocity: isFiniteNumber(step.velocity) ? Math.max(0, Math.min(1, step.velocity)) : 0.8,
      offset: isFiniteNumber(step.offset) ? step.offset : 0,
      chance: isFiniteNumber(step.chance) ? Math.max(0, Math.min(1, step.chance)) : 1
    };
    if (isFiniteNumber(step.level)) {
      out.level = Math.max(0, Math.min(3, Math.round(step.level)));
    }
    return out;
  }

  function validateMnrAsset(asset) {
    if (!isObject(asset)) {
      return { ok: false, code: "ASSET_NOT_OBJECT", message: "Asset is not an object." };
    }

    if (asset.assetType !== "mGroove") {
      return { ok: false, code: "ASSET_TYPE_INVALID", message: "assetType must be 'mGroove'." };
    }

    if (asset.schemaVersion !== 2) {
      return { ok: false, code: "SCHEMA_VERSION_INVALID", message: "schemaVersion must be 2." };
    }

    if (!isObject(asset.metadata)) {
      return { ok: false, code: "METADATA_MISSING", message: "metadata is missing." };
    }

    if (!isObject(asset.pattern)) {
      return { ok: false, code: "PATTERN_MISSING", message: "pattern is missing." };
    }

    const stepCount = asset.pattern.stepCount;
    if (!Number.isInteger(stepCount) || stepCount <= 0) {
      return { ok: false, code: "STEP_COUNT_INVALID", message: "pattern.stepCount must be a positive integer." };
    }

    if (!isObject(asset.pattern.voices)) {
      return { ok: false, code: "VOICES_MISSING", message: "pattern.voices is missing." };
    }

    for (const voiceId of REQUIRED_VOICES) {
      const arr = asset.pattern.voices[voiceId];
      if (!Array.isArray(arr)) {
        return { ok: false, code: "VOICE_ARRAY_MISSING", message: `Voice array missing: ${voiceId}` };
      }
      if (arr.length !== stepCount) {
        return {
          ok: false,
          code: "VOICE_ARRAY_LENGTH_INVALID",
          message: `Voice ${voiceId} length must equal stepCount (${stepCount}).`
        };
      }

      for (let i = 0; i < arr.length; i++) {
        const step = arr[i];
        if (!step || typeof step !== "object") {
          return {
            ok: false,
            code: "STEP_INVALID",
            message: `Invalid step object at ${voiceId}[${i}]`
          };
        }
        if (typeof step.on !== "boolean") {
          return {
            ok: false,
            code: "STEP_ON_INVALID",
            message: `Step ${voiceId}[${i}] must contain boolean 'on'.`
          };
        }
      }
    }

    return { ok: true };
  }

  function normalizeAsset(asset) {
    const stepCount = asset.pattern.stepCount;
    const normalized = {
      assetType: "mGroove",
      schemaVersion: 2,
      metadata: {
        id: asset.metadata.id || null,
        name: asset.metadata.name || "Untitled Rhythm",
        authorId: asset.metadata.authorId || null,
        timeSignature: asset.metadata.timeSignature || asset.metadata.meter || null,
        defaultBpm: isFiniteNumber(asset.metadata.defaultBpm) ? asset.metadata.defaultBpm : 90,
        preferredKit: asset.metadata.preferredKit || DEFAULT_FALLBACK_KIT
      },
      pattern: {
        stepCount,
        voices: {}
      }
    };

    if (isObject(asset.pattern.grid)) {
      normalized.pattern.grid = clone(asset.pattern.grid);
    }

    if (asset.pattern.voiceSettings && typeof asset.pattern.voiceSettings === 'object') {
      normalized.pattern.voiceSettings = JSON.parse(JSON.stringify(asset.pattern.voiceSettings));
    }
    if (asset.pattern.metricAccent && typeof asset.pattern.metricAccent === 'object') {
      normalized.pattern.metricAccent = JSON.parse(JSON.stringify(asset.pattern.metricAccent));
    }

    for (const voiceId of REQUIRED_VOICES) {
      normalized.pattern.voices[voiceId] = asset.pattern.voices[voiceId].map(normalizeStep);
    }

    return normalized;
  }

  class MNotesRhythmRuntime {
    constructor(options = {}) {
      const EngineCtor = options.EngineCtor || global.DrumMachine || global.UniversalPercussionEngine;

      if (!EngineCtor) {
        throw new Error("No engine constructor available on window.");
      }

      this.runtimeGridConfig = { beatCount: 4, stepsPerBeat: 4, stepCount: 16 };
      this.engine = options.engine || new EngineCtor(
        typeof options.getGridConfig === 'function' ? options.getGridConfig : () => this._getRuntimeGridConfig()
      );
      this.fallbackKit = options.fallbackKit || DEFAULT_FALLBACK_KIT;

      this.currentAsset = null;
      this.currentKitId = null;
      this.isInitialized = false;

      this.onReady = null;
      this.onKitLoaded = null;
      this.onPatternLoaded = null;
      this.onPlaybackStarted = null;
      this.onPlaybackStopped = null;
      this.onStep = null;
      this.onError = null;

      this._unsubs = [];
      this._bindEngineEvents();
    }

    _bindEngineEvents() {
      this._unsubs.push(this.engine.on("ready", (payload) => { if (typeof this.onReady === "function") this.onReady(payload); }));
      this._unsubs.push(this.engine.on("kitLoaded", (payload) => {
        this.currentKitId = payload?.kitId || this.currentKitId;
        if (typeof this.onKitLoaded === "function") this.onKitLoaded(payload);
      }));
      this._unsubs.push(this.engine.on("patternLoaded", (payload) => { if (typeof this.onPatternLoaded === "function") this.onPatternLoaded(payload); }));
      this._unsubs.push(this.engine.on("playbackStarted", (payload) => { if (typeof this.onPlaybackStarted === "function") this.onPlaybackStarted(payload); }));
      this._unsubs.push(this.engine.on("playbackStopped", (payload) => { if (typeof this.onPlaybackStopped === "function") this.onPlaybackStopped(payload); }));
      this._unsubs.push(this.engine.on("step", (payload) => { if (typeof this.onStep === "function") this.onStep(payload); }));
      this._unsubs.push(this.engine.on("error", (payload) => { if (typeof this.onError === "function") this.onError(payload); }));
    }

    async init() {
      if (this.isInitialized) return;
      await this.engine.init();
      this.isInitialized = true;
    }

    async loadAsset(asset) {
      const validation = validateMnrAsset(asset);
      if (!validation.ok) {
        const err = new Error(validation.message);
        err.code = validation.code;
        throw err;
      }

      const normalized = normalizeAsset(asset);
      this.currentAsset = normalized;

      await this.init();

      const preferredKit = normalized.metadata.preferredKit || this.fallbackKit;

      if (preferredKit.startsWith('custom_')) {
        let customKit = null;
        if (global.CustomKitDB && typeof global.CustomKitDB.getKit === 'function') {
          try {
            customKit = await global.CustomKitDB.getKit(preferredKit);
          } catch (_) {
            customKit = null;
          }
        }
        if (customKit && typeof this.engine.loadCustomKit === 'function') {
          await this.engine.loadCustomKit(customKit);
        } else {
          await this._loadFallbackKit(true);
        }
      } else {
        try {
          await this.engine.loadKit(preferredKit);
        } catch (err) {
          if (preferredKit !== this.fallbackKit) {
            await this._loadFallbackKit(false);
          } else if (this.fallbackKit !== 'standard') {
            await this.engine.loadKit('standard');
          } else {
            throw err;
          }
        }
      }

      let beatCount = 4;
      let stepsPerBeat = 4;
      const grid = normalized.pattern.grid;
      if (isObject(grid) && isFiniteNumber(grid.beatCount) && grid.beatCount > 0 && isFiniteNumber(grid.stepsPerBeat) && grid.stepsPerBeat > 0) {
        beatCount = grid.beatCount;
        stepsPerBeat = grid.stepsPerBeat;
      } else {
        const ts = normalized.metadata.timeSignature;
        if (typeof ts === 'string' && ts.includes('/')) {
           const parts = ts.split('/');
           const num = parseInt(parts[0]);
           const den = parseInt(parts[1]);
           if (!isNaN(num) && !isNaN(den)) {
               beatCount = num;
               if (den === 4) stepsPerBeat = 4;
               else if (den === 8) stepsPerBeat = 2;
               else stepsPerBeat = 16 / den;
           }
        }
      }

      this.runtimeGridConfig = {
        beatCount: beatCount,
        stepsPerBeat: stepsPerBeat,
        stepCount: normalized.pattern.stepCount
      };

      const payload = Object.assign({}, normalized.pattern.voices, {
          grid: Object.assign({}, this.runtimeGridConfig)
      });
      if (normalized.pattern.voiceSettings) {
        payload.voiceSettings = normalized.pattern.voiceSettings;
      }
      if (normalized.pattern.metricAccent) {
        payload.metricAccent = normalized.pattern.metricAccent;
      }

      this.engine.setPattern(payload);
      this.engine.setBpm(normalized.metadata.defaultBpm);
    }

    _getRuntimeGridConfig() {
      return this.runtimeGridConfig;
    }

    async _loadFallbackKit(showMissingCustomNotice = false) {
      try {
        await this.engine.loadKit(this.fallbackKit);
      } catch (err) {
        if (this.fallbackKit !== "standard") {
          await this.engine.loadKit("standard");
        } else {
          throw err;
        }
      }
      if (showMissingCustomNotice && typeof global.showToast === "function") {
        global.showToast("Ο ρυθμός φτιάχτηκε με δικό του kit — ακούς το βασικό", "info");
      }
    }

    async loadFromJsonString(jsonString) {
      let asset;
      try {
        asset = JSON.parse(jsonString);
      } catch (err) {
        const e = new Error("Invalid JSON string.");
        e.code = "JSON_PARSE_FAILED";
        throw e;
      }
      await this.loadAsset(asset);
    }

    async loadFromObject(assetObject) {
      await this.loadAsset(assetObject);
    }

    play() {
      return this.engine.play();
    }

    stop() {
      this.engine.stop();
    }

    pause() {
      if (typeof this.engine.pause === "function") this.engine.pause();
    }

    resume() {
      if (typeof this.engine.resume === "function") return this.engine.resume();
    }

    setBpm(bpm) {
      this.engine.setBpm(bpm);
      if (this.currentAsset && this.currentAsset.metadata) {
        this.currentAsset.metadata.defaultBpm = bpm;
      }
    }
    
    setMasterVolume(vol) {
      if (this.engine && typeof this.engine.setMasterVolume === 'function') {
        this.engine.setMasterVolume(vol);
      }
    }

    getCurrentAsset() {
      return this.currentAsset ? clone(this.currentAsset) : null;
    }

    getCurrentPattern() {
      return this.currentAsset ? clone(this.currentAsset.pattern) : null;
    }

    getCurrentMetadata() {
      return this.currentAsset ? clone(this.currentAsset.metadata) : null;
    }

    getState() {
      return {
        runtimeReady: this.isInitialized,
        currentKitId: this.currentKitId,
        hasAsset: !!this.currentAsset,
        assetId: this.currentAsset?.metadata?.id || null,
        assetName: this.currentAsset?.metadata?.name || null,
        engineState: typeof this.engine.getState === "function" ? this.engine.getState() : null
      };
    }

    destroy() {
      this.stop();

      for (const unsub of this._unsubs) {
        try {
          if (typeof unsub === "function") unsub();
        } catch (_) {}
      }
      this._unsubs = [];

      if (this.engine && typeof this.engine.destroy === "function") {
        this.engine.destroy();
      }

      this.currentAsset = null;
      this.currentKitId = null;
      this.isInitialized = false;
    }
  }

  global.MNotesRhythmRuntime = MNotesRhythmRuntime;
  global.validateMnrAsset = validateMnrAsset;
})(window);
