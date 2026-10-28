// GoCare Bridge — máy chủ của App Bệnh Nhân: tài khoản, dữ liệu, camera chống té ngã và
// cầu nối tạo đơn cấp cứu trên Web Quản Lý GoCare. Không cần cài thư viện: chỉ dùng Node.js >= 18.
//
//   POST /api/auth/register | login | logout, GET /api/auth/me     tài khoản (SĐT + mã PIN 6 số)
//   GET/PUT /api/me/data                                           dữ liệu riêng của bệnh nhân
//   POST /api/emergency       tạo đơn cấp cứu (SOS, té ngã, rời vùng an toàn…)
//   GET  /api/alerts          cảnh báo của tài khoản đang đăng nhập
//   GET  /api/status          trạng thái kết nối
//   GET/POST/DELETE /api/cameras…   cài camera thật, bật/tắt bộ phát hiện YOLOv8
//   POST /api/heartbeat, POST /api/frame   (thiết bị camera gửi lên)
//   GET  /api/frame/:id       khung hình trực tiếp cho app
//   GET  /                    phục vụ App Bệnh Nhân (thư mục ../app)

const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');

loadEnv(path.join(__dirname, '.env'));

const PORT = Number(process.env.PORT || 8787);
const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const API_TOKEN = process.env.API_TOKEN || '';
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || `http://localhost:${PORT}`).replace(/\/+$/, '');
const PATIENT_USER_ID = process.env.PATIENT_USER_ID || '';
const DEDUPE_SECONDS = Number(process.env.DEDUPE_SECONDS || 60);
const ALSO_TRIAGE = process.env.ALSO_TRIAGE_REPORT !== 'false';
const SESSION_DAYS = Number(process.env.SESSION_DAYS || 90);
let NURSING_EXTRA = {};
try { NURSING_EXTRA = JSON.parse(process.env.NURSING_EXTRA_FIELDS || '{}'); } catch { console.warn('NURSING_EXTRA_FIELDS không phải JSON hợp lệ — bỏ qua.'); }

const APP_DIR = path.join(__dirname, '..', 'app');
const DATA_DIR = path.join(__dirname, 'data');
const SNAP_DIR = path.join(DATA_DIR, 'snapshots');
const USERDATA_DIR = path.join(DATA_DIR, 'userdata');
const LOG_FILE = path.join(DATA_DIR, 'alerts.json');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const SESSIONS_FILE = path.join(DATA_DIR, 'sessions.json');
fs.mkdirSync(SNAP_DIR, { recursive: true });
fs.mkdirSync(USERDATA_DIR, { recursive: true });

const TYPES = {
  sos:   { title: '🚨 CẤP CỨU: Bệnh nhân bấm nút SOS', pain: 10 },
  fall:  { title: '🚨 CẤP CỨU: Camera phát hiện TÉ NGÃ', pain: 10 },
  geofence: { title: '⚠️ KHẨN: Bệnh nhân ra khỏi vùng an toàn (GPS)', pain: 7 },
  zone:  { title: '⚠️ KHẨN: Bệnh nhân rời vùng an toàn trong nhà (camera)', pain: 7 },
  health: { title: '⚠️ KHẨN: Chỉ số sức khỏe bất thường', pain: 8 },
};

const cameras = {};           // camera_id -> { lastSeen, status, patient }
let alerts = readJson(LOG_FILE, []);
const supabaseOn = Boolean(SUPABASE_URL && SUPABASE_KEY);

// ======================= TÀI KHOẢN =======================
// Đăng nhập bằng số điện thoại + mã PIN 6 số (dễ dùng cho người cao tuổi).
// PIN băm bằng scrypt; phiên đăng nhập lưu dạng băm SHA-256; khóa 10 phút sau 5 lần nhập sai.

let users = readJson(USERS_FILE, []);         // [{ id, name, phone, salt, pinHash, createdAt }]
let sessions = readJson(SESSIONS_FILE, {});   // sha256(token) -> { userId, exp }
const failures = {};                          // phone -> { count, until }
const WEAK_PINS = new Set(['000000', '111111', '222222', '333333', '444444', '555555', '666666', '777777',
  '888888', '999999', '123456', '654321', '012345', '123123', '112233', '121212']);

