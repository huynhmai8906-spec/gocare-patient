import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

interface ServerCamera {
  id: string;
  name: string;
  source: string;
  running: boolean;
  zone?: string;
  lastError?: string | null;
}

// In-memory Node machine camera configuration
let nodeCameras: ServerCamera[] = [
  {
    id: 'cam-phong-khach',
    name: 'Camera phòng khách',
    source: 'Webcam chính (Node)',
    running: true,
    zone: '0.12,0.08;0.88,0.08;0.88,0.92;0.12,0.92',
  },
];

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'node-camera-and-api-middleware',
      configureServer(server) {
        server.middlewares.use(async (req, res, next) => {
          const urlStr = req.url || '';
          const url = new URL(urlStr, 'http://localhost:3000');
          const pathname = url.pathname;

          // Helper to send JSON
          const sendJson = (code: number, data: any) => {
            res.setHeader('Content-Type', 'application/json');
            res.statusCode = code;
            res.end(JSON.stringify(data));
          };

          // 1. Status endpoint
          if (pathname === '/api/status' && req.method === 'GET') {
            return sendJson(200, {
              ok: true,
              node: 'GoCare Node.js Hub',
              mode: 'active',
              cameras: nodeCameras.map((c) => ({
                id: c.id,
                name: c.name,
                source: c.source,
                running: c.running,
                online: true,
              })),
            });
          }

          // 2. TTS status endpoint
          if (pathname === '/api/tts/status' && req.method === 'GET') {
            return sendJson(200, {
              ok: true,
              available: true,
              voice: 'GoCare – giọng nữ tiếng Việt',
            });
          }

          // 3. GET all cameras on Node
          if (pathname === '/api/cameras' && req.method === 'GET') {
            return sendJson(200, nodeCameras);
          }

          // 4. POST add new camera on Node
          if (pathname === '/api/cameras' && req.method === 'POST') {
            let bodyStr = '';
            req.on('data', (chunk) => (bodyStr += chunk));
            req.on('end', () => {
              try {
                const body = JSON.parse(bodyStr || '{}');
                const newCam: ServerCamera = {
                  id: `cam-${Math.random().toString(36).slice(2, 8)}`,
                  name: body.name || 'Camera mới',
                  source: body.source || '0',
                  running: true,
                  zone: body.zone || '',
                };
                nodeCameras.push(newCam);
                return sendJson(201, newCam);
              } catch (err: any) {
                return sendJson(400, { ok: false, error: err.message });
              }
            });
            return;
          }

          // 5. POST start / stop camera on Node
          const camActionMatch = pathname.match(/^\/api\/cameras\/([^/]+)\/(start|stop)$/);
          if (camActionMatch && req.method === 'POST') {
            const [, camId, action] = camActionMatch;
            const targetCam = nodeCameras.find((c) => c.id === camId);
            if (!targetCam) {
              return sendJson(404, { ok: false, error: 'Không tìm thấy camera trên Node' });
            }
            targetCam.running = action === 'start';
            return sendJson(200, {
              ok: true,
              camera: targetCam,
              message: action === 'start' ? 'Đã bật camera trên Node' : 'Đã tắt camera trên Node',
            });
          }

          // 6. DELETE camera on Node
          const camDeleteMatch = pathname.match(/^\/api\/cameras\/([^/]+)$/);
          if (camDeleteMatch && req.method === 'DELETE') {
            const camId = camDeleteMatch[1];
            nodeCameras = nodeCameras.filter((c) => c.id !== camId);
            return sendJson(200, { ok: true, message: 'Đã xóa camera trên Node' });
          }

          // 7. GET /api/frame/:id - Serve SVG/JPEG frame from Node
          const frameMatch = pathname.match(/^\/api\/frame\/([^/]+)$/);
          if (frameMatch && req.method === 'GET') {
            const camId = frameMatch[1];
            const targetCam = nodeCameras.find((c) => c.id === camId);
            const now = new Date().toLocaleTimeString('vi-VN');
            const svgFrame = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360">
              <rect width="640" height="360" fill="#142c22"/>
              <line x1="0" y1="260" x2="640" y2="260" stroke="#224838" stroke-width="2"/>
              <line x1="120" y1="260" x2="0" y2="360" stroke="#224838" stroke-width="2"/>
              <line x1="520" y1="260" x2="640" y2="360" stroke="#224838" stroke-width="2"/>
              <rect x="76" y="28" width="488" height="304" fill="none" stroke="#eab308" stroke-width="2" stroke-dasharray="6,6"/>
              <text x="86" y="50" fill="#eab308" font-size="12" font-family="sans-serif" font-weight="bold">VÙNG AN TOÀN TRONG NHÀ</text>
              <rect x="270" y="80" width="100" height="200" fill="none" stroke="#16a34a" stroke-width="3"/>
              <rect x="270" y="56" width="90" height="22" fill="#16a34a"/>
              <text x="278" y="72" fill="#ffffff" font-size="12" font-family="sans-serif" font-weight="bold">ĐỨNG 8°</text>
              <circle cx="320" cy="115" r="18" fill="#16a34a" stroke="#fff" stroke-width="2"/>
              <line x1="320" y1="115" x2="320" y2="220" stroke="#fff" stroke-width="2"/>
              <rect x="0" y="326" width="640" height="34" fill="rgba(0,0,0,0.6)"/>
              <text x="14" y="348" fill="#ffffff" font-size="12" font-family="sans-serif">Node AI Cam | ${targetCam?.name || 'Phòng khách'} | ${now}</text>
            </svg>`;
            res.setHeader('Content-Type', 'image/svg+xml');
            res.setHeader('Cache-Control', 'no-store');
            res.statusCode = 200;
            res.end(svgFrame);
            return;
          }

          // 8. Emergency Alert Endpoint
          if (pathname.startsWith('/api/emergency') && req.method === 'POST') {
            let bodyStr = '';
            req.on('data', (chunk) => (bodyStr += chunk));
            req.on('end', async () => {
              try {
                const body = JSON.parse(bodyStr || '{}');
                const authHeader = req.headers.authorization || '';
                const token = authHeader.replace(/^Bearer\s+/i, '');

                const supabaseUrl = process.env.SUPABASE_URL || 'https://niptzzxfgduhcrbofthg.supabase.co';
                const publicKey = process.env.SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_1BbQKqBKyHS7Qo-yglIpkg_pNW14RIV';
                const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
                const key = serviceKey || publicKey;

                let user: any = null;
                if (token) {
                  try {
                    const uRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
                      headers: { apikey: publicKey, Authorization: `Bearer ${token}` },
                    });
                    if (uRes.ok) user = await uRes.json();
                  } catch {
                    // Ignore error
                  }
                }

                const titles: Record<string, string> = {
                  sos: '🚨 CẤP CỨU: Bệnh nhân bấm nút SOS',
                  fall: '🚨 CẤP CỨU: Camera phát hiện TÉ NGÃ',
                  geofence: '⚠️ KHẨN: Bệnh nhân ra khỏi vùng an toàn (GPS)',
                  zone: '⚠️ KHẨN: Bệnh nhân rời vùng an toàn trong nhà (camera)',
                  health: '⚠️ KHẨN: Chỉ số sức khỏe bất thường',
                };

                const typeKey = body.type || 'sos';
                const title = titles[typeKey] || titles.sos;
                const createdAt = new Date().toISOString();

                let bookingId: any = null;
                let synced = false;
                let errorMsg = null;

                try {
                  const bookingRow = {
                    patient_name: body.patientName || user?.user_metadata?.full_name || 'Bệnh nhân GoCare',
                    service_name: title,
                    price: 0,
                    phone: body.phone || user?.user_metadata?.phone || body.familyPhone || '',
                    address: body.address || 'Chưa có địa chỉ',
                    scheduled_at: `NGAY LẬP TỨC · ${new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}`,
                    medical_note: `${title}\n${body.note || ''}\nTài khoản: ${user?.email || 'Khách'} · Nguồn: Node.js App Bệnh Nhân GoCare`,
                    urgency: 'immediate',
                    status: 'pending',
                    ...(user?.id ? { user_id: user.id } : {}),
                  };

                  const bRes = await fetch(`${supabaseUrl}/rest/v1/nursing_bookings`, {
                    method: 'POST',
                    headers: {
                      apikey: key,
                      Authorization: `Bearer ${serviceKey || token || publicKey}`,
                      'Content-Type': 'application/json',
                      Prefer: 'return=representation',
                    },
                    body: JSON.stringify(bookingRow),
                  });

                  if (bRes.ok) {
                    const bData = await bRes.json();
                    bookingId = Array.isArray(bData) ? bData[0]?.id : bData?.id;
                    synced = true;
                  } else {
                    const errText = await bRes.text();
                    errorMsg = errText.slice(0, 150);
                  }
                } catch (e: any) {
                  errorMsg = e.message;
                }

                return sendJson(200, {
                  ok: true,
                  alert: {
                    type: typeKey,
                    title,
                    createdAt,
                    synced,
                    supabaseId: bookingId,
                    error: errorMsg,
                  },
                });
              } catch (err: any) {
                return sendJson(200, {
                  ok: true,
                  alert: {
                    type: 'sos',
                    title: '🚨 CẤP CỨU: Bệnh nhân bấm nút SOS',
                    createdAt: new Date().toISOString(),
                    synced: false,
                    error: err.message,
                  },
                });
              }
            });
            return;
          }

          next();
        });
      },
    },
  ],
  server: {
    host: '0.0.0.0',
    port: 3000,
    headers: {
      'Permissions-Policy': 'camera=(self "*"), microphone=(self "*"), geolocation=(self "*")',
      'Access-Control-Allow-Origin': '*',
    },
  },
  preview: {
    host: '0.0.0.0',
    port: 3000,
    headers: {
      'Permissions-Policy': 'camera=(self "*"), microphone=(self "*"), geolocation=(self "*")',
      'Access-Control-Allow-Origin': '*',
    },
  },
});
