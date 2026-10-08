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

### Sửa lỗi Google OAuth trên Vercel
Đặt `BASE_URL` trong Vercel → Settings → Environment Variables thành origin HTTPS, ví dụ `https://mail2job.vercel.app`, không thêm `/api/auth/callback`. Trong Google Cloud Console → APIs & Services → Credentials, mở đúng OAuth Client ID đang đặt trên Vercel và thêm Authorized redirect URI chính xác `https://mail2job.vercel.app/api/auth/callback`. Mở ứng dụng bằng cùng domain rồi deploy lại sau khi đổi biến môi trường.

## Lưu ý
- **Lịch gửi**: cron hiện chạy mỗi ngày một lần trên gói Hobby (`vercel.json`, 01:00 UTC), nên thư hẹn giờ được gửi ở lần cron kế tiếp. Nút **Gửi thư** gửi ngay.
- Quyền Gmail thuộc nhóm nhạy cảm: ở chế độ *Testing* dùng được tối đa 100 người; muốn công khai cần Google xác minh ứng dụng.
- Refresh token được mã hóa AES-256-GCM bằng `SESSION_SECRET` trước khi lưu. Nội dung thư gốc không được lưu; nội dung trả lời và tệp đính kèm được lưu trong Redis để gửi hoặc xử lý theo lịch.

### Bài báo nghiên cứu
Menu **Bài báo** nằm ngay dưới Documents. Hỗ trợ tìm kiếm, sắp xếp, xem bảng/thẻ, thêm/sửa/xóa, nhập/xuất `.xlsx` và tải mẫu Excel. Hộp thoại có bốn tab: thông tin chung (điền từ BibTeX Google Scholar), minh chứng, mã nguồn, ghi chú Markdown và ảnh. Dữ liệu lưu tại `articles/index.json`, tệp tại `articles/files/` trong cùng repository đã cấu hình cho Documents. Gỡ tệp hoặc xóa bài báo giữ nguyên bản tệp trên GitHub.

Mỗi tệp tối đa **20 MB**, tải theo phần 1 MB; cần Redis đã cấu hình để lưu tạm các phần (hết hạn sau một giờ). Nếu tải tệp lỗi, thông tin bài báo đã lưu vẫn được giữ và có thể bấm lưu để thử tiếp. Excel chứa nội dung văn bản, không chứa tệp đính kèm. Nhập Excel tạo các bài báo mới, không ghi đè bài cũ; tối đa 500 bài/lần. Thư viện SheetJS 0.20.3 được lưu tại `public/vendor/xlsx.full.min.js` (Apache-2.0).

Documents trên màn hình rộng tối đa 700 px hiển thị ba cột: tên văn bản, dung lượng và thao tác.

Kiểm tra chức năng bằng `node scripts/check-articles.js` (GitHub/Redis giả lập, không ghi dữ liệu thật).

Kiểm tra tải Minh chứng bằng `node scripts/check-evidence-upload.js`: nhiều tệp, tệp vượt giới hạn, mất phản hồi sau khi lưu, hết hạn phần tệp, xung đột cập nhật GitHub và giữ hàng đợi khi chưa tải xong. Tệp vượt 20 MB được báo tên và bỏ qua riêng; các tệp hợp lệ trong cùng lượt kéo vẫn được nhận. Tải gián đoạn được thử lại tối đa ba lần, chỉ bỏ tệp khỏi hàng đợi sau khi máy chủ xác nhận đã lưu.
