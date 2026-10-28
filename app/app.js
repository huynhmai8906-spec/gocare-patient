/* GoCare Bệnh Nhân — app dành cho người cao tuổi.
 * - Đọc to mọi nút khi bấm (Web Speech API, giọng tiếng Việt nhẹ nhàng)
 * - Nhắc uống thuốc + lịch hẹn khám
 * - Nút cấp cứu SOS → tạo đơn cấp cứu trên Web Quản Lý qua GoCare Bridge
 * - Camera chống té ngã thật: cài, bật/tắt, xem trực tiếp (bridge chạy YOLOv8)
 * - Vùng an toàn GPS: báo động khi đi ra xa nhà
 */
'use strict';

const STORE_KEY = 'gocare.patient.v1';
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const ms = (name, fill = false) => `<span class="ms${fill ? ' fill' : ''}" aria-hidden="true">${name}</span>`;

// ======================= DỮ LIỆU =======================

const DEFAULTS = {
  profile: { name: '', phone: '', address: '', familyName: '', familyPhone: '', doctorPhone: '', emergencyPhone: '115', autoDial: true },
  voice: { on: true, rate: 0.85, voiceName: 'gocare' },
  size: 'l',
  link: { bridgeUrl: '', token: '' },
  meds: [
    { id: 'm1', name: 'Thuốc huyết áp', dose: '1 viên', times: ['07:00'], note: 'Sau ăn sáng', icon: '💊' },
    { id: 'm2', name: 'Thuốc tiểu đường', dose: '1 viên', times: ['07:30', '19:30'], note: 'Sau ăn', icon: '🔵' },
  ],
  log: {},
  snooze: {},
  zone: { on: false, home: null, radius: 200 },
  vitals: [],
  appts: [],
  pending: [],
  seenAlertId: null,
  lastCheckin: null,
};

// Đăng nhập bằng Supabase Auth — database dùng chung với Web Khách Hàng & Web Quản Lý GoCare.
const CFG = window.GOCARE_CONFIG || {};
const sb = window.supabase?.createClient(CFG.supabaseUrl, CFG.supabaseKey, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: 'gocare-patient-auth' },
}) || null;
let session = null;  // { token, user: { id, name, phone, email } }
let S = structuredClone(DEFAULTS);

function toSession(s) {
  if (!s) return null;
  const m = s.user.user_metadata || {};
  return { token: s.access_token, user: { id: s.user.id, email: s.user.email, name: m.full_name || m.name || (s.user.email || '').split('@')[0], phone: m.phone || '' } };
}

function readLocal(key) { try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch { return null; } }
function writeLocal(key, v) { try { v == null ? localStorage.removeItem(key) : localStorage.setItem(key, JSON.stringify(v)); } catch { /* bỏ qua */ } }
const userStoreKey = () => `${STORE_KEY}.${session?.user?.id || 'guest'}`;

function hydrate(data) {
  if (!data) return structuredClone(DEFAULTS);
  const s = { ...structuredClone(DEFAULTS), ...data,
    profile: { ...DEFAULTS.profile, ...data.profile }, voice: { ...DEFAULTS.voice, ...data.voice },
    link: { ...DEFAULTS.link, ...data.link }, zone: { ...DEFAULTS.zone, ...data.zone } };
  delete s.updatedAt;
  if (![0.75, 0.85, 1].includes(s.voice.rate)) s.voice.rate = 0.85; // tốc độ cũ → nhịp nhẹ nhàng mới
  return s;
}
function load() { return hydrate(readLocal(userStoreKey()) || readLocal(STORE_KEY)); }

let syncTimer = null, syncState = 'ok';
function save() {
  writeLocal(userStoreKey(), S);
  if (!session) return;
  // Đồng bộ lên máy chủ sau 1,5 giây (gộp nhiều thay đổi liên tiếp)
  clearTimeout(syncTimer);
  syncTimer = setTimeout(pushData, 1500);
}
// Dữ liệu app lưu ở bảng patient_app_data (xem supabase/patient_app_data.sql).
// Nếu database chưa có bảng này → lưu tạm trong hồ sơ tài khoản (user_metadata).
let hasDataTable = true;
async function pushData() {
  if (!session || !sb) return;
  const { pending, link, ...data } = S;
  try {
    if (hasDataTable) {
      const { error } = await sb.from('patient_app_data').upsert({ user_id: session.user.id, data, updated_at: new Date().toISOString() });
      if (error && /patient_app_data|does not exist|PGRST205|42P01/i.test(`${error.code} ${error.message}`)) hasDataTable = false;
      else if (error) throw error;
    }
    if (!hasDataTable) {
      const slim = { ...data, vitals: data.vitals.slice(0, 20), log: Object.fromEntries(Object.entries(data.log).slice(-7)) };
      const { error } = await sb.auth.updateUser({ data: { gocare_app: slim } });
      if (error) throw error;
    }
    syncState = 'ok';
  } catch { syncState = 'offline'; }
  renderAccount();
}

async function pullData(user) {
  if (!sb) return null;
  const { data, error } = await sb.from('patient_app_data').select('data').eq('user_id', user.id).maybeSingle();
  if (error && /patient_app_data|does not exist|PGRST205|42P01/i.test(`${error.code} ${error.message}`)) hasDataTable = false;
  return data?.data || user.user_metadata?.gocare_app || null;
}

// Hồ sơ bệnh nhân hiện ở mục "Hồ sơ khách đăng ký" trên Web Quản Lý
async function syncPatientProfile() {
  if (!session || !sb) return;
  const p = S.profile;
  const row = { user_id: session.user.id, full_name: p.name || session.user.name, emergency_phone: p.familyPhone || p.phone || null,
    guardian_name: p.familyName || null, service_need: `App Bệnh Nhân GoCare${p.address ? ' · ' + p.address : ''}` };
  try {
    const { data } = await sb.from('patient_profiles').select('id').eq('user_id', session.user.id).maybeSingle();
    if (data?.id) await sb.from('patient_profiles').update(row).eq('id', data.id);
    else await sb.from('patient_profiles').insert(row);
  } catch { /* không bắt buộc */ }
}

// ======================= GIỌNG ĐỌC NHẸ NHÀNG =======================

// Ưu tiên giọng nữ tự nhiên, ấm (HoaiMy Natural của Microsoft, giọng Google), rồi mới tới giọng tiếng Việt khác
const GENTLE = [/HoaiMy/i, /Google.*(Vi|Việt)/i, /Natural/i, /Online/i, /Linh|Mai|Female|Nữ/i];
let viVoices = [];
let viVoice = null;

function loadVoices() {
  if (!('speechSynthesis' in window)) return;
  viVoices = speechSynthesis.getVoices().filter(v => /^vi/i.test(v.lang));
  const rank = v => { const i = GENTLE.findIndex(re => re.test(v.name)); return i < 0 ? 99 : i; };
  viVoices.sort((a, b) => rank(a) - rank(b));
  viVoice = viVoices.find(v => v.name === S.voice.voiceName) || viVoices[0] || null;
  renderVoiceSelect();
}

function useGocareVoice() { return gocareTts && (!S.voice.voiceName || S.voice.voiceName === 'gocare'); }

function renderVoiceSelect() {
  const sel = $('#voiceSelect');
  if (!sel) return;
  const rank = v => { const i = GENTLE.findIndex(re => re.test(v.name)); return i < 0 ? 99 : i; };
  sel.innerHTML = (gocareTts ? `<option value="gocare" ${useGocareVoice() ? 'selected' : ''}>GoCare — giọng nữ tự nhiên (khuyên dùng)</option>` : '') +
    viVoices.map(v => `<option value="${esc(v.name)}" ${!useGocareVoice() && v === viVoice ? 'selected' : ''}>Giọng của máy: ${esc(v.name.replace(/Microsoft |\(Natural\)| - Vietnamese \(Vietnam\)/g, '').trim())}${rank(v) < 3 ? ' — nhẹ nhàng' : ''}</option>`).join('') ||
    '<option>Giọng mặc định của máy</option>';
  const info = $('#voiceInfo');
  if (info) info.textContent = gocareTts || viVoices.length ? '' :
    'Máy chưa có giọng tiếng Việt. Android: cài "Dịch vụ giọng nói của Google". Windows: Cài đặt → Thời gian & ngôn ngữ → Giọng nói → thêm Tiếng Việt.';
}

// Giọng nữ tiếng Việt GoCare (Piper) do máy chủ đọc; lỗi thì tự quay về giọng của máy
let gocareTts = false;
const player = new Audio();
player.preload = 'auto';
player.onplay = () => document.body.classList.add('speaking');
player.onended = player.onpause = player.onerror = () => document.body.classList.remove('speaking');
async function checkTts() {
  try { gocareTts = (await (await fetch(`${bridgeBase()}/api/tts/status`)).json()).available === true; } catch { gocareTts = false; }
  renderVoiceSelect();
}
if ('speechSynthesis' in window) {
  loadVoices();
  speechSynthesis.onvoiceschanged = loadVoices;
}

function clean(text) {
  return String(text).replace(/[\p{Extended_Pictographic}️‍]/gu, '').replace(/\s+/g, ' ').trim();
}
// Chữ trên nút (bỏ tên icon Material Symbols)
function visibleText(el) {
  const c = el.cloneNode(true);
  c.querySelectorAll('.ms, [aria-hidden="true"]').forEach(n => n.remove());
  return c.textContent;
}

let sayId = 0;
function say(text, opts = {}) {
  const { force = false } = opts;
  if (!text || (!S.voice.on && !force)) return;
  if (useGocareVoice()) {
    const id = ++sayId;
    if ('speechSynthesis' in window) speechSynthesis.cancel();
    player.pause();
    player.src = `${bridgeBase()}/api/tts?speed=${S.voice.rate}&text=${encodeURIComponent(clean(text).slice(0, 400))}`;
    player.play().catch(err => {
      // Trình duyệt chặn tự phát khi chưa chạm màn hình → im lặng; lỗi khác → đọc bằng giọng của máy
      if (id === sayId && err.name !== 'NotAllowedError' && err.name !== 'AbortError') systemSay(text, opts);
    });
    return;
  }
  systemSay(text, opts);
}

function systemSay(text, { queue = false } = {}) {
  if (!('speechSynthesis' in window)) return;
  player.pause();
  if (!queue) speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(clean(text));
  u.lang = 'vi-VN';
  if (viVoice) u.voice = viVoice;
  u.rate = S.voice.rate;   // chậm rãi
  u.pitch = 1.05;          // ấm, không gắt
  u.volume = 0.9;
  u.onstart = () => document.body.classList.add('speaking');
  u.onend = u.onerror = () => { if (!speechSynthesis.speaking) document.body.classList.remove('speaking'); };
  speechSynthesis.speak(u);
}

// Đọc to mọi thứ được bấm (chạy trước các xử lý khác — xử lý sau có thể đọc câu riêng thay thế)
document.addEventListener('click', e => {
  const el = e.target.closest('button, a, label.check, summary, [data-say]');
  if (!el || el.disabled) return;
  let text;
  if (el.dataset.sayFn && SAY_FN[el.dataset.sayFn]) text = SAY_FN[el.dataset.sayFn]();
  else if (el.dataset.say !== undefined) text = el.dataset.say;
  else text = el.getAttribute('aria-label') || visibleText(el);
  if (text) say(text);
}, true);

document.addEventListener('focusin', e => {
  if (!e.target.matches('input, select')) return;
  const label = e.target.closest('label')?.querySelector('span')?.textContent;
  if (label) say(label);
});

const SAY_FN = {
  clock: () => `Bây giờ là ${spokenTime(new Date())}, ${spokenDate(new Date())}`,
  hello: () => {
    const next = nextDose();
    const medText = next ? `Thuốc kế tiếp là ${next.med.name}, ${next.med.dose}, lúc ${spokenHM(next.time)}.` : 'Hôm nay bạn đã uống đủ thuốc rồi.';
    return `${greeting().text} ${S.profile.name}. Bây giờ là ${spokenTime(new Date())}. ${medText}`;
  },
};

// ======================= ÂM THANH =======================

let ac = null;
function audio() {
  try {
    ac ||= new (window.AudioContext || window.webkitAudioContext)();
    if (ac.state === 'suspended') ac.resume();
  } catch { ac = null; }
  return ac;
}
document.addEventListener('pointerdown', audio, { once: true });

