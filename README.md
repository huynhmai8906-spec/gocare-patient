# GoCare — App Bệnh Nhân (React + TypeScript)

Ứng dụng hỗ trợ bệnh nhân và người cao tuổi GoCare, được viết lại hoàn chỉnh bằng **React 19 + TypeScript + Vite**. Ứng dụng kết nối trực tiếp với hệ sinh thái y tế GoCare:
- **Web Khách Hàng:** https://mai-hu-nh-th-tuy-t-o684.vercel.app
- **Web Quản Lý Bệnh Viện:** https://quanlyweb-bjsh.vercel.app

Cả ba ứng dụng dùng **chung một database Supabase**, đảm bảo đồng bộ tài khoản, đơn cấp cứu, lịch khám và hồ sơ bệnh nhân theo thời gian thực.

## Tính năng chính

| Tính năng | Mô tả |
|---|---|
| 🔐 **Đăng nhập / Đăng ký / Quên mật khẩu** | Tích hợp Supabase Auth với luồng xác thực và làm quen 3 bước (Onboarding) |
| ☁️ **Đồng bộ đám mây** | Thuốc, chỉ số sinh hiệu, lịch hẹn và cài đặt cá nhân được tự động lưu lên Supabase |
| 🔊 **Đọc to khi chạm (Text-to-Speech)** | Giọng đọc tiếng Việt tự nhiên (Web Speech API / Piper TTS) hỗ trợ người cao tuổi |
| 🚑 **Nút Gọi Cấp Cứu (SOS)** | Đếm ngược 5 giây, kích hoạt còi báo động, tạo đơn cấp cứu hỏa tốc và tự quay số 115 |
| 💊 **Nhắc giờ uống thuốc** | Lịch uống hôm nay, theo dõi tỷ lệ tuân thủ 7 ngày, chuông báo, nhắc lại sau 10 phút |
| 📍 **Vùng an toàn GPS** | Cảnh báo khi người cao tuổi di chuyển ra khỏi bán kính an toàn đã cài đặt |
| 📹 **Giám sát Camera trong nhà** | Quản lý webcam hoặc luồng RTSP camera IP, phát hiện té ngã |
| ❤️ **Theo dõi sinh hiệu** | Huyết áp, nhịp tim, đường huyết kèm biểu đồ 7 lần đo và đánh giá mức độ nguy hiểm |
| 📅 **Lịch hẹn khám** | Quản lý lịch tái khám và tự động nhắc nhở trước 24 giờ và 1 giờ |

## Cấu trúc mã nguồn

```
src/
├── components/          Thành phần giao diện (Header, TabBar, OverlayModal, Toast)
├── context/             AppContext quản lý trạng thái, đồng bộ đám mây và sự kiện
├── screens/             5 màn hình chính (Home, Meds, Safety, Health, Settings) + Auth & Onboarding
├── services/            Âm thanh Web Audio, giọng đọc TTS, Supabase client
├── types.ts             Kiểu dữ liệu TypeScript
├── utils/helpers.ts     Công cụ tính toán thời gian, khoảng cách, phân loại sinh hiệu
└── index.css            Thiết kế giao diện thân thiện với người cao tuổi (Mint & Emerald)
```

## Khởi chạy ứng dụng

```bash
# Cài đặt gói phụ thuộc
npm install

# Chạy môi trường phát triển (Port 3000)
npm run dev

# Kiểm tra kiểu dữ liệu
npm run lint

# Đóng gói sản phẩm
npm run build
```
