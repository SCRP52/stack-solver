# Stack Solver

Web app tìm và mô phỏng chuỗi thao tác để đưa một bộ bài về thứ tự stack. Chọn stack đích, nhập 52 lá hoặc chỉ định vài vị trí theo dạng `1=AS, 17=QC, 52=KD`.

- Các nước gồm faro in/out, faro lệch, cut, Multi Cut, run, đảo đoạn đầu, cull, reverse cull và chia tối đa 10 tụ.
- Faro lệch xen từ đầu hoặc từ đáy, phần dư nằm cùng một đầu. Multi Cut cắt 3–10 cọc liền theo các mốc đã nhập.
- Cull có thể lấy tối đa 5 lá rải rác từ trên xuống hoặc dưới lên. Hướng dẫn ghi các lá kẹp chỗ nạp và vị trí trên bộ trước khi làm nước đó.
- Solver chạy trong Web Worker của trình duyệt. Stack nhập tay và chuỗi đã lưu ở trên thiết bị.
- Solver trả tối đa 5 chuỗi khác nhau. Xếp hạng ưu tiên ít cull, ít nối cull với cut, và ưu tiên cull dưới lên khi các phương án ngang điểm. Danh sách giữ một chuỗi ít nước nhất đã tìm được và báo số nước tối thiểu khi đã chứng minh được.

## Chạy thử

Chạy `python -m http.server 8080` trong thư mục repo rồi mở `http://localhost:8080`. Trang chạy trực tiếp từ `index.html` với JavaScript thuần.
