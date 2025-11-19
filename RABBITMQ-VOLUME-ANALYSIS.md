# RabbitMQ Volume Analysis Report

**Generated:** 2025-11-18  
**Status:** 🔴 CRITICAL - High Volume Usage

---

## 📊 Tổng quan tình trạng

### Queue Status Summary

| Queue | Messages | Size (GB) | Consumers | Status |
|-------|----------|-----------|-----------|--------|
| **transaction-etl-dlq** | **5,155,425** | **~21.5 GB** | 0 | 🔴 CRITICAL |
| transaction-etl-v3 | 0 | 0 | 10 | ✅ Healthy |
| transaction-etl-v2 | 100,000 | ~0.4 GB | 0 | ⚠️ Full |
| transaction-etl | 0 | 0 | 0 | ✅ Empty |

### Total Volume
- **Total Messages:** 5,255,425
- **Total Size:** ~**22 GB**
- **Critical Issue:** DLQ chiếm **98%** tổng volume

---

## 🔴 Vấn đề nghiêm trọng: Dead Letter Queue

### transaction-etl-dlq

**Thống kê:**
- **Messages:** 5,155,425 (hơn 5 triệu!)
- **Message Bytes:** 21,523,757,393 bytes (~21.5 GB)
- **Message Bytes Persistent:** 21.5 GB (100% persistent)
- **Consumers:** 0 (không có consumer nào đang xử lý)
- **State:** Running (idle)

**Phân tích:**
- DLQ đang chứa **hơn 5 triệu messages** không được xử lý
- Mỗi message trung bình ~4.2 KB
- Tất cả messages đều persistent (lưu trên disk)
- Không có consumer nào đang xử lý DLQ

**Nguyên nhân có thể:**
1. ❌ Consumer fail liên tục → messages bị đưa vào DLQ
2. ❌ Cùng một transaction bị retry nhiều lần → duplicate messages
3. ❌ Transaction không thể parse được → fail sau 3 retries
4. ❌ Consumer không có logic để xử lý DLQ

---

## ✅ Queue đang hoạt động tốt

### transaction-etl-v3

**Thống kê:**
- **Messages:** 0 (queue rỗng)
- **Consumers:** 10 (đang active)
- **Processing Rate:** 4.8 messages/second
- **Total Processed:** 122,222 messages
- **Total Published:** 6,474,775 messages
- **Consumer Utilization:** 99.99% (gần full capacity)

**Phân tích:**
- Queue đang được xử lý tốt
- 10 consumers đang hoạt động song song
- Processing rate ổn định
- Queue không bị backlog

---

## ⚠️ Queue đầy

### transaction-etl-v2

**Thống kê:**
- **Messages:** 100,000 (đạt max-length)
- **Message Bytes:** 419,064,835 bytes (~0.4 GB)
- **Consumers:** 0 (không có consumer)
- **Publish Rate:** 109.8 messages/second

**Phân tích:**
- Queue đã đạt max-length (100k messages)
- Không có consumer nào đang xử lý
- Có thể là queue cũ không còn được sử dụng

---

## 🔍 Phân tích nguyên nhân

### 1. Dead Letter Queue quá lớn

**Vấn đề chính:**
- DLQ chứa hơn 5 triệu messages với 21.5 GB
- Không có consumer để xử lý DLQ
- Messages không được cleanup

