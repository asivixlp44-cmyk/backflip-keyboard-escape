// Procedural soundtrack and sound effects (Web Audio, no asset files).
// "Sugar Keys": an original 128 BPM candy-pop / future-bass track in F major for the keyboard
// world. Its hi-hats are keyboard clacks typing away, the snare is a space-bar thock, a glassy
// lead sings the hook over the royal-road progression (Bbmaj7 - C7 - Am7 - Dm7), bubbly chiptune plucks
// arpeggiate, the bass bounces in octaves and the drops add sidechain-pumped supersaws and bells.
// 36 bars: music-box intro, verse, build, drop, break, build, drop 2, looping.

let ctx = null, master, musicBus, musicOut, duckFilter, sfxBus, reverb, delay, pump;
let noiseBuf = null;
let musicOn = false, schedTimer = null, step = 0, nextTime = 0, ducked = false, intensity = 0;
const settings = { music: 0.6, sfx: 0.8, master: 1, muted: false };
try { Object.assign(settings, JSON.parse(localStorage.getItem('bke_audio2') || '{}')); } catch (e) { /* defaults */ }

const BPM = 128, STEP = 60 / BPM / 4;
const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);
// The "royal road" progression (IV - V - iii - vi in F) that so many catchy J-pop / kawaii songs ride
const CHORDS = [
    { root: 34, notes: [58, 62, 65, 69] },   // Bbmaj7
    { root: 36, notes: [60, 64, 67, 70] },   // C7
    { root: 33, notes: [57, 60, 64, 67] },   // Am7
    { root: 38, notes: [57, 62, 65, 69] },   // Dm7
];
// The hook, one phrase per chord: [step, midi, length]. A: the main hook, B: the answer in drop 2
const HOOK_A = [
    [[0, 74, 2], [3, 77, 2], [6, 76, 1], [8, 74, 2], [10, 72, 2], [12, 69, 2], [14, 72, 2]],
    [[0, 72, 2], [3, 76, 2], [6, 79, 2], [8, 77, 1], [9, 76, 1], [10, 74, 2], [12, 72, 4]],
    [[0, 72, 2], [3, 74, 2], [6, 76, 2], [8, 76, 1], [10, 77, 2], [12, 79, 2], [14, 81, 2]],
    [[0, 81, 3], [3, 79, 1], [4, 77, 2], [6, 76, 2], [8, 74, 6], [14, 72, 2]],
];
const HOOK_B = [
    [[0, 77, 2], [2, 79, 2], [4, 81, 2], [6, 79, 1], [7, 77, 1], [8, 74, 2], [10, 77, 2], [12, 81, 2], [14, 84, 2]],
    [[0, 84, 3], [3, 82, 1], [4, 81, 2], [6, 79, 2], [8, 76, 4], [12, 79, 2], [14, 81, 2]],
    [[0, 81, 2], [2, 79, 2], [4, 76, 2], [6, 72, 2], [8, 76, 2], [10, 79, 2], [12, 84, 2], [14, 81, 2]],
    [[0, 81, 2], [2, 77, 2], [4, 81, 2], [6, 86, 4], [10, 84, 2], [12, 81, 4]],
];
// Typing rhythm for the keyboard-clack hats: accent per 16th (0 = rest)
const TYPING = [0.9, 0.35, 0.6, 0.3, 0.8, 0, 0.55, 0.4, 0.9, 0.35, 0.5, 0.45, 0.75, 0.3, 0.6, 0];
// Song map, 36 bars: intro (music box plays the hook), verse, build, drop, break, build, drop 2
const SECTION = (bar) => {
    const b = bar % 36;
    if (b < 4) return 'intro';
    if (b < 8) return 'verse';
    if (b < 12) return 'build';
    if (b < 20) return 'drop';
    if (b < 24) return 'break';
    if (b < 28) return 'build';
    return 'drop2';
};

