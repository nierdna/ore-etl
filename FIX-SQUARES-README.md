# Fix Squares Script

Script để fix squares cho automation transactions có `mask=0` bằng cách reconstruct squares từ `authority + roundId`.

## Tổng quan

Script này sẽ:
1. Tìm tất cả records có:
   - `isAutomation = true`
   - `squaresMask = 0`
   - `numSquares` từ 1-24
   - `squares = []` hoặc không có
   - `authority != 'unknown'`

2. Reconstruct squares sử dụng `reconstructSquaresForAutomation()`

3. Update database với squares mới và thêm field `fixedAt`

## Cách sử dụng

### 1. Dry-run mode (Test trước)

Chạy với dry-run để xem sẽ fix bao nhiêu records mà không thay đổi database:

```bash
# Option 1: Dùng flag
npm run fix:squares -- --dry-run

# Option 2: Dùng environment variable
DRY_RUN=true npm run fix:squares
```

### 2. Chạy thực tế

Sau khi verify với dry-run, chạy script để update database:

```bash
npm run fix:squares
```

### 3. Hoặc chạy trực tiếp với ts-node

```bash
# Dry-run
npx ts-node fix-squares.ts --dry-run

# Thực tế
npx ts-node fix-squares.ts
```

## Output

Script sẽ hiển thị:
- Tổng số records cần fix
- Progress theo từng batch
- Số records đã fix thành công
- Số errors (nếu có)
- Số records bị skip (nếu có)

### Ví dụ output:

```
Found 2749064 records to fix
Processing batch: 1 - 1000 of 2749064
Updated 1000 records in this batch
Progress: 1000/2749064 processed, 1000 fixed, 0 errors, 0 skipped
...

=== Fix Summary ===
Total records processed: 2749064
Successfully fixed: 2749064
Errors: 0
Skipped: 0
```

## Lưu ý

1. **Backup database trước khi chạy**: Script sẽ update trực tiếp vào database
2. **Chạy dry-run trước**: Luôn test với `--dry-run` trước khi chạy thực tế
3. **Batch processing**: Script xử lý theo batch 1000 records để tránh memory issues
4. **Error handling**: Script sẽ skip records có lỗi và tiếp tục với records khác
5. **Field `fixedAt`**: Mỗi record được fix sẽ có thêm field `fixedAt` với timestamp

## Cấu hình

Script sử dụng config từ `.env`:
- `MONGODB_URI`: MongoDB connection string
- `TARGET_DATABASE`: Database name (default: `ore_transformed`)

## Troubleshooting

### Lỗi "Cannot find module 'js-sha3'"
```bash
npm install
```

### Lỗi connection
Kiểm tra `MONGODB_URI` trong `.env` file

### Records không được fix
- Kiểm tra xem records có `authority != 'unknown'` không
- Kiểm tra xem `numSquares` có trong range 1-24 không
- Xem logs để biết lý do skip