function tone(freq, start, dur, type = 'sine', vol = 0.35) {
  const ctx = audio(); if (!ctx) return;
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type; o.frequency.value = freq;
  g.gain.setValueAtTime(0.0001, ctx.currentTime + start);
  g.gain.exponentialRampToValueAtTime(vol, ctx.currentTime + start + 0.04);
  g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + start + dur);
  o.connect(g).connect(ctx.destination);
  o.start(ctx.currentTime + start); o.stop(ctx.currentTime + start + dur + 0.05);
}
// Chuông nhắc êm (đô – mi – son), âm lượng nhỏ
const chime = () => { tone(523, 0, 0.9, 'sine', 0.16); tone(659, 0.28, 0.9, 'sine', 0.14); tone(784, 0.56, 1.3, 'sine', 0.12); };
const beep = () => tone(740, 0, 0.16, 'sine', 0.18);
let sirenTimer = null;
function siren(on) {
  clearInterval(sirenTimer); sirenTimer = null;
  if (!on) return;
  const wail = () => { tone(960, 0, 0.35, 'sawtooth', 0.2); tone(720, 0.4, 0.35, 'sawtooth', 0.2); };
  wail(); sirenTimer = setInterval(wail, 800);
}
function vibrate(p) { try { navigator.vibrate?.(p); } catch { /* bỏ qua */ } }

// ======================= HIỆU ỨNG =======================

document.addEventListener('pointerdown', e => {
  const el = e.target.closest('.btn, .status, .seg button, .tabbar button, .voice-toggle, .choice button, .keypad button, .sos, .back');
  if (!el) return;
  const r = el.getBoundingClientRect(), size = Math.max(r.width, r.height) * 2.2;
  const dot = document.createElement('span');
  dot.className = 'ripple';
  dot.style.cssText = `width:${size}px;height:${size}px;left:${e.clientX - r.left - size / 2}px;top:${e.clientY - r.top - size / 2}px`;
  el.appendChild(dot);
  setTimeout(() => dot.remove(), 650);
});

function stagger(root) {
  [...root.children].forEach((c, i) => { c.style.setProperty('--i', i); c.style.animation = 'none'; void c.offsetWidth; c.style.animation = ''; });
  $$(':is(.dose-list, .list, .cam-list) > *', root).forEach((c, i) => c.style.setProperty('--i', i % 8));
  root.classList.add('entering');
  clearTimeout(root._enterTimer);
  root._enterTimer = setTimeout(() => root.classList.remove('entering'), 1600);
}

function burst(x = innerWidth / 2, y = innerHeight / 2) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const bits = ['favorite', 'star', 'check_circle', 'auto_awesome', 'celebration', 'spa'];
  for (let i = 0; i < 14; i++) {
    const s = document.createElement('span');
    const a = (i / 14) * Math.PI * 2, d = 90 + Math.random() * 90;
    s.className = 'burst ms fill';
    s.textContent = bits[i % bits.length];
    s.style.cssText = `left:${x - 15}px;top:${y - 15}px;--dx:${Math.cos(a) * d}px;--dy:${Math.sin(a) * d - 40}px;--r:${Math.random() * 360 - 180}deg;color:${['#2e6b47', '#c5a059', '#0d5c58', '#426086'][i % 4]}`;
    document.body.appendChild(s);
    setTimeout(() => s.remove(), 1050);
  }
}

// ======================= TIỆN ÍCH THỜI GIAN =======================

const pad = n => String(n).padStart(2, '0');
const todayKey = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const hm = d => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const WEEKDAYS = ['Chủ nhật', 'Thứ hai', 'Thứ ba', 'Thứ tư', 'Thứ năm', 'Thứ sáu', 'Thứ bảy'];
function spokenHM(t) { const [h, m] = t.split(':').map(Number); return m ? `${h} giờ ${m} phút` : `${h} giờ`; }
function spokenTime(d) { return spokenHM(hm(d)); }
function spokenDate(d) { return `${WEEKDAYS[d.getDay()]}, ngày ${d.getDate()} tháng ${d.getMonth() + 1}`; }
function atToday(t) { const [h, m] = t.split(':').map(Number); const d = new Date(); d.setHours(h, m, 0, 0); return d; }
function greeting(h = new Date().getHours()) {
  if (h >= 5 && h < 11) return { text: 'Chào buổi sáng', icon: 'light_mode', eyebrow: 'Buổi sáng an lành' };
  if (h >= 11 && h < 13) return { text: 'Chào buổi trưa', icon: 'wb_sunny', eyebrow: 'Nghỉ trưa thư thái' };
  if (h >= 13 && h < 18) return { text: 'Chào buổi chiều', icon: 'wb_twilight', eyebrow: 'Buổi chiều nhẹ nhàng' };
  return { text: 'Chào buổi tối', icon: 'bedtime', eyebrow: 'Buổi tối bình yên' };
}
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function uid() { return Math.random().toString(36).slice(2, 10); }

// ======================= ĐIỀU HƯỚNG =======================

function go(name) {
  $$('.screen').forEach(s => s.classList.toggle('active', s.id === `screen-${name}`));
  const tabs = $$('#tabbar button');
  tabs.forEach(b => b.classList.toggle('active', b.dataset.go === name));
  $('#tabbar').style.setProperty('--tab', Math.max(0, tabs.findIndex(b => b.dataset.go === name)));
  stagger($(`#screen-${name}`));
  window.scrollTo({ top: 0 });
  if (name === 'safety') { refreshBridge(true); refreshCams(); }
}
document.addEventListener('click', e => {
  const el = e.target.closest('[data-go]');
  if (el) go(el.dataset.go);
});

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.hidden = false;
  t.style.animation = 'none'; void t.offsetWidth; t.style.animation = '';
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 4000);
}

// ======================= LỚP PHỦ =======================

let current = null;
function showOverlay(kind, html, cls = '', cleanup = null) {
  closeOverlay();
  const box = $('#overlayBox');
  box.className = `overlay-box ${cls}`;
  box.innerHTML = html;
  $('#overlay').hidden = false;
  current = { kind, cleanup };
  box.querySelector('button')?.focus({ preventScroll: true });
}
function closeOverlay() {
  if (current?.cleanup) current.cleanup();
  current = null;
  siren(false);
  $('#overlay').hidden = true;
}

// ======================= KẾT NỐI BRIDGE =======================

// Home Hub = máy tính ở nhà chạy camera AI + giọng đọc (bridge/server.js). Trên Vercel thì nhập địa chỉ Home Hub trong Hồ sơ.
function bridgeBase() {
  const custom = S.link.bridgeUrl || readLocal('gocare.server');
  if (custom) return custom.replace(/\/+$/, '');
  return location.protocol.startsWith('http') ? location.origin : '';
}
function authHeaders() { return session?.token ? { Authorization: `Bearer ${session.token}` } : {}; }

async function api(path, { method = 'GET', body, timeout = 8000, base: forcedBase } = {}) {
  const base = forcedBase ?? bridgeBase();
  if (!base) throw new Error('Chưa cài địa chỉ máy chủ');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(base + path, {
      method, signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { const err = new Error(data.error || `Lỗi ${res.status}`); Object.assign(err, data, { status: res.status }); throw err; }
    return data;
  } finally { clearTimeout(timer); }
}

function getLocation(timeout = 5000) {
  return new Promise(resolve => {
    if (!navigator.geolocation) return resolve({});
    navigator.geolocation.getCurrentPosition(
      p => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: Math.round(p.coords.accuracy) }),
      () => resolve({}), { enableHighAccuracy: true, timeout, maximumAge: 30000 });
  });
}

async function sendEmergency(payload) {
  const p = S.profile;
  const body = {
    patientName: p.name, phone: p.phone, familyPhone: p.familyPhone, address: p.address,
    source: 'app', ...payload, clientTime: new Date().toISOString(),
  };
  try {
    // Đơn cấp cứu luôn gửi qua chính máy chủ của app (Vercel /api/emergency hoặc Home Hub)
    if (sb) { const { data } = await sb.auth.getSession(); if (data.session) session = toSession(data.session); }
    const r = await api('/api/emergency', { method: 'POST', body, base: location.origin, timeout: 12000 });
    if (r.ok === false) throw new Error(r.alert?.error || 'Không tạo được đơn');
    S.sentAlerts = [{ ...r.alert, type: payload.type, createdAt: new Date().toISOString() }, ...(S.sentAlerts || [])].slice(0, 30);
    linkState = { ok: true, mode: 'supabase' };
    save(); renderStatus();
    return { ok: true, alert: r.alert };
  } catch (e) {
    S.pending.push(body); save(); renderStatus();
    return { ok: false, error: e.message };
  }
}

async function flushPending() {
  if (!S.pending.length) return;
  const queue = [...S.pending];
  S.pending = [];
  for (const body of queue) {
    try { await api('/api/emergency', { method: 'POST', base: location.origin, body: { ...body, note: `${body.note || ''} (gửi lại sau khi mất mạng)`.trim() } }); }
    catch { S.pending.push(body); }
  }
  save(); renderStatus();
}

function callLinks() {
  const p = S.profile, em = esc(p.emergencyPhone || '115');
  return `
    <a class="btn danger" href="tel:${em}" data-say="Gọi cấp cứu ${em}">${ms('call', true)} Gọi cấp cứu ${em}</a>
    ${p.familyPhone ? `<a class="btn primary" href="tel:${esc(p.familyPhone)}" data-say="Gọi ${esc(p.familyName || 'người thân')}">${ms('family_restroom', true)} Gọi ${esc(p.familyName || 'người thân')}</a>` : ''}`;
}

// ======================= NÚT SOS =======================

$('#sosBtn').addEventListener('click', startSOS);

function startSOS() {
  if (current?.kind === 'sos') return;
  let n = 5, timer;
  showOverlay('sos', `
    <div class="ov-title">Sắp gọi cấp cứu</div>
    <div class="ov-count" id="sosCount" style="--p:1"><span>${n}</span></div>
    <p class="ov-text">Bệnh viện sẽ được báo khi đếm về 0</p>
    <button class="btn danger" id="sosNow" data-say="Gọi ngay">${ms('e911_emergency', true)} GỌI NGAY</button>
    <button class="btn" id="sosCancel" data-say="Hủy">${ms('close')} Hủy — tôi bấm nhầm</button>`, '', () => clearInterval(timer));
  say('Sẽ gọi cấp cứu sau 5 giây. Nếu bấm nhầm, bạn bấm nút Hủy nhé.');
  vibrate([200, 100, 200]);
  timer = setInterval(() => {
    n--; beep();
    const c = $('#sosCount');
    if (c) {
      c.querySelector('span').textContent = n;
      c.style.setProperty('--p', n / 5);
      c.classList.remove('tick'); void c.offsetWidth; c.classList.add('tick');
    }
    if (n <= 0) { clearInterval(timer); fireSOS(); }
  }, 1000);
  $('#sosNow').onclick = () => { clearInterval(timer); fireSOS(); };
  $('#sosCancel').onclick = () => { closeOverlay(); say('Đã hủy gọi cấp cứu. Bạn vẫn an toàn.'); };
}

async function fireSOS() {
  showOverlay('sos', `<div class="ov-ico">${ms('cell_tower', true)}</div><div class="ov-title">Đang báo bệnh viện…</div><p class="ov-text">Xin giữ bình tĩnh</p>`, 'alarm');
  say('Đang báo bệnh viện và người thân. Bạn cứ bình tĩnh nhé.');
  siren(true);
  const loc = await getLocation(4000);
  const r = await sendEmergency({ type: 'sos', ...loc, note: 'Bệnh nhân tự bấm nút cấp cứu trên app.' });
  siren(false);
  const p = S.profile;
  showOverlay('sos', `
    <div class="ov-ico">${ms(r.ok ? 'verified' : 'wifi_off', true)}</div>
    <div class="ov-title">${r.ok ? 'Bệnh viện đã nhận báo động' : 'Chưa gửi được qua mạng'}</div>
    <p class="ov-text">${r.ok ? 'Nhân viên y tế đang xử lý. Hãy ngồi hoặc nằm nghỉ ở chỗ an toàn.' : 'App sẽ tự gửi lại khi có mạng. Hãy GỌI ĐIỆN ngay bằng nút dưới.'}</p>
    ${callLinks()}
    <button class="btn" id="ovClose" data-say="Đóng">Đóng</button>`, r.ok ? '' : 'remind');
  $('#ovClose').onclick = closeOverlay;
  say(r.ok ? 'Bệnh viện đã nhận báo động rồi. Nhân viên y tế đang xử lý. Bạn ngồi nghỉ ở chỗ an toàn nhé.'
           : 'Chưa gửi được qua mạng. Đang gọi điện cấp cứu cho bạn.');
  if (p.autoDial || !r.ok) setTimeout(() => { location.href = `tel:${p.emergencyPhone || '115'}`; }, 2500);
}

// ======================= THUỐC =======================

function dayLog(key = todayKey()) { return (S.log[key] ||= {}); }

let lastTap = { x: innerWidth / 2, y: innerHeight / 2 }, justTaken = null;
document.addEventListener('pointerdown', e => { lastTap = { x: e.clientX, y: e.clientY }; }, true);

function dosesToday() {
  const now = Date.now(), log = dayLog();
  const list = [];
  for (const med of S.meds) for (const time of med.times) {
    const key = `${med.id}@${time}`, at = atToday(time).getTime();
    let status = 'upcoming';
    if (log[key]?.status === 'taken') status = 'taken';
    else if (now > at + 60 * 60000) status = 'missed';
    else if (now >= at) status = 'due';
    list.push({ med, time, key, at, status });
  }
  return list.sort((a, b) => a.at - b.at);
}
function nextDose() { return dosesToday().find(d => d.status === 'due' || d.status === 'upcoming'); }

