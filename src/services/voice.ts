import { VoiceSettings } from '../types';

const GENTLE = [/HoaiMy/i, /Google.*(Vi|Việt)/i, /Natural/i, /Online/i, /Linh|Mai|Female|Nữ/i];

let viVoices: SpeechSynthesisVoice[] = [];
let viVoice: SpeechSynthesisVoice | null = null;
let gocareTts = false;
let isSpeakingState = false;
const listeners = new Set<(isSpeaking: boolean) => void>();

function setSpeaking(speaking: boolean) {
  isSpeakingState = speaking;
  if (typeof document !== 'undefined') {
    if (speaking) {
      document.body.classList.add('speaking');
    } else {
      document.body.classList.remove('speaking');
    }
  }
  listeners.forEach(fn => fn(speaking));
}

export function subscribeSpeaking(callback: (isSpeaking: boolean) => void) {
  listeners.add(callback);
  callback(isSpeakingState);
  return () => {
    listeners.delete(callback);
  };
}

const player = typeof Audio !== 'undefined' ? new Audio() : null;
if (player) {
  player.preload = 'auto';
  player.onplay = () => setSpeaking(true);
  player.onended = () => setSpeaking(false);
  player.onpause = () => setSpeaking(false);
  player.onerror = () => setSpeaking(false);
}

export function loadVoices(selectedVoiceName?: string): SpeechSynthesisVoice[] {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return [];
  viVoices = window.speechSynthesis.getVoices().filter(v => /^vi/i.test(v.lang));
  const rank = (v: SpeechSynthesisVoice) => {
    const i = GENTLE.findIndex(re => re.test(v.name));
    return i < 0 ? 99 : i;
  };
  viVoices.sort((a, b) => rank(a) - rank(b));
  viVoice = viVoices.find(v => v.name === selectedVoiceName) || viVoices[0] || null;
  return viVoices;
}

if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
  loadVoices();
  window.speechSynthesis.onvoiceschanged = () => {
    loadVoices();
  };
}

export async function checkTtsStatus(bridgeUrl?: string): Promise<boolean> {
  const base = bridgeUrl ? bridgeUrl.replace(/\/+$/, '') : (typeof location !== 'undefined' ? location.origin : '');
  try {
    const res = await fetch(`${base}/api/tts/status`, { signal: AbortSignal.timeout(3000) });
    const data = await res.json();
    gocareTts = data.available === true;
  } catch {
    gocareTts = false;
  }
  return gocareTts;
}

export function cleanText(text: string): string {
  return String(text)
    .replace(/[\p{Extended_Pictographic}️‍]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

let sayId = 0;

export function say(
  text: string,
  settings: VoiceSettings,
  bridgeUrl?: string,
  opts: { force?: boolean; queue?: boolean } = {}
) {
  const { force = false } = opts;
  if (!text || (!settings.on && !force)) return;

  const cleaned = cleanText(text);
  if (!cleaned) return;

  const useGocare = gocareTts && (!settings.voiceName || settings.voiceName === 'gocare');

  if (useGocare && player) {
    const id = ++sayId;
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    player.pause();
    const base = bridgeUrl ? bridgeUrl.replace(/\/+$/, '') : location.origin;
    player.src = `${base}/api/tts?speed=${settings.rate}&text=${encodeURIComponent(cleaned.slice(0, 400))}`;
    player.play().catch(err => {
      if (id === sayId && err.name !== 'NotAllowedError' && err.name !== 'AbortError') {
        systemSay(cleaned, settings, opts);
      }
    });
    return;
  }

  systemSay(cleaned, settings, opts);
}

export function systemSay(
  text: string,
  settings: VoiceSettings,
  { queue = false }: { queue?: boolean } = {}
) {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
  if (player) player.pause();
  if (!queue) {
    window.speechSynthesis.cancel();
  }

  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'vi-VN';
  if (viVoice) u.voice = viVoice;
  u.rate = settings.rate || 0.85;
  u.pitch = 1.05;
  u.volume = 0.95;

  u.onstart = () => setSpeaking(true);
  u.onend = () => {
    if (!window.speechSynthesis.speaking) setSpeaking(false);
  };
  u.onerror = () => {
    if (!window.speechSynthesis.speaking) setSpeaking(false);
  };

  window.speechSynthesis.speak(u);
}

export function stopSpeaking() {
  if (player) player.pause();
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    window.speechSynthesis.cancel();
  }
  setSpeaking(false);
}