export function initAudio() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -12; comp.ratio.value = 4; comp.attack.value = 0.003; comp.release.value = 0.15;
    master = ctx.createGain(); master.gain.value = 0.9;
    comp.connect(master).connect(ctx.destination);
    musicBus = ctx.createGain();
    duckFilter = ctx.createBiquadFilter(); duckFilter.type = 'lowpass'; duckFilter.frequency.value = 20000; duckFilter.Q.value = 0.5;
    musicOut = ctx.createGain();
    musicBus.connect(duckFilter).connect(musicOut).connect(comp);
    sfxBus = ctx.createGain(); sfxBus.connect(comp);
    pump = ctx.createGain(); pump.connect(musicBus);
    applyVolumes();

    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;

    reverb = ctx.createConvolver();
    const len = ctx.sampleRate * 2.4, ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
        const ch = ir.getChannelData(c);
        for (let i = 0; i < len; i++) ch[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.4);
    }
    reverb.buffer = ir;
    const revGain = ctx.createGain(); revGain.gain.value = 0.3;
    reverb.connect(revGain).connect(musicBus);
    delay = ctx.createDelay(1);
    delay.delayTime.value = STEP * 3;
    const fb = ctx.createGain(); fb.gain.value = 0.3;
    const dlf = ctx.createBiquadFilter(); dlf.type = 'highpass'; dlf.frequency.value = 600;
    const dlGain = ctx.createGain(); dlGain.gain.value = 0.26;
    delay.connect(dlf).connect(fb).connect(delay);
    dlf.connect(dlGain).connect(musicBus);

    document.addEventListener('visibilitychange', () => {
        if (!ctx) return;
        if (document.hidden) ctx.suspend(); else ctx.resume();
    });
}

function applyVolumes() {
    if (!ctx) return;
    const t = ctx.currentTime;
    const m = settings.master ?? 1;
    musicOut.gain.setTargetAtTime(settings.muted ? 0 : settings.music * 0.5 * m * (ducked ? 0.6 : 1), t, 0.08);
    sfxBus.gain.setTargetAtTime(settings.sfx * m, t, 0.05);
}
function save() { try { localStorage.setItem('bke_audio2', JSON.stringify(settings)); } catch (e) { /* ignore */ } }
export function getVolumes() { return { ...settings }; }
export function setVolume(kind, v) {
    settings[kind] = Math.max(0, Math.min(1, v));
    save();
    applyVolumes();
}
// The "Sounds" button: music on / off
export function toggleMusic() { settings.muted = !settings.muted; save(); applyVolumes(); return !settings.muted; }
export const musicMuted = () => !!settings.muted;
// Browsers keep audio off until the first click or key press
export const audioSuspended = () => !ctx || ctx.state !== 'running';
// Menus open: the music goes muffled and a little quieter
export function setMusicDuck(on) {
    if (!ctx || on === ducked) return;
    ducked = on;
    duckFilter.frequency.setTargetAtTime(on ? 900 : 20000, ctx.currentTime, 0.12);
    applyVolumes();
}
// 0 in the lobby, 1 on the high stages: an extra glitter layer in the drops
export function setMusicIntensity(v) { intensity = v; }