function markTaken(key) {
  const d = dosesToday().find(x => x.key === key);
  dayLog()[key] = { status: 'taken', at: new Date().toISOString() };
  delete S.snooze[key];
  justTaken = key;
  save(); renderMeds(); renderHome();
  if (current?.kind === 'remind') closeOverlay();
  chime(); burst(lastTap.x, lastTap.y);
  say(`Đã ghi nhận uống ${d ? d.med.name : 'thuốc'}. Bạn giỏi lắm!`);
}

function renderMeds() {
  const doses = dosesToday();
  const done = doses.filter(d => d.status === 'taken').length;
  const frac = doses.length ? done / doses.length : 0;
  const prevW = $('#medProgress .bar i')?.style.width || '0%';
  $('#medProgress').innerHTML = `
    <div class="gc-top"><span class="gc-label">Thuốc hôm nay</span><span class="gc-pill">${WEEKDAYS[new Date().getDay()]}</span></div>
    <div class="gc-big">${doses.length ? `${done}/${doses.length} lần` : 'Chưa có thuốc'}</div>
    <div class="bar"><i style="width:${prevW}"></i></div>
    <div class="gc-foot"><span>${frac === 1 && doses.length ? 'Tuyệt vời, đã uống đủ!' : `${done} đã uống`}</span><span>${doses.length - done} còn lại</span></div>`;
  $('#medProgress').dataset.say = `Hôm nay đã uống ${done} trên ${doses.length} lần thuốc`;
  requestAnimationFrame(() => { const b = $('#medProgress .bar i'); if (b) b.style.width = `${frac * 100}%`; });

  $('#todayDoses').innerHTML = doses.map(d => `
    <div class="dose ${d.status}">
      <span class="d-time">${d.time}</span>
      <span><span class="d-name">${esc(d.med.icon)} ${esc(d.med.name)}</span><br><span class="d-dose">${esc(d.med.dose)} · ${esc(d.med.note)}</span></span>
      ${d.status === 'taken' ? `<span class="tag ok ${d.key === justTaken ? 'pop' : ''}">${ms('check_circle', true)} Đã uống</span>`
        : `<button class="btn ${d.status === 'upcoming' ? '' : 'okay'}" data-take="${d.key}" data-say="Đã uống ${esc(d.med.name)}">${ms('check')} ${d.status === 'missed' ? 'Quên — uống bù' : 'Đã uống'}</button>`}
    </div>`).join('') || '<p class="empty">Không có lịch uống thuốc hôm nay</p>';
  justTaken = null;

  $('#medList').innerHTML = S.meds.map(m => li({
    icon: `<span>${esc(m.icon)}</span>`, color: medColor(m), title: esc(m.name),
    sub: `${esc(m.dose)} · ${esc(m.note)}`, end: m.times.join(' · '), endSub: `${m.times.length} lần/ngày`,
    tag: 'button', attrs: `data-edit-med="${m.id}" data-say="Sửa ${esc(m.name)}"`,
  })).join('') || '<p class="empty">Chưa có thuốc</p>';
}
$('#addMedTop').addEventListener('click', () => openMedSheet(null));

document.addEventListener('click', e => {
  const take = e.target.closest('[data-take]');
  if (take) markTaken(take.dataset.take);
  const edit = e.target.closest('[data-edit-med]');
  if (edit) openMedSheet(S.meds.find(m => m.id === edit.dataset.editMed));
});
$('#addMedBtn').addEventListener('click', () => openMedSheet(null));

const PILL_ICONS = ['💊', '🔵', '🟡', '🟢', '🔴', '⚪', '🟠', '🟣', '💉', '🧴', '🍵', '🩹'];
const NOTES = ['Sau ăn', 'Trước ăn', 'Trong bữa ăn', 'Trước khi ngủ', 'Bất kỳ lúc nào'];

