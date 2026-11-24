let context: AudioContext | null = null;

function audio(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  try { context ??= new AudioContext(); if (context.state === 'suspended') void context.resume(); return context; } catch { return null; }
}

type Note = { f: number; at: number; len: number; type?: OscillatorType; gain?: number; slide?: number };
function play(notes: Note[]) {
  const ctx = audio(); if (!ctx) return; const now = ctx.currentTime;
  for (const n of notes) {
    const o = ctx.createOscillator(), g = ctx.createGain(); o.type = n.type ?? 'triangle';
    o.frequency.setValueAtTime(n.f, now + n.at); if (n.slide) o.frequency.exponentialRampToValueAtTime(n.f * n.slide, now + n.at + n.len);
    g.gain.setValueAtTime(0.0001, now + n.at); g.gain.exponentialRampToValueAtTime(n.gain ?? 0.2, now + n.at + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, now + n.at + n.len);
    o.connect(g).connect(ctx.destination); o.start(now + n.at); o.stop(now + n.at + n.len + 0.03);
  }
}

/** Short sounds synthesised on the fly, so the app ships no audio files. */
export type SoundKind = 'whistle' | 'goal' | 'save' | 'card' | 'final';
export function playSound(kind: SoundKind): void {
  switch (kind) {
    case 'whistle': return play([{ f: 2100, at: 0, len: 0.16, type: 'sine', gain: 0.16 }, { f: 2350, at: 0.17, len: 0.22, type: 'sine', gain: 0.16 }]);
    case 'goal': return play([{ f: 392, at: 0, len: 0.16 }, { f: 523, at: 0.12, len: 0.16 }, { f: 659, at: 0.24, len: 0.16 }, { f: 784, at: 0.36, len: 0.5, gain: 0.26 }]);
    case 'save': return play([{ f: 300, at: 0, len: 0.12, slide: 0.6, gain: 0.3 }]);
    case 'card': return play([{ f: 220, at: 0, len: 0.2, type: 'square', gain: 0.1 }]);
    case 'final': return play([{ f: 2000, at: 0, len: 0.2, type: 'sine', gain: 0.16 }, { f: 2000, at: 0.28, len: 0.2, type: 'sine', gain: 0.16 }, { f: 2000, at: 0.56, len: 0.5, type: 'sine', gain: 0.16 }]);
  }
}