const sha256 = s => crypto.createHash('sha256').update(s).digest('hex');
const hashPin = (pin, salt) => crypto.scryptSync(pin, salt, 32).toString('hex');
const publicUser = u => ({ id: u.id, name: u.name, phone: u.phone, createdAt: u.createdAt });

function normPhone(p) {
  let d = String(p || '').replace(/[^\d+]/g, '');
  if (d.startsWith('+84')) d = '0' + d.slice(3);
  else if (d.startsWith('84') && d.length === 11) d = '0' + d.slice(2);
  return /^0\d{8,10}$/.test(d) ? d : null;
}

function newSession(user) {
  const token = crypto.randomBytes(32).toString('base64url');
  sessions[sha256(token)] = { userId: user.id, exp: Date.now() + SESSION_DAYS * 86400000 };
  for (const [k, s] of Object.entries(sessions)) if (s.exp < Date.now()) delete sessions[k];
  writeJson(SESSIONS_FILE, sessions);
  return token;
}

// Nhận cả phiên đăng nhập Supabase của App Bệnh Nhân (tài khoản dùng chung với 2 web GoCare)
const AUTH_URL = (process.env.SUPABASE_URL || 'https://niptzzxfgduhcrbofthg.supabase.co').replace(/\/+$/, '');
const AUTH_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_1BbQKqBKyHS7Qo-yglIpkg_pNW14RIV';
const supaCache = new Map();  // sha256(token) -> { user, exp }

async function sessionUser(req) {
  const m = String(req.headers.authorization || '').match(/^Bearer\s+(\S+)$/i);
  if (!m) return null;
  const key = sha256(m[1]);
  const s = sessions[key];
  if (s && s.exp > Date.now()) return users.find(u => u.id === s.userId) || null;
  if (m[1].split('.').length !== 3) return null;  // không phải JWT của Supabase
  const hit = supaCache.get(key);
  if (hit && hit.exp > Date.now()) return hit.user;
  try {
    const r = await fetch(`${AUTH_URL}/auth/v1/user`, { headers: { apikey: AUTH_KEY, Authorization: `Bearer ${m[1]}` } });
    if (!r.ok) return null;
    const u = await r.json();
    const meta = u.user_metadata || {};
    const user = { id: u.id, name: meta.full_name || u.email, phone: meta.phone || '', email: u.email };
    supaCache.set(key, { user, exp: Date.now() + 5 * 60000 });
    return user;
  } catch { return null; }
}

function userDataFile(id) { return path.join(USERDATA_DIR, `${id.replace(/[^\w-]/g, '')}.json`); }
function readUserData(id) { return readJson(userDataFile(id), null); }

// ======================= TẠO ĐƠN CẤP CỨU =======================

