/* Offline cinematic sound design: layered airflow, afterburner thump,
 * AIM-9X IR tone, missiles, flares, Doppler flybys, radio VHF & blast tails. */
(() => {
  'use strict';
  let ctx, master, engineBus, airFilter, coreFilter, airLevel, coreLevel, turbine, reverb;
  let burnerGain, burnerFilter, tensionOsc, tensionSub, tensionGain;
  let lockOsc, lockMod, lockModGain, lockGain;
  let noiseBuffer, started = false, enabled = true, engineLevel = 0.5;
  let prevAfterburner = false;
  const time = () => ctx.currentTime;
  const safe = fn => { if (!ctx || !enabled) return; try { fn(); } catch (_) {} };
  const param = (p, value, seconds = .08) => {
    p.cancelScheduledValues(time());
    p.setTargetAtTime(value, time(), seconds);
  };

  function makeNoise(seconds, channels = 1) {
    const buffer = ctx.createBuffer(channels, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
    for (let ch = 0; ch < channels; ch++) {
      const data = buffer.getChannelData(ch);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    }
    return buffer;
  }

  function makeReverb() {
    // Short diffuse reflections suggest open air and the aircraft interior, not a room echo.
    const impulse = ctx.createBuffer(2, Math.floor(ctx.sampleRate * 1.35), ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const data = impulse.getChannelData(ch);
      let smooth = 0;
      for (let i = 0; i < data.length; i++) {
        smooth = smooth * .56 + (Math.random() * 2 - 1) * .44;
        data[i] = smooth * Math.pow(1 - i / data.length, 3.4) * .48;
      }
    }
    const convolver = ctx.createConvolver();
    convolver.buffer = impulse;
    const returnGain = ctx.createGain(); returnGain.gain.value = .16;
    convolver.connect(returnGain); returnGain.connect(master);
    return convolver;
  }

  function loopNoise(filter, gain) {
    const source = ctx.createBufferSource();
    source.buffer = noiseBuffer; source.loop = true; source.playbackRate.value = .85 + Math.random() * .3;
    source.connect(filter); filter.connect(gain); gain.connect(engineBus); source.start(0, Math.random() * 4);
  }

  function init() {
    if (ctx) return true;
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return false;
    try {
      ctx = new AudioContextClass();
      master = ctx.createGain(); master.gain.value = enabled ? .72 : 0;
      const compressor = ctx.createDynamicsCompressor();
      compressor.threshold.value = -14; compressor.knee.value = 12;
      compressor.ratio.value = 4; compressor.attack.value = .008; compressor.release.value = .2;
      master.connect(compressor); compressor.connect(ctx.destination);
      noiseBuffer = makeNoise(6, 2);
      reverb = makeReverb();
      engineBus = ctx.createGain(); engineBus.gain.value = 0; engineBus.connect(master);

      // Broad filtered airflow and low-frequency combustion make up most of the engine.
      airFilter = ctx.createBiquadFilter(); airFilter.type = 'lowpass'; airFilter.frequency.value = 900;
      airLevel = ctx.createGain(); airLevel.gain.value = .17;
      loopNoise(airFilter, airLevel);
      coreFilter = ctx.createBiquadFilter(); coreFilter.type = 'lowpass'; coreFilter.frequency.value = 145;
      coreLevel = ctx.createGain(); coreLevel.gain.value = .5;
      loopNoise(coreFilter, coreLevel);
      const hissFilter = ctx.createBiquadFilter(); hissFilter.type = 'bandpass';
      hissFilter.frequency.value = 1600; hissFilter.Q.value = .45;
      const hissGain = ctx.createGain(); hissGain.gain.value = .045;
      loopNoise(hissFilter, hissGain);

      // A faint, soft turbine component sits behind the broadband noise.
      turbine = ctx.createOscillator(); turbine.type = 'sine'; turbine.frequency.value = 235;
      const turbineGain = ctx.createGain(); turbineGain.gain.value = .012;
      turbine.connect(turbineGain); turbineGain.connect(engineBus); turbine.start();
      const flutter = ctx.createOscillator(), flutterGain = ctx.createGain();
      flutter.frequency.value = .31; flutterGain.gain.value = .018;
      flutter.connect(flutterGain); flutterGain.connect(airLevel.gain); flutter.start();

      // Afterburner deep jet roar channel (ramps smoothly when SHIFT is engaged).
      burnerFilter = ctx.createBiquadFilter(); burnerFilter.type = 'lowpass'; burnerFilter.frequency.value = 180;
      burnerGain = ctx.createGain(); burnerGain.gain.value = .0001;
      loopNoise(burnerFilter, burnerGain);

      // Subtle cinematic sub-bass tension bed (Hans Zimmer / Dunkirk pulse).
      tensionGain = ctx.createGain(); tensionGain.gain.value = .016;
      const tensionLP = ctx.createBiquadFilter(); tensionLP.type = 'lowpass'; tensionLP.frequency.value = 130;
      tensionOsc = ctx.createOscillator(); tensionOsc.type = 'sawtooth'; tensionOsc.frequency.value = 55;
      tensionSub = ctx.createOscillator(); tensionSub.type = 'sine'; tensionSub.frequency.value = 27.5;
      const tensionLfo = ctx.createOscillator(), tensionLfoGain = ctx.createGain();
      tensionLfo.frequency.value = 0.24; tensionLfoGain.gain.value = .006;
      tensionLfo.connect(tensionLfoGain); tensionLfoGain.connect(tensionGain.gain);
      tensionOsc.connect(tensionLP); tensionSub.connect(tensionLP);
      tensionLP.connect(tensionGain); tensionGain.connect(engineBus);
      tensionOsc.start(); tensionSub.start(); tensionLfo.start();

      // AIM-9X Sidewinder IR seeker growl / lock tone (silent unless locking).
      lockOsc = ctx.createOscillator(); lockOsc.type = 'sawtooth'; lockOsc.frequency.value = 210;
      const lockFilter = ctx.createBiquadFilter(); lockFilter.type = 'bandpass';
      lockFilter.frequency.value = 980; lockFilter.Q.value = 2.6;
      lockMod = ctx.createOscillator(); lockMod.type = 'square'; lockMod.frequency.value = 18;
      lockModGain = ctx.createGain(); lockModGain.gain.value = 0;
      lockGain = ctx.createGain(); lockGain.gain.value = 0;
      lockMod.connect(lockModGain); lockModGain.connect(lockOsc.frequency);
      lockOsc.connect(lockFilter); lockFilter.connect(lockGain); lockGain.connect(engineBus);
      lockOsc.start(); lockMod.start();
      return true;
    } catch (_) { ctx = null; return false; }
  }

  function start() {
    if (!init()) return;
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    started = true;
    param(engineBus.gain, enabled ? 1 : 0, .45);
    setEngine(engineLevel);
  }

  function stop() {
    if (!ctx) return;
    started = false;
    prevAfterburner = false;
    if (lockGain) param(lockGain.gain, 0, .05);
    param(engineBus.gain, 0, .2);
  }

  function setEngine(level, gForce = 1, boost = 0) {
    engineLevel = Math.max(0, Math.min(1, Number(level) || 0));
    const b = Math.max(0, Math.min(1, Number(boost) || 0));
    const g = Math.max(0, Math.abs(Number(gForce) || 1) - 1);
    if (!ctx) return;
    param(airFilter.frequency, 650 + engineLevel * 1050 + b * 480, .25);
    param(coreFilter.frequency, 110 + engineLevel * 90 + b * 65, .25);
    param(airLevel.gain, .12 + engineLevel * .10 + b * .09 + Math.min(.08, g * .014), .25);
    param(coreLevel.gain, .38 + engineLevel * .20 + b * .18, .25);
    param(turbine.frequency, 190 + engineLevel * 145 + b * 60, .25);
    if (burnerGain && burnerFilter) {
      param(burnerGain.gain, .0001 + b * .36, .18);
      param(burnerFilter.frequency, 140 + b * 240, .2);
    }
    if (tensionGain) {
      param(tensionGain.gain, .014 + Math.min(.028, engineLevel * .014 + b * .012 + g * .003), .4);
    }
    if (b > 0.35 && !prevAfterburner && started && enabled) {
      // Afterburner ignition thump ("ka-BOOM" behind the seat).
      noiseBurst({ duration: .42, gain: .58, frequency: 145, endFrequency: 42, attack: .012, wet: .2 });
      resonance(46, .35, .07);
    }
    prevAfterburner = b > 0.35;
  }

  function setLock(progress = 0, locked = false) {
    if (!ctx || !lockGain || !lockOsc) return;
    if (!enabled || !started || progress <= 0.04) {
      param(lockGain.gain, 0, .04);
      return;
    }
    if (locked) {
      param(lockOsc.frequency, 920, .03);
      param(lockMod.frequency, 6, .04);
      param(lockModGain.gain, 14, .03);
      param(lockGain.gain, .046, .03);
    } else {
      param(lockOsc.frequency, 220 + progress * 240, .05);
      param(lockMod.frequency, 16 + progress * 18, .05);
      param(lockModGain.gain, 55, .05);
      param(lockGain.gain, .022 + progress * .016, .04);
    }
  }

  function noiseBurst({duration = .2, gain = .1, frequency = 1000, endFrequency = frequency,
                       type = 'lowpass', q = .7, delay = 0, attack = .004, wet = .15}) {
    const t = time() + delay;
    const source = ctx.createBufferSource(), filter = ctx.createBiquadFilter(), amp = ctx.createGain();
    source.buffer = noiseBuffer;
    source.playbackRate.value = .9 + Math.random() * .2;
    filter.type = type; filter.Q.value = q;
    filter.frequency.setValueAtTime(frequency, t);
    filter.frequency.exponentialRampToValueAtTime(Math.max(25, endFrequency), t + duration);
    amp.gain.setValueAtTime(.0001, t);
    amp.gain.exponentialRampToValueAtTime(gain, t + Math.min(attack, duration * .4));
    amp.gain.exponentialRampToValueAtTime(.0001, t + duration);
    source.connect(filter); filter.connect(amp); amp.connect(master);
    if (wet) { const send = ctx.createGain(); send.gain.value = wet; amp.connect(send); send.connect(reverb); }
    const available = Math.max(0, noiseBuffer.duration - duration * 1.12 - .02);
    source.start(t, Math.random() * available);
    source.stop(t + duration + .01);
  }

  function resonance(frequency, duration, gain, delay = 0) {
    const t = time() + delay;
    const osc = ctx.createOscillator(), amp = ctx.createGain();
    osc.type = 'sine'; osc.frequency.value = frequency * (.97 + Math.random() * .06);
    amp.gain.setValueAtTime(.0001, t); amp.gain.exponentialRampToValueAtTime(gain, t + .003);
    amp.gain.exponentialRampToValueAtTime(.0001, t + duration);
    osc.connect(amp); amp.connect(master); osc.start(t); osc.stop(t + duration + .01);
  }

  function shoot() {
    safe(() => {
      // Heavy GAU-22/A 25mm rotary cannon impulse: sharp supersonic crack, breech thump & shell clatter.
      noiseBurst({duration:.022,gain:.54,frequency:2400,endFrequency:1650,attack:.001,wet:.03});
      noiseBurst({duration:.12,gain:.78,frequency:165,endFrequency:72,attack:.0015,wet:.05});
      noiseBurst({duration:.04,gain:.22,frequency:880,endFrequency:620,type:'bandpass',q:.75,delay:.014,wet:.03});
      noiseBurst({duration:.05,gain:.12,frequency:1450,endFrequency:980,type:'bandpass',q:.6,delay:.042,wet:.03});
      resonance(115, .065, .045);
    });
  }

  function hit() {
    safe(() => {
      // Armor-piercing incendiary impact on metallic hull.
      noiseBurst({duration: .14, gain: .26, frequency: 2300, endFrequency: 480, type: 'bandpass', q: .85});
      noiseBurst({duration: .16, gain: .36, frequency: 310, endFrequency: 95});
      resonance(690, .12, .024);
      resonance(1180, .085, .016);
    });
  }

  function explosion(distance = 0) {
    safe(() => {
      const d = Math.max(0, Number(distance) || 0);
      const level = Math.max(.14, 1 / (1 + d / 1200));
      const delay = Math.min(3.5, d / 343);
      const cutoff = 3800 / (1 + d / 700);
      // Initial detonation crack + sub-bass shockwave + rolling valley thunder tail.
      noiseBurst({duration:.34,gain:.48*level,frequency:cutoff,endFrequency:160,attack:.003,delay,wet:.16});
      noiseBurst({duration:2.3,gain:.96*level,frequency:240,endFrequency:38,attack:.03,delay,wet:.32});
      noiseBurst({duration:1.75,gain:.56*level,frequency:Math.max(260,cutoff*.62),endFrequency:82,attack:.07,delay:delay+.07,wet:.35});
      noiseBurst({duration:1.1,gain:.32*level,frequency:420,endFrequency:58,delay:delay+.28,wet:.38});
      resonance(54, .65, .08 * level, delay);
    });
  }

  function cityImpact(distance = 0) {
    safe(() => {
      const d = Math.max(0, Number(distance) || 0);
      const level = Math.max(.12, 1 / (1 + d / 1350));
      const delay = Math.min(3.2, d / 343);
      // Ground blast + masonry collapse & shattering roof tiles.
      noiseBurst({duration:.38,gain:.52*level,frequency:2200,endFrequency:140,attack:.004,delay,wet:.24});
      noiseBurst({duration:1.9,gain:.85*level,frequency:195,endFrequency:42,attack:.025,delay,wet:.35});
      // Falling stone & timber debris crackle.
      noiseBurst({duration:.95,gain:.34*level,frequency:1350,endFrequency:280,type:'bandpass',q:.65,attack:.08,delay:delay+.18,wet:.28});
      resonance(48, .55, .07 * level, delay);
    });
  }

  function crashImpact(distance = 0) {
    safe(() => {
      const d = Math.max(0, Number(distance) || 0);
      const level = Math.max(.18, 1 / (1 + d / 1600));
      const delay = Math.min(3.0, d / 343);
      // Catastrophic ship crash into city: metallic hull crush + secondary fuel fireball + building demolition.
      noiseBurst({duration:.48,gain:.68*level,frequency:2900,endFrequency:120,attack:.003,delay,wet:.28});
      noiseBurst({duration:2.7,gain:1.05*level,frequency:210,endFrequency:32,attack:.03,delay,wet:.42});
      noiseBurst({duration:1.8,gain:.58*level,frequency:980,endFrequency:95,type:'bandpass',q:.55,attack:.09,delay:delay+.14,wet:.36});
      resonance(42, .85, .11 * level, delay);
      resonance(128, .45, .05 * level, delay + .06);
    });
  }

  function crowdScream(altitude = 200) {
    safe(() => {
      const alt = Math.max(80, Number(altitude) || 200);
      const prox = Math.max(.12, Math.min(1, (360 - alt) / 240));
      const now = time();
      // Synthesize 2-3 terrified human voices in the streets below using glottal sawtooth + vocal tract formants.
      const voiceCount = 2 + (Math.random() < 0.55 ? 1 : 0);
      for (let v = 0; v < voiceCount; v++) {
        const isHighVoice = (v % 2 === 0) || Math.random() < 0.6;
        const startDelay = v * (.11 + Math.random() * .16);
        const dur = .55 + Math.random() * .55;
        const t0 = now + startDelay;

        const pitchStart = isHighVoice ? (680 + Math.random() * 260) : (340 + Math.random() * 140);
        const pitchPeak = pitchStart * (1.14 + Math.random() * .16);
        const pitchEnd = pitchStart * (.72 + Math.random() * .12);

        const osc = ctx.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(pitchStart, t0);
        osc.frequency.exponentialRampToValueAtTime(pitchPeak, t0 + dur * .28);
        osc.frequency.exponentialRampToValueAtTime(pitchEnd, t0 + dur);

        // Vocal cord panic vibrato/jitter
        const vib = ctx.createOscillator(), vibGain = ctx.createGain();
        vib.frequency.value = 11 + Math.random() * 7;
        vibGain.gain.value = pitchStart * .035;
        vib.connect(vibGain);
        vibGain.connect(osc.frequency);

        // Two vocal formants (open-mouth scream F1 ~ 880 Hz, F2 ~ 2150 Hz)
        const f1 = ctx.createBiquadFilter(), f2 = ctx.createBiquadFilter();
        f1.type = 'bandpass'; f1.frequency.value = isHighVoice ? 920 : 760; f1.Q.value = 5.5;
        f2.type = 'bandpass'; f2.frequency.value = isHighVoice ? 2350 : 1850; f2.Q.value = 6.5;

        const voiceAmp = ctx.createGain();
        const peakGain = (.036 + Math.random() * .018) * prox;
        voiceAmp.gain.setValueAtTime(.0001, t0);
        voiceAmp.gain.exponentialRampToValueAtTime(peakGain, t0 + .06);
        voiceAmp.gain.exponentialRampToValueAtTime(peakGain * .7, t0 + dur * .65);
        voiceAmp.gain.exponentialRampToValueAtTime(.0001, t0 + dur);

        osc.connect(f1); osc.connect(f2);
        f1.connect(voiceAmp); f2.connect(voiceAmp);
        voiceAmp.connect(master);
        if (reverb) {
          const send = ctx.createGain();
          send.gain.value = .42;
          voiceAmp.connect(send);
          send.connect(reverb);
        }

        osc.start(t0); osc.stop(t0 + dur + .02);
        vib.start(t0); vib.stop(t0 + dur + .02);

        // Breathy vocal turbulence
        noiseBurst({
          duration: dur * .85,
          gain: .028 * prox,
          frequency: isHighVoice ? 2200 : 1650,
          endFrequency: 1100,
          type: 'bandpass',
          q: 3.2,
          attack: .05,
          delay: startDelay,
          wet: .38
        });
      }

      // Distant crowd panic murmur & occasional medieval church alarm bell toll
      noiseBurst({
        duration: .95,
        gain: .045 * prox,
        frequency: 1250,
        endFrequency: 680,
        type: 'bandpass',
        q: 1.4,
        attack: .12,
        wet: .45
      });
      if (Math.random() < 0.45) {
        resonance(587, .75, .012 * prox, .08);
        resonance(1174, .45, .007 * prox, .08);
      }
    });
  }

  function damage() {
    safe(() => {
      noiseBurst({duration: .32, gain: .34, frequency: 2100, endFrequency: 400, wet: .25});
      noiseBurst({duration: .65, gain: .65, frequency: 240, endFrequency: 60, wet: .2});
      resonance(480, .16, .025, .025);
      resonance(725, .11, .015, .04);
    });
  }

  function reload() {
    safe(() => {
      noiseBurst({duration: .07, gain: .14, frequency: 1500, endFrequency: 500, type: 'bandpass', q: 1.2, wet: .08});
      resonance(720, .055, .012);
      noiseBurst({duration: .10, gain: .17, frequency: 2100, endFrequency: 600, type: 'bandpass', q: 1.1, delay: .38, wet: .08});
      noiseBurst({duration: .09, gain: .18, frequency: 300, endFrequency: 100, delay: .38, wet: .08});
    });
  }

  function victory() {
    safe(() => {
      // A restrained aircraft systems cue rather than an arcade melody.
      resonance(440, .28, .022);
      resonance(660, .42, .017, .16);
    });
  }

  function defeat() {
    safe(() => {
      noiseBurst({duration: 1.7, gain: .55, frequency: 650, endFrequency: 65, attack: .035, wet: .4});
      noiseBurst({duration: 1.5, gain: .65, frequency: 180, endFrequency: 45, attack: .04, wet: .3});
    });
  }

  function missileLaunch() {
    safe(() => {
      // Rail release clunk + solid-rocket ignition roar + receding supersonic hiss.
      noiseBurst({ duration: .06, gain: .48, frequency: 420, endFrequency: 110, attack: .002, wet: .08 });
      noiseBurst({ duration: .85, gain: .64, frequency: 2800, endFrequency: 420, type: 'bandpass', q: .55, attack: .015, delay: .02, wet: .24 });
      noiseBurst({ duration: 1.15, gain: .52, frequency: 340, endFrequency: 58, attack: .025, delay: .02, wet: .28 });
      resonance(130, .28, .055, .01);
    });
  }

  function flare() {
    safe(() => {
      // Triple countermeasure cartridge pop-pop-pop.
      for (let i = 0; i < 3; i++) {
        const d = i * .075;
        noiseBurst({ duration: .09, gain: .44, frequency: 1900, endFrequency: 320, type: 'bandpass', q: .8, attack: .002, delay: d, wet: .16 });
        noiseBurst({ duration: .14, gain: .30, frequency: 260, endFrequency: 70, attack: .003, delay: d, wet: .12 });
        resonance(310 + i * 35, .07, .028, d);
      }
    });
  }

  function flyby(intensity = 1) {
    safe(() => {
      const lvl = Math.max(.2, Math.min(1.2, Number(intensity) || 1));
      // Doppler jet / plasma near-miss sweep (high-to-low air tear).
      noiseBurst({ duration: .52, gain: .52 * lvl, frequency: 3200, endFrequency: 210, type: 'bandpass', q: .9, attack: .07, wet: .28 });
      noiseBurst({ duration: .62, gain: .46 * lvl, frequency: 420, endFrequency: 65, attack: .09, wet: .22 });
      const t = time();
      const osc = ctx.createOscillator(), amp = ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(520, t);
      osc.frequency.exponentialRampToValueAtTime(115, t + .46);
      amp.gain.setValueAtTime(.0001, t);
      amp.gain.exponentialRampToValueAtTime(.032 * lvl, t + .12);
      amp.gain.exponentialRampToValueAtTime(.0001, t + .48);
      osc.connect(amp); amp.connect(master);
      osc.start(t); osc.stop(t + .5);
    });
  }

  function radioClick(isEnd = false) {
    safe(() => {
      // Authentic military VHF squelch burst.
      noiseBurst({
        duration: isEnd ? .055 : .042,
        gain: isEnd ? .16 : .19,
        frequency: isEnd ? 2100 : 2850,
        endFrequency: isEnd ? 1100 : 1900,
        type: 'bandpass',
        q: 2.8,
        attack: .002,
        wet: .02
      });
      resonance(isEnd ? 980 : 1420, .032, .016);
    });
  }

  function warningTone() {
    safe(() => {
      // Rapid RWR threat beep-beep.
      resonance(1120, .065, .036, 0);
      resonance(880, .065, .032, .085);
    });
  }

  function gStrain(gForce = 5) {
    safe(() => {
      const intensity = Math.max(.2, Math.min(1, (Math.abs(Number(gForce) || 5) - 3.5) / 5));
      // Airframe structural groan + pilot G-suit air pressure hiss.
      noiseBurst({ duration: .45, gain: .24 * intensity, frequency: 620, endFrequency: 240, type: 'bandpass', q: 1.8, attack: .08, wet: .05 });
      resonance(78, .38, .032 * intensity);
    });
  }

  function setEnabled(value) {
    enabled = !!value;
    if (!ctx) return;
    param(master.gain, enabled ? .72 : 0, .06);
    if (started && enabled) param(engineBus.gain, 1, .2);
  }

  window.GameAudio = {
    init, start, stop, setEngine, setLock, shoot, hit, explosion,
    cityImpact, crashImpact, crowdScream,
    missileLaunch, flare, flyby, radioClick, warningTone, gStrain,
    damage, reload, victory, defeat, setEnabled
  };
})();