// ----- instruments -----
function env(g, t, a, peak, d, sustain, r, end) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0001, sustain), t + a + d);
    if (end) { g.gain.setValueAtTime(Math.max(0.0001, sustain), end); g.gain.exponentialRampToValueAtTime(0.0001, end + r); }
}
function noise(t, dur, type, freq, q, gain, out) {
    const src = ctx.createBufferSource(); src.buffer = noiseBuf;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q || 1;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(out || musicBus);
    src.start(t, Math.random() * 1.5); src.stop(t + dur + 0.05);
    return g;
}
function kick(t, gain) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.setValueAtTime(170, t); o.frequency.exponentialRampToValueAtTime(48, t + 0.09);
    g.gain.setValueAtTime(gain || 0.85, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.36);
    o.connect(g).connect(musicBus); o.start(t); o.stop(t + 0.4);
    noise(t, 0.012, 'highpass', 3000, 0.7, 0.16, musicBus);
    pump.gain.cancelScheduledValues(t);
    pump.gain.setValueAtTime(0.22, t);
    pump.gain.linearRampToValueAtTime(1, t + STEP * 3.2);
}
// A mechanical keyboard key: a sharp click on top of a short plastic knock
function clack(t, gain, out) {
    noise(t, 0.018, 'bandpass', 5200 + Math.random() * 900, 2.5, gain, out || musicBus);
    noise(t + 0.004, 0.035, 'bandpass', 1700 + Math.random() * 300, 3, gain * 0.55, out || musicBus);
}
// A big keycap bottoming out under your feet: a short hollow plastic knock
function bottomOut(t, gain) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'triangle'; o.frequency.setValueAtTime(420 + Math.random() * 60, t); o.frequency.exponentialRampToValueAtTime(190, t + 0.045);
    g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
    o.connect(g).connect(sfxBus); o.start(t); o.stop(t + 0.08);
    noise(t, 0.03, 'bandpass', 1100, 2.2, gain * 0.6, sfxBus);
}
// Space bar "thock": lower, rounder, with the clap on top
function thock(t, gain) {
    noise(t, 0.07, 'bandpass', 900, 2, gain, musicBus);
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'triangle'; o.frequency.setValueAtTime(260, t); o.frequency.exponentialRampToValueAtTime(140, t + 0.06);
    g.gain.setValueAtTime(gain * 0.9, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.08);
    o.connect(g).connect(musicBus); o.start(t); o.stop(t + 0.1);
}
function clap(t, gain) {
    gain = gain || 0.18;
    for (let i = 0; i < 3; i++) noise(t + i * 0.009, 0.08, 'bandpass', 1500, 1.1, gain, musicBus);
    noise(t, 0.3, 'bandpass', 1800, 0.9, gain * 0.5, reverb);
}
function snare(t, gain) { noise(t, 0.09, 'bandpass', 2200, 0.8, gain, musicBus); }
// Glassy bell: sine + bright partials with a long tail
function bell(t, n, dur, gain) {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + 0.006); g.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(0.4, dur * 2.2));
    g.connect(musicBus); g.connect(reverb); g.connect(delay);
    for (const [k, a] of [[1, 1], [2.01, 0.35], [3.99, 0.18], [6.2, 0.06]]) {
        const o = ctx.createOscillator(), og = ctx.createGain(); o.type = 'sine'; o.frequency.value = midi(n) * k; og.gain.value = a;
        o.connect(og).connect(g); o.start(t); o.stop(t + Math.max(0.45, dur * 2.3));
    }
}
// Bubbly chiptune pluck: square with a fast pitch blip and decay
function pluck(t, n, gain) {
    const o = ctx.createOscillator(), g = ctx.createGain(), f = ctx.createBiquadFilter();
    o.type = 'square';
    o.frequency.setValueAtTime(midi(n + 12), t); o.frequency.exponentialRampToValueAtTime(midi(n), t + 0.02);
    f.type = 'lowpass'; f.frequency.setValueAtTime(4200, t); f.frequency.exponentialRampToValueAtTime(900, t + 0.15);
    g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    o.connect(f).connect(g); g.connect(musicBus); g.connect(reverb);
    o.start(t); o.stop(t + 0.2);
}
function supersaw(t, notes, dur, gain, cutoff) {
    const f = ctx.createBiquadFilter(), g = ctx.createGain();
    f.type = 'lowpass'; f.Q.value = 1.2;
    f.frequency.setValueAtTime(cutoff * 2.2, t); f.frequency.exponentialRampToValueAtTime(cutoff, t + dur * 0.6);
    env(g, t, 0.006, gain, dur * 0.5, gain * 0.55, 0.08, t + dur);
    f.connect(g); g.connect(pump); g.connect(reverb);
    for (const n of notes) for (const det of [-14, 0, 14]) {
        const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = midi(n); o.detune.value = det + (Math.random() - 0.5) * 4;
        o.connect(f); o.start(t); o.stop(t + dur + 0.12);
    }
}
function pad(t, notes, dur, gain, cutoff) {
    const f = ctx.createBiquadFilter(), g = ctx.createGain();
    f.type = 'lowpass'; f.Q.value = 0.7; f.frequency.value = cutoff;
    env(g, t, dur * 0.25, gain, dur * 0.2, gain * 0.8, 0.3, t + dur);
    f.connect(g); g.connect(pump); g.connect(reverb);
    for (const n of notes) for (const det of [-8, 8]) {
        const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = midi(n); o.detune.value = det;
        o.connect(f); o.start(t); o.stop(t + dur + 0.35);
    }
}
function bass(t, n, dur, gain) {
    const g = ctx.createGain(), f = ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = 560; f.Q.value = 2;
    env(g, t, 0.005, gain || 0.32, dur * 0.6, (gain || 0.32) * 0.7, 0.05, t + dur);
    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = midi(n);
    const o2 = ctx.createOscillator(); o2.type = 'square'; o2.frequency.value = midi(n); const g2 = ctx.createGain(); g2.gain.value = 0.16;
    o.connect(g); o2.connect(g2).connect(f).connect(g); g.connect(pump);
    o.start(t); o.stop(t + dur + 0.1); o2.start(t); o2.stop(t + dur + 0.1);
}
// Music box (the break): thin sine with a metallic ping
function musicBox(t, n, gain) {
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
    g.connect(musicBus); g.connect(reverb);
    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = midi(n); o.connect(g); o.start(t); o.stop(t + 1);
    const h = ctx.createOscillator(), hg = ctx.createGain(); h.type = 'sine'; h.frequency.value = midi(n) * 3.01; hg.gain.setValueAtTime(0.25, t); hg.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    h.connect(hg).connect(g); h.start(t); h.stop(t + 0.15);
}
function riser(t, dur) {
    const src = ctx.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 1.5;
    f.frequency.setValueAtTime(400, t); f.frequency.exponentialRampToValueAtTime(9000, t + dur);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.15, t + dur * 0.95); g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.05);
    src.connect(f).connect(g); g.connect(musicBus); g.connect(reverb);
    src.start(t); src.stop(t + dur + 0.1);
}
// Glitter sweep up into the drop: fast ascending bells
function sparkleSweep(t) { for (let i = 0; i < 12; i++) bell(t + i * STEP * 0.5, 84 + [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24, 28][i], STEP, 0.035); }
function impact(t) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.setValueAtTime(95, t); o.frequency.exponentialRampToValueAtTime(30, t + 0.9);
    g.gain.setValueAtTime(0.5, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.1);
    o.connect(g).connect(musicBus); o.start(t); o.stop(t + 1.2);
    noise(t, 1.4, 'highpass', 3500, 0.5, 0.13, reverb);
}

