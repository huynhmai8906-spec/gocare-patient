import { Medication, TodayDose, DoseStatus, VitalRecord } from '../types';

export const pad = (n: number) => String(n).padStart(2, '0');

export const todayKey = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export const hm = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

export const WEEKDAYS = ['Chủ nhật', 'Thứ hai', 'Thứ ba', 'Thứ tư', 'Thứ năm', 'Thứ sáu', 'Thứ bảy'];

export function spokenHM(t: string): string {
  const [h, m] = t.split(':').map(Number);
  return m ? `${h} giờ ${m} phút` : `${h} giờ`;
}

export function spokenTime(d: Date): string {
  return spokenHM(hm(d));
}

export function spokenDate(d: Date): string {
  return `${WEEKDAYS[d.getDay()]}, ngày ${d.getDate()} tháng ${d.getMonth() + 1}`;
}

export function atToday(t: string): Date {
  const [h, m] = t.split(':').map(Number);
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d;
}

export function getGreeting(h = new Date().getHours()): { text: string; icon: string; eyebrow: string } {
  if (h >= 5 && h < 11) return { text: 'Chào buổi sáng', icon: 'light_mode', eyebrow: 'Buổi sáng an lành' };
  if (h >= 11 && h < 13) return { text: 'Chào buổi trưa', icon: 'wb_sunny', eyebrow: 'Nghỉ trưa thư thái' };
  if (h >= 13 && h < 18) return { text: 'Chào buổi chiều', icon: 'wb_twilight', eyebrow: 'Buổi chiều nhẹ nhàng' };
  return { text: 'Chào buổi tối', icon: 'bedtime', eyebrow: 'Buổi tối bình yên' };
}

export function uid(): string {
  return Math.random().toString(36).slice(2, 10);
}

export function getInitials(name?: string): string {
  const trimmed = String(name || 'G').trim();
  const parts = trimmed.split(/\s+/);
  const last = parts[parts.length - 1] || 'G';
  return last.charAt(0).toUpperCase();
}

export function medColor(med: Medication): string {
  const hash = med.name.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  const colors = ['c-green', 'c-blue', 'c-amber', 'c-violet', 'c-pink'];
  return colors[hash % colors.length];
}

export function getTodayDoses(
  meds: Medication[],
  log: Record<string, Record<string, { status: 'taken'; at: string }>>
): TodayDose[] {
  const list: TodayDose[] = [];
  const now = new Date();
  const tKey = todayKey(now);
  const dayLog = log[tKey] || {};

  for (const med of meds) {
    for (const time of med.times) {
      const key = `${med.id}@${time}`;
      const dueAt = atToday(time);
      const isTaken = dayLog[key]?.status === 'taken';

      let status: DoseStatus = 'upcoming';
      if (isTaken) {
        status = 'taken';
      } else {
        const diff = (now.getTime() - dueAt.getTime()) / 60000;
        if (diff >= -15 && diff <= 60) status = 'due';
        else if (diff > 60) status = 'missed';
        else status = 'upcoming';
      }

      list.push({ key, med, time, status, dueAt });
    }
  }

  list.sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime());
  return list;
}

export function getNextDose(
  meds: Medication[],
  log: Record<string, Record<string, { status: 'taken'; at: string }>>
): TodayDose | null {
  const doses = getTodayDoses(meds, log);
  return doses.find(d => d.status === 'due') || doses.find(d => d.status === 'upcoming') || null;
}

export function calculateAdherence(
  meds: Medication[],
  log: Record<string, Record<string, { status: 'taken'; at: string }>>
): number | null {
  let due = 0;
  let taken = 0;
  const now = new Date();

  for (let i = 0; i < 7; i++) {
    const d = new Date(Date.now() - i * 86400000);
    const dayLog = log[todayKey(d)] || {};
    for (const m of meds) {
      for (const t of m.times) {
        if (i === 0 && atToday(t) > now) continue;
        due++;
        if (dayLog[`${m.id}@${t}`]?.status === 'taken') taken++;
      }
    }
  }

  return due ? Math.round((taken / due) * 100) : null;
}

export function classifyVitals(v: { sys?: number | null; dia?: number | null; pulse?: number | null; sugar?: number | null }): {
  level: 'ok' | 'warn' | 'bad';
  issues: string[];
} {
  let level: 'ok' | 'warn' | 'bad' = 'ok';
  const issues: string[] = [];
  const bump = (lvl: 'warn' | 'bad') => {
    if (lvl === 'bad') level = 'bad';
    else if (level !== 'bad') level = 'warn';
  };

  if (v.sys && v.dia) {
    if (v.sys >= 180 || v.dia >= 120) {
      issues.push('Huyết áp rất cao nguy hiểm');
      bump('bad');
    } else if (v.sys >= 140 || v.dia >= 90) {
      issues.push('Huyết áp hơi cao');
      bump('warn');
    } else if (v.sys < 90 || v.dia < 60) {
      issues.push('Huyết áp thấp');
      bump('warn');
    }
  } else if (v.sys) {
    if (v.sys >= 180) { issues.push('Huyết áp rất cao nguy hiểm'); bump('bad'); }
    else if (v.sys >= 140) { issues.push('Huyết áp hơi cao'); bump('warn'); }
    else if (v.sys < 90) { issues.push('Huyết áp thấp'); bump('warn'); }
  }

  if (v.pulse) {
    if (v.pulse < 40 || v.pulse > 140) {
      issues.push('Nhịp tim bất thường nguy hiểm');
      bump('bad');
    } else if (v.pulse < 50 || v.pulse > 110) {
      issues.push('Nhịp tim hơi bất thường');
      bump('warn');
    }
  }

  if (v.sugar) {
    if (v.sugar < 3.9) {
      issues.push('Đường huyết thấp, cần ăn đồ ngọt ngay');
      bump('bad');
    } else if (v.sugar > 13.9) {
      issues.push('Đường huyết rất cao');
      bump('bad');
    } else if (v.sugar > 10) {
      issues.push('Đường huyết cao');
      bump('warn');
    }
  }

  return { level, issues };
}

export function vitalSummaryText(v: VitalRecord): string {
  return [
    v.sys && v.dia ? `Huyết áp ${v.sys}/${v.dia}` : (v.sys ? `Huyết áp ${v.sys}` : ''),
    v.pulse ? `Nhịp tim ${v.pulse}` : '',
    v.sugar ? `Đường huyết ${v.sugar}` : '',
  ]
    .filter(Boolean)
    .join(' · ');
}

export function haversineDistance(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371000;
  const rad = (x: number) => (x * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function triggerConfettiBurst(x?: number, y?: number) {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  const cx = x ?? window.innerWidth / 2;
  const cy = y ?? window.innerHeight / 2;
  const bits = ['favorite', 'star', 'check_circle', 'auto_awesome', 'celebration', 'spa'];
  const colors = ['#2e6b47', '#c5a059', '#0d5c58', '#426086'];

  for (let i = 0; i < 14; i++) {
    const s = document.createElement('span');
    const a = (i / 14) * Math.PI * 2;
    const d = 90 + Math.random() * 90;
    s.className = 'burst ms fill';
    s.textContent = bits[i % bits.length];
    s.style.cssText = `left:${cx - 15}px;top:${cy - 15}px;--dx:${Math.cos(a) * d}px;--dy:${
      Math.sin(a) * d - 40
    }px;--r:${Math.random() * 360 - 180}deg;color:${colors[i % colors.length]}`;
    document.body.appendChild(s);
    setTimeout(() => s.remove(), 1050);
  }
}
