// ═══════════════════════════════════════════════════════════════════════════
//  AUDIO.JS — Effetti sonori procedurali per MelodiQ
//  Tutti i suoni sono generati con Web Audio API, nessun file esterno.
// ═══════════════════════════════════════════════════════════════════════════

const Audio = (() => {
  let _ctx = null;
  let _master = null;
  let _sfxGain = null;
  let _initialized = false;
  let _masterVol = CONFIG.audio.masterVol;
  let _sfxVol = CONFIG.audio.sfxVol;

  // ── Synth primitives ─────────────────────────────────────────────────

  function _osc(dest, freq, freqEnd, wave, dur, vol, attack, decay) {
    const t = _ctx.currentTime;
    const o = _ctx.createOscillator();
    const g = _ctx.createGain();
    o.type = wave;
    o.frequency.setValueAtTime(freq, t);
    if (freqEnd !== freq) o.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd), t + dur);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + (attack || 0.005));
    g.gain.linearRampToValueAtTime(vol * 0.6, t + dur - (decay || dur * 0.3));
    g.gain.linearRampToValueAtTime(0, t + dur);
    o.connect(g); g.connect(dest);
    o.start(t); o.stop(t + dur + 0.01);
  }

  function _noise(dest, dur, vol, freqLow, freqHigh) {
    const t = _ctx.currentTime;
    const bufSz = Math.max(1, Math.floor(_ctx.sampleRate * dur));
    const buf = _ctx.createBuffer(1, bufSz, _ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < bufSz; i++) d[i] = Math.random() * 2 - 1;
    const src = _ctx.createBufferSource();
    src.buffer = buf;
    const g = _ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.linearRampToValueAtTime(0, t + dur);
    src.connect(g);
    if (freqLow || freqHigh) {
      const f = _ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = ((freqLow || 100) + (freqHigh || 4000)) / 2;
      f.Q.value = 1;
      g.disconnect(); src.connect(f); f.connect(g); g.connect(dest);
    } else {
      g.connect(dest);
    }
    src.start(t); src.stop(t + dur + 0.01);
  }

  function _beep(dest, freq, dur, vol, wave) {
    _osc(dest, freq, freq, wave || 'sine', dur, vol || 0.3, 0.003, dur * 0.4);
  }

  function _seq(dest, notes, dur, vol, wave) {
    notes.forEach((freq, i) => {
      const t = _ctx.currentTime + i * dur;
      const o = _ctx.createOscillator();
      const g = _ctx.createGain();
      o.type = wave || 'sine';
      o.frequency.setValueAtTime(freq, t);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(vol || 0.2, t + 0.005);
      g.gain.linearRampToValueAtTime(0, t + dur - 0.01);
      o.connect(g); g.connect(dest);
      o.start(t); o.stop(t + dur);
    });
  }

  // ── Sound definitions ────────────────────────────────────────────────

  const SOUNDS = {
    // Click UI
    click() {
      _beep(_sfxGain, 1200, 0.04, 0.08, 'sine');
    },

    // Countdown tick (3-2-1)
    countdown_tick() {
      _beep(_sfxGain, 880, 0.08, 0.15, 'triangle');
      _noise(_sfxGain, 0.03, 0.04, 2000, 6000);
    },

    // Countdown GO!
    countdown_go() {
      _seq(_sfxGain, [523, 784, 1047], 0.08, 0.2, 'sine');
    },

    // Risposta selezionata
    answer_select() {
      _noise(_sfxGain, 0.04, 0.08, 2000, 6000);
      _beep(_sfxGain, 900, 0.06, 0.1, 'sine');
    },

    // Risposta corretta
    correct() {
      _seq(_sfxGain, [523, 659, 784, 1047], 0.1, 0.18, 'sine');
      _osc(_sfxGain, 1047, 1047, 'triangle', 0.3, 0.08, 0.1, 0.2);
    },

    // Risposta sbagliata
    wrong() {
      _osc(_sfxGain, 300, 150, 'sawtooth', 0.3, 0.12, 0.005, 0.2);
      _osc(_sfxGain, 250, 120, 'square', 0.25, 0.06, 0.01, 0.15);
    },

    // Nuovo round
    round_start() {
      _seq(_sfxGain, [440, 554, 659], 0.1, 0.12, 'triangle');
    },

    // Player pronto
    player_ready() {
      _beep(_sfxGain, 660, 0.08, 0.08, 'sine');
      _beep(_sfxGain, 880, 0.08, 0.06, 'sine');
    },

    // Player joined
    player_join() {
      _seq(_sfxGain, [400, 600], 0.08, 0.1, 'sine');
    },

    // Game start jingle
    game_start() {
      _seq(_sfxGain, [523, 659, 784, 1047, 784, 1047, 1319], 0.12, 0.18, 'sine');
    },

    // Game end / results fanfare
    fanfare() {
      _seq(_sfxGain, [523, 523, 659, 784, 659, 784, 1047, 1319], 0.15, 0.2, 'sine');
      setTimeout(() => _osc(_sfxGain, 1319, 1319, 'triangle', 0.5, 0.1, 0.1, 0.3), 1200);
    },

    // Time running out warning
    time_warning() {
      _beep(_sfxGain, 1000, 0.05, 0.1, 'square');
    },
  };

  // ── Public API ───────────────────────────────────────────────────────

  return {
    init() {
      if (_initialized) return;
      try {
        _ctx = new (window.AudioContext || window.webkitAudioContext)();
        _master = _ctx.createGain();
        _master.gain.value = _masterVol;
        _master.connect(_ctx.destination);
        _sfxGain = _ctx.createGain();
        _sfxGain.gain.value = _sfxVol;
        _sfxGain.connect(_master);
        _initialized = true;
      } catch (e) {
        console.warn('Audio: Web Audio API non disponibile', e);
      }
    },

    play(event) {
      if (!_initialized || !_ctx) return;
      if (_ctx.state === 'suspended') _ctx.resume();
      const fn = SOUNDS[event];
      if (!fn) return;
      try { fn(); } catch (_) {}
    },

    setVolume(v) {
      _sfxVol = Math.max(0, Math.min(1, v));
      if (_sfxGain) _sfxGain.gain.value = _sfxVol;
    },
    getVolume() { return _sfxVol; },
  };
})();