// The lead: two detuned squares and a saw with a soft filter and delayed vibrato, plus a sine an
// octave up for sparkle; it carries the hook through the drops
function lead(t, n, dur, gain) {
    const g = ctx.createGain(), f = ctx.createBiquadFilter();
    f.type = 'lowpass'; f.Q.value = 1.6;
    f.frequency.setValueAtTime(5600, t); f.frequency.exponentialRampToValueAtTime(2600, t + Math.min(0.4, dur));
    env(g, t, 0.008, gain, 0.12, gain * 0.75, 0.09, t + dur);
    f.connect(g); g.connect(musicBus); g.connect(delay); g.connect(reverb);
    const vib = ctx.createOscillator(), vg = ctx.createGain();
    vib.frequency.value = 5.6; vg.gain.setValueAtTime(0, t); vg.gain.linearRampToValueAtTime(midi(n) * 0.011, t + Math.min(0.28, dur));
    vib.connect(vg);
    for (const [type, det, k, oct] of [['square', -8, 0.45, 0], ['square', 8, 0.45, 0], ['sawtooth', 0, 0.22, 0], ['sine', 0, 0.3, 12]]) {
        const o = ctx.createOscillator(), og = ctx.createGain();
        o.type = type; o.detune.value = det; og.gain.value = k;
        o.frequency.setValueAtTime(midi(n + oct), t);
        vg.connect(o.frequency);
        o.connect(og).connect(f); o.start(t); o.stop(t + dur + 0.18);
    }
    vib.start(t); vib.stop(t + dur + 0.18);
}
function hookNotes(sec, bar) { return (sec === 'drop2' ? HOOK_B : HOOK_A)[bar % 4]; }

