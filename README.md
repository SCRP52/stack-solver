# Stack Converter

Chạm logo Stack Converter để mở Trainer. Learn có Flipcard và Grid. Practice có Basic và Advanced, mỗi level có chế độ Tập và Thi 13, 26 hoặc 52 câu. Custom Stack đủ 52 lá dùng chung với Converter. Tiến độ lưu theo thứ tự stack trên trình duyệt.

Web app tìm và mô phỏng cách chuyển từ stack ban đầu sang stack đích. Chọn bộ 52 lá hoặc packet từ 1 đến 52 lá. Có thể nhập toàn bộ hoặc điền vài ô có số ở cả hai đầu. Khi để trống ô ban đầu, kết quả mô tả một bộ bài tương thích với các lá đã nhập. Nút Đảo thứ tự lật toàn bộ thứ tự, kể cả vị trí trống.

- Các nước gồm faro in/out, faro lệch, cut, cắt nhiều cọc, run, đảo đoạn đầu, cull, reverse cull và chia tối đa 10 tụ.
- Faro lệch xen từ đầu hoặc từ đáy, phần dư nằm cùng một đầu. Cắt nhiều cọc có giới hạn từ 3 đến 10 cọc và tùy chọn đổi thứ tự lúc gom. Hướng dẫn hiển thị hai lá kẹp mỗi chỗ cắt và thứ tự gom từ trên xuống.
- Cull có thể lấy tối đa 5 lá rải rác từ trên xuống hoặc dưới lên. Hướng dẫn ghi các lá kẹp chỗ nạp và vị trí trên bộ trước khi làm nước đó.
- Tìm kiếm chạy trong Web Worker của trình duyệt với giới hạn tối đa 60 phút. Giao diện có tiếng Việt và tiếng Anh. Stack nhập tay và chuỗi đã lưu ở trên thiết bị.
- Các phương án mới được mô phỏng lại từ thao tác của từng bước trước khi hiển thị. Nhấn giữ một bước hoặc chọn nút thông tin để đọc cách làm.
- Solver trả tối đa 5 chuỗi khác nhau. Xếp hạng ưu tiên ít cull và ít cắt nhiều cọc. Điểm phạt khi cắt nhiều cọc liên tiếp bắt đầu từ lần thứ tư. Cắt nhiều cọc đi cùng cull hoặc Cut được tính theo chi phí của từng nước. Khi ngang điểm, ưu tiên cull dưới lên. Danh sách giữ một chuỗi ít nước nhất đã tìm được và báo số nước tối thiểu khi đã chứng minh được.

## Chạy thử

Chạy `python -m http.server 8080` trong thư mục repo rồi mở `http://localhost:8080`. Trang chạy trực tiếp từ `index.html` với JavaScript thuần.

Chạy `node --test` để kiểm tra dữ liệu stack, logic sinh và chấm câu hỏi, cùng thống kê Practice.
