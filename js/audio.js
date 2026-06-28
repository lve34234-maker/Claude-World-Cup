(function (global) {
  "use strict";

  // ---------------------------------------------------------------------------
  // Self-contained Web Audio sound-effects module for a browser soccer game.
  // All sounds are synthesized at runtime -- no external files, no network.
  // Public API (attached to window.Sound):
  //   Sound.init()            -- lazily create/resume the AudioContext.
  //   Sound.setEnabled(bool)  -- mute/unmute toggle.
  //   Sound.whistle(type)     -- 'start' | 'foul' | 'goal' | 'end'.
  //   Sound.kick()            -- percussive thump for kicking/passing.
  //   Sound.cheer()           -- crowd roar (swelling filtered noise).
  //   Sound.crowd(on)         -- ambient stadium murmur loop on/off.
  //   Sound.post()            -- metallic ding for hitting the post.
  //   Sound.save()            -- soft thud for a goalkeeper save.
  // Everything degrades gracefully: if Web Audio is unavailable, or any node
  // creation throws, methods become no-ops and never throw.
  // ---------------------------------------------------------------------------

  var ctx = null;          // shared AudioContext
  var master = null;       // master GainNode
  var noiseBuffer = null;  // reusable white-noise AudioBuffer
  var enabled = true;      // mute/unmute flag
  var crowdNodes = null;   // currently-running ambient loop nodes (or null)

  var MASTER_GAIN = 0.5;   // tasteful overall level
  var supported = false;   // whether Web Audio could be set up at all

  // Lazily resolve the AudioContext constructor without touching it at load.
  function getAudioContextCtor() {
    if (typeof global === "undefined") return null;
    return global.AudioContext || global.webkitAudioContext || null;
  }

  // Create the reusable white-noise buffer (a couple of seconds, mono).
  function buildNoiseBuffer() {
    try {
      var seconds = 2;
      var length = Math.floor(ctx.sampleRate * seconds);
      var buf = ctx.createBuffer(1, length, ctx.sampleRate);
      var data = buf.getChannelData(0);
      for (var i = 0; i < length; i++) {
        data[i] = Math.random() * 2 - 1;
      }
      return buf;
    } catch (e) {
      return null;
    }
  }

  // Current scheduling time, or 0 if no context.
  function now() {
    return ctx ? ctx.currentTime : 0;
  }

  // Apply the master gain depending on the enabled flag.
  function applyMasterGain() {
    if (!master) return;
    try {
      master.gain.value = enabled ? MASTER_GAIN : 0;
    } catch (e) {
      /* no-op */
    }
  }

  // True only when we have a usable, running context and aren't muted.
  function ready() {
    return supported && ctx && master && enabled;
  }

  // ---------------------------------------------------------------------------
  // init / setEnabled
  // ---------------------------------------------------------------------------

  function init() {
    try {
      if (!ctx) {
        var Ctor = getAudioContextCtor();
        if (!Ctor) {
          supported = false;
          return;
        }
        ctx = new Ctor();
        master = ctx.createGain();
        master.connect(ctx.destination);
        noiseBuffer = buildNoiseBuffer();
        supported = true;
        applyMasterGain();
      }
      // Resume if the browser suspended it (autoplay policy).
      if (ctx && ctx.state === "suspended" && typeof ctx.resume === "function") {
        ctx.resume();
      }
    } catch (e) {
      supported = false;
    }
  }

  function setEnabled(bool) {
    enabled = !!bool;
    applyMasterGain();
    // Stop ambient bed immediately if we just muted.
    if (!enabled) {
      crowd(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Low-level helpers
  // ---------------------------------------------------------------------------

  // Create a noise source node from the shared buffer.
  function makeNoiseSource() {
    if (!noiseBuffer) noiseBuffer = buildNoiseBuffer();
    if (!noiseBuffer) return null;
    var src = ctx.createBufferSource();
    src.buffer = noiseBuffer;
    return src;
  }

  // ---------------------------------------------------------------------------
  // whistle
  // ---------------------------------------------------------------------------

  // One short whistle blast at time t (seconds, absolute).
  function whistleBlast(t, duration) {
    try {
      var osc = ctx.createOscillator();
      var vib = ctx.createOscillator();   // vibrato LFO
      var vibGain = ctx.createGain();
      var gain = ctx.createGain();

      osc.type = "triangle";
      var base = 2500; // ~2200-2800Hz range
      osc.frequency.setValueAtTime(base, t);

      // Light vibrato.
      vib.type = "sine";
      vib.frequency.setValueAtTime(18, t);
      vibGain.gain.setValueAtTime(40, t);
      vib.connect(vibGain);
      vibGain.connect(osc.frequency);

      // Fast attack, quick decay envelope.
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.35, t + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);

      osc.connect(gain);
      gain.connect(master);

      osc.start(t);
      vib.start(t);
      osc.stop(t + duration + 0.02);
      vib.stop(t + duration + 0.02);
    } catch (e) {
      /* no-op */
    }
  }

  function whistle(type) {
    if (!ready()) return;
    try {
      var t = now();
      if (type === "goal") {
        // Goal celebration uses the crowd cheer, not a whistle. Accept gracefully.
        return;
      }
      if (type === "end") {
        // Full time: three short whistles.
        whistleBlast(t + 0.00, 0.18);
        whistleBlast(t + 0.28, 0.18);
        whistleBlast(t + 0.56, 0.30);
        return;
      }
      // 'start', 'foul', or anything else => single short whistle.
      whistleBlast(t, 0.22);
    } catch (e) {
      /* no-op */
    }
  }

  // ---------------------------------------------------------------------------
  // kick
  // ---------------------------------------------------------------------------

  function kick() {
    if (!ready()) return;
    try {
      var t = now();
      var osc = ctx.createOscillator();
      var gain = ctx.createGain();

      osc.type = "sine";
      // Low thump with a quick downward pitch drop for punch.
      osc.frequency.setValueAtTime(180, t);
      osc.frequency.exponentialRampToValueAtTime(140, t + 0.04);
      osc.frequency.exponentialRampToValueAtTime(90, t + 0.08);

      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.6, t + 0.005);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.08);

      osc.connect(gain);
      gain.connect(master);

      osc.start(t);
      osc.stop(t + 0.1);
    } catch (e) {
      /* no-op */
    }
  }

  // ---------------------------------------------------------------------------
  // cheer
  // ---------------------------------------------------------------------------

  function cheer() {
    if (!ready()) return;
    try {
      var t = now();
      var dur = 1.5;

      var src = makeNoiseSource();
      if (!src) return;
      src.loop = true;

      var bp = ctx.createBiquadFilter();
      bp.type = "bandpass";
      bp.Q.value = 0.8;
      // Sweep the center frequency up then down for a rising-falling roar.
      bp.frequency.setValueAtTime(500, t);
      bp.frequency.linearRampToValueAtTime(1400, t + dur * 0.4);
      bp.frequency.linearRampToValueAtTime(700, t + dur);

      var gain = ctx.createGain();
      // Loud-ish swell then fade.
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.linearRampToValueAtTime(0.9, t + dur * 0.35);
      gain.gain.linearRampToValueAtTime(0.7, t + dur * 0.7);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);

      src.connect(bp);
      bp.connect(gain);
      gain.connect(master);

      src.start(t);
      src.stop(t + dur + 0.05);
    } catch (e) {
      /* no-op */
    }
  }

  // ---------------------------------------------------------------------------
  // crowd (ambient loop)
  // ---------------------------------------------------------------------------

  function crowd(on) {
    if (on) {
      if (!ready()) return;
      if (crowdNodes) return; // already running -- don't stack loops
      try {
        var src = makeNoiseSource();
        if (!src) return;
        src.loop = true;

        var lp = ctx.createBiquadFilter();
        lp.type = "lowpass";
        lp.frequency.value = 700;
        lp.Q.value = 0.5;

        var gain = ctx.createGain();
        var t = now();
        gain.gain.setValueAtTime(0.0001, t);
        gain.gain.linearRampToValueAtTime(0.04, t + 1.0); // quiet ambient bed

        src.connect(lp);
        lp.connect(gain);
        gain.connect(master);

        src.start(t);

        crowdNodes = { src: src, gain: gain, filter: lp };
      } catch (e) {
        crowdNodes = null;
      }
    } else {
      // Stop the ambient loop if running.
      if (!crowdNodes) return;
      try {
        var t2 = now();
        var c = crowdNodes;
        if (c.gain) {
          c.gain.gain.cancelScheduledValues(t2);
          c.gain.gain.setValueAtTime(c.gain.gain.value || 0.0001, t2);
          c.gain.gain.linearRampToValueAtTime(0.0001, t2 + 0.4);
        }
        if (c.src) {
          c.src.stop(t2 + 0.45);
        }
      } catch (e) {
        /* no-op */
      }
      crowdNodes = null;
    }
  }

  // ---------------------------------------------------------------------------
  // post (metallic ding)
  // ---------------------------------------------------------------------------

  function post() {
    if (!ready()) return;
    try {
      var t = now();
      // A couple of inharmonic partials for a metallic ring.
      var partials = [900, 1370, 2310];
      var amps = [0.5, 0.25, 0.12];
      for (var i = 0; i < partials.length; i++) {
        var osc = ctx.createOscillator();
        var gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.setValueAtTime(partials[i], t);

        gain.gain.setValueAtTime(0.0001, t);
        gain.gain.exponentialRampToValueAtTime(amps[i], t + 0.005);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);

        osc.connect(gain);
        gain.connect(master);
        osc.start(t);
        osc.stop(t + 0.55);
      }
    } catch (e) {
      /* no-op */
    }
  }

  // ---------------------------------------------------------------------------
  // save (soft thud)
  // ---------------------------------------------------------------------------

  function save() {
    if (!ready()) return;
    try {
      var t = now();

      // Low sine body.
      var osc = ctx.createOscillator();
      var oscGain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(220, t);
      osc.frequency.exponentialRampToValueAtTime(160, t + 0.12);
      oscGain.gain.setValueAtTime(0.0001, t);
      oscGain.gain.exponentialRampToValueAtTime(0.45, t + 0.008);
      oscGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
      osc.connect(oscGain);
      oscGain.connect(master);
      osc.start(t);
      osc.stop(t + 0.2);

      // Short low-passed noise burst for the "thwack".
      var src = makeNoiseSource();
      if (src) {
        src.loop = false;
        var lp = ctx.createBiquadFilter();
        lp.type = "lowpass";
        lp.frequency.value = 500;
        var nGain = ctx.createGain();
        nGain.gain.setValueAtTime(0.0001, t);
        nGain.gain.exponentialRampToValueAtTime(0.3, t + 0.005);
        nGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.1);
        src.connect(lp);
        lp.connect(nGain);
        nGain.connect(master);
        src.start(t);
        src.stop(t + 0.12);
      }
    } catch (e) {
      /* no-op */
    }
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  var Sound = {
    init: init,
    setEnabled: setEnabled,
    whistle: whistle,
    kick: kick,
    cheer: cheer,
    crowd: crowd,
    post: post,
    save: save
  };

  global.Sound = Sound;
})(typeof window !== "undefined" ? window : this);