**Nguyên nhân từ code review:**
1. **Retry logic có vấn đề** (Issue #2 trong CODE-REVIEW.md):
   - Nack + republish có thể tạo duplicate
   - Cùng một transaction có thể bị retry nhiều lần

2. **Không có idempotency check** (Issue #3):
   - Transaction đã được xử lý vẫn bị retry
   - Tạo duplicate messages trong DLQ

3. **Error handling không đầy đủ** (Issue #4):
   - Parser error có thể làm fail toàn bộ transaction
   - Transaction hợp lệ có thể bị reject

### 2. Duplicate Messages

**Dấu hiệu:**
- Từ test trước, tất cả 10 messages trong DLQ đều có cùng signature
- Cùng một transaction bị duplicate nhiều lần

**Nguyên nhân:**
- Retry logic trong `handleFailure()` có thể tạo duplicate
- Nack message rồi republish ngay → message có thể bị duplicate

### 3. Không có DLQ Consumer

**Vấn đề:**
- Không có consumer nào đang xử lý DLQ
- Messages trong DLQ không bao giờ được xử lý
- DLQ chỉ tích lũy, không bao giờ giảm

---

## 💾 Disk Usage

### RabbitMQ Node
- **Disk Free:** 7.5 GB (7,576,141,824 bytes)
- **Memory Used:** 1 GB (1,041,330,176 bytes)
- **Memory Limit:** 247 GB
- **Memory Usage:** 0.42%

**Cảnh báo:**
- Disk free chỉ còn 7.5 GB
- DLQ đang chiếm 21.5 GB (có thể trên disk)
- Cần cleanup DLQ ngay để tránh hết disk

---

## 🔧 Giải pháp đề xuất

### 1. **URGENT: Purge Dead Letter Queue**

**Hành động ngay:**
```bash
# Sử dụng MCP tool hoặc RabbitMQ Management UI
# Purge transaction-etl-dlq để giải phóng 21.5 GB
```

**Lưu ý:**
- Backup messages quan trọng trước khi purge
- Phân tích một sample messages để hiểu nguyên nhân
- Sau khi purge, cần fix code để tránh tái diễn

### 2. **Fix Retry Logic**

**File:** `src/queue/transaction-consumer.ts`

**Thay đổi:**
- Sử dụng delay queue thay vì nack + republish
- Hoặc sử dụng `requeue: true` với exponential backoff

### 3. **Thêm Idempotency Check**

**Thêm vào `handleMessage()`:**
```typescript
// Check if transaction already processed
const existing = await this.mongoManager.getResetsCollection()
  .findOne({ signature: tx.signature });
if (existing) {
  logger.warn(`Transaction ${tx.signature} already processed, skipping`);
  this.channel!.ack(msg);
  return;
}
```

### 4. **Tạo DLQ Consumer**

**Tạo consumer riêng để xử lý DLQ:**
- Monitor DLQ size
- Alert khi DLQ quá lớn
- Retry messages từ DLQ sau khi fix bug
- Hoặc export messages để phân tích offline

### 5. **Cleanup Old Queues**

**Xóa hoặc purge:**
- `transaction-etl-v2` (100k messages, không có consumer)
- `transaction-etl` (rỗng, có thể không cần thiết)

---

## 📈 Monitoring Recommendations

### Metrics cần theo dõi:
1. **DLQ Size:** Alert khi > 10k messages
2. **DLQ Growth Rate:** Alert khi tăng > 1k/hour
3. **Disk Free:** Alert khi < 10 GB
4. **Consumer Count:** Alert khi < 5 consumers
5. **Processing Rate:** Alert khi < 1 msg/s

### Alerts:
- 🔴 **Critical:** DLQ > 100k messages
- 🟡 **Warning:** DLQ > 10k messages
- 🔴 **Critical:** Disk free < 5 GB
- 🟡 **Warning:** Disk free < 10 GB

---

## 🎯 Action Items

### Immediate (Today):
1. ✅ [ ] Purge DLQ để giải phóng 21.5 GB
2. ✅ [ ] Phân tích sample messages từ DLQ
3. ✅ [ ] Fix retry logic trong consumer

### Short-term (This Week):
4. ✅ [ ] Thêm idempotency check
5. ✅ [ ] Fix error handling cho parsers
6. ✅ [ ] Tạo DLQ monitoring và alerts

### Long-term (This Month):
7. ✅ [ ] Tạo DLQ consumer
8. ✅ [ ] Cleanup old queues
9. ✅ [ ] Implement circuit breaker
10. ✅ [ ] Add comprehensive monitoring

---

## 📝 Notes

- DLQ đang là vấn đề chính ngốn volume
- Cần purge ngay để tránh hết disk
- Sau khi purge, cần fix code để tránh tái diễn
- Consumer đang hoạt động tốt với transaction-etl-v3

---

**Next Steps:**
1. Purge DLQ ngay
2. Fix retry logic
3. Thêm idempotency check
4. Setup monitoring

