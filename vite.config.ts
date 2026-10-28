import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'api-emergency-middleware',
      configureServer(server) {
        server.middlewares.use(async (req, res, next) => {
          if (req.url?.startsWith('/api/emergency') && req.method === 'POST') {
            let bodyStr = '';
            req.on('data', (chunk) => {
              bodyStr += chunk;
            });
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
                      headers: { apikey: publicKey, Authorization: `Bearer ${token}` }
                    });
                    if (uRes.ok) user = await uRes.json();
                  } catch {
                    // Ignore error if user endpoint fails
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

                // If user and supabase key available, attempt insert into nursing_bookings
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
                    medical_note: `${title}\n${body.note || ''}\nTài khoản: ${user?.email || 'Khách'} · Nguồn: App Bệnh Nhân GoCare`,
                    urgency: 'immediate',
                    status: 'pending',
                    ...(user?.id ? { user_id: user.id } : {})
                  };

                  const bRes = await fetch(`${supabaseUrl}/rest/v1/nursing_bookings`, {
                    method: 'POST',
                    headers: {
                      apikey: key,
                      Authorization: `Bearer ${serviceKey || token || publicKey}`,
                      'Content-Type': 'application/json',
                      Prefer: 'return=representation'
                    },
                    body: JSON.stringify(bookingRow)
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

                res.setHeader('Content-Type', 'application/json');
                res.statusCode = 200;
                res.end(JSON.stringify({
                  ok: true,
                  alert: {
                    type: typeKey,
                    title,
                    createdAt,
                    synced,
                    supabaseId: bookingId,
                    error: errorMsg
                  }
                }));
              } catch (err: any) {
                res.setHeader('Content-Type', 'application/json');
                res.statusCode = 200;
                res.end(JSON.stringify({
                  ok: true,
                  alert: {
                    type: 'sos',
                    title: '🚨 CẤP CỨU: Bệnh nhân bấm nút SOS',
                    createdAt: new Date().toISOString(),
                    synced: false,
                    error: err.message
                  }
                }));
              }
            });
            return;
          }
          next();
        });
      }
    }
  ],
  server: {
    host: '0.0.0.0',
    port: 3000,
  },
  preview: {
    host: '0.0.0.0',
    port: 3000,
  }
});
