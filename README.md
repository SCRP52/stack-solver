# Stack Converter

Web app tìm và mô phỏng cách chuyển từ stack bài xuất phát sang stack đích. Chọn preset hoặc nhập 52 lá cho mỗi đầu. Với đích theo vị trí, nhập dạng `1=AS, 17=QC, 52=KD`.

- Các nước gồm faro in/out, faro lệch, cut, cắt nhiều cọc, run, đảo đoạn đầu, cull, reverse cull và chia tối đa 10 tụ.
- Faro lệch xen từ đầu hoặc từ đáy, phần dư nằm cùng một đầu. Cắt nhiều cọc có giới hạn từ 3 đến 10 cọc và tùy chọn đổi thứ tự lúc gom. Hướng dẫn hiển thị hai lá kẹp mỗi chỗ cắt và thứ tự gom từ trên xuống.
- Cull có thể lấy tối đa 5 lá rải rác từ trên xuống hoặc dưới lên. Hướng dẫn ghi các lá kẹp chỗ nạp và vị trí trên bộ trước khi làm nước đó.
- Tìm kiếm chạy trong Web Worker của trình duyệt với giới hạn tối đa 30 phút. Giao diện có tiếng Việt và tiếng Anh. Stack nhập tay và chuỗi đã lưu ở trên thiết bị.
- Solver trả tối đa 5 chuỗi khác nhau. Xếp hạng ưu tiên ít cull và ít cắt nhiều cọc. Điểm phạt khi cắt nhiều cọc liên tiếp bắt đầu từ lần thứ tư. Cắt nhiều cọc đi cùng cull hoặc Cut được tính theo chi phí của từng nước. Khi ngang điểm, ưu tiên cull dưới lên. Danh sách giữ một chuỗi ít nước nhất đã tìm được và báo số nước tối thiểu khi đã chứng minh được.

## Chạy thử

Chạy `python -m http.server 8080` trong thư mục repo rồi mở `http://localhost:8080`. Trang chạy trực tiếp từ `index.html` với JavaScript thuần.
