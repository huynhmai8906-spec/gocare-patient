let ac: AudioContext | null = null;

export function getAudioContext(): AudioContext | null {
  try {
    if (!ac && typeof window !== 'undefined') {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioCtx) {
        ac = new AudioCtx();
      }
    }
    if (ac && ac.state === 'suspended') {
      ac.resume().catch(() => {});
    }
  } catch {
    ac = null;
  }
  return ac;
}

export function playTone(freq: number, start: number, dur: number, type: OscillatorType = 'sine', vol = 0.35) {
  const ctx = getAudioContext();
  if (!ctx) return;
  try {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, ctx.currentTime + start);
    g.gain.exponentialRampToValueAtTime(vol, ctx.currentTime + start + 0.04);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + start + dur);
    o.connect(g).connect(ctx.destination);
    o.start(ctx.currentTime + start);
    o.stop(ctx.currentTime + start + dur + 0.05);
  } catch {
    // Ignore audio playback errors
  }
}

export function playChime() {
  playTone(523, 0, 0.9, 'sine', 0.16);
  playTone(659, 0.28, 0.9, 'sine', 0.14);
  playTone(784, 0.56, 1.3, 'sine', 0.12);
}

export function playBeep() {
  playTone(740, 0, 0.16, 'sine', 0.18);
}

let sirenTimer: any = null;

export function setSiren(on: boolean) {
  if (sirenTimer) {
    clearInterval(sirenTimer);
    sirenTimer = null;
  }
  if (!on) return;
  const wail = () => {
    playTone(960, 0, 0.35, 'sawtooth', 0.2);
    playTone(720, 0.4, 0.35, 'sawtooth', 0.2);
  };
  wail();
  sirenTimer = setInterval(wail, 800);
}

export function vibrate(pattern: number | number[] = 200) {
  if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
    try {
      navigator.vibrate(pattern);
    } catch {
      // Ignore vibration error
    }
  }
}
