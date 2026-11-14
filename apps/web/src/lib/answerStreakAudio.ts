/**
 * Answer feedback and answer-streak sounds.
 *
 * The short feedback and score motifs are synthesised with the Web Audio API,
 * so they stay tiny and need no extra request. The 100-point applause uses a
 * CC0 recording (see assets/sounds/LICENSE.txt) and falls back to a synthetic
 * clap texture if it cannot be fetched or decoded. A context may only start
 * after a user gesture, so the Practice page primes it on the first tap or key
 * press; if the browser still refuses, playback is silently skipped.
 */

import applauseUrl from '@/assets/sounds/applause.mp3';
import type { ScoreSoundBand } from './answerStreak';

type AudioContextConstructor = typeof AudioContext;

let context: AudioContext | null = null;
// A fresh AudioContext starts at currentTime ≈ 0, so 0 cannot double as the
// "nothing played yet" sentinel or the very first sound would be suppressed.
let lastPlayedAt = Number.NEGATIVE_INFINITY;

function resolveConstructor(): AudioContextConstructor | null {
  if (typeof window === 'undefined') return null;
  const candidate =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: AudioContextConstructor }).webkitAudioContext;
  return candidate ?? null;
}

function ensureContext(): AudioContext | null {
  const Constructor = resolveConstructor();
  if (!Constructor) return null;
  try {
    if (!context || context.state === 'closed') context = new Constructor();
    if (context.state === 'suspended') void context.resume();
    return context;
  } catch {
    // Autoplay policies and exotic browsers are not worth an error banner;
    // the visual streak still works without sound.
    return null;
  }
}

/** Call from a user gesture so the first chime is allowed to start. */
export function primeAnswerStreakAudio(): void {
  ensureContext();
}

/**
 * Mute or unmute the shared context immediately. Suspending also cuts a sound
 * that is already scheduled, which is what the in-session speaker button
 * should do rather than only changing the setting for future answers.
 */
export function setAnswerAudioEnabled(enabled: boolean): void {
  if (enabled) {
    ensureContext();
    return;
  }
  if (context && context.state === 'running') void context.suspend();
}

let applauseBytes: ArrayBuffer | null = null;
let applauseBytesPromise: Promise<ArrayBuffer | null> | null = null;
let applauseBuffer: AudioBuffer | null = null;

function fetchApplauseBytes(): Promise<ArrayBuffer | null> {
  if (applauseBytes) return Promise.resolve(applauseBytes);
  if (!applauseBytesPromise) {
    applauseBytesPromise = fetch(applauseUrl)
      .then((response) => {
        if (!response.ok) throw new Error(`applause ${response.status}`);
        return response.arrayBuffer();
      })
      .then((data) => {
        applauseBytes = data;
        return data;
      })
      .catch(() => {
        applauseBytesPromise = null;
        return null;
      });
  }
  return applauseBytesPromise;
}

/**
 * Fetch the CC0 applause recording while the learner is still answering, so
 * the results screen can decode and play it without a visible stall.
 */
export function preloadApplause(): void {
  void fetchApplauseBytes();
}

function loadApplause(audio: AudioContext): Promise<AudioBuffer | null> {
  if (applauseBuffer) return Promise.resolve(applauseBuffer);
  return fetchApplauseBytes()
    .then((bytes) => {
      if (!bytes) return null;
      return audio.decodeAudioData(bytes.slice(0));
    })
    .then((buffer) => {
      if (!buffer) return null;
      normalizeBuffer(buffer, 0.85);
      applauseBuffer = buffer;
      return buffer;
    })
    .catch(() => null);
}

function normalizeBuffer(buffer: AudioBuffer, targetPeak: number): void {
  let peak = 0;
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const samples = buffer.getChannelData(channel);
    for (let index = 0; index < samples.length; index += 1) {
      const value = Math.abs(samples[index] ?? 0);
      if (value > peak) peak = value;
    }
  }
  if (peak <= 0.0001) return;
  const scale = targetPeak / peak;
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const samples = buffer.getChannelData(channel);
    for (let index = 0; index < samples.length; index += 1) {
      samples[index] = (samples[index] ?? 0) * scale;
    }
  }
}

/** Semitone offsets from C5 for a warm, mostly pentatonic ladder. */
const LADDER = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24];

function frequency(semitone: number): number {
  return 440 * 2 ** ((72 + semitone - 69) / 12);
}

