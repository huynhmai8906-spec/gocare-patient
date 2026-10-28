// Vercel Function: POST /api/emergency
// App gửi kèm access token Supabase của bệnh nhân → kiểm tra token → tạo đơn cấp cứu "HỎA TỐC"
// trong nursing_bookings + cảnh báo đỏ trong triage_reports, hiện realtime trên Web Quản Lý GoCare.
//
// Biến môi trường trên Vercel (Project Settings → Environment Variables):
//   SUPABASE_URL                 (mặc định: Supabase dùng chung của GoCare)
//   SUPABASE_PUBLISHABLE_KEY     (mặc định: khóa công khai của GoCare)
//   SUPABASE_SERVICE_ROLE_KEY    (khuyên dùng — ghi đơn kể cả khi RLS chặn; chỉ đặt trên Vercel, không đưa vào code)

const SUPABASE_URL = (process.env.SUPABASE_URL || 'https://niptzzxfgduhcrbofthg.supabase.co').replace(/\/+$/, '');
const PUBLIC_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_1BbQKqBKyHS7Qo-yglIpkg_pNW14RIV';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const TYPES = {
  sos:      { title: '🚨 CẤP CỨU: Bệnh nhân bấm nút SOS', pain: 10 },
  fall:     { title: '🚨 CẤP CỨU: Camera phát hiện TÉ NGÃ', pain: 10 },
  geofence: { title: '⚠️ KHẨN: Bệnh nhân ra khỏi vùng an toàn (GPS)', pain: 7 },
  zone:     { title: '⚠️ KHẨN: Bệnh nhân rời vùng an toàn trong nhà (camera)', pain: 7 },
  health:   { title: '⚠️ KHẨN: Chỉ số sức khỏe bất thường', pain: 8 },
};

const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const num = v => { const n = Number(v); return v == null || v === '' || !Number.isFinite(n) ? null : n; };

async function getUser(token) {
  const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: PUBLIC_KEY, Authorization: `Bearer ${token}` } });
  return r.ok ? r.json() : null;
}

async function insert(table, row, token) {
  // Có khóa service_role thì ghi bằng khóa đó; không có thì ghi thay mặt bệnh nhân (theo RLS của database)
  const key = SERVICE_KEY || PUBLIC_KEY;
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: { apikey: key, Authorization: `Bearer ${SERVICE_KEY || token}`, 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: JSON.stringify(row),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`${table}: ${r.status} ${text.slice(0, 200)}`);
  const data = text ? JSON.parse(text) : null;
  return Array.isArray(data) ? data[0] : data;
}

function buildBooking(user, b) {
  const t = TYPES[b.type] || TYPES.sos;
  const lat = num(b.lat), lng = num(b.lng);
  const map = lat != null && lng != null ? `https://maps.google.com/?q=${lat},${lng}` : '';
  const meta = user.user_metadata || {};
  const name = str(b.patientName, 120) || meta.full_name || user.email || 'Bệnh nhân GoCare';
  const note = [
    t.title,
    str(b.note, 600),
    num(b.confidence) != null ? `Độ tin cậy AI: ${Math.round(num(b.confidence) * 100)}%` : '',
    num(b.distance) != null ? `Cách nhà: ${Math.round(num(b.distance))} m` : '',
    map ? `Vị trí GPS: ${map}` : '',
    str(b.familyPhone, 30) ? `Người thân: ${str(b.familyPhone, 30)}` : '',
    `Tài khoản: ${user.email || user.id} · Nguồn: App Bệnh Nhân GoCare`,
  ].filter(Boolean).join('\n');
  return {
    title: t.title,
    pain: t.pain,
    row: {
      user_id: user.id,
      patient_name: name,
      service_name: t.title,
      price: 0,
      phone: str(b.phone, 30) || meta.phone || str(b.familyPhone, 30) || '',
      address: str(b.address, 300) || (map ? `GPS ${lat.toFixed(5)}, ${lng.toFixed(5)}` : 'Chưa có địa chỉ'),
      scheduled_at: `NGAY LẬP TỨC · ${new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}`,
      medical_note: note,
      urgency: 'immediate',
      status: 'pending',
    },
  };
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Chỉ nhận POST' });

  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) return res.status(401).json({ ok: false, error: 'Bạn cần đăng nhập' });
  const user = await getUser(token).catch(() => null);
  if (!user?.id) return res.status(401).json({ ok: false, error: 'Phiên đăng nhập hết hạn, bạn đăng nhập lại nhé' });

  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  const { title, pain, row } = buildBooking(user, body);

  const result = { ok: true, alert: { type: body.type || 'sos', title, createdAt: new Date().toISOString(), synced: false, error: null } };
  try {
    let booking;
    try { booking = await insert('nursing_bookings', row, token); }
    catch (e) {
      // Một số database chưa có cột user_id trong nursing_bookings → thử lại không có cột này
      if (!/user_id/.test(e.message)) throw e;
      const { user_id, ...rest } = row;
      booking = await insert('nursing_bookings', rest, token);
    }
    result.alert.synced = true;
    result.alert.supabaseId = booking?.id ?? null;
    await insert('triage_reports', { user_id: user.id, pain_level: pain, urgent: true }, token)
      .catch(e => { result.alert.error = e.message; });
  } catch (e) {
    result.ok = false;
    result.alert.error = e.message;
    return res.status(502).json(result);
  }
  return res.status(201).json(result);
};

module.exports.buildBooking = buildBooking; // để kiểm thử
