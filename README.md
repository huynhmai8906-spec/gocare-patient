# GoCare — App Bệnh Nhân

App dành cho người cao tuổi, liên kết với hệ thống GoCare:
- **Web Khách Hàng:** https://mai-hu-nh-th-tuy-t-o684.vercel.app
- **Web Quản Lý:** https://quanlyweb-bjsh.vercel.app

Cả ba dùng **chung một database Supabase**. Vì vậy tài khoản tạo trên app đăng nhập được web khách hàng, còn đơn cấp cứu và hồ sơ bệnh nhân hiện ngay trên web quản lý.

| Tính năng | |
|---|---|
| 🔐 Đăng ký / đăng nhập / đăng xuất / quên mật khẩu | Supabase Auth, dùng chung tài khoản với web GoCare |
| ☁️ Dữ liệu theo tài khoản | Thuốc, chỉ số, lịch hẹn, cài đặt được lưu trên Supabase và đồng bộ giữa các máy |
| 🔊 Đọc to mọi nút khi bấm | Giọng nữ tiếng Việt (Piper, cần Home Hub) hoặc giọng có sẵn của máy |
| 🚑 Nút **Gọi cấp cứu** | Tạo đơn **HỎA TỐC** và cảnh báo đỏ trên Web Quản Lý, rồi gọi 115 |
| 💊 Nhắc uống thuốc, lịch hẹn khám | Chuông, giọng đọc, thông báo |
| 📍 Vùng an toàn GPS | Ra khỏi bán kính → báo động, sau 60 giây tự báo bệnh viện |
| 📹 Camera chống té ngã (YOLOv8) | Chạy trên máy tính ở nhà (Home Hub), có hình trực tiếp trong app |
| ❤️ Sức khỏe | Ghi huyết áp, nhịp tim, đường huyết; có biểu đồ 7 lần đo |

## Cấu trúc

```
app/                 App (HTML/CSS/JS, PWA) — Vercel phục vụ thư mục này
api/emergency.js     Vercel Function: kiểm tra đăng nhập → tạo đơn cấp cứu trên Supabase
supabase/            SQL tạo bảng patient_app_data (chạy 1 lần)
bridge/              GoCare Home Hub — chạy trên máy tính ở nhà: camera AI, giọng đọc Piper
fall_detection/      Bộ phát hiện té ngã & vùng an toàn trong nhà (Ultralytics YOLOv8)
```

## Deploy lên Vercel

1. Vào vercel.com → **Add New → Project** → chọn repo GitHub này.
   - *Framework* chọn **Other**.
   - *Root Directory* để mặc định. Các thiết lập khác đã có sẵn trong `vercel.json`.
2. **Environment Variables** (Project → Settings). Không bắt buộc, nhưng nên đặt:
   - `SUPABASE_SERVICE_ROLE_KEY`: khóa bí mật của Supabase (Dashboard → Project Settings → API). Có khóa này thì đơn cấp cứu luôn ghi được vào web quản lý, kể cả khi quy tắc bảo mật (RLS) chặn bệnh nhân ghi trực tiếp. **Chỉ đặt trên Vercel, không bao giờ đưa vào code.**
   - `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`: chỉ cần khi dùng project Supabase khác.
3. Trong **Supabase Dashboard**:
   - **Authentication → URL Configuration:** thêm địa chỉ Vercel của app (ví dụ `https://gocare-patient.vercel.app`) vào *Site URL / Redirect URLs*. Nếu thiếu, link xác nhận email và link đặt lại mật khẩu sẽ không quay về app.
   - **SQL Editor:** chạy `supabase/patient_app_data.sql` để có bảng lưu dữ liệu app. Chưa chạy thì app vẫn hoạt động, nhưng dữ liệu tạm lưu trong hồ sơ tài khoản và bị giới hạn dung lượng.

Hoặc deploy bằng lệnh:

```bash
vercel --prod
```

## GoCare Home Hub (máy tính ở nhà: camera AI + giọng đọc)

Vercel không chạy được Python/YOLOv8, nên camera và giọng Piper chạy trên một máy tính ở nhà. Máy này cần **Node.js 18** trở lên và **Python 3.12**.

```bash
npm run hub
```

- Cài AI cho camera: xem phần **Camera** bên dưới.
- Cài giọng đọc:

```bash
%LOCALAPPDATA%\gocare-venv\Scripts\python -m pip install piper-tts
```

  Sau đó tải `vi_VN-vais1000-medium.onnx` và `.onnx.json` từ huggingface.co/rhasspy/piper-voices vào `%LOCALAPPDATA%\gocare-tts\`.
- Tạo `bridge/.env` từ `bridge/.env.example`. Điền `SUPABASE_SERVICE_ROLE_KEY` để cảnh báo té ngã từ camera cũng lên web quản lý, và `API_TOKEN` cho camera.
- Mở app trên Vercel → **Hồ sơ → Kết nối bệnh viện** → nhập địa chỉ **HTTPS** của Home Hub (ví dụ dùng `cloudflared tunnel --url http://localhost:8787`). App trên Vercel chạy HTTPS nên không gọi được địa chỉ `http://` trong mạng nhà.
- Home Hub tự nhận phiên đăng nhập Supabase của app. Camera và cảnh báo gắn đúng với tài khoản bệnh nhân.

### Camera

```bash
py -3.12 -m venv %LOCALAPPDATA%\gocare-venv
```

```bash
%LOCALAPPDATA%\gocare-venv\Scripts\python -m pip install --index-url https://download.pytorch.org/whl/cpu torch torchvision
```

```bash
%LOCALAPPDATA%\gocare-venv\Scripts\python -m pip install -r fall_detection/requirements.txt
```

Sau đó vào app → **An toàn → Cài camera mới** (webcam hoặc link RTSP). Home Hub tự chạy YOLOv8 cho camera đó.

Một lần ngã được xác nhận khi đủ 3 điều kiện:
1. Người vừa đứng thẳng trong vòng 4 giây trước đó.
2. Đỉnh đầu tụt ít nhất 40% chiều cao người, rồi chuyển sang tư thế nằm.
3. Người nằm yên ít nhất 2,5 giây.

Ngồi cúi về phía trước hay nằm lên giường từ từ sẽ không bị báo nhầm. Khi có thêm model té ngã riêng (`--fall-weights`), hai cách phát hiện chạy song song.

## Bảo mật

- Khóa `sb_publishable_…` trong `app/config.js` là khóa công khai, được thiết kế để nằm trong trình duyệt (hai web GoCare cũng dùng). Khóa bí mật `service_role` chỉ nằm trong biến môi trường của Vercel hoặc trong `bridge/.env`. Cả hai nơi này đều nằm trong `.gitignore`.
- Dữ liệu trên Home Hub (`bridge/data/`) không được đưa lên GitHub. Thư mục này chứa tài khoản cũ, cảnh báo, ảnh camera và giọng đọc đã tạo.
- Mỗi bệnh nhân chỉ đọc và ghi được dữ liệu của chính mình (RLS trong `supabase/patient_app_data.sql`).