function openMedSheet(med) {
  const m = med ? structuredClone(med) : { id: uid(), name: '', dose: '1 viên', times: ['08:00'], note: 'Sau ăn', icon: '💊' };
  const sheet = $('#sheet'), form = $('#sheetForm');
  const draw = () => {
    form.innerHTML = `
      <h2>${med ? 'Sửa thuốc' : 'Thêm thuốc mới'}</h2>
      <label class="field"><span>Tên thuốc</span><input name="name" required value="${esc(m.name)}" placeholder="Ví dụ: Amlodipin 5mg"></label>
      <label class="field"><span>Liều mỗi lần</span><input name="dose" value="${esc(m.dose)}" placeholder="1 viên"></label>
      <p class="label">Giờ uống</p>
      <div class="chips">${m.times.map(t => `<button type="button" class="chip" data-rm-time="${t}" data-say="Xóa giờ ${spokenHM(t)}">${t} ${ms('close')}</button>`).join('')}</div>
      <div class="seg">
        <button type="button" data-add-time="07:00">Sáng 7h</button><button type="button" data-add-time="12:00">Trưa 12h</button>
        <button type="button" data-add-time="17:00">Chiều 5h</button><button type="button" data-add-time="20:00">Tối 8h</button>
      </div>
      <div class="row" style="margin-top:10px;align-items:end"><label class="field"><span>Giờ khác</span><input type="time" id="otherTime"></label>
        <button type="button" class="btn" id="addOtherTime" style="margin-bottom:14px" data-say="Thêm giờ này">${ms('add')} Thêm</button></div>
      <label class="field"><span>Cách uống</span><select name="note">${NOTES.map(n => `<option ${n === m.note ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
      <p class="label">Hình viên thuốc</p>
      <div class="pick">${PILL_ICONS.map(i => `<button type="button" data-icon="${i}" aria-pressed="${i === m.icon}" data-say="Chọn hình">${i}</button>`).join('')}</div>
      <button class="btn big primary full" type="submit" data-say="Lưu thuốc">${ms('save')} Lưu</button>
      ${med ? `<button class="btn danger full" type="button" id="delMed" data-say="Xóa thuốc này">${ms('delete')} Xóa thuốc này</button>` : ''}
      <button class="btn full" type="button" id="closeSheet" data-say="Đóng">Đóng</button>`;
  };
  const sync = () => { m.name = form.name.value.trim(); m.dose = form.dose.value.trim(); m.note = form.note.value; };
  draw();
  form.onclick = e => {
    const t = e.target.closest('button'); if (!t) return;
    if (t.dataset.addTime || t.id === 'addOtherTime') {
      sync();
      const v = t.dataset.addTime || $('#otherTime').value;
      if (v && !m.times.includes(v)) { m.times.push(v); m.times.sort(); }
      draw();
    } else if (t.dataset.rmTime) { sync(); m.times = m.times.filter(x => x !== t.dataset.rmTime); draw(); }
    else if (t.dataset.icon) { sync(); m.icon = t.dataset.icon; draw(); }
    else if (t.id === 'delMed') {
      if (confirm(`Xóa thuốc "${m.name}"?`)) { S.meds = S.meds.filter(x => x.id !== m.id); save(); sheet.close(); renderMeds(); renderHome(); say('Đã xóa thuốc'); }
    } else if (t.id === 'closeSheet') sheet.close();
  };
  form.onsubmit = e => {
    e.preventDefault(); sync();
    if (!m.name) { say('Bạn nhập tên thuốc nhé'); form.name.focus(); return; }
    if (!m.times.length) { say('Bạn chọn ít nhất một giờ uống nhé'); return; }
    const i = S.meds.findIndex(x => x.id === m.id);
    if (i >= 0) S.meds[i] = m; else S.meds.push(m);
    save(); sheet.close(); renderMeds(); renderHome();
    say(`Đã lưu ${m.name}, uống lúc ${m.times.map(spokenHM).join(', ')}`);
  };
  sheet.showModal();
}

// ---- Nhắc giờ uống thuốc ----
const lastNag = {};
function checkReminders() {
  const now = Date.now();
  for (const d of dosesToday()) {
    if (d.status !== 'due') continue;
    if ((S.snooze[d.key] || 0) > now) continue;
    if (lastNag[d.key] && now - lastNag[d.key] < 5 * 60000) continue;
    if (current) { notify(`Đến giờ uống ${d.med.name}`, `${d.med.dose} · ${d.med.note}`, d.key); continue; }
    lastNag[d.key] = now;
    showMedReminder(d);
    return;
  }
  for (const a of S.appts) {
    const at = new Date(a.at).getTime();
    for (const [flag, before, label] of [['d1', 86400000, 'ngày mai'], ['h1', 3600000, 'một giờ nữa']]) {
      if (!a[flag] && now >= at - before && now < at) {
        a[flag] = true; save();
        if (!current) showApptReminder(a, label); else notify('Lịch hẹn khám', a.title, a.id);
        return;
      }
    }
  }
}

function showMedReminder(d) {
  let voiceTimer;
  const speak = () => say(`Đến giờ uống thuốc rồi ạ. ${d.med.name}, ${d.med.dose}, ${d.med.note}. Uống xong, bạn bấm nút Đã uống nhé.`);
  showOverlay('remind', `
    <div class="ov-ico">${ms('medication', true)}</div>
    <div class="ov-title">Đến giờ uống thuốc</div>
    <p class="ov-big">${esc(d.med.icon)} ${esc(d.med.name)}</p>
    <p class="ov-text">${esc(d.med.dose)} · ${esc(d.med.note)} · ${d.time}</p>
    <button class="btn okay" id="rmTaken" data-say="">${ms('check_circle', true)} ĐÃ UỐNG</button>
    <button class="btn" id="rmSnooze" data-say="">${ms('snooze')} Nhắc lại sau 10 phút</button>`, 'remind', () => clearInterval(voiceTimer));
  chime(); vibrate([300, 200, 300]); speak();
  voiceTimer = setInterval(() => { chime(); speak(); }, 45000);
  notify('Đến giờ uống thuốc', `${d.med.name} — ${d.med.dose}`, d.key);
  $('#rmTaken').onclick = () => markTaken(d.key);
  $('#rmSnooze').onclick = () => {
    S.snooze[d.key] = Date.now() + 10 * 60000; save(); closeOverlay();
    say('Dạ, 10 phút nữa sẽ nhắc lại ạ.');
  };
}

function showApptReminder(a, label) {
  showOverlay('remind', `
    <div class="ov-ico">${ms('event_available', true)}</div><div class="ov-title">Lịch hẹn khám ${label}</div>
    <p class="ov-big">${esc(a.title)}</p>
    <p class="ov-text">${new Date(a.at).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', weekday: 'long', day: 'numeric', month: 'numeric' })}${a.place ? ' · ' + esc(a.place) : ''}</p>
    <button class="btn okay" id="apOk" data-say="Đã biết">${ms('thumb_up', true)} Tôi đã biết</button>`, 'remind');
  chime();
  say(`Nhắc lịch hẹn ạ: ${a.title}, ${label}, lúc ${spokenTime(new Date(a.at))}. ${a.place ? 'Tại ' + a.place : ''}`);
  $('#apOk').onclick = closeOverlay;
}

function notify(title, body, tag) {
  if (!('Notification' in window) || Notification.permission !== 'granted' || !document.hidden) return;
  navigator.serviceWorker?.ready.then(reg => reg.showNotification(title, {
    body, tag, renotify: true, requireInteraction: true, icon: 'icon.svg', badge: 'icon.svg', vibrate: [400, 200, 400],
  })).catch(() => {});
}

// ======================= CAMERA THẬT =======================

let cams = [];
let camTimer = null;
const camUrls = {};

async function refreshCams() {
  try {
    cams = await api('/api/cameras', { timeout: 6000 });
    $('#camInfo').textContent = '';
  } catch (e) {
    cams = [];
    $('#camInfo').textContent = 'Camera AI chạy trên máy tính ở nhà (GoCare Home Hub). Vào Hồ sơ → Kết nối bệnh viện để nhập địa chỉ Home Hub.';
  }
  renderCams(); renderStatus();
}

function camState(c) {
  if (c.running && c.online) return { cls: 'ok', text: 'Đang canh chừng', icon: 'visibility' };
  if (c.running) return { cls: 'warn', text: 'Đang khởi động…', icon: 'hourglass_top' };
  if (c.error) return { cls: 'bad', text: 'Lỗi', icon: 'error' };
  return { cls: 'off', text: 'Đã tắt', icon: 'videocam_off' };
}

function renderCams() {
  const box = $('#camList');
  const keep = {};
  box.querySelectorAll('[data-cam-img]').forEach(img => { keep[img.dataset.camImg] = img.src; });
  box.innerHTML = cams.map(c => {
    const st = camState(c);
    const src = c.source === '0' || /^\d+$/.test(c.source) ? `Webcam số ${c.source}` : c.source.replace(/\/\/[^@/]+@/, '//•••@');
    return `
    <div class="cam">
      <div class="cam-view">
        ${c.running ? `<span class="cam-live"><i></i>TRỰC TIẾP</span>` : ''}
        ${c.running && keep[c.id] ? `<img data-cam-img="${c.id}" src="${keep[c.id]}" alt="">` : c.running ? `<img data-cam-img="${c.id}" alt="" hidden>` : ''}
        <span class="placeholder">${ms(c.running ? 'hourglass_top' : 'videocam_off')}${c.running ? 'Đang mở camera…' : 'Camera đang tắt'}</span>
      </div>
      <div class="cam-body">
        <div class="cam-title"><b>${esc(c.name)}</b><span class="tag ${st.cls}">${ms(st.icon, true)} ${st.text}</span></div>
        <div class="cam-src">${esc(src)}${c.zone ? ' · có vùng an toàn trong nhà' : ''}</div>
        ${c.error ? `<div class="cam-log">${esc(c.error)}</div>` : ''}
        <div class="cam-actions">
          ${c.running
            ? `<button class="btn" data-cam-stop="${c.id}" data-say="Tắt camera ${esc(c.name)}">${ms('stop_circle')} Tắt camera</button>`
            : `<button class="btn primary" data-cam-start="${c.id}" data-say="Bật camera ${esc(c.name)}">${ms('play_circle')} Bật canh chừng</button>`}
          <button class="icon-btn red" data-cam-del="${c.id}" data-say="Xóa camera ${esc(c.name)}" aria-label="Xóa camera">${ms('delete')}</button>
        </div>
      </div>
    </div>`;
  }).join('') || `<p class="empty">Chưa cài camera nào. Bấm “Cài camera mới” để dùng webcam máy tính hoặc camera IP trong nhà.</p>`;
  syncCamFeed();
}

// Hình trực tiếp: lấy khung hình mới nhất từ bridge khoảng mỗi giây khi đang ở màn hình An toàn
function syncCamFeed() {
  const active = $('#screen-safety').classList.contains('active') && cams.some(c => c.running);
  if (active && !camTimer) camTimer = setInterval(pullFrames, 1000);
  if (!active && camTimer) { clearInterval(camTimer); camTimer = null; }
}
async function pullFrames() {
  if (!$('#screen-safety').classList.contains('active')) return syncCamFeed();
  for (const img of $$('[data-cam-img]')) {
    const id = img.dataset.camImg;
    try {
      const res = await fetch(`${bridgeBase()}/api/frame/${encodeURIComponent(id)}?t=${Date.now()}`, { headers: authHeaders(), cache: 'no-store' });
      if (!res.ok) continue;
      const url = URL.createObjectURL(await res.blob());
      if (camUrls[id]) URL.revokeObjectURL(camUrls[id]);
      camUrls[id] = url;
      img.src = url; img.hidden = false;
    } catch { /* thử lại lần sau */ }
  }
}

async function camAction(path, method, okMsg) {
  try { await api(path, { method, timeout: 15000 }); say(okMsg); }
  catch (e) { say('Chưa làm được. ' + e.message); toast(e.message); }
  refreshCams();
}

document.addEventListener('click', e => {
  const s = e.target.closest('[data-cam-start]'), t = e.target.closest('[data-cam-stop]'), d = e.target.closest('[data-cam-del]');
  if (s) camAction(`/api/cameras/${s.dataset.camStart}/start`, 'POST', 'Đang bật camera. Khoảng mười giây là hình hiện lên ạ.');
  if (t) camAction(`/api/cameras/${t.dataset.camStop}/stop`, 'POST', 'Đã tắt camera.');
  if (d && confirm('Xóa camera này?')) camAction(`/api/cameras/${d.dataset.camDel}`, 'DELETE', 'Đã xóa camera.');
});

$('#addCamBtn').addEventListener('click', () => {
  const sheet = $('#sheet'), form = $('#sheetForm');
  const c = { kind: 'webcam', index: '0' };
  const draw = () => {
    form.innerHTML = `
      <h2>Cài camera mới</h2>
      <label class="field"><span>Tên camera (đặt ở đâu?)</span><input name="name" value="${esc(form.name?.value || 'Phòng khách')}"></label>
      <p class="label">Loại camera</p>
      <div class="choice">
        <button type="button" data-kind="webcam" aria-pressed="${c.kind === 'webcam'}" data-say="Webcam gắn máy tính">${ms('desktop_windows')}Webcam máy tính</button>
        <button type="button" data-kind="ip" aria-pressed="${c.kind === 'ip'}" data-say="Camera IP wifi trong nhà">${ms('nest_cam_wired_stand')}Camera IP / Wi-Fi</button>
      </div>
      ${c.kind === 'webcam' ? `
        <p class="label">Webcam số mấy?</p>
        <div class="seg">${['0', '1', '2'].map(i => `<button type="button" data-index="${i}" aria-pressed="${c.index === i}">${i === '0' ? 'Webcam chính' : 'Số ' + i}</button>`).join('')}</div>`
      : `<label class="field"><span>Link RTSP của camera</span><input name="url" value="${esc(c.url || '')}" placeholder="rtsp://user:matkhau@192.168.1.20:554/stream1"></label>
         <p class="muted small">Xem trong app của camera (Imou, Ezviz, TP-Link Tapo…) → mục RTSP / ONVIF.</p>`}
      <label class="check" style="margin-top:14px"><input type="checkbox" name="zone" ${c.zone ? 'checked' : ''}> Báo động khi bệnh nhân rời khỏi khu vực giữa khung hình</label>
      <button class="btn big primary full" type="submit" data-say="Lưu và bật camera">${ms('videocam', true)} Lưu & bật camera</button>
      <button class="btn full" type="button" id="closeSheet" data-say="Đóng">Đóng</button>`;
  };
  const sync = () => { c.name = form.name.value; if (form.url) c.url = form.url.value.trim(); c.zone = form.zone.checked; };
  draw();
  form.onclick = e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.kind) { sync(); c.kind = b.dataset.kind; draw(); form.name.value = c.name; }
    else if (b.dataset.index) { sync(); c.index = b.dataset.index; draw(); form.name.value = c.name; }
    else if (b.id === 'closeSheet') sheet.close();
  };
  form.onsubmit = async e => {
    e.preventDefault(); sync();
    const source = c.kind === 'webcam' ? c.index : c.url;
    if (!source || (c.kind === 'ip' && !/^(rtsp|https?):\/\//i.test(source))) { say('Bạn nhập link RTSP của camera nhé'); return; }
    const p = S.profile;
    try {
      const cam = await api('/api/cameras', { method: 'POST', timeout: 15000, body: {
        name: c.name || 'Camera', source,
        zone: c.zone ? '0.12,0.05;0.88,0.05;0.88,0.98;0.12,0.98' : '',
        patientName: p.name, phone: p.phone || p.familyPhone, address: p.address,
      } });
      sheet.close();
      await api(`/api/cameras/${cam.id}/start`, { method: 'POST', timeout: 15000 });
      say(`Đã cài ${cam.name}. Camera đang mở, khoảng mười giây là hình hiện lên ạ.`);
    } catch (err) { say('Chưa cài được camera. ' + err.message); toast(err.message); }
    refreshCams();
  };
  sheet.showModal();
});

// ======================= VÙNG AN TOÀN (GPS) =======================

let watchId = null;
const zone = { dist: null, acc: null, outsideCount: 0, outside: false, snoozeUntil: 0, alarm: false, error: null };

function haversine(a, b) {
  const R = 6371000, rad = x => x * Math.PI / 180;
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

async function setHome() {
  say('Đang lấy vị trí hiện tại');
  const loc = await getLocation(10000);
  if (loc.lat == null) { say('Không lấy được vị trí. Bạn cho phép app dùng vị trí nhé.'); toast('Không lấy được vị trí — hãy bật GPS và cho phép truy cập vị trí'); return false; }
  S.zone.home = { lat: loc.lat, lng: loc.lng };
  save(); renderSafety(); renderStatus();
  say('Đã lưu vị trí nhà');
  return true;
}

async function startZone() {
  if (!navigator.geolocation) { say('Máy không hỗ trợ định vị'); return; }
  if (!S.zone.home && !(await setHome())) return;
  S.zone.on = true; save();
  watchId = navigator.geolocation.watchPosition(onPosition, err => {
    zone.error = err.code === 1 ? 'Chưa cho phép dùng vị trí' : 'Không bắt được GPS';
    renderSafety(); renderStatus();
  }, { enableHighAccuracy: true, maximumAge: 15000, timeout: 30000 });
  requestWakeLock();
  renderSafety(); renderStatus();
}
function stopZone() {
  S.zone.on = false; save();
  if (watchId != null) navigator.geolocation.clearWatch(watchId);
  watchId = null; zone.outside = false; zone.outsideCount = 0;
  renderSafety(); renderStatus();
}

function onPosition(p) {
  zone.error = null;
  const here = { lat: p.coords.latitude, lng: p.coords.longitude };
  zone.acc = Math.round(p.coords.accuracy);
  zone.dist = haversine(S.zone.home, here);
  const outsideNow = zone.dist - Math.min(zone.acc, 100) > S.zone.radius;
  zone.outsideCount = outsideNow ? zone.outsideCount + 1 : 0;
  const wasOutside = zone.outside;
  zone.outside = zone.outsideCount >= 2;
  if (zone.outside && !zone.alarm && Date.now() > zone.snoozeUntil) zoneAlarm({ ...here, accuracy: zone.acc });
  if (wasOutside && !zone.outside) { say('Bạn đã về trong vùng an toàn rồi.'); toast('Đã về trong vùng an toàn'); }
  renderSafety(); renderStatus();
}

function zoneAlarm(loc, test = false) {
  zone.alarm = true;
  let n = 60, voiceTimer, countTimer;
  const dist = Math.round(zone.dist ?? 0);
  showOverlay('zone', `
    <div class="ov-ico">${ms('wrong_location', true)}</div>
    <div class="ov-title">${test ? 'Thử — ' : ''}Bạn đang ở xa nhà</div>
    <p class="ov-text">${test ? 'Đây là báo động thử.' : `Cách nhà khoảng ${dist} m.`} Nếu không bấm, sau <b id="zCount">${n}</b> giây app sẽ báo bệnh viện và người thân.</p>
    <button class="btn okay" id="zOk" data-say="">${ms('sentiment_satisfied', true)} TÔI VẪN ỔN</button>
    ${callLinks()}`, 'alarm', () => { clearInterval(voiceTimer); clearInterval(countTimer); zone.alarm = false; });
  const speak = () => say('Chú ý nhé. Bạn đang ra khỏi vùng an toàn. Nếu bạn vẫn ổn, hãy bấm nút Tôi vẫn ổn.');
  siren(true); vibrate([600, 300, 600, 300, 600]); speak();
  setTimeout(() => siren(false), 3000);
  voiceTimer = setInterval(speak, 12000);
  countTimer = setInterval(async () => {
    n--; const c = $('#zCount'); if (c) c.textContent = n;
    if (n > 0) return;
    clearInterval(countTimer); clearInterval(voiceTimer);
    if (test) { closeOverlay(); say('Kết thúc báo động thử. Khi có thật, bệnh viện sẽ được báo ngay lúc này.'); return; }
    const r = await sendEmergency({ type: 'geofence', ...loc, distance: zone.dist,
      note: `Ra khỏi vùng an toàn bán kính ${S.zone.radius} m, không xác nhận "Tôi vẫn ổn" sau 60 giây.` });
    showOverlay('zone', `<div class="ov-ico">${ms(r.ok ? 'mark_email_read' : 'wifi_off', true)}</div>
      <div class="ov-title">${r.ok ? 'Đã báo bệnh viện và người thân' : 'Chưa gửi được — sẽ gửi lại'}</div>
      <p class="ov-text">Hãy đứng ở chỗ an toàn, người nhà sẽ đến đón.</p>${callLinks()}
      <button class="btn" id="ovClose" data-say="Đóng">Đóng</button>`, 'remind', () => { zone.alarm = false; });
    zone.snoozeUntil = Date.now() + 15 * 60000;
    $('#ovClose').onclick = closeOverlay;
    say('Đã báo bệnh viện và người thân vị trí của bạn. Bạn đứng ở chỗ an toàn nhé, người nhà sẽ đến đón.');
  }, 1000);
  $('#zOk').onclick = () => {
    zone.snoozeUntil = Date.now() + 15 * 60000;
    closeOverlay(); say('Dạ, đã tắt báo động. 15 phút nữa nếu vẫn ở xa, app sẽ hỏi lại ạ.');
  };
}

$('#zoneToggle').addEventListener('click', () => (S.zone.on ? stopZone() : startZone()));
$('#setHomeBtn').addEventListener('click', setHome);
$('#zoneTestBtn').addEventListener('click', () => zoneAlarm({}, true));
$('#radiusSeg').addEventListener('click', e => {
  const b = e.target.closest('[data-r]'); if (!b) return;
  S.zone.radius = Number(b.dataset.r); save(); renderSafety();
  say(`Bán kính an toàn ${S.zone.radius >= 1000 ? '1 ki lô mét' : S.zone.radius + ' mét'}`);
});

let wakeLock = null;
async function requestWakeLock() {
  try { wakeLock = await navigator.wakeLock?.request('screen'); return !!wakeLock; } catch { return false; }
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && (S.zone.on || wakeLock)) requestWakeLock();
  if (document.visibilityState === 'visible') checkReminders();
});

// ======================= TRẠNG THÁI BRIDGE =======================

let linkState = { ok: null, mode: null };
let bridgeData = { cameras: [], alerts: [] };

let hubOnline = false;
async function refreshBridge(withAlerts = false) {
  // "Bệnh viện" = kết nối Supabase dùng chung; Home Hub (camera, giọng đọc) là phần thêm
  linkState = { ok: navigator.onLine && Boolean(session), mode: 'supabase' };
  try {
    const st = await api('/api/status', { timeout: 6000 });
    hubOnline = true;
    bridgeData.cameras = st.cameras || [];
    if (withAlerts) bridgeData.alerts = await api('/api/alerts?limit=15', { timeout: 6000 });
    handleCameraAlert(st.lastAlert);
  } catch { hubOnline = false; bridgeData = { cameras: [], alerts: [] }; }
  if (linkState.ok) flushPending();
  renderStatus(); renderSafety();
  const ls = $('#linkState'); if (ls) ls.textContent = linkMessage();
}

function handleCameraAlert(a) {
  if (!a || a.id === S.seenAlertId) return;
  const fresh = Date.now() - new Date(a.createdAt).getTime() < 5 * 60000;
  const first = S.seenAlertId === null;
  S.seenAlertId = a.id; save();
  if (first || !fresh || a.source !== 'camera') return;
  const isFall = a.type === 'fall';
  showOverlay('cam', `
    <div class="ov-ico">${ms(isFall ? 'personal_injury' : 'door_open', true)}</div>
    <div class="ov-title">${isFall ? 'Camera phát hiện té ngã' : 'Camera: rời vùng an toàn trong nhà'}</div>
    <p class="ov-text">Bệnh viện đã được báo${a.synced ? ' và đã tạo đơn cấp cứu' : ''}. Nếu có thể, hãy nằm yên và gọi người thân.</p>
    ${callLinks()}
    <button class="btn" id="ovClose" data-say="Đóng">Đóng</button>`, 'alarm');
  siren(true); setTimeout(() => siren(false), 4000);
  say(isFall ? 'Bạn có sao không ạ? Camera thấy bạn bị ngã. Bệnh viện đã được báo, nhân viên y tế đang đến. Bạn cứ nằm yên nhé.'
             : 'Chú ý nhé. Camera thấy bạn rời khỏi vùng an toàn trong nhà. Bệnh viện đã được báo.');
  $('#ovClose').onclick = closeOverlay;
}

function linkMessage() {
  const hosp = linkState.ok ? 'Đã kết nối Bệnh viện GoCare: đơn cấp cứu hiện ngay trên web quản lý.' : 'Chưa kết nối được bệnh viện. Bạn kiểm tra mạng nhé.';
  const hub = hubOnline ? ' Home Hub (camera & giọng đọc) đang hoạt động.' : ' Chưa nối Home Hub: nhập địa chỉ máy tính ở nhà bên dưới để dùng camera AI.';
  return hosp + hub;
}
$('#linkForm').addEventListener('submit', async e => {
  e.preventDefault();
  S.link.bridgeUrl = e.target.bridgeUrl.value.trim();
  writeLocal('gocare.server', S.link.bridgeUrl);
  $('#linkInfo').textContent = 'Đang kiểm tra…';
  await refreshBridge(true);
  $('#linkInfo').textContent = ''; say(linkMessage());
});

// ======================= SỨC KHỎE =======================

function classify(v) {
  const issues = []; let level = 'ok';
  const bump = l => { if (l === 'bad' || (l === 'warn' && level === 'ok')) level = l; };
  if (v.sys && v.dia) {
    if (v.sys >= 180 || v.dia >= 120) { issues.push('Huyết áp rất cao, nguy hiểm'); bump('bad'); }
    else if (v.sys >= 140 || v.dia >= 90) { issues.push('Huyết áp cao'); bump('warn'); }
    else if (v.sys < 90 || v.dia < 60) { issues.push('Huyết áp thấp'); bump(v.sys < 80 ? 'bad' : 'warn'); }
  }
  if (v.pulse) {
    if (v.pulse < 40 || v.pulse > 140) { issues.push('Nhịp tim bất thường nguy hiểm'); bump('bad'); }
    else if (v.pulse < 50 || v.pulse > 110) { issues.push('Nhịp tim hơi bất thường'); bump('warn'); }
  }
  if (v.sugar) {
    if (v.sugar < 3.9) { issues.push('Đường huyết thấp, cần ăn đồ ngọt ngay'); bump('bad'); }
    else if (v.sugar > 13.9) { issues.push('Đường huyết rất cao'); bump('bad'); }
    else if (v.sugar > 10) { issues.push('Đường huyết cao'); bump('warn'); }
  }
  return { level, issues };
}

function vitalText(v) {
  return [v.sys && v.dia ? `Huyết áp ${v.sys}/${v.dia}` : '', v.pulse ? `Nhịp tim ${v.pulse}` : '', v.sugar ? `Đường huyết ${v.sugar}` : '']
    .filter(Boolean).join(' · ');
}

$('#vitalsForm').addEventListener('submit', e => {
  e.preventDefault();
  const f = e.target, n = k => (f[k].value ? Number(f[k].value) : null);
  const v = { at: new Date().toISOString(), sys: n('sys'), dia: n('dia'), pulse: n('pulse'), sugar: n('sugar') };
  if (!v.sys && !v.pulse && !v.sugar) { say('Bạn nhập ít nhất một chỉ số nhé'); return; }
  const c = classify(v); v.level = c.level;
  S.vitals.unshift(v); S.vitals = S.vitals.slice(0, 60); save();
  f.reset(); renderHealth();
  const msg = c.level === 'ok' ? 'Các chỉ số đều bình thường. Tốt lắm ạ!' : c.issues.join('. ');
  const color = c.level === 'ok' ? 'var(--stable)' : c.level === 'warn' ? 'var(--amber)' : 'var(--emergency)';
  $('#vitalResult').innerHTML = `
    <div class="card" style="border-left:6px solid ${color}">
      <h2>${ms(c.level === 'ok' ? 'check_circle' : c.level === 'warn' ? 'warning' : 'emergency', true)} ${c.level === 'ok' ? 'Bình thường' : c.level === 'warn' ? 'Cần chú ý' : 'Nguy hiểm'}</h2>
      <p>${esc(msg)}</p>
      ${c.level === 'bad' ? `<button class="btn danger big full" id="healthAlert" data-say="Báo bệnh viện">${ms('local_hospital', true)} Báo bệnh viện ngay</button>` : ''}
      ${c.level === 'warn' ? '<p class="muted">Nghỉ ngơi 10 phút rồi đo lại. Nếu vẫn cao, hãy gọi bác sĩ.</p>' : ''}
    </div>`;
  say(`${vitalText(v)}. ${msg}${c.level === 'bad' ? '. Bạn bấm nút Báo bệnh viện ngay nhé.' : ''}`);
  $('#healthAlert')?.addEventListener('click', async () => {
    const r = await sendEmergency({ type: 'health', ...(await getLocation(3000)), note: `${vitalText(v)} — ${c.issues.join('; ')}` });
    const t = r.ok ? 'Đã báo bệnh viện. Bạn ngồi nghỉ nhé, bác sĩ sẽ liên hệ.' : 'Chưa gửi được, bạn gọi điện cho bác sĩ nhé.';
    toast(t); say(t);
  });
});

// Biểu đồ sức khỏe: chọn chỉ số, xem 7 lần đo gần nhất
const METRICS = {
  bp:    { label: 'Huyết áp', unit: 'mmHg', icon: 'blood_pressure', get: v => v.sys, show: v => `${v.sys}/${v.dia}`, max: 200 },
  pulse: { label: 'Nhịp tim', unit: 'lần/phút', icon: 'cardiology', get: v => v.pulse, show: v => `${v.pulse}`, max: 150 },
  sugar: { label: 'Đường huyết', unit: 'mmol/L', icon: 'glucose', get: v => v.sugar, show: v => `${v.sugar}`, max: 15 },
};
let healthMetric = 'bp';

function renderHealth() {
  const m = METRICS[healthMetric];
  const pts = S.vitals.filter(v => m.get(v)).slice(0, 7).reverse();
  const last = pts[pts.length - 1], prev = pts[pts.length - 2];
  // Trục bắt đầu gần giá trị nhỏ nhất để thấy rõ chênh lệch giữa các lần đo
  const vals = pts.map(m.get), top = Math.max(...vals, 1) * 1.08, floor = Math.min(...vals, top) * 0.7;
  const pct = v => Math.max(8, (m.get(v) - floor) / (top - floor) * 100);
  const diff = last && prev ? m.get(last) - m.get(prev) : null;
  $('#healthChart').innerHTML = `
    <div class="seg" id="metricSeg">${Object.entries(METRICS).map(([k, x]) => `<button type="button" data-metric="${k}" aria-pressed="${k === healthMetric}">${x.label}</button>`).join('')}</div>
    <div class="ch-label">${m.label} gần nhất</div>
    <div class="ch-big">${last ? `${m.show(last)} <small>${m.unit}</small>` : '—'}</div>
    ${diff != null ? `<span class="ch-trend ${diff > 0 ? 't-amber' : 't-green'}">${ms(diff > 0 ? 'arrow_upward' : diff < 0 ? 'arrow_downward' : 'remove')} ${Math.abs(Math.round(diff * 10) / 10)} so với lần trước</span>` : '<span class="muted">Ghi chỉ số bên dưới để xem biểu đồ</span>'}
    <div class="bars">
      ${[0.25, 0.5, 0.75].map(f => `<span class="gl" style="bottom:calc(26px + ${f} * (100% - 26px))"></span>`).join('')}
      ${pts.map((v, i) => `<span class="b ${v.level !== 'ok' ? v.level : ''} ${i === pts.length - 1 ? 'last' : ''}" style="--i:${i}">
        ${i === pts.length - 1 ? `<em style="bottom:calc(${pct(v) * 0.82}% + 8px)">${m.show(v)}</em>` : ''}<i style="height:${pct(v) * 0.82}%"></i>
        <span>${new Date(v.at).getDate()}/${new Date(v.at).getMonth() + 1}</span></span>`).join('') || '<span class="empty" style="grid-column:1/-1;align-self:center">Chưa có dữ liệu</span>'}
    </div>`;
  $('#healthChart').dataset.say = last ? `${m.label} gần nhất là ${m.show(last).replace('/', ' trên ')}` : `Chưa có số đo ${m.label}`;

  $('#vitalHistory').innerHTML = S.vitals.slice(0, 10).map(v => li({
    icon: ms(v.level === 'ok' ? 'favorite' : v.level === 'warn' ? 'warning' : 'emergency', true),
    color: v.level === 'ok' ? 'c-green' : v.level === 'warn' ? 'c-amber' : 'c-red',
    title: esc(vitalText(v)), sub: new Date(v.at).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' }),
    end: `<span class="tag ${v.level}">${v.level === 'ok' ? 'Tốt' : v.level === 'warn' ? 'Chú ý' : 'Nguy hiểm'}</span>`,
    attrs: `data-say="${esc(vitalText(v))}"`,
  })).join('') || '<p class="empty">Chưa có lần đo nào</p>';

  const upcoming = S.appts.filter(a => new Date(a.at).getTime() > Date.now() - 3600000).sort((a, b) => new Date(a.at) - new Date(b.at));
  $('#apptList').innerHTML = upcoming.map(a => li({
    icon: ms('event', true), color: 'c-blue', title: esc(a.title),
    sub: `${new Date(a.at).toLocaleString('vi-VN', { weekday: 'long', hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })}${a.place ? ' · ' + esc(a.place) : ''}`,
    end: `<button class="icon-btn red" data-del-appt="${a.id}" data-say="Xóa lịch hẹn ${esc(a.title)}" aria-label="Xóa">${ms('delete')}</button>`,
  })).join('') || '<p class="empty">Chưa có lịch hẹn</p>';
}

document.addEventListener('click', e => {
  const b = e.target.closest('[data-metric]');
  if (b) { healthMetric = b.dataset.metric; renderHealth(); }
});

document.addEventListener('click', e => {
  const d = e.target.closest('[data-del-appt]');
  if (d) { S.appts = S.appts.filter(a => a.id !== d.dataset.delAppt); save(); renderHealth(); }
});

$('#addApptBtn').addEventListener('click', () => {
  const sheet = $('#sheet'), form = $('#sheetForm');
  const tomorrow = new Date(Date.now() + 86400000);
  form.innerHTML = `
    <h2>Thêm lịch hẹn khám</h2>
    <label class="field"><span>Khám gì?</span><input name="title" required placeholder="Tái khám tim mạch"></label>
    <label class="field"><span>Ngày giờ</span><input name="at" type="datetime-local" required value="${todayKey(tomorrow)}T08:00"></label>
    <label class="field"><span>Nơi khám</span><input name="place" placeholder="Bệnh viện GoCare"></label>
    <button class="btn big primary full" type="submit" data-say="Lưu lịch hẹn">${ms('save')} Lưu</button>
    <button class="btn full" type="button" id="closeSheet" data-say="Đóng">Đóng</button>`;
  form.onclick = e => { if (e.target.closest('#closeSheet')) sheet.close(); };
  form.onsubmit = e => {
    e.preventDefault();
    const a = { id: uid(), title: form.title.value.trim(), at: form.at.value, place: form.place.value.trim() };
    S.appts.push(a); save(); sheet.close(); renderHealth();
    say(`Đã lưu lịch hẹn ${a.title}, ${spokenDate(new Date(a.at))}, lúc ${spokenTime(new Date(a.at))}. App sẽ nhắc trước một ngày và trước một giờ.`);
  };
  sheet.showModal();
});

// ======================= CÀI ĐẶT =======================

function fillSettings() {
  const f = $('#profileForm');
  for (const [k, v] of Object.entries(S.profile)) {
    if (!f[k]) continue;
    if (f[k].type === 'checkbox') f[k].checked = !!v; else f[k].value = v ?? '';
  }
  $('#linkForm').bridgeUrl.value = S.link.bridgeUrl;
  setPressed('#rateSeg', b => Number(b.dataset.rate) === S.voice.rate);
  setPressed('#sizeSeg', b => b.dataset.size === S.size);
  document.documentElement.dataset.size = S.size;
  const vt = $('#voiceToggle');
  vt.setAttribute('aria-pressed', S.voice.on);
  vt.querySelector('.vt-icon').textContent = S.voice.on ? 'volume_up' : 'volume_off';
  vt.setAttribute('aria-label', S.voice.on ? 'Đọc to đang bật' : 'Đọc to đang tắt');
  $('#notifBtn').innerHTML = !('Notification' in window) ? 'Máy không hỗ trợ thông báo'
    : Notification.permission === 'granted' ? `${ms('notifications_active', true)} Đã bật thông báo` : `${ms('notifications')} Cho phép thông báo nhắc thuốc`;
  $('#wakeBtn').innerHTML = wakeLock ? `${ms('light_mode', true)} Màn hình luôn sáng` : `${ms('brightness_high')} Giữ màn hình luôn sáng`;
}
function setPressed(sel, fn) { $$(`${sel} button`).forEach(b => b.setAttribute('aria-pressed', fn(b))); }

$('#profileForm').addEventListener('submit', e => {
  e.preventDefault();
  const f = e.target;
  for (const k of Object.keys(S.profile)) if (f[k]) S.profile[k] = f[k].type === 'checkbox' ? f[k].checked : f[k].value.trim();
  if (!S.profile.emergencyPhone) S.profile.emergencyPhone = '115';
  save(); renderHome(); fillSettings(); renderAccount();
  say(`Đã lưu thông tin của ${S.profile.name || 'bệnh nhân'}`);
});

$('#voiceToggle').addEventListener('click', () => {
  S.voice.on = !S.voice.on; save(); fillSettings();
  say(S.voice.on ? 'Đã bật đọc to' : 'Đã tắt đọc to', { force: true });
});
$('#voiceSelect').addEventListener('change', e => {
  S.voice.voiceName = e.target.value; save(); loadVoices(); renderVoiceSelect();
  say(`Xin chào ${S.profile.name || 'bạn'}, đây là giọng đọc mới ạ.`, { force: true });
});
$('#rateSeg').addEventListener('click', e => {
  const b = e.target.closest('[data-rate]'); if (!b) return;
  S.voice.rate = Number(b.dataset.rate); save(); fillSettings(); say(`Tốc độ đọc ${b.textContent}`);
});
$('#sizeSeg').addEventListener('click', e => {
  const b = e.target.closest('[data-size]'); if (!b) return;
  S.size = b.dataset.size; save(); fillSettings();
});
$('#testVoiceBtn').addEventListener('click', () =>
  say(`Xin chào ${S.profile.name || 'bạn'}. Đây là giọng đọc của GoCare. Mỗi khi bạn chạm vào nút nào, mình sẽ đọc nhỏ nhẹ cho bạn nghe nhé.`, { force: true }));
$('#notifBtn').addEventListener('click', async () => {
  if (!('Notification' in window)) return;
  const r = await Notification.requestPermission();
  fillSettings(); say(r === 'granted' ? 'Đã bật thông báo' : 'Chưa được phép gửi thông báo');
});
$('#wakeBtn').addEventListener('click', async () => {
  const ok = await requestWakeLock(); fillSettings();
  say(ok ? 'Màn hình sẽ luôn sáng khi mở app' : 'Máy không hỗ trợ giữ màn hình sáng');
});

// ======================= TRANG CHỦ =======================

$('#okBtn').addEventListener('click', () => { S.lastCheckin = new Date().toISOString(); save(); renderHome(); toast('Đã ghi nhận: hôm nay bạn khỏe'); });

// Một hàng danh sách: icon tròn màu · tiêu đề + dòng phụ · phần cuối bên phải
function li({ icon, color = 'c-mint', title, sub = '', end = '', endSub = '', tag = 'div', attrs = '' }) {
  return `<${tag} class="li" ${attrs}><span class="li-ico ${color}">${icon}</span>
    <span class="li-main"><b>${title}</b>${sub ? `<small>${sub}</small>` : ''}</span>
    <span class="li-end">${end}${endSub ? `<small>${endSub}</small>` : ''}</span></${tag}>`;
}
const MED_COLORS = ['c-green', 'c-blue', 'c-amber', 'c-violet', 'c-pink', 'c-red'];
const medColor = m => MED_COLORS[Math.abs([...m.id].reduce((a, c) => a + c.charCodeAt(0), 0)) % MED_COLORS.length];

function renderHome() {
  const g = greeting(), p = S.profile;
  $('#helloIcon').textContent = g.icon;
  $('#helloEyebrow').textContent = `${g.text},`;
  $('#helloLine').textContent = p.name || session?.user?.name || 'GoCare';
  const doses = dosesToday(), taken = doses.filter(d => d.status === 'taken').length;
  $('#helloSub').innerHTML = `<span class="dot"></span> ${doses.length ? `Đã uống ${taken}/${doses.length} lần thuốc hôm nay` : 'Chúc bạn một ngày an lành'}`;

  // Danh sách thuốc hôm nay (giống "giao dịch gần đây")
  $('#homeDoses').innerHTML = doses.slice(0, 4).map(d => li({
    icon: `<span>${esc(d.med.icon)}</span>`, color: medColor(d.med), title: esc(d.med.name),
    sub: `${esc(d.med.dose)} · ${esc(d.med.note)}`,
    end: d.status === 'taken' ? `<span class="t-green">${ms('check_circle', true)}</span>` : d.status === 'missed' ? '<span class="t-red">Quên</span>' : d.status === 'due' ? '<span class="t-amber">Đến giờ</span>' : d.time,
    endSub: d.status === 'taken' ? 'Đã uống' : d.status === 'upcoming' ? 'Sắp tới' : d.time,
    tag: 'button', attrs: `data-go="meds" data-say="${esc(d.med.name)}, ${d.status === 'taken' ? 'đã uống' : 'lúc ' + spokenHM(d.time)}"`,
  })).join('') || '<p class="empty">Chưa có thuốc. Vào mục Thuốc để thêm.</p>';

  const d = nextDose(), card = $('#nextMedCard');
  card.classList.toggle('due', d?.status === 'due');
  if (!d || d.status !== 'due') {
    card.innerHTML = ''; // chỉ hiện thẻ nổi bật khi đến giờ uống
  } else {
    const due = d.status === 'due';
    card.innerHTML = `
      <button class="nm-top" data-go="meds"
        data-say="${due ? 'Đến giờ uống' : 'Thuốc kế tiếp'}: ${esc(d.med.name)}, ${esc(d.med.dose)}, lúc ${spokenHM(d.time)}, ${esc(d.med.note)}">
        <span class="nm-pill">${ms(due ? 'alarm' : 'medication', true)}</span>
        <span><span class="nm-label">${due ? 'Đến giờ uống' : 'Thuốc kế tiếp'}</span><br>
        <span class="nm-name">${esc(d.med.icon)} ${esc(d.med.name)}</span><br>
        <span class="nm-meta"><b>${d.time}</b> · ${esc(d.med.dose)} · ${esc(d.med.note)}</span></span>
      </button>
      ${due ? `<button class="btn okay big" data-take="${d.key}" data-say="Đã uống ${esc(d.med.name)}">${ms('check_circle', true)} Tôi đã uống</button>` : ''}`;
  }

  const calls = [];
  const em = esc(p.emergencyPhone || '115');
  const callEnd = `<span class="li-ico c-green" style="width:44px;height:44px">${ms('call', true)}</span>`;
  if (p.familyPhone) calls.push(li({ icon: ms('family_restroom', true), color: 'c-blue', title: esc(p.familyName || 'Người thân'), sub: esc(p.familyPhone), end: callEnd, tag: 'a', attrs: `href="tel:${esc(p.familyPhone)}" data-say="Gọi cho ${esc(p.familyName || 'người thân')}"` }));
  if (p.doctorPhone) calls.push(li({ icon: ms('stethoscope', true), color: 'c-violet', title: 'Bác sĩ / điều dưỡng', sub: esc(p.doctorPhone), end: callEnd, tag: 'a', attrs: `href="tel:${esc(p.doctorPhone)}" data-say="Gọi bác sĩ"` }));
  calls.push(li({ icon: ms('ambulance', true), color: 'c-red', title: 'Cấp cứu', sub: em, end: callEnd, tag: 'a', attrs: `href="tel:${em}" data-say="Gọi cấp cứu ${em}"` }));
  if (!p.familyPhone) calls.push(li({ icon: ms('person_add', true), color: 'c-mint', title: 'Thêm số người thân', sub: 'Trong Hồ sơ → Thông tin cá nhân', end: ms('chevron_right'), tag: 'button', attrs: 'data-go="settings" data-say="Thêm số người thân trong phần hồ sơ"' }));
  $('#quickCalls').innerHTML = calls.join('');
  renderStatus();
}

function renderStatus() {
  const set = (id, cls, icon, title, val, sayText) => {
    const el = $(id);
    el.className = `status ${cls}`;
    el.innerHTML = `<span class="s-ico">${ms(icon, true)}</span><span>${title}</span><span class="s-val">${val}</span>`;
    el.dataset.say = sayText;
  };
  const camOnline = (cams.length ? cams.filter(c => c.running && c.online) : bridgeData.cameras.filter(c => c.online)).length;
  const camTotal = cams.length || bridgeData.cameras.length;
  if (camOnline) set('#stCam', 'ok', 'videocam', 'Camera', `${camOnline} đang canh`, `Có ${camOnline} camera chống té ngã đang canh chừng`);
  else set('#stCam', camTotal ? 'warn' : '', 'videocam_off', 'Camera', camTotal ? 'Đang tắt' : 'Chưa cài', 'Camera chống té ngã chưa hoạt động. Bấm để cài camera.');

  if (!S.zone.on) set('#stZone', '', 'location_off', 'Vùng GPS', 'Đang tắt', 'Vùng an toàn GPS đang tắt. Bấm để bật.');
  else if (zone.error) set('#stZone', 'warn', 'location_disabled', 'Vùng GPS', zone.error, `Vùng an toàn: ${zone.error}`);
  else if (zone.outside) set('#stZone', 'bad', 'wrong_location', 'Vùng GPS', 'Ở xa nhà', `Bạn đang ở ngoài vùng an toàn, cách nhà ${Math.round(zone.dist)} mét`);
  else set('#stZone', 'ok', 'where_to_vote', 'Vùng GPS', zone.dist != null ? `${Math.round(zone.dist)} m` : 'Đang bật', 'Bạn đang trong vùng an toàn');

  const pend = S.pending.length;
  if (linkState.ok) set('#stLink', pend ? 'warn' : 'ok', 'local_hospital', 'Bệnh viện', pend ? `Chờ gửi ${pend}` : (linkState.mode === 'supabase' ? 'Đã kết nối' : 'Thử nghiệm'), 'Đã kết nối với bệnh viện');
  else set('#stLink', linkState.ok === false ? 'bad' : '', 'local_hospital', 'Bệnh viện', linkState.ok === false ? 'Mất kết nối' : 'Đang kiểm tra', 'Chưa kết nối được với bệnh viện. Vẫn có thể gọi điện cấp cứu.');
}

function renderSafety() {
  const st = $('#zoneState');
  if (!S.zone.home) { st.className = 'zone-state'; st.innerHTML = 'Chưa đặt vị trí nhà. Hãy đứng ở nhà và bấm “Đặt chỗ đang đứng làm NHÀ”.'; }
  else if (!S.zone.on) { st.className = 'zone-state'; st.innerHTML = `Đang <b>tắt</b>. Bán kính ${S.zone.radius} m quanh nhà.`; }
  else if (zone.error) { st.className = 'zone-state bad'; st.innerHTML = esc(zone.error); }
  else if (zone.dist == null) { st.className = 'zone-state'; st.innerHTML = 'Đang dò vị trí GPS…'; }
  else {
    st.className = `zone-state ${zone.outside ? 'bad' : 'ok'}`;
    st.innerHTML = `${zone.outside ? '<b>Ở ngoài vùng an toàn</b>' : '<b>Đang trong vùng an toàn</b>'}<br>Cách nhà ${Math.round(zone.dist)} m (sai số ±${zone.acc} m) · giới hạn ${S.zone.radius} m`;
  }
  const t = $('#zoneToggle');
  t.className = `btn big full ${S.zone.on ? 'danger' : 'primary'}`;
  t.innerHTML = S.zone.on ? `${ms('stop_circle')} Tắt canh vùng an toàn` : `${ms('play_circle')} Bật canh vùng an toàn`;
  t.dataset.say = S.zone.on ? 'Tắt canh vùng an toàn' : 'Bật canh vùng an toàn';
  setPressed('#radiusSeg', b => Number(b.dataset.r) === S.zone.radius);

  const META = {
    sos: ['e911_emergency', 'Bấm nút SOS'], fall: ['personal_injury', 'Té ngã (camera)'], geofence: ['wrong_location', 'Ra khỏi vùng GPS'],
    zone: ['door_open', 'Rời vùng trong nhà'], health: ['monitor_heart', 'Chỉ số nguy hiểm'],
  };
  const alertsShown = bridgeData.alerts?.length ? bridgeData.alerts : (S.sentAlerts || []);
  $('#alertList').innerHTML = alertsShown.slice(0, 10).map(a => {
    const [icon, label] = META[a.type] || ['warning', a.type];
    const d = new Date(a.createdAt);
    return li({
      icon: ms(icon, true), color: a.type === 'fall' || a.type === 'sos' ? 'c-red' : 'c-amber', title: label,
      sub: `${a.synced ? 'Đã tạo đơn trên web bệnh viện' : a.error ? 'Lỗi: ' + esc(a.error) : 'Đã lưu tại máy chủ'}${a.snapshotUrl ? ` · <a href="${esc(a.snapshotUrl)}" target="_blank" rel="noopener">xem ảnh</a>` : ''}`,
      end: hm(d), endSub: `${d.getDate()}/${d.getMonth() + 1}`,
    });
  }).join('') || '<p class="empty">Chưa có cảnh báo nào</p>';
}

// Điểm "tuân thủ dùng thuốc" 7 ngày qua — hiện trên thẻ xanh ở trang Hồ sơ
function adherence() {
  let due = 0, taken = 0;
  for (let i = 0; i < 7; i++) {
    const d = new Date(Date.now() - i * 86400000), log = S.log[todayKey(d)] || {};
    for (const m of S.meds) for (const t of m.times) {
      if (i === 0 && atToday(t) > new Date()) continue;
      due++; if (log[`${m.id}@${t}`]?.status === 'taken') taken++;
    }
  }
  return due ? Math.round(taken / due * 100) : null;
}

// ======================= KHỞI ĐỘNG =======================

function tickClock() {
  const d = new Date();
  $('#clockTime').innerHTML = `${pad(d.getHours())}<span class="colon">:</span>${pad(d.getMinutes())}`;
  $('#clockDate').textContent = `${WEEKDAYS[d.getDay()]}, ${d.getDate()}/${d.getMonth() + 1}`;
}

function cleanupLog() {
  const cutoff = todayKey(new Date(Date.now() - 30 * 86400000));
  for (const k of Object.keys(S.log)) if (k < cutoff) delete S.log[k];
}

// ======================= TÀI KHOẢN =======================

const initials = name => (String(name || 'G').trim().split(/\s+/).slice(-1)[0] || 'G').charAt(0).toUpperCase();

function renderAccount() {
  if (!session) return;
  const name = S.profile.name || session.user.name;
  $('#avatarText').textContent = initials(name);
  $('#accAvatar').textContent = initials(name);
  $('#accName').textContent = name;
  $('#accPhone').textContent = session.user.phone;
  const tag = $('#accSync');
  tag.className = `tag ${syncState === 'ok' ? 'ok' : 'warn'}`;
  tag.innerHTML = syncState === 'ok' ? `${ms('cloud_done', true)} Đã lưu trên máy chủ` : `${ms('cloud_off', true)} Chưa đồng bộ — sẽ thử lại`;

  // Thẻ xanh "Sức khỏe tổng quát" với vòng phần trăm uống thuốc đúng giờ 7 ngày qua
  const pct = adherence();
  const C = 2 * Math.PI * 40;
  const word = pct == null ? 'Bắt đầu nào' : pct >= 90 ? 'Rất tốt' : pct >= 70 ? 'Tốt' : pct >= 50 ? 'Cần cố gắng' : 'Cần chú ý';
  $('#healthScore').innerHTML = `
    <div><span class="gc-label">Uống thuốc đúng giờ (7 ngày)</span>
      <div class="gc-big">${word} ${ms('north_east')}</div>
      <small>${pct == null ? 'Thêm thuốc để GoCare theo dõi giúp bạn.' : pct >= 70 ? 'Bạn đang làm rất tốt, cứ giữ vậy nhé!' : 'Bật thông báo để không quên uống thuốc nhé.'}</small></div>
    <span class="ring"><svg viewBox="0 0 96 96"><circle class="track" cx="48" cy="48" r="40"/>
      <circle class="fill" cx="48" cy="48" r="40" stroke-dasharray="${C}" stroke-dashoffset="${C}"/></svg><b>${pct == null ? '—' : pct + '%'}</b></span>`;
  $('#healthScore').dataset.say = pct == null ? 'Chưa có dữ liệu uống thuốc' : `Uống thuốc đúng giờ ${pct} phần trăm trong 7 ngày qua. ${word}.`;
  requestAnimationFrame(() => $('#healthScore .fill')?.setAttribute('stroke-dashoffset', C * (1 - (pct || 0) / 100)));
}

$('#logoutBtn').addEventListener('click', async () => {
  if (!confirm('Đăng xuất khỏi GoCare trên máy này?')) return;
  clearTimeout(syncTimer); await pushData();
  try { await sb?.auth.signOut(); } catch { /* vẫn đăng xuất trong máy */ }
  signOut(false);
  say('Đã đăng xuất. Hẹn gặp lại bạn nhé.');
});

function signOut(expired) {
  if (!session) return;
  stopZone(); closeOverlay();
  session = null;
  S = structuredClone(DEFAULTS);
  showAuth('welcome');
  if (expired) toast('Phiên đăng nhập đã hết hạn, bạn đăng nhập lại nhé');
}

async function signedIn(supaSession, isNew) {
  session = toSession(supaSession);
  // Ưu tiên dữ liệu trên database; tài khoản mới bắt đầu sạch
  let server = null;
  try { server = await pullData(supaSession.user); } catch { /* dùng bản trong máy */ }
  S = server ? hydrate(server) : isNew ? hydrate(null) : load();
  if (isNew && !server) S.meds = [];
  S.profile.name ||= session.user.name;
  S.profile.phone ||= session.user.phone;
  save();
  if (isNew || !S.onboarded) showOnboarding(0); else enterApp();
}

let appStarted = false;
function enterApp() {
  document.body.classList.remove('signed-out');
  $('#authView').hidden = true;
  cleanupLog();
  fillSettings(); renderHome(); renderMeds(); renderHealth(); renderSafety(); renderAccount();
  go('home');
  refreshBridge(true); refreshCams();
  setTimeout(checkReminders, 1500);
  if (S.zone.on) startZone();
  if (!appStarted) {
    appStarted = true;
    setInterval(tickClock, 15000);
    setInterval(() => { if (session) { checkReminders(); renderHome(); renderMeds(); } }, 20000);
    setInterval(() => { if (!session) return; const on = $('#screen-safety').classList.contains('active'); refreshBridge(on); if (on) refreshCams(); }, 15000);
  }
  say(`${greeting().text} ${S.profile.name || ''}. Chúc bạn một ngày an lành.`);
}

// ---------- Màn hình đăng nhập / đăng ký (Supabase Auth) ----------

const auth = { email: '', name: '', phone: '' };
const AUTH_ERRORS = [
  [/Invalid login credentials/i, 'Email hoặc mật khẩu chưa đúng'],
  [/Email not confirmed/i, 'Email chưa được xác nhận. Bạn mở hộp thư và bấm vào đường link GoCare gửi nhé'],
  [/User already registered|already been registered/i, 'Email này đã có tài khoản, bạn đăng nhập nhé'],
  [/Password should be at least|password.*(short|characters)/i, 'Mật khẩu cần ít nhất 6 ký tự'],
  [/rate limit|too many/i, 'Thử quá nhiều lần, bạn đợi vài phút rồi thử lại nhé'],
  [/Failed to fetch|NetworkError|network/i, 'Không có mạng, bạn kiểm tra kết nối nhé'],
];
const authMsg = e => (AUTH_ERRORS.find(([re]) => re.test(e?.message || '')) || [null, e?.message || 'Có lỗi, bạn thử lại nhé'])[1];

function showAuth(view) {
  document.body.classList.add('signed-out');
  $('#authView').hidden = false;
  window.scrollTo({ top: 0 });
  const box = $('#authInner');
  const head = (title, sub, back) => `
    <div class="auth-top">
      ${back ? `<button class="auth-back" data-auth="${back}" data-say="Quay lại" aria-label="Quay lại">${ms('arrow_back')}</button>` : ''}
      <div class="auth-title"><h1>${title}</h1><p>${sub}</p></div>
    </div>`;
  const pw = (name, label, ac) => `<label class="field"><span>${label}</span><span class="pw"><input name="${name}" type="password" autocomplete="${ac}" minlength="6" required>
    <button type="button" class="pw-eye" data-say="Hiện mật khẩu" aria-label="Hiện mật khẩu">${ms('visibility')}</button></span></label>`;

  if (!sb) {
    box.innerHTML = `${head('Không tải được GoCare', 'Thiếu thư viện đăng nhập. Bạn kiểm tra mạng rồi tải lại trang nhé.')}`;
    return;
  }

  if (view === 'welcome') {
    box.innerHTML = `
      <div class="welcome">
        <div class="brand-row">${ms('spa', true)} GoCare</div>
        <h1>An tâm chăm sóc<br>mỗi ngày</h1>
        <p>Nhắc thuốc, gọi cấp cứu, camera chống té ngã — dành cho ông bà, cha mẹ.</p>
        <div class="welcome-art">
          <img src="https://quanlyweb-bjsh.vercel.app/assets/senior_patient_portrait_1793135539108-DmcqQNuw.jpg" alt="" onerror="this.remove()">
          <span class="badge">${ms('verified_user', true)} Kết nối Bệnh viện GoCare 24/7</span>
        </div>
        <ul class="feature-list">
          <li><span class="f-ico c-green">${ms('medication', true)}</span>Nhắc uống thuốc đúng giờ, đọc to dễ nghe</li>
          <li><span class="f-ico c-red">${ms('e911_emergency', true)}</span>Một chạm gọi cấp cứu, bệnh viện nhận ngay</li>
          <li><span class="f-ico c-blue">${ms('videocam', true)}</span>Camera AI phát hiện té ngã trong nhà</li>
        </ul>
        <button class="btn big primary full" data-auth="register" data-say="Bắt đầu, tạo tài khoản mới">Bắt đầu ${ms('arrow_forward')}</button>
        <p class="auth-foot">Đã có tài khoản GoCare? <button type="button" class="link-btn" data-auth="login" data-say="Đăng nhập">Đăng nhập</button></p>
      </div>`;
    say('Chào mừng bạn đến với GoCare. Bấm Bắt đầu để tạo tài khoản, hoặc Đăng nhập nếu đã có tài khoản.');
  }

  if (view === 'login') {
    box.innerHTML = `${head('Đăng nhập', 'Dùng chung tài khoản với website GoCare', 'welcome')}
      <form class="auth-card" id="authForm">
        <label class="field"><span>Email</span><input name="email" type="email" inputmode="email" autocomplete="email" value="${esc(auth.email)}" required placeholder="ten@gmail.com"></label>
        ${pw('password', 'Mật khẩu', 'current-password')}
        <p class="form-error" id="authErr"></p>
        <button class="btn big primary full" type="submit" data-say="Đăng nhập">${ms('login')} Đăng nhập</button>
        <p class="auth-foot"><button type="button" class="link-btn" data-auth="forgot" data-say="Quên mật khẩu">Quên mật khẩu?</button></p>
        <p class="auth-foot">Chưa có tài khoản? <button type="button" class="link-btn" data-auth="register">Tạo tài khoản</button></p>
      </form>`;
    $('#authForm').onsubmit = async e => {
      e.preventDefault();
      const f = e.target; auth.email = f.email.value.trim();
      busy(f, true);
      const { data, error } = await sb.auth.signInWithPassword({ email: auth.email, password: f.password.value });
      busy(f, false);
      if (error) { const m = authMsg(error); authError(m); say(m); return; }
      f.password.value = '';
      await signedIn(data.session, false);
    };
    say('Đăng nhập. Nhập email và mật khẩu của bạn.');
  }

  if (view === 'register') {
    box.innerHTML = `${head('Tạo tài khoản', 'Người thân có thể tạo giúp — chỉ mất một phút', 'welcome')}
      <form class="auth-card" id="authForm">
        <label class="field"><span>Tên gọi (ví dụ: Bà Mai)</span><input name="name" autocomplete="name" value="${esc(auth.name)}" required></label>
        <label class="field"><span>Số điện thoại</span><input name="phone" type="tel" inputmode="tel" autocomplete="tel" value="${esc(auth.phone)}" placeholder="0901 234 567"></label>
        <label class="field"><span>Email</span><input name="email" type="email" inputmode="email" autocomplete="email" value="${esc(auth.email)}" required placeholder="ten@gmail.com"></label>
        ${pw('password', 'Mật khẩu (ít nhất 6 ký tự)', 'new-password')}
        ${pw('password2', 'Nhập lại mật khẩu', 'new-password')}
        <p class="form-error" id="authErr"></p>
        <button class="btn big primary full" type="submit" data-say="Tạo tài khoản">${ms('person_add')} Tạo tài khoản</button>
        <p class="auth-foot">Đã có tài khoản? <button type="button" class="link-btn" data-auth="login">Đăng nhập</button></p>
      </form>`;
    $('#authForm').onsubmit = async e => {
      e.preventDefault();
      const f = e.target;
      auth.name = f.name.value.trim(); auth.phone = f.phone.value.trim(); auth.email = f.email.value.trim();
      if (f.password.value !== f.password2.value) { const m = 'Hai mật khẩu chưa giống nhau'; authError(m); say(m); return; }
      busy(f, true);
      const { data, error } = await sb.auth.signUp({
        email: auth.email, password: f.password.value,
        options: { data: { full_name: auth.name, phone: auth.phone, role: 'patient', source: 'gocare-patient-app' }, emailRedirectTo: location.origin },
      });
      busy(f, false);
      if (error) { const m = authMsg(error); authError(m); say(m); return; }
      if (!data.session) { showAuth('check-email'); return; }  // database bật xác nhận email
      await signedIn(data.session, true);
    };
    say('Tạo tài khoản. Nhập tên gọi, số điện thoại, email và mật khẩu.');
  }

  if (view === 'check-email') {
    box.innerHTML = `${head('Kiểm tra hộp thư', '', 'login')}
      <div class="auth-card" style="text-align:center">
        <div class="ov-ico">${ms('mark_email_unread', true)}</div>
        <h2>Đã gửi email xác nhận</h2>
        <p class="muted">GoCare vừa gửi thư tới <b>${esc(auth.email)}</b>. Bạn mở thư và bấm vào đường link để kích hoạt tài khoản, rồi quay lại đăng nhập nhé.</p>
        <button class="btn big primary full" data-auth="login" data-say="Đăng nhập">${ms('login')} Tôi đã xác nhận, đăng nhập</button>
      </div>`;
    say(`Đã gửi email xác nhận tới ${auth.email}. Bạn mở thư và bấm vào đường link nhé.`);
  }

  if (view === 'forgot') {
    box.innerHTML = `${head('Quên mật khẩu', 'GoCare sẽ gửi đường link đặt lại mật khẩu', 'login')}
      <form class="auth-card" id="authForm">
        <label class="field"><span>Email đã đăng ký</span><input name="email" type="email" inputmode="email" value="${esc(auth.email)}" required></label>
        <p class="form-error" id="authErr"></p>
        <button class="btn big primary full" type="submit" data-say="Gửi đường link">${ms('send')} Gửi đường link</button>
      </form>`;
    $('#authForm').onsubmit = async e => {
      e.preventDefault();
      const f = e.target; auth.email = f.email.value.trim();
      busy(f, true);
      const { error } = await sb.auth.resetPasswordForEmail(auth.email, { redirectTo: location.origin });
      busy(f, false);
      const m = error ? authMsg(error) : 'Đã gửi. Bạn mở email và bấm vào đường link để đặt mật khẩu mới nhé.';
      authError(m); say(m);
    };
    say('Quên mật khẩu. Nhập email đã đăng ký.');
  }

  if (view === 'reset') {
    box.innerHTML = `${head('Đặt mật khẩu mới', 'Chọn mật khẩu dễ nhớ với bạn')}
      <form class="auth-card" id="authForm">
        ${pw('password', 'Mật khẩu mới', 'new-password')}
        ${pw('password2', 'Nhập lại mật khẩu mới', 'new-password')}
        <p class="form-error" id="authErr"></p>
        <button class="btn big primary full" type="submit" data-say="Lưu mật khẩu">${ms('lock_reset')} Lưu mật khẩu</button>
      </form>`;
    $('#authForm').onsubmit = async e => {
      e.preventDefault();
      const f = e.target;
      if (f.password.value !== f.password2.value) { authError('Hai mật khẩu chưa giống nhau'); return; }
      busy(f, true);
      const { error } = await sb.auth.updateUser({ password: f.password.value });
      busy(f, false);
      if (error) { const m = authMsg(error); authError(m); say(m); return; }
      say('Đã đổi mật khẩu.');
      const { data } = await sb.auth.getSession();
      if (data.session) await signedIn(data.session, false); else showAuth('login');
    };
  }
}

function busy(form, on) {
  const b = form.querySelector('[type=submit]');
  if (!b) return;
  b.disabled = on;
  if (on) { b.dataset.label = b.innerHTML; b.innerHTML = `${ms('progress_activity')} Đang xử lý…`; }
  else if (b.dataset.label) b.innerHTML = b.dataset.label;
}
function authError(msg) { const el = $('#authErr'); if (el) el.textContent = msg; }

document.addEventListener('click', e => {
  const eye = e.target.closest('.pw-eye');
  if (!eye) return;
  const input = eye.parentElement.querySelector('input');
  input.type = input.type === 'password' ? 'text' : 'password';
  eye.querySelector('.ms').textContent = input.type === 'password' ? 'visibility' : 'visibility_off';
});

// ---------- Làm quen sau khi tạo tài khoản ----------

function showOnboarding(step) {
  document.body.classList.add('signed-out');
  $('#authView').hidden = false;
  const box = $('#authInner');
  const bar = `<div class="steps">${[0, 1, 2].map(i => `<i class="${i < step ? 'done' : i === step ? 'cur' : ''}"></i>`).join('')}</div>`;
  const p = S.profile;
  if (step === 0) {
    box.innerHTML = `<div class="auth-top"><div class="auth-title"><h1>Chào ${esc(p.name)}! 👋</h1><p>Mình cùng cài đặt nhanh 3 bước nhé</p></div></div>
      <form class="auth-card" id="obForm">${bar}
        <h2>Nhà bạn ở đâu?</h2><p class="muted">Để xe cấp cứu tìm đến nhanh nhất.</p>
        <label class="field"><span>Địa chỉ nhà</span><input name="address" value="${esc(p.address)}" placeholder="Số nhà, đường, phường, quận"></label>
        <button class="btn big primary full" type="submit" data-say="Tiếp tục">Tiếp tục ${ms('arrow_forward')}</button>
        <p class="auth-foot"><button type="button" class="link-btn" data-ob="1">Để sau</button></p>
      </form>`;
    say(`Chào ${p.name}. Mình cùng cài đặt nhanh ba bước nhé. Bước một: địa chỉ nhà của bạn.`);
    $('#obForm').onsubmit = e => { e.preventDefault(); S.profile.address = e.target.address.value.trim(); save(); showOnboarding(1); };
  }
  if (step === 1) {
    box.innerHTML = `<div class="auth-top"><button class="auth-back" data-ob="0" data-say="Quay lại" aria-label="Quay lại">${ms('arrow_back')}</button><div class="auth-title"><h1>Người thân</h1><p>Ai sẽ được gọi khi có chuyện khẩn cấp?</p></div></div>
      <form class="auth-card" id="obForm">${bar}
        <h2>Liên hệ khẩn cấp</h2><p class="muted">Có thể đổi sau trong Hồ sơ.</p>
        <label class="field"><span>Tên người thân</span><input name="familyName" value="${esc(p.familyName)}" placeholder="Con gái Lan"></label>
        <label class="field"><span>Số điện thoại người thân</span><input name="familyPhone" type="tel" inputmode="tel" value="${esc(p.familyPhone)}"></label>
        <button class="btn big primary full" type="submit" data-say="Tiếp tục">Tiếp tục ${ms('arrow_forward')}</button>
        <p class="auth-foot"><button type="button" class="link-btn" data-ob="2">Để sau</button></p>
      </form>`;
    say('Bước hai: số điện thoại người thân, để gọi khi có chuyện khẩn cấp.');
    $('#obForm').onsubmit = e => { e.preventDefault(); S.profile.familyName = e.target.familyName.value.trim(); S.profile.familyPhone = e.target.familyPhone.value.trim(); save(); showOnboarding(2); };
  }
  if (step === 2) {
    const notif = 'Notification' in window && Notification.permission === 'granted';
    box.innerHTML = `<div class="auth-top"><button class="auth-back" data-ob="1" data-say="Quay lại" aria-label="Quay lại">${ms('arrow_back')}</button><div class="auth-title"><h1>Sắp xong rồi</h1><p>Cho phép để GoCare nhắc và bảo vệ bạn</p></div></div>
      <div class="auth-card">${bar}
        <div class="perm"><span class="f-ico c-green">${ms('notifications_active', true)}</span><span class="perm-body"><b>Thông báo</b><br><span class="muted">Nhắc giờ uống thuốc</span></span>
          <button class="btn ${notif ? 'okay' : 'tonal'}" id="obNotif">${notif ? ms('check') + ' Đã bật' : 'Cho phép'}</button></div>
        <div class="perm"><span class="f-ico c-blue">${ms('my_location', true)}</span><span class="perm-body"><b>Vị trí</b><br><span class="muted">Gửi vị trí khi gọi cấp cứu</span></span>
          <button class="btn tonal" id="obLoc">Cho phép</button></div>
        <button class="btn big primary full" id="obDone" data-say="Bắt đầu dùng GoCare">${ms('check_circle', true)} Bắt đầu dùng GoCare</button>
      </div>`;
    say('Bước cuối: cho phép thông báo và vị trí, rồi bấm Bắt đầu dùng GoCare.');
    $('#obNotif').onclick = async () => {
      if (!('Notification' in window)) return;
      const r = await Notification.requestPermission();
      if (r === 'granted') { $('#obNotif').className = 'btn okay'; $('#obNotif').innerHTML = `${ms('check')} Đã bật`; }
    };
    $('#obLoc').onclick = async () => {
      const loc = await getLocation(8000);
      if (loc.lat != null) { $('#obLoc').className = 'btn okay'; $('#obLoc').innerHTML = `${ms('check')} Đã bật`; }
      else say('Chưa lấy được vị trí, bạn có thể bật sau nhé.');
    };
    $('#obDone').onclick = () => { S.onboarded = true; save(); syncPatientProfile(); burst(); chime(); enterApp(); };
  }
}

document.addEventListener('click', e => {
  const a = e.target.closest('[data-auth]'); if (a) showAuth(a.dataset.auth);
  const o = e.target.closest('[data-ob]'); if (o) showOnboarding(Number(o.dataset.ob));
});

// ======================= KHỞI ĐỘNG =======================

async function boot() {
  tickClock();
  checkTts();
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(() => {});
  let recovering = /type=recovery/.test(location.hash);
  if (sb) {
    sb.auth.onAuthStateChange((event, s) => {
      if (event === 'PASSWORD_RECOVERY') { recovering = true; showAuth('reset'); }
      if (event === 'TOKEN_REFRESHED' && s && session) session.token = s.access_token;
      if (event === 'SIGNED_OUT' && session) signOut(true);
    });
  }
  const { data } = sb ? await sb.auth.getSession() : { data: {} };
  setTimeout(() => document.body.classList.remove('booting'), 500);
  if (recovering) return showAuth('reset');
  if (data?.session) {
    session = toSession(data.session);
    S = load();  // mở ngay bằng bản trong máy (kể cả khi mất mạng), rồi cập nhật từ database
    if (S.onboarded === false) return showOnboarding(0);
    enterApp();
    pullData(data.session.user).then(server => {
      if (server) { S = hydrate(server); writeLocal(userStoreKey(), S); fillSettings(); renderHome(); renderMeds(); renderHealth(); renderAccount(); }
    }).catch(() => {});
  } else {
    showAuth('welcome');
  }
}

boot();
