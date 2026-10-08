# 📬 Trợ lý Gmail & Điểm tin công nghệ

Ứng dụng serverless chạy trên **Vercel** (Vercel CLI được tải khi chạy local):
- Đăng nhập Google OAuth, chỉ đọc thư khi người dùng cho phép (`gmail.readonly`, `gmail.compose`).
- Nhập nội dung trả lời và gửi thư trực tiếp qua Gmail, không cần dịch vụ AI.
- Lên lịch gửi; đính kèm tệp và đánh dấu công việc hoàn thành.
- Điểm tin công nghệ: đọc bài mới từ RSS/Atom hoặc thẻ bài viết trên website do người dùng thêm.

## Cấu trúc
```
api/auth.js    đăng nhập Google (login, callback, logout, me)
api/mails.js   danh sách thư
api/tasks.js   tạo / gửi / hoàn thành / xóa công việc
api/documents.js lưu hồ sơ và tệp trong repository GitHub
api/news.js    quản lý nguồn + đọc RSS/Atom và bài viết
api/cron.js    chạy các công việc đã đến giờ (Vercel Cron)
lib/util.js    mã hóa, Redis và Gmail
public/index.html  giao diện
```

## Chạy cục bộ
1. Cài Node.js 20 trở lên, sau đó chạy `npm install`.
2. Tạo `.env.local` từ `.env.example`; điền thông tin Google OAuth, Upstash Redis và repository GitHub dùng riêng để lưu hồ sơ. Không đưa file này lên GitHub.
3. Trong Google Cloud Console, bật *Gmail API*, thêm email vào OAuth consent screen → Test users, và thêm redirect URI `http://localhost:3000/api/auth/callback`.
4. Đặt `BASE_URL=http://localhost:3000` trong `.env.local`, rồi chạy `npm run vercel:dev`.
5. Mở `http://localhost:3000` và đăng nhập Google.

### Lưu Documents trên GitHub
Tạo một repository GitHub đã có ít nhất một commit và token có quyền **Contents: Read and write** chỉ trên repository đó, sau đó đặt `GITHUB_TOKEN`, `GITHUB_OWNER`, `GITHUB_REPO` và `GITHUB_BRANCH` trong `.env.local` hoặc Vercel Environment Variables. API lưu tệp riêng tư qua máy chủ; token không được gửi xuống trình duyệt. Mỗi hồ sơ hỗ trợ tối đa 10 tệp, tổng cộng 3 MB do giới hạn payload serverless.

## Triển khai Vercel/GitHub
1. Tạo project Google Cloud, bật *Gmail API*, cấu hình OAuth consent screen và tạo *OAuth Client ID* loại Web. Thêm redirect URI `https://TEN-MIEN-CUA-BAN.vercel.app/api/auth/callback`.
2. Đẩy mã lên GitHub, sau đó Import repository vào Vercel.
3. Trong Vercel → Storage / Marketplace, thêm **Upstash Redis**.
4. Thêm biến môi trường theo `.env.example` (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `SESSION_SECRET`, `CRON_SECRET`, `GITHUB_TOKEN`, `GITHUB_OWNER`, `GITHUB_REPO`, cùng thông tin Upstash Redis). Không cần cấu hình khóa AI. Không đặt `BASE_URL` để Vercel tự nhận domain.
5. Deploy, mở domain và đăng nhập Google.

## Lưu ý
- **Lịch gửi**: cron hiện chạy mỗi ngày một lần trên gói Hobby (`vercel.json`, 01:00 UTC), nên thư hẹn giờ được gửi ở lần cron kế tiếp. Nút **Gửi thư** gửi ngay.
- Quyền Gmail thuộc nhóm nhạy cảm: ở chế độ *Testing* dùng được tối đa 100 người; muốn công khai cần Google xác minh ứng dụng.
- Refresh token được mã hóa AES-256-GCM bằng `SESSION_SECRET` trước khi lưu. Nội dung thư gốc không được lưu; nội dung trả lời và tệp đính kèm được lưu trong Redis để gửi hoặc xử lý theo lịch.