async function createEmergency(input, ownerId) {
  const type = TYPES[input.type] ? input.type : 'sos';
  const now = new Date();

  // Lấy thông tin bệnh nhân từ hồ sơ đã lưu của tài khoản (đáng tin hơn dữ liệu gửi kèm)
  const owner = ownerId ? users.find(u => u.id === ownerId) : null;
  const profile = (ownerId && readUserData(ownerId)?.profile) || {};
  const patientName = str(profile.name, 120) || owner?.name || str(input.patientName, 120) || 'Bệnh nhân chưa đặt tên';

  // Gộp cảnh báo trùng (ví dụ camera báo ngã liên tục) trong DEDUPE_SECONDS
  const dup = alerts.find(a => a.type === type && a.ownerId === (ownerId || null) && a.patientName === patientName &&
    now - new Date(a.createdAt) < DEDUPE_SECONDS * 1000);
  if (dup) return { ...dup, duplicate: true };

  const alert = {
    id: crypto.randomUUID(),
    ownerId: ownerId || null,
    type,
    title: TYPES[type].title,
    patientName,
    phone: str(profile.phone, 30) || owner?.phone || str(input.phone, 30),
    familyPhone: str(profile.familyPhone, 30) || str(input.familyPhone, 30),
    address: str(profile.address, 300) || str(input.address, 300),
    lat: num(input.lat), lng: num(input.lng), accuracy: num(input.accuracy),
    distance: num(input.distance),
    confidence: num(input.confidence),
    source: str(input.source, 60) || (type === 'fall' || type === 'zone' ? 'camera' : 'app'),
    note: str(input.note, 600),
    createdAt: now.toISOString(),
    snapshotUrl: null,
    synced: false,
    supabaseId: null,
    error: null,
  };

  if (typeof input.snapshot === 'string' && input.snapshot.length < 4_000_000) {
    const b64 = input.snapshot.replace(/^data:image\/\w+;base64,/, '');
    const file = `${alert.id}.jpg`;
    fs.writeFileSync(path.join(SNAP_DIR, file), Buffer.from(b64, 'base64'));
    alert.snapshotUrl = `${PUBLIC_BASE_URL}/snapshots/${file}`;
  }

  if (supabaseOn) {
    try {
      const row = await insert('nursing_bookings', toNursingBooking(alert));
      alert.supabaseId = row?.id ?? null;
      alert.synced = true;
      if (ALSO_TRIAGE) {
        // Bảng triage_reports kích hoạt thông báo đỏ "CẢNH BÁO SÀNG LỌC KHẨN" trên web quản lý
        const triage = { pain_level: TYPES[type].pain, urgent: true };
        if (PATIENT_USER_ID) triage.user_id = PATIENT_USER_ID;
        await insert('triage_reports', triage).catch(e => { alert.error = `triage_reports: ${e.message}`; });
      }
    } catch (e) {
      alert.error = e.message;
      console.error('[supabase] Không tạo được đơn:', e.message);
    }
  }

  alerts.unshift(alert);
  alerts = alerts.slice(0, 1000);
  writeJson(LOG_FILE, alerts);
  console.log(`[${alert.createdAt}] ${alert.title} — ${alert.patientName} — synced=${alert.synced}`);
  return alert;
}

// Ánh xạ sang bảng nursing_bookings mà web quản lý đang hiển thị realtime
// (urgency = 'immediate' → nhãn "HỎA TỐC"; status 'pending' → nút Xác nhận / Hoàn tất).
function toNursingBooking(a) {
  const map = a.lat != null ? `https://maps.google.com/?q=${a.lat},${a.lng}` : '';
  const lines = [
    a.title,
    a.note,
    a.confidence != null ? `Độ tin cậy AI: ${Math.round(a.confidence * 100)}%` : '',
    a.distance != null ? `Cách nhà: ${Math.round(a.distance)} m` : '',
    map ? `Vị trí GPS: ${map}` : '',
    a.snapshotUrl ? `Ảnh camera: ${a.snapshotUrl}` : '',
    a.familyPhone ? `Người thân: ${a.familyPhone}` : '',
    `Nguồn: ${a.source} · Mã: ${a.id.slice(0, 8)}`,
  ].filter(Boolean);
  return {
    patient_name: a.patientName,
    service_name: a.title,
    price: 0,
    phone: a.phone || a.familyPhone || '',
    address: a.address || (map ? `GPS ${a.lat.toFixed(5)}, ${a.lng.toFixed(5)}` : 'Chưa có địa chỉ'),
    scheduled_at: `NGAY LẬP TỨC · ${new Date(a.createdAt).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}`,
    medical_note: lines.join('\n'),
    urgency: 'immediate',
    status: 'pending',
    ...NURSING_EXTRA,
  };
}