function pluck(
  audio: AudioContext,
  output: AudioNode,
  hz: number,
  at: number,
  duration: number,
  volume: number,
): void {
  const tone = audio.createOscillator();
  const envelope = audio.createGain();
  tone.type = 'sine';
  tone.frequency.setValueAtTime(hz, at);
  envelope.gain.setValueAtTime(0.0001, at);
  envelope.gain.exponentialRampToValueAtTime(volume, at + 0.018);
  envelope.gain.exponentialRampToValueAtTime(0.0001, at + duration);
  tone.connect(envelope).connect(output);
  tone.start(at);
  tone.stop(at + duration + 0.04);

  // A quiet octave above turns the sine into a small chime.
  const shimmer = audio.createOscillator();
  const shimmerGain = audio.createGain();
  shimmer.type = 'triangle';
  shimmer.frequency.setValueAtTime(hz * 2, at);
  shimmerGain.gain.setValueAtTime(0.0001, at);
  shimmerGain.gain.exponentialRampToValueAtTime(volume * 0.28, at + 0.012);
  shimmerGain.gain.exponentialRampToValueAtTime(0.0001, at + duration * 0.7);
  shimmer.connect(shimmerGain).connect(output);
  shimmer.start(at);
  shimmer.stop(at + duration);
}

function withAudio(run: (audio: AudioContext) => void): void {
  const audio = ensureContext();
  if (!audio) return;

  if (audio.state === 'running') {
    run(audio);
    return;
  }

  // The first gesture and the React effect can race; finish the resume first
  // so the very first answer sound is not lost.
  if (audio.state === 'suspended') {
    void audio
      .resume()
      .then(() => {
        if (audio.state === 'running') run(audio);
      })
      .catch(() => undefined);
  }
}

function claimStart(audio: AudioContext): number | null {
  const now = audio.currentTime;
  // Effects can race with React StrictMode or a double click; one at a time.
  if (now - lastPlayedAt < 0.12) return null;
  lastPlayedAt = now;
  return now;
}

function masterGain(audio: AudioContext): GainNode {
  const master = audio.createGain();
  master.gain.value = 0.55;
  master.connect(audio.destination);
  return master;
}

/**
 * A short two-note answer for every run from two upwards. The pitch climbs
 * with the streak, and milestone runs get a four-note fanfare with a high
 * sparkle instead. Gain is deliberately low; this is encouragement, not an
 * alarm.
 */
export function playAnswerStreakChime(streak: number, milestone = false): void {
  withAudio((audio) => emitChime(audio, streak, milestone));
}

/**
 * The base feedback for one graded answer, independent of any streak:
 * a bright rising fifth for a fully correct answer, and a softer rising minor
 * third for a partly correct answer. The partial motif is deliberately warmer
 * and quieter, so it reads as encouragement rather than a second reward.
 */
export function playAnswerFeedbackSound(kind: 'correct' | 'partial'): void {
  withAudio((audio) => emitFeedback(audio, kind));
}

function emitChime(audio: AudioContext, streak: number, milestone: boolean): void {
  const now = claimStart(audio);
  if (now === null) return;
  const master = masterGain(audio);

  const index = Math.max(0, Math.min(LADDER.length - 4, Math.trunc(streak) - 2));
  const root = LADDER[index] ?? 0;

  if (milestone) {
    const notes = [0, 4, 7, 12];
    notes.forEach((offset, position) => {
      const hz = frequency(root + offset);
      pluck(audio, master, hz, now + 0.03 + position * 0.075, 0.45, 0.075);
    });
    pluck(audio, master, frequency(root + 24), now + 0.34, 0.7, 0.028);
  } else {
    pluck(audio, master, frequency(root), now + 0.03, 0.2, 0.055);
    pluck(audio, master, frequency(root + 7), now + 0.1, 0.26, 0.04);
  }
}

function emitFeedback(audio: AudioContext, kind: 'correct' | 'partial'): void {
  const now = claimStart(audio);
  if (now === null) return;
  const master = masterGain(audio);

  if (kind === 'correct') {
    // C5 → G5: a clean, conclusive fifth.
    pluck(audio, master, frequency(0), now + 0.02, 0.22, 0.055);
    pluck(audio, master, frequency(7), now + 0.11, 0.28, 0.042);
    return;
  }

  // A4 → C5: a softer minor third for a partly correct answer. Lower gain and
  // a longer envelope keep it supportive without sounding disappointed.
  pluck(audio, master, frequency(-3), now + 0.03, 0.26, 0.042);
  pluck(audio, master, frequency(0), now + 0.16, 0.32, 0.033);
}

/**
 * The result sound for a finished session: applause at 100, a short rising
 * arpeggio from 60, and a lower, softer motif below 60. The score itself is
 * handled by `SessionResults`, which decides whether a sound is allowed.
 */
