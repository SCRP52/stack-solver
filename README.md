# Stack Solver

Web app tìm và mô phỏng chuỗi thao tác để đưa một bộ bài về thứ tự stack. Chọn bộ xuất phát và đích từ danh sách, hoặc nhập riêng 52 lá.

- Các nước gồm faro in/out, faro lệch, cut, Multi Cut, run, đảo đoạn đầu, cull, reverse cull và chia tối đa 10 tụ.
- Multi Cut cắt 3–10 cọc liền theo các mốc đã nhập. Overhand đặt mỗi cọc lên trên cọc trước. Gom tự do cho phép đổi thứ tự các cọc. Cull có thể lấy tối đa 5 lá rải rác trong một lượt.
- Solver chạy trong Web Worker của trình duyệt. Stack nhập tay và chuỗi đã lưu ở trên thiết bị.
- Solver trả tối đa 5 chuỗi khác nhau, xếp theo số nước. Kết quả cho biết khi nào phương án đầu tiên đã được chứng minh ngắn nhất.

## Chạy thử

Chạy `python -m http.server 8080` trong thư mục repo rồi mở `http://localhost:8080`. Trang chạy trực tiếp từ `index.html` với JavaScript thuần.