function playStep(s, t) {
    const bar = Math.floor(s / 16), i = s % 16, b = bar % 36, sec = SECTION(bar), chord = CHORDS[bar % 4];
    if (sec === 'intro' || sec === 'break') {
        // Pad, long bass notes, somebody typing gently and the hook on a music box
        if (i === 0) pad(t, chord.notes, STEP * 16, 0.045, sec === 'intro' ? 700 + (b % 4) * 400 : 1800);
        if (i === 0) bass(t, chord.root + 12, STEP * 14, 0.13);
        if (TYPING[i] && i % 2 === 0) clack(t, 0.05 * TYPING[i]);
        for (const [at, n] of HOOK_A[bar % 4]) if (at === i) musicBox(t, n + 12, 0.1);
        if (sec === 'break' && (i === 4 || i === 12)) thock(t, 0.08);
        if ((b === 3 || b === 23) && i >= 12) snare(t, 0.05 + (i - 12) * 0.02);
        return;
    }
    if (sec === 'verse') {
        // Light groove: kick on the beat, claps on 2 and 4, plucky arps, the bass bouncing in octaves
        if (i % 4 === 0) kick(t, 0.6);
        if (i === 4 || i === 12) { clap(t, 0.12); thock(t, 0.07); }
        if (TYPING[i]) clack(t, 0.06 * TYPING[i]);
        pluck(t, chord.notes[[0, 1, 2, 3, 2, 1, 3, 2][(i >> 1) % 8]] + 12, i % 2 ? 0.02 : 0.035);
        if (i % 2 === 0) bass(t, chord.root + (i % 4 === 2 ? 24 : 12), STEP * 1.6, 0.2);
        if (i === 0) pad(t, chord.notes, STEP * 16, 0.03, 1200);
        if (bar % 4 === 3 && i >= 8) for (const [at, n, l] of HOOK_A[3]) if (at === i) lead(t, n, STEP * l, 0.06);
        return;
    }
    if (sec === 'build') {
        const k = b % 4;
        if (k === 0 && i === 0) riser(t, STEP * 64);
        if (k === 3 && i === 0) sparkleSweep(t);
        const every = k < 2 ? 4 : k === 2 ? 2 : 1;
        if (i % every === 0) snare(t, 0.05 + (k * 16 + i) / 64 * 0.12);
        if (k < 3 && i % 4 === 0) kick(t, 0.6);
        if (i === 0) supersaw(t, chord.notes, STEP * 14, 0.03, 800 + k * 900);
        if (TYPING[i]) clack(t, 0.06 * TYPING[i]);
        if (i % 2 === 0) pluck(t, chord.notes[(i / 2) % 4] + 12, 0.035);
        if (i === 0) bass(t, chord.root + 12, STEP * 12, 0.16);
        // The hook teases in on the last bar
        if (k === 3) for (const [at, n, l] of HOOK_A[bar % 4]) if (at === i) lead(t, n, STEP * l, 0.07);
        return;
    }
    // Drops: four on the floor, clap + space-bar thock, typing hats, pumping supersaw chords, the
    // bass bouncing in octaves, the lead singing the hook (bells double it in drop 2)
    if ((b === 12 || b === 28) && i === 0) impact(t);
    if (i % 4 === 0) kick(t, 0.85);
    if (i === 4 || i === 12) { clap(t, 0.17); thock(t, 0.1); }
    if (TYPING[i]) clack(t, 0.075 * TYPING[i]);
    if (i % 4 === 2) noise(t, 0.12, 'highpass', 7000, 0.7, 0.05, musicBus);
    if (i % 4 === 0) supersaw(t, chord.notes.map((n) => n + 12), STEP * 3.6, 0.04, 3200);
    if (i % 2 === 0) bass(t, chord.root + (i % 4 === 2 ? 24 : 12), STEP * 1.7, 0.28);
    for (const [at, n, l] of hookNotes(sec, bar)) if (at === i) {
        lead(t, n, STEP * l, 0.1);
        if (sec === 'drop2') bell(t, n + 12, STEP * l, 0.045);
    }
    if (i % 2 === 1) pluck(t, chord.notes[(i >> 1) % 4] + 24, 0.018);
    if (intensity > 0.5 && i % 4 === 2) bell(t, chord.notes[(i >> 2) % 4] + 24, STEP, 0.03);
    if (i === 14 && bar % 4 === 3) { snare(t, 0.08); snare(t + STEP / 2, 0.1); }
}