export function playScoreSound(band: ScoreSoundBand): void {
  withAudio((audio) => {
    if (band === 'perfect') emitApplause(audio);
    else emitScoreMotif(audio, band);
  });
}

function noiseBuffer(audio: AudioContext, seconds: number): AudioBuffer {
  const length = Math.max(1, Math.round(audio.sampleRate * seconds));
  const buffer = audio.createBuffer(1, length, audio.sampleRate);
  const data = buffer.getChannelData(0);
  for (let index = 0; index < length; index += 1) {
    data[index] = Math.random() * 2 - 1;
  }
  return buffer;
}

/**
 * Play the recorded applause, trimmed with a fade-out. If the recording is not
 * available (for example a first visit that is offline before the asset is
 * cached), fall back to the synthetic clap texture below.
 */
function emitApplause(audio: AudioContext): void {
  void loadApplause(audio).then((buffer) => {
    if (!buffer) {
      emitSynthApplause(audio);
      return;
    }

    const start = audio.currentTime + 0.03;
    const offset = Math.min(0.5, Math.max(0, buffer.duration - 0.5));
    const duration = Math.min(2.8, Math.max(1.2, buffer.duration - offset - 0.05));
    const gain = audio.createGain();
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.linearRampToValueAtTime(0.7, start + 0.04);
    gain.gain.setValueAtTime(0.7, start + Math.max(0.05, duration - 0.35));
    gain.gain.linearRampToValueAtTime(0.0001, start + duration);

    const source = audio.createBufferSource();
    source.buffer = buffer;
    source.connect(gain).connect(audio.destination);
    source.start(start, offset, duration);
    source.stop(start + duration + 0.02);
  });
}

/** Synthetic applause used when the CC0 recording cannot be loaded. */
function emitSynthApplause(audio: AudioContext): void {
  const start = audio.currentTime + 0.04;
  const master = masterGain(audio);
  master.gain.value = 0.5;
  const noise = noiseBuffer(audio, 1.9);

  // The body of the crowd, slowly opening and closing.
  const bed = audio.createBufferSource();
  bed.buffer = noise;
  const bedFilter = audio.createBiquadFilter();
  bedFilter.type = 'bandpass';
  bedFilter.frequency.value = 850;
  bedFilter.Q.value = 0.6;
  const bedGain = audio.createGain();
  bedGain.gain.setValueAtTime(0.0001, start);
  bedGain.gain.linearRampToValueAtTime(0.04, start + 0.18);
  bedGain.gain.setValueAtTime(0.04, start + 1.15);
  bedGain.gain.exponentialRampToValueAtTime(0.0001, start + 1.65);
  bed.connect(bedFilter).connect(bedGain).connect(master);
  bed.start(start);
  bed.stop(start + 1.7);

  // Individual claps spread over the first second.
  for (let index = 0; index < 26; index += 1) {
    const at = start + 0.03 + Math.random() * 1.1;
    const duration = 0.035 + Math.random() * 0.055;
    const volume = 0.022 + Math.random() * 0.038;
    const source = audio.createBufferSource();
    source.buffer = noise;
    const filter = audio.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 1100 + Math.random() * 2200;
    filter.Q.value = 0.9 + Math.random() * 0.8;
    const envelope = audio.createGain();
    envelope.gain.setValueAtTime(0.0001, at);
    envelope.gain.exponentialRampToValueAtTime(volume, at + 0.004);
    envelope.gain.exponentialRampToValueAtTime(0.0001, at + duration);
    const panner = audio.createStereoPanner();
    panner.pan.value = Math.random() * 1.4 - 0.7;
    source.connect(filter).connect(envelope).connect(panner).connect(master);
    source.start(at, Math.random() * 1.5, duration + 0.02);
    source.stop(at + duration + 0.03);
  }
}

function emitScoreMotif(audio: AudioContext, band: 'pass' | 'retry'): void {
  const now = audio.currentTime + 0.04;
  const master = masterGain(audio);

  if (band === 'pass') {
    // C5 → E5 → G5 → C6: a warm major arpeggio for 60–99.
    [0, 4, 7].forEach((semitone, position) => {
      pluck(audio, master, frequency(semitone), now + position * 0.1, 0.5, 0.055);
    });
    pluck(audio, master, frequency(12), now + 0.3, 0.65, 0.03);
    return;
  }

  // D4 → G4: a low, unhurried perfect fourth for below 60. It is quieter and
  // slower than the passing motif so it reads as "keep going", not as failure.
  pluck(audio, master, frequency(-10), now + 0.02, 0.4, 0.038);
  pluck(audio, master, frequency(-5), now + 0.22, 0.55, 0.03);
}
