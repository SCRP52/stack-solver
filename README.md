# Stack Solver

Web app tìm và mô phỏng chuỗi thao tác để đưa một bộ bài về thứ tự stack. Chọn bộ xuất phát và đích từ danh sách, hoặc nhập riêng 52 lá.

- Các nước gồm faro in/out, faro lệch, cut, triple cut, run, đảo đoạn đầu, cull, reverse cull và chia tối đa 10 tụ.
- Solver chạy trong Web Worker của trình duyệt. Stack nhập tay và chuỗi đã lưu ở trên thiết bị.
- Kết quả phân biệt lời giải đã chứng minh ngắn nhất với chuỗi tốt nhất tìm được trong thời gian đã chọn.

## Chạy thử

Chạy `python -m http.server 8080` trong thư mục repo rồi mở `http://localhost:8080`. Trang chạy trực tiếp từ `index.html` với JavaScript thuần.
