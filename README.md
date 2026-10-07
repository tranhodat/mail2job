# 📬 Trợ lý Gmail & Điểm tin công nghệ

Ứng dụng serverless chạy trên **Vercel** (Vercel CLI được tải khi chạy local):
- Đăng nhập Google OAuth, chỉ đọc thư khi người dùng cho phép (`gmail.readonly`, `gmail.compose`).
- AI (Claude) tự soạn trả lời, lưu thành **bản nháp Gmail**, người dùng duyệt rồi mới gửi.
- Lên lịch xử lý; theo dõi **tiến độ %**, **tệp đính kèm**, ghi chú **gửi đến ai** và **đã thực hiện như thế nào**.
- Điểm tin công nghệ: tải các website do người dùng thêm và tóm tắt thành tin ngắn.

## Cấu trúc
```
api/auth.js    đăng nhập Google (login, callback, logout, me)
api/mails.js   danh sách thư
api/tasks.js   tạo / chạy / gửi / xóa công việc
api/news.js    nguồn tin + tổng hợp tin
api/cron.js    chạy các công việc đã đến giờ (Vercel Cron)
lib/util.js    mã hóa, Redis, Gmail, Claude
public/index.html  giao diện
```

## Chạy cục bộ
1. Cài Node.js 20 trở lên, sau đó chạy `npm install`.
2. Tạo `.env.local` từ `.env.example`; điền thông tin Google OAuth, Anthropic và Upstash Redis. Không đưa file này lên GitHub.
3. Trong Google Cloud Console, bật *Gmail API*, thêm email vào OAuth consent screen → Test users, và thêm redirect URI `http://localhost:3000/api/auth/callback`.
4. Đặt `BASE_URL=http://localhost:3000` trong `.env.local`, rồi chạy `npm run vercel:dev`.
5. Mở `http://localhost:3000` và đăng nhập Google.

## Triển khai Vercel/GitHub
1. Tạo project Google Cloud, bật *Gmail API*, cấu hình OAuth consent screen và tạo *OAuth Client ID* loại Web. Thêm redirect URI `https://TEN-MIEN-CUA-BAN.vercel.app/api/auth/callback`.
2. Đẩy mã lên GitHub, sau đó Import repository vào Vercel.
3. Trong Vercel → Storage / Marketplace, thêm **Upstash Redis**.
4. Thêm biến môi trường theo `.env.example` (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `ANTHROPIC_API_KEY`, `SESSION_SECRET`, `CRON_SECRET`, cùng thông tin Upstash Redis). Không đặt `BASE_URL` để Vercel tự nhận domain.
5. Deploy, mở domain và đăng nhập Google.

## Lưu ý
- **Lịch chạy**: gói Hobby chỉ cho cron mỗi ngày 1 lần (`vercel.json`, 01:00 UTC). Công việc hẹn giờ sẽ chạy ở lần cron kế tiếp; nút **Chạy ngay** xử lý tức thì. Gói Pro có thể đổi lịch thành mỗi 5–15 phút.
- Quyền Gmail thuộc nhóm nhạy cảm: ở chế độ *Testing* dùng được tối đa 100 người; muốn công khai cần Google xác minh ứng dụng.
- Refresh token được mã hóa AES-256-GCM bằng `SESSION_SECRET` trước khi lưu. Thư không được lưu lại, chỉ lưu tiêu đề, bản nháp và nhật ký công việc.
- Lịch cron ở gói Hobby chạy mỗi ngày một lần theo `vercel.json` (01:00 UTC); công việc hẹn giờ sẽ chạy ở lần cron kế tiếp. Nút **Chạy ngay** xử lý tức thì.