async function insert(table, row) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify(row),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status} ${text.slice(0, 300)}`);
  const data = text ? JSON.parse(text) : null;
  return Array.isArray(data) ? data[0] : data;
}

// ======================= CAMERA THẬT =======================
// Bridge tự chạy fall_detector.py (Ultralytics YOLOv8) cho từng camera đã cài trong app.

const CAM_FILE = path.join(DATA_DIR, 'cameras.json');
const DETECTOR_SRC = path.join(__dirname, '..', 'fall_detection', 'fall_detector.py');
// Windows giới hạn độ dài đường dẫn → chạy Python từ thư mục ngắn
const CAM_WORKDIR = process.env.CAMERA_WORKDIR || path.join(process.env.LOCALAPPDATA || os.homedir(), 'gocare-camera');
const PYTHON = process.env.PYTHON_PATH || (process.platform === 'win32'
  ? path.join(process.env.LOCALAPPDATA || '', 'gocare-venv', 'Scripts', 'python.exe')
  : 'python3');
let camConfig = readJson(CAM_FILE, []);  // [{ id, ownerId, name, source, zone, wantRunning, lastError }]
const procs = {};    // id -> { child, log: [], stopping }
const frames = {};   // id -> { buf, at }

function saveCams() { writeJson(CAM_FILE, camConfig); }

function camView(c) {
  const hb = cameras[c.id];
  const p = procs[c.id];
  return {
    id: c.id, name: c.name, source: c.source, zone: c.zone || '',
    running: Boolean(p && !p.stopping),
    online: Boolean(hb && Date.now() - hb.lastSeen < 90_000) || Boolean(frames[c.id] && Date.now() - frames[c.id].at < 10_000),
    lastSeen: hb?.lastSeen || null,
    error: !p && c.lastError ? c.lastError : null,
  };
}

function validSource(s) {
  return /^\d{1,2}$/.test(s) || /^(rtsp|rtsps|https?):\/\/[^\s"'`]+$/i.test(s);
}

function startCamera(c) {
  if (procs[c.id]) return;
  if (!fs.existsSync(PYTHON)) throw new Error(`Chưa có Python/YOLOv8 tại ${PYTHON}. Xem README phần 3.`);
  fs.mkdirSync(CAM_WORKDIR, { recursive: true });
  fs.copyFileSync(DETECTOR_SRC, path.join(CAM_WORKDIR, 'fall_detector.py'));
  const owner = users.find(u => u.id === c.ownerId);
  const profile = (c.ownerId && readUserData(c.ownerId)?.profile) || {};
  const args = ['-u', 'fall_detector.py', '--source', c.source, '--bridge', `http://127.0.0.1:${PORT}`,
    '--camera-id', c.id, '--frame-every', '1'];
  if (API_TOKEN) args.push('--token', API_TOKEN);
  const name = profile.name || owner?.name;
  if (name) args.push('--patient', name);
  if (profile.address) args.push('--address', profile.address);
  if (c.zone) args.push('--zone', c.zone);
  // Không dùng shell: mỗi tham số truyền riêng, không bị chèn lệnh
  const child = spawn(PYTHON, args, { cwd: CAM_WORKDIR, env: { ...process.env, PYTHONIOENCODING: 'utf-8' }, windowsHide: true });
  const p = procs[c.id] = { child, log: [], stopping: false };
  const onData = d => {
    for (const line of d.toString('utf8').split(/\r?\n/).filter(Boolean)) {
      p.log.push(line); if (p.log.length > 40) p.log.shift();
      console.log(`[cam:${c.name}] ${line}`);
    }
  };
  child.stdout.on('data', onData);
  child.stderr.on('data', onData);
  child.on('exit', code => {
    const wasStopping = p.stopping;
    delete procs[c.id];
    delete frames[c.id];
    const cfg = camConfig.find(x => x.id === c.id);
    if (!cfg) return;
    if (wasStopping) { cfg.lastError = null; saveCams(); return; }
    cfg.lastError = `Camera dừng (mã ${code}). ${p.log.filter(l => /error|lỗi|không|Traceback|Exception/i.test(l)).slice(-2).join(' ')}`.trim();
    saveCams();
    // Tự bật lại sau 10 giây nếu người dùng vẫn muốn camera chạy
    if (cfg.wantRunning) setTimeout(() => { if (cfg.wantRunning && !procs[cfg.id]) { try { startCamera(cfg); } catch (e) { console.error(e.message); } } }, 10_000);
  });
  c.lastError = null;
}

function stopCamera(c) {
  const p = procs[c.id];
  if (!p) return;
  p.stopping = true;
  p.child.kill();
}

setTimeout(() => {
  for (const c of camConfig) if (c.wantRunning) { try { startCamera(c); } catch (e) { c.lastError = e.message; } }
}, 1500);

