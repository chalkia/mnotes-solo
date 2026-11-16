/* =========================================
   sample-kit-data.js
   Embedded WAV sample kit for Eastern Sample
   ========================================= */

(function (global) {
  "use strict";

  const SAMPLE_RATE = 22050;

  function clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
  }

  function envExp(t, attack, decay) {
    if (t < 0) return 0;
    if (t < attack) return t / Math.max(attack, 1e-6);
    return Math.exp(-(t - attack) / Math.max(decay, 1e-6));
  }

  function makeWavDataUri(durationSec, renderSample) {
    const sampleCount = Math.max(1, Math.floor(SAMPLE_RATE * durationSec));
    const pcm16 = new Int16Array(sampleCount);

    for (let i = 0; i < sampleCount; i++) {
      const t = i / SAMPLE_RATE;
      const v = clamp(renderSample(t, i, sampleCount) || 0, -1, 1);
      pcm16[i] = Math.round(v * 32767);
    }

    const dataSize = pcm16.length * 2;
    const buffer = new ArrayBuffer(44 + dataSize);
    const view = new DataView(buffer);

    function writeString(offset, str) {
      for (let i = 0; i < str.length; i++) {
        view.setUint8(offset + i, str.charCodeAt(i));
      }
    }

    writeString(0, "RIFF");
    view.setUint32(4, 36 + dataSize, true);
    writeString(8, "WAVE");
    writeString(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, SAMPLE_RATE, true);
    view.setUint32(28, SAMPLE_RATE * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeString(36, "data");
    view.setUint32(40, dataSize, true);

    let offset = 44;
    for (let i = 0; i < pcm16.length; i++, offset += 2) {
      view.setInt16(offset, pcm16[i], true);
    }

    const bytes = new Uint8Array(buffer);
    let binary = "";
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
    }

    return "data:audio/wav;base64," + btoa(binary);
  }

  function makeNoise(seed = 1) {
    let x = seed >>> 0;
    return function () {
      x ^= x << 13;
      x ^= x >>> 17;
      x ^= x << 5;
      return ((x >>> 0) / 4294967295) * 2 - 1;
    };
  }

  function makeDum(variant = 0) {
    const base = variant === 0 ? 96 : 88;
    return makeWavDataUri(0.28, (t) => {
      const e = envExp(t, 0.002, 0.12);
      const pitchDrop = Math.exp(-t * 18);
      const f1 = base * (0.72 + 0.55 * pitchDrop);
      const f2 = f1 * 1.55;
      const body =
        Math.sin(2 * Math.PI * f1 * t) * 0.82 +
        Math.sin(2 * Math.PI * f2 * t) * 0.18;
      return body * e * 0.9;
    });
  }

  function makeLow(variant = 0) {
    const base = variant === 0 ? 150 : 165;
    const noise = makeNoise(11 + variant);
    return makeWavDataUri(0.20, (t) => {
      const e = envExp(t, 0.001, 0.08);
      const tone = Math.sin(2 * Math.PI * base * t) * 0.55;
      const click = noise() * Math.exp(-t * 90) * 0.18;
      return (tone + click) * e;
    });
  }

  function makeMid(variant = 0) {
    const base = variant === 0 ? 430 : 520;
    const noise = makeNoise(21 + variant);
    return makeWavDataUri(0.13, (t) => {
      const e = envExp(t, 0.001, 0.055);
      const band =
        Math.sin(2 * Math.PI * base * t) * 0.28 +
        Math.sin(2 * Math.PI * (base * 1.8) * t) * 0.12;
      const noisy = noise() * Math.exp(-t * 40) * 0.22;
      return (band + noisy) * e;
    });
  }

  function makeTek(variant = 0) {
    const base = variant === 0 ? 1950 : 2350;
    const noise = makeNoise(31 + variant);
    return makeWavDataUri(0.085, (t) => {
      const e = envExp(t, 0.0005, 0.022);
      const bright =
        Math.sin(2 * Math.PI * base * t) * 0.18 +
        Math.sin(2 * Math.PI * (base * 1.7) * t) * 0.10;
      const noisy = noise() * Math.exp(-t * 65) * 0.45;
      return (bright + noisy) * e;
    });
  }

  function makeClap(variant = 0) {
    const noise = makeNoise(41 + variant);
    return makeWavDataUri(0.16, (t) => {
      const burst1 = Math.exp(-Math.max(0, t - 0.000) * 65);
      const burst2 = Math.exp(-Math.max(0, t - 0.012) * 72);
      const burst3 = Math.exp(-Math.max(0, t - 0.024) * 76);
      const shape = burst1 * 0.65 + burst2 * 0.55 + burst3 * 0.45;
      return noise() * shape * 0.55;
    });
  }

  function makeShaker(variant = 0) {
    const noise = makeNoise(51 + variant);
    return makeWavDataUri(0.12, (t) => {
      const fast = Math.exp(-t * 36);
      const grain = (Math.sin(2 * Math.PI * (55 + variant * 8) * t) * 0.5 + 0.5);
      return noise() * fast * grain * 0.42;
    });
  }

  const easternSampleKit = {
    v1: [ { data: makeDum(0), gain: 1.0, playbackRate: 1.0 }, { data: makeDum(1), gain: 0.96, playbackRate: 0.98 } ],
    v2: [ { data: makeLow(0), gain: 0.92, playbackRate: 1.0 }, { data: makeLow(1), gain: 0.90, playbackRate: 1.02 } ],
    v3: [ { data: makeMid(0), gain: 0.82, playbackRate: 1.0 }, { data: makeMid(1), gain: 0.80, playbackRate: 0.99 } ],
    v4: [ { data: makeTek(0), gain: 0.95, playbackRate: 1.0 }, { data: makeTek(1), gain: 0.92, playbackRate: 1.03 } ],
    v5: [ { data: makeClap(0), gain: 0.82, playbackRate: 1.0 }, { data: makeClap(1), gain: 0.78, playbackRate: 1.02 } ],
    v6: [ { data: makeShaker(0), gain: 0.72, playbackRate: 1.0 }, { data: makeShaker(1), gain: 0.70, playbackRate: 1.04 } ]
  };

  // --- NEW: Rock Acoustic Kit ---
  function makeRockKick() { return makeWavDataUri(0.3, (t) => { const e = envExp(t, 0.001, 0.15); return Math.sin(2 * Math.PI * (60 + Math.exp(-t * 25) * 80) * t) * e * 0.9; }); }
  function makeRockSnare() { const noise = makeNoise(100); return makeWavDataUri(0.25, (t) => { return (Math.sin(2 * Math.PI * 180 * t) * 0.5 * envExp(t, 0.001, 0.04) + noise() * 0.5 * envExp(t, 0.002, 0.12)) * 0.8; }); }
  function makeHatClosed() { const noise = makeNoise(200); return makeWavDataUri(0.08, (t) => noise() * envExp(t, 0.001, 0.03) * 0.6); }
  function makeHatOpen() { const noise = makeNoise(201); return makeWavDataUri(0.4, (t) => noise() * envExp(t, 0.005, 0.25) * 0.5); }
  function makeRockTom() { return makeWavDataUri(0.4, (t) => { const e = envExp(t, 0.002, 0.2); return Math.sin(2 * Math.PI * (100 + Math.exp(-t * 15) * 30) * t) * e * 0.8; }); }
  function makeCrash() { const noise = makeNoise(300); return makeWavDataUri(1.2, (t) => noise() * (0.6 + 0.4 * Math.sin(2 * Math.PI * 400 * t)) * envExp(t, 0.01, 0.8) * 0.7); }

  const rockSampleKit = {
    v1: [ { data: makeRockKick(), gain: 1.0, playbackRate: 1.0 } ],
    v2: [ { data: makeRockSnare(), gain: 1.0, playbackRate: 1.0 } ],
    v3: [ { data: makeHatClosed(), gain: 0.8, playbackRate: 1.0 } ],
    v4: [ { data: makeHatOpen(), gain: 0.85, playbackRate: 1.0 } ],
    v5: [ { data: makeRockTom(), gain: 0.9, playbackRate: 1.0 } ],
    v6: [ { data: makeCrash(), gain: 0.8, playbackRate: 1.0 } ]
  };

  // --- NEW: 808 Synth Kit ---
  function make808Kick() { return makeWavDataUri(0.6, (t) => Math.sin(2 * Math.PI * (50 + Math.exp(-t * 10) * 100) * t) * envExp(t, 0.001, 0.4) * 1.0); }
  function make808Snare() { const noise = makeNoise(400); return makeWavDataUri(0.2, (t) => (Math.sin(2 * Math.PI * 220 * t) * 0.6 * envExp(t, 0.001, 0.05) + noise() * 0.4 * envExp(t, 0.001, 0.1)) * 0.8); }
  function make808Hat() { const noise = makeNoise(500); return makeWavDataUri(0.05, (t) => noise() * envExp(t, 0.001, 0.02) * 0.5); }
  function make808Clap() { const noise = makeNoise(600); return makeWavDataUri(0.2, (t) => noise() * (envExp(t, 0.001, 0.01) + envExp(Math.max(0, t - 0.01), 0.001, 0.01) + envExp(Math.max(0, t - 0.02), 0.001, 0.1)) * 0.6); }
  function make808Tom() { return makeWavDataUri(0.3, (t) => Math.sin(2 * Math.PI * 130 * t) * envExp(t, 0.001, 0.15) * 0.9); }
  function make808Cowbell() { return makeWavDataUri(0.2, (t) => (Math.sign(Math.sin(2 * Math.PI * 540 * t)) + Math.sign(Math.sin(2 * Math.PI * 800 * t))) * 0.25 * envExp(t, 0.001, 0.1)); }

  const synth808Kit = {
    v1: [ { data: make808Kick(), gain: 1.0, playbackRate: 1.0 } ],
    v2: [ { data: make808Snare(), gain: 1.0, playbackRate: 1.0 } ],
    v3: [ { data: make808Hat(), gain: 0.8, playbackRate: 1.0 } ],
    v4: [ { data: make808Clap(), gain: 0.85, playbackRate: 1.0 } ],
    v5: [ { data: make808Tom(), gain: 0.9, playbackRate: 1.0 } ],
    v6: [ { data: make808Cowbell(), gain: 0.9, playbackRate: 1.0 } ]
  };

  // --- NEW: Latin / Tango Kit ---
  function makeLatinCongaLow() { return makeWavDataUri(0.3, (t) => Math.sin(2 * Math.PI * (150 + Math.exp(-t * 20) * 30) * t) * envExp(t, 0.002, 0.15) * 0.9); }
  function makeLatinCongaHigh() { return makeWavDataUri(0.2, (t) => Math.sin(2 * Math.PI * (250 + Math.exp(-t * 20) * 30) * t) * envExp(t, 0.002, 0.1) * 0.9); }
  function makeClave() { return makeWavDataUri(0.1, (t) => (Math.sin(2 * Math.PI * 2200 * t) * 0.8 + Math.sin(2 * Math.PI * 2400 * t) * 0.4) * Math.exp(-t * 40)); }
  function makeTimbales() { const noise = makeNoise(800); return makeWavDataUri(0.25, (t) => (Math.sin(2 * Math.PI * 350 * t) * 0.6 * envExp(t, 0.001, 0.15) + noise() * 0.4 * envExp(t, 0.001, 0.02)) * 0.9); }
  function makeGuiro() { const noise = makeNoise(801); return makeWavDataUri(0.2, (t) => noise() * (Math.sin(2 * Math.PI * 25 * t) > 0 ? 1 : 0.2) * envExp(t, 0.01, 0.15) * 0.5); }
  function makeLatinCowbell() { return makeWavDataUri(0.2, (t) => (Math.sin(2 * Math.PI * 540 * t) + Math.sin(2 * Math.PI * 800 * t)) * 0.3 * Math.exp(-t * 15)); }

  const latinSampleKit = {
    v1: [ { data: makeLatinCongaLow(), gain: 1.0, playbackRate: 1.0 } ],
    v2: [ { data: makeLatinCongaHigh(), gain: 1.0, playbackRate: 1.0 } ],
    v3: [ { data: makeClave(), gain: 0.9, playbackRate: 1.0 } ],
    v4: [ { data: makeTimbales(), gain: 0.9, playbackRate: 1.0 } ],
    v5: [ { data: makeGuiro(), gain: 0.8, playbackRate: 1.0 } ],
    v6: [ { data: makeLatinCowbell(), gain: 0.8, playbackRate: 1.0 } ]
  };

  // --- NEW: Jazz Kit ---
  function makeJazzKick() { return makeWavDataUri(0.3, (t) => Math.sin(2 * Math.PI * (60 + Math.exp(-t * 15) * 30) * t) * envExp(t, 0.01, 0.2) * 0.8); }
  function makeJazzBrush() { const noise = makeNoise(900); return makeWavDataUri(0.4, (t) => noise() * envExp(t, 0.05, 0.2) * 0.6); }
  function makeJazzPedalHat() { const noise = makeNoise(901); return makeWavDataUri(0.08, (t) => noise() * envExp(t, 0.001, 0.03) * 0.4); }
  function makeJazzRide() { const noise = makeNoise(902); return makeWavDataUri(1.5, (t) => {
      const ring = Math.sin(2*Math.PI*250*t) + Math.sin(2*Math.PI*350*t) + Math.sin(2*Math.PI*450*t);
      return (noise() * 0.3 + ring * 0.1) * envExp(t, 0.005, 0.8) * 0.5;
  }); }
  function makeJazzTom() { return makeWavDataUri(0.4, (t) => Math.sin(2 * Math.PI * (160 + Math.exp(-t * 10) * 10) * t) * envExp(t, 0.005, 0.25) * 0.8); }
  function makeJazzCrash() { const noise = makeNoise(903); return makeWavDataUri(1.0, (t) => noise() * envExp(t, 0.02, 0.5) * 0.5); }

  const jazzSampleKit = {
    v1: [ { data: makeJazzKick(), gain: 1.0, playbackRate: 1.0 } ],
    v2: [ { data: makeJazzBrush(), gain: 1.0, playbackRate: 1.0 } ],
    v3: [ { data: makeJazzPedalHat(), gain: 0.8, playbackRate: 1.0 } ],
    v4: [ { data: makeJazzRide(), gain: 0.9, playbackRate: 1.0 } ],
    v5: [ { data: makeJazzTom(), gain: 0.9, playbackRate: 1.0 } ],
    v6: [ { data: makeJazzCrash(), gain: 0.8, playbackRate: 1.0 } ]
  };

  // --- NEW: Balkan Kit ---
  function makeBalkanTapanDum() { return makeWavDataUri(0.5, (t) => Math.sin(2 * Math.PI * (50 + Math.exp(-t * 20) * 50) * t) * envExp(t, 0.002, 0.3) * 1.0); }
  function makeBalkanTapanTek() { const noise = makeNoise(1000); return makeWavDataUri(0.15, (t) => (Math.sin(2 * Math.PI * 400 * t) * 0.4 + noise() * 0.6) * envExp(t, 0.001, 0.05) * 0.8); }
  function makeBalkanSnare() { const noise = makeNoise(1001); return makeWavDataUri(0.15, (t) => (Math.sin(2 * Math.PI * 250 * t) * 0.3 + noise() * 0.7) * envExp(t, 0.001, 0.04) * 0.9); }
  function makeBalkanDarbukaHigh() { return makeWavDataUri(0.15, (t) => Math.sin(2 * Math.PI * (350 + Math.exp(-t * 30) * 80) * t) * envExp(t, 0.001, 0.08) * 0.8); }
  function makeBalkanHeavyTom() { return makeWavDataUri(0.35, (t) => Math.sin(2 * Math.PI * (110 + Math.exp(-t * 15) * 30) * t) * envExp(t, 0.002, 0.15) * 0.9); }
  function makeBrassStab() { 
      return makeWavDataUri(0.4, (t) => {
          const f1 = 220, f2 = 277.18, f3 = 329.63; // A major chord
          const s1 = ((t * f1) % 1) * 2 - 1;
          const s2 = ((t * f2) % 1) * 2 - 1;
          const s3 = ((t * f3) % 1) * 2 - 1;
          return (s1 + s2 + s3) * 0.2 * envExp(t, 0.01, 0.1);
      });
  }

  const balkanSampleKit = {
    v1: [ { data: makeBalkanTapanDum(), gain: 1.0, playbackRate: 1.0 } ],
    v2: [ { data: makeBalkanTapanTek(), gain: 1.0, playbackRate: 1.0 } ],
    v3: [ { data: makeBalkanSnare(), gain: 1.0, playbackRate: 1.0 } ],
    v4: [ { data: makeBalkanDarbukaHigh(), gain: 0.9, playbackRate: 1.0 } ],
    v5: [ { data: makeBalkanHeavyTom(), gain: 0.9, playbackRate: 1.0 } ],
    v6: [ { data: makeBrassStab(), gain: 1.0, playbackRate: 1.0 } ]
  };

  global.SAMPLE_KIT_DATA = global.SAMPLE_KIT_DATA || {};
  global.SAMPLE_KIT_DATA.easternSampleKit = easternSampleKit;
  global.SAMPLE_KIT_DATA.rockSampleKit = rockSampleKit;
  global.SAMPLE_KIT_DATA.synth808Kit = synth808Kit;
  global.SAMPLE_KIT_DATA.latinSampleKit = latinSampleKit;
  global.SAMPLE_KIT_DATA.jazzSampleKit = jazzSampleKit;
  global.SAMPLE_KIT_DATA.balkanSampleKit = balkanSampleKit;
})(window);