function scheduler() {
    while (nextTime < ctx.currentTime + 0.15) {
        playStep(step, nextTime);
        nextTime += STEP;
        step++;
    }
}
export function startMusic() {
    if (!ctx || musicOn) return;
    musicOn = true;
    step = 0; nextTime = ctx.currentTime + 0.1;
    schedTimer = setInterval(scheduler, 25);
}
export function stopMusic() { musicOn = false; clearInterval(schedTimer); }

// ----- sound effects -----
function tone(t, type, f0, f1, dur, gain, out) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(f0, t);
    if (f1) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(out || sfxBus); o.start(t); o.stop(t + dur + 0.05);
}
// Each backflip in a chain rings one step higher up a major scale: spamming jump climbs a tune
const FLIP_SCALE = [0, 2, 4, 5, 7, 9, 11, 12, 14, 16, 17, 19, 21, 23, 24];
let flipN = 0;
export function resetFlips() { flipN = 0; }
const SFX = {
    click(t) { clack(t, 0.32, sfxBus); },
    jump(t) { tone(t, 'sine', 300, 700, 0.12, 0.22); clack(t, 0.15, sfxBus); },
    flip(t) {
        const n = 72 + FLIP_SCALE[flipN % FLIP_SCALE.length] + 12 * Math.floor(flipN / FLIP_SCALE.length) % 24;
        flipN++;
        tone(t, 'triangle', midi(n), midi(n + 12), 0.1, 0.13);
        tone(t, 'sine', midi(n + 12), null, 0.22, 0.08);
        const src = ctx.createBufferSource(); src.buffer = noiseBuf;
        const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 1.8;
        f.frequency.setValueAtTime(600, t); f.frequency.exponentialRampToValueAtTime(3200, t + 0.2);
        const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.18, t + 0.06); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
        src.connect(f).connect(g).connect(sfxBus); src.start(t, Math.random()); src.stop(t + 0.3);
    },
    land(t) { thockSfx(t, 0.3); },
    step(t) { clack(t, 0.065, sfxBus); bottomOut(t + 0.012, 0.07); },
    gain(t) { tone(t, 'triangle', midi(88), null, 0.05, 0.05); },
    checkpoint(t) { [79, 84, 88].forEach((n, i) => tone(t + i * 0.06, 'triangle', midi(n), null, 0.25, 0.12)); },
    zap(t) { tone(t, 'square', 1400, 180, 0.22, 0.16); noise(t, 0.15, 'highpass', 3000, 0.8, 0.18, sfxBus); },
    crush(t) { tone(t, 'sine', 120, 35, 0.4, 0.55); noise(t, 0.35, 'lowpass', 700, 1, 0.45, sfxBus); },
    boing(t) { springTone(t, 220, 0.35, 0.22); },
    death(t) { tone(t, 'triangle', 620, 110, 0.45, 0.25); tone(t + 0.12, 'sine', 300, 70, 0.4, 0.2); noise(t, 0.3, 'lowpass', 900, 1, 0.25, sfxBus); },
    levelUp(t) { [72, 76, 79, 84].forEach((n, i) => tone(t + i * 0.08, 'square', midi(n), null, 0.25, 0.1)); tone(t + 0.32, 'triangle', midi(88), null, 0.6, 0.18); },
    buy(t) { [79, 84, 88, 91, 96].forEach((n, i) => tone(t + i * 0.05, 'sine', midi(n), null, 0.3, 0.15)); },
    denied(t) { tone(t, 'square', 220, 160, 0.14, 0.12); tone(t + 0.14, 'square', 180, 120, 0.18, 0.12); },
    whoosh(t) {
        const src = ctx.createBufferSource(); src.buffer = noiseBuf;
        const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 2;
        f.frequency.setValueAtTime(300, t); f.frequency.exponentialRampToValueAtTime(3000, t + 0.35);
        const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.32, t + 0.2); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
        src.connect(f).connect(g).connect(sfxBus); src.start(t); src.stop(t + 0.55);
    },
    cheer(t) {
        for (let i = 0; i < 6; i++) tone(t + i * 0.04, 'sine', 180 - i * 8, 90, 0.08, 0.2);
        [72, 76, 79, 84, 88].forEach((n, i) => tone(t + 0.25 + i * 0.07, 'square', midi(n), null, 0.3, 0.08));
        noise(t + 0.25, 0.6, 'highpass', 4000, 0.7, 0.12, sfxBus);
    },
    gate(t) {
        [84, 88, 91, 96, 100].forEach((n, i) => tone(t + i * 0.035, 'sine', midi(n), null, 0.5, 0.09));
        tone(t, 'triangle', 220, 880, 0.35, 0.12);
    },
    teleport(t) { for (let i = 0; i < 8; i++) tone(t + i * 0.03, 'sine', midi(76 + i * 3), null, 0.15, 0.07); },
    firework(t) { tone(t, 'sine', 900, 200, 0.35, 0.05); noise(t + 0.35, 0.4, 'lowpass', 2500, 0.8, 0.3, sfxBus); },
    quest(t) { [84, 91, 96].forEach((n, i) => tone(t + i * 0.09, 'triangle', midi(n), null, 0.35, 0.12)); },
};
function thockSfx(t, gain) {
    noise(t, 0.06, 'bandpass', 800, 2, gain, sfxBus);
    tone(t, 'triangle', 220, 110, 0.07, gain * 0.7);
}
function springTone(t, f, dur, gain) {
    const o = ctx.createOscillator(), g = ctx.createGain(), lfo = ctx.createOscillator(), lg = ctx.createGain();
    o.type = 'triangle';
    o.frequency.setValueAtTime(f * 0.7, t); o.frequency.exponentialRampToValueAtTime(f * 1.9, t + dur * 0.35); o.frequency.exponentialRampToValueAtTime(f, t + dur);
    lfo.frequency.value = 28; lg.gain.value = f * 0.12; lfo.connect(lg).connect(o.frequency);
    g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(sfxBus); o.start(t); o.stop(t + dur + 0.05); lfo.start(t); lfo.stop(t + dur + 0.05);
}
export function sfx(name) {
    if (!ctx || !SFX[name] || settings.sfx <= 0) return;
    SFX[name](ctx.currentTime + 0.005);
}