// ======================= GIỌNG ĐỌC TIẾNG VIỆT (Piper) =======================
// Giọng nữ tự nhiên vi_VN-vais1000 chạy ngay trên máy; mỗi câu đọc xong được lưu lại để lần sau phát tức thì.

const TTS_MODEL = process.env.TTS_MODEL || path.join(process.env.LOCALAPPDATA || os.homedir(), 'gocare-tts', 'vi_VN-vais1000-medium.onnx');
const TTS_DIR = path.join(DATA_DIR, 'tts');
fs.mkdirSync(TTS_DIR, { recursive: true });
let tts = null;  // { child, ready: Promise, waiting: Map }

function ttsAvailable() { return fs.existsSync(PYTHON) && fs.existsSync(TTS_MODEL); }

function ttsWorker() {
  if (tts) return tts;
  fs.mkdirSync(CAM_WORKDIR, { recursive: true });
  fs.copyFileSync(path.join(__dirname, 'tts_worker.py'), path.join(CAM_WORKDIR, 'tts_worker.py'));
  const child = spawn(PYTHON, ['-u', 'tts_worker.py', TTS_MODEL], { cwd: CAM_WORKDIR, env: { ...process.env, PYTHONIOENCODING: 'utf-8' }, windowsHide: true });
  const waiting = new Map();
  let markReady;
  const w = tts = { child, waiting, ready: new Promise(r => { markReady = r; }) };
  let buf = '';
  child.stdout.on('data', d => {
    buf += d.toString('utf8');
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 1);
      let msg; try { msg = JSON.parse(line); } catch { continue; }
      if (msg.ready) { markReady(); continue; }
      const job = waiting.get(msg.id);
      if (job) { waiting.delete(msg.id); msg.ok ? job.resolve() : job.reject(new Error(msg.error)); }
    }
  });
  child.stderr.on('data', d => console.log(`[tts] ${d.toString('utf8').trim()}`));
  child.on('exit', () => {
    for (const job of waiting.values()) job.reject(new Error('Giọng đọc bị dừng'));
    if (tts === w) tts = null;  // lần sau sẽ chạy lại
  });
  return w;
}

const ttsJobs = new Map();  // tránh đọc trùng cùng một câu cùng lúc
async function synthesize(text, speed) {
  const file = path.join(TTS_DIR, `${sha256(`${speed}|${text}`).slice(0, 32)}.wav`);
  if (fs.existsSync(file)) return file;
  if (ttsJobs.has(file)) return ttsJobs.get(file);
  const job = (async () => {
    const w = ttsWorker();
    await w.ready;
    const id = crypto.randomUUID();
    const tmp = `${file}.tmp`;
    await new Promise((resolve, reject) => {
      w.waiting.set(id, { resolve, reject });
      w.child.stdin.write(JSON.stringify({ id, text, out: tmp, speed }) + '\n');
      setTimeout(() => { if (w.waiting.delete(id)) reject(new Error('Đọc quá lâu')); }, 20_000);
    });
    fs.renameSync(tmp, file);
    return file;
  })().finally(() => ttsJobs.delete(file));
  ttsJobs.set(file, job);
  return job;
}
if (ttsAvailable()) setTimeout(() => { try { ttsWorker(); } catch (e) { console.error('[tts]', e.message); } }, 500);

process.on('exit', () => {
  for (const p of Object.values(procs)) { p.stopping = true; p.child.kill(); }
  if (tts) tts.child.kill();
});
process.on('SIGINT', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));

// ======================= HTTP =======================

const ERR_AUTH = { ok: false, error: 'Bạn cần đăng nhập lại' };
const ERR_DEVICE = { ok: false, error: 'Sai mã kết nối thiết bị (API_TOKEN)' };

