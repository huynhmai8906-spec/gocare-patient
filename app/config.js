// Cấu hình công khai của App Bệnh Nhân GoCare.
// Supabase dùng chung với Web Khách Hàng (mai-hu-nh-th-tuy-t-o684.vercel.app) và Web Quản Lý (quanlyweb-bjsh.vercel.app).
// Khóa "publishable" được thiết kế để nằm trong trình duyệt (giống hai web kia) — KHÔNG đặt khóa service_role ở đây.
window.GOCARE_CONFIG = {
  supabaseUrl: 'https://niptzzxfgduhcrbofthg.supabase.co',
  supabaseKey: 'sb_publishable_1BbQKqBKyHS7Qo-yglIpkg_pNW14RIV',
  customerWeb: 'https://mai-hu-nh-th-tuy-t-o684.vercel.app/',
  managementWeb: 'https://quanlyweb-bjsh.vercel.app/',
};