const server = http.createServer(async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return end(res, 204);
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;

  try {
    // ----- Tài khoản -----
    if (p === '/api/auth/register' && req.method === 'POST') {
      const b = await readBody(req);
      const name = str(b.name, 80), phone = normPhone(b.phone), pin = String(b.pin || '');
      if (!name) return json(res, 400, { ok: false, error: 'Bạn nhập tên gọi nhé' });
      if (!phone) return json(res, 400, { ok: false, error: 'Số điện thoại chưa đúng' });
      if (!/^\d{6}$/.test(pin)) return json(res, 400, { ok: false, error: 'Mã PIN cần đúng 6 chữ số' });
      if (WEAK_PINS.has(pin)) return json(res, 400, { ok: false, error: 'Mã PIN này dễ đoán quá, bạn chọn số khác nhé' });
      if (users.some(u => u.phone === phone)) return json(res, 409, { ok: false, error: 'Số điện thoại này đã có tài khoản, bạn đăng nhập nhé' });
      const salt = crypto.randomBytes(16).toString('hex');
      const user = { id: `u-${crypto.randomBytes(6).toString('hex')}`, name, phone, salt, pinHash: hashPin(pin, salt), createdAt: new Date().toISOString() };
      users.push(user); writeJson(USERS_FILE, users);
      return json(res, 201, { ok: true, token: newSession(user), user: publicUser(user) });
    }
    if (p === '/api/auth/login' && req.method === 'POST') {
      const b = await readBody(req);
      const phone = normPhone(b.phone), pin = String(b.pin || '');
      if (!phone) return json(res, 400, { ok: false, error: 'Số điện thoại chưa đúng' });
      const f = failures[phone];
      if (f && f.until > Date.now()) {
        return json(res, 429, { ok: false, error: `Nhập sai nhiều lần. Bạn thử lại sau ${Math.ceil((f.until - Date.now()) / 60000)} phút nhé`, lockedUntil: f.until });
      }
      const user = users.find(u => u.phone === phone);
      const ok = user && /^\d{6}$/.test(pin) &&
        crypto.timingSafeEqual(Buffer.from(hashPin(pin, user.salt), 'hex'), Buffer.from(user.pinHash, 'hex'));
      if (!ok) {
        // Đếm tiếp số lần sai; chỉ đếm lại từ đầu khi lần khóa trước đã hết hạn
        const prev = f && !(f.until && f.until <= Date.now()) ? f.count : 0;
        const cur = failures[phone] = { count: prev + 1, until: 0 };
        if (cur.count >= 5) cur.until = Date.now() + 10 * 60000;
        const left = Math.max(0, 5 - cur.count);
        return json(res, 401, { ok: false, error: left ? `Số điện thoại hoặc mã PIN chưa đúng. Còn ${left} lần thử` : 'Nhập sai 5 lần. Tài khoản tạm khóa 10 phút', attemptsLeft: left });
      }
      delete failures[phone];
      return json(res, 200, { ok: true, token: newSession(user), user: publicUser(user) });
    }
    if (p === '/api/auth/logout' && req.method === 'POST') {
      const m = String(req.headers.authorization || '').match(/^Bearer\s+(\S+)$/i);
      if (m) { delete sessions[sha256(m[1])]; writeJson(SESSIONS_FILE, sessions); }
      return json(res, 200, { ok: true });
    }
    if (p === '/api/auth/me' && req.method === 'GET') {
      const u = await sessionUser(req);
      return u ? json(res, 200, { ok: true, user: publicUser(u) }) : json(res, 401, ERR_AUTH);
    }
    if (p === '/api/me/data') {
      const u = await sessionUser(req);
      if (!u) return json(res, 401, ERR_AUTH);
      if (req.method === 'GET') return json(res, 200, { ok: true, data: readUserData(u.id) });
      if (req.method === 'PUT') {
        const b = await readBody(req, 1_000_000);
        if (!b.data || typeof b.data !== 'object') return json(res, 400, { ok: false, error: 'Dữ liệu không hợp lệ' });
        writeJson(userDataFile(u.id), { ...b.data, updatedAt: new Date().toISOString() });
        return json(res, 200, { ok: true });
      }
    }

    // ----- Giọng đọc (không cần đăng nhập: màn hình đăng nhập cũng đọc to) -----
    if (p === '/api/tts' && req.method === 'GET') {
      if (!ttsAvailable()) return json(res, 503, { ok: false, error: 'Chưa cài giọng đọc GoCare' });
      const text = str(url.searchParams.get('text') || '', 400);
      if (!text) return end(res, 400);
      const speed = [0.75, 0.85, 1].includes(Number(url.searchParams.get('speed'))) ? Number(url.searchParams.get('speed')) : 0.85;
      const file = await synthesize(text, speed);
      res.writeHead(200, { 'Content-Type': 'audio/wav', 'Cache-Control': 'public, max-age=31536000, immutable' });
      return fs.createReadStream(file).pipe(res);
    }
    if (p === '/api/tts/status' && req.method === 'GET') {
      return json(res, 200, { ok: true, available: ttsAvailable(), voice: 'GoCare – giọng nữ tiếng Việt (Piper vais1000)' });
    }

    // ----- Cấp cứu & trạng thái -----
    if (p === '/api/status' && req.method === 'GET') {
      const u = await sessionUser(req);
      const mine = u ? camConfig.filter(c => c.ownerId === u.id).map(c => c.id) : [];
      return json(res, 200, {
        ok: true,
        mode: supabaseOn ? 'supabase' : 'demo',
        cameras: u ? mine.map(id => ({ id, ...(cameras[id] || {}), online: Boolean(cameras[id] && Date.now() - cameras[id].lastSeen < 90_000) })) : [],
        lastAlert: u ? alerts.find(a => a.ownerId === u.id) || null : null,
      });
    }
    if (p === '/api/alerts' && req.method === 'GET') {
      const u = await sessionUser(req);
      if (!u) return json(res, 401, ERR_AUTH);
      const limit = Math.min(Number(url.searchParams.get('limit') || 30), 200);
      return json(res, 200, alerts.filter(a => a.ownerId === u.id).slice(0, limit));
    }
    if (p === '/api/emergency' && req.method === 'POST') {
      const u = await sessionUser(req);
      if (!u && !deviceAuthorized(req)) return json(res, 401, ERR_DEVICE);
      const body = await readBody(req);
      // Camera gửi kèm mã camera → cảnh báo thuộc về chủ camera
      const ownerId = u ? u.id : camConfig.find(c => c.id === body.camera)?.ownerId || null;
      const alert = await createEmergency(body, ownerId);
      return json(res, 201, { ok: true, alert });
    }
    if (p === '/api/heartbeat' && req.method === 'POST') {
      if (!deviceAuthorized(req)) return json(res, 401, ERR_DEVICE);
      const body = await readBody(req);
      const id = str(body.camera, 60) || 'camera';
      cameras[id] = { lastSeen: Date.now(), status: str(body.status, 60) || 'watching', patient: str(body.patientName, 120) };
      return json(res, 200, { ok: true });
    }

    // ----- Camera thật -----
    if (p === '/api/cameras' && req.method === 'GET') {
      const u = await sessionUser(req);
      if (!u) return json(res, 401, ERR_AUTH);
      // Camera cài trước khi có tài khoản → giao cho người đăng nhập đầu tiên
      let claimed = false;
      for (const c of camConfig) if (!c.ownerId) { c.ownerId = u.id; claimed = true; }
      if (claimed) saveCams();
      return json(res, 200, camConfig.filter(c => c.ownerId === u.id).map(camView));
    }
    if (p === '/api/cameras' && req.method === 'POST') {
      const u = await sessionUser(req);
      if (!u) return json(res, 401, ERR_AUTH);
      const b = await readBody(req);
      const source = str(String(b.source ?? ''), 400);
      if (!validSource(source)) return json(res, 400, { ok: false, error: 'Nguồn camera không hợp lệ (số webcam hoặc link rtsp://…)' });
      const zone = str(b.zone, 200);
      if (zone && !/^[\d.,;\s]+$/.test(zone)) return json(res, 400, { ok: false, error: 'Vùng an toàn không hợp lệ' });
      const c = { id: `cam-${crypto.randomBytes(4).toString('hex')}`, ownerId: u.id, name: str(b.name, 60) || 'Camera', source, zone, wantRunning: false, lastError: null };
      camConfig.push(c); saveCams();
      return json(res, 201, camView(c));
    }
    const camMatch = p.match(/^\/api\/cameras\/([\w-]+)(?:\/(start|stop))?$/);
    if (camMatch) {
      const u = await sessionUser(req);
      if (!u) return json(res, 401, ERR_AUTH);
      const c = camConfig.find(x => x.id === camMatch[1] && x.ownerId === u.id);
      if (!c) return json(res, 404, { ok: false, error: 'Không tìm thấy camera' });
      if (camMatch[2] === 'start' && req.method === 'POST') {
        c.wantRunning = true;
        try { startCamera(c); } catch (e) { c.wantRunning = false; c.lastError = e.message; saveCams(); return json(res, 500, { ok: false, error: e.message }); }
        saveCams(); return json(res, 200, camView(c));
      }
      if (camMatch[2] === 'stop' && req.method === 'POST') {
        c.wantRunning = false; stopCamera(c); saveCams();
        return json(res, 200, camView(c));
      }
      if (!camMatch[2] && req.method === 'DELETE') {
        c.wantRunning = false; stopCamera(c);
        camConfig = camConfig.filter(x => x.id !== c.id); saveCams();
        return json(res, 200, { ok: true });
      }
    }
    if (p === '/api/frame' && req.method === 'POST') {
      if (!deviceAuthorized(req)) return json(res, 401, ERR_DEVICE);
      const b = await readBody(req);
      const id = str(b.camera, 60);
      if (id && typeof b.jpeg === 'string') frames[id] = { buf: Buffer.from(b.jpeg, 'base64'), at: Date.now() };
      return json(res, 200, { ok: true });
    }
    const frameMatch = p.match(/^\/api\/frame\/([\w-]+)$/);
    if (frameMatch && req.method === 'GET') {
      const u = await sessionUser(req);
      if (!u) return json(res, 401, ERR_AUTH);
      if (!camConfig.some(c => c.id === frameMatch[1] && c.ownerId === u.id)) return end(res, 404);
      const f = frames[frameMatch[1]];
      if (!f) return end(res, 404);
      res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'no-store' });
      return res.end(f.buf);
    }
    if (p.startsWith('/snapshots/')) {
      return serveFile(res, path.join(SNAP_DIR, path.basename(p)));
    }
    if (req.method === 'GET') {
      const rel = p === '/' ? 'index.html' : decodeURIComponent(p.slice(1));
      const file = path.normalize(path.join(APP_DIR, rel));
      if (!file.startsWith(APP_DIR)) return end(res, 403);
      return serveFile(res, file);
    }
    end(res, 404);
  } catch (e) {
    console.error(e);
    json(res, 500, { ok: false, error: e.message });
  }
});

server.listen(PORT, () => {
  console.log(`GoCare Bridge chạy tại http://localhost:${PORT}`);
  console.log(supabaseOn
    ? `Đã kết nối Supabase: ${SUPABASE_URL} → đơn cấp cứu sẽ hiện trên web quản lý.`
    : 'CHẾ ĐỘ DEMO: chưa có SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY trong bridge/.env — cảnh báo chỉ lưu tại bridge/data/alerts.json.');
});

// ======================= tiện ích =======================

// Thiết bị (camera) xác thực bằng API_TOKEN; chưa đặt API_TOKEN thì chỉ nên chạy trong mạng nội bộ
function deviceAuthorized(req) {
  if (!API_TOKEN) return true;
  const got = String(req.headers['x-api-key'] || '');
  return got.length === API_TOKEN.length && crypto.timingSafeEqual(Buffer.from(got), Buffer.from(API_TOKEN));
}

function readBody(req, limit = 6_000_000) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > limit) { reject(new Error('Dữ liệu quá lớn')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch { reject(new Error('JSON không hợp lệ')); } });
    req.on('error', reject);
  });
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.png': 'image/png', '.mp3': 'audio/mpeg' };

function serveFile(res, file) {
  fs.readFile(file, (err, buf) => {
    if (err) return end(res, 404);
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(buf);
  });
}

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-api-key');
}
function json(res, code, data) { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(data)); }
function end(res, code) { res.writeHead(code); res.end(); }
function str(v, max) { return typeof v === 'string' ? v.trim().slice(0, max) : ''; }
function num(v) { const n = Number(v); return v == null || v === '' || !Number.isFinite(n) ? null : n; }
function readJson(f, fallback) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return fallback; } }
function writeJson(f, data) { fs.writeFileSync(f, JSON.stringify(data, null, 2)); }

function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
