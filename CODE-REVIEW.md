# Code Review - Transaction ETL System

## 📋 Tổng quan

Review các file chính trong hệ thống ETL xử lý transactions từ RabbitMQ.

---

## 🔴 Vấn đề nghiêm trọng (Critical Issues)

### 1. **TransactionConsumer - Thiếu Error Handling cho Channel/Connection**

**File:** `src/queue/transaction-consumer.ts`

**Vấn đề:**
```typescript
// Line 126, 150, 154, 167
this.channel!.ack(msg);  // ⚠️ Non-null assertion có thể gây crash
this.channel!.nack(msg, false, false);
```

**Rủi ro:** Nếu connection bị đóng giữa chừng, `channel` có thể là `null`, gây crash.

**Giải pháp:**
```typescript
if (!this.channel) {
  logger.error('Channel is null, cannot ack message');
  return;
}
this.channel.ack(msg);
```

---

### 2. **TransactionConsumer - Retry Logic có thể gây Duplicate Messages**

**File:** `src/queue/transaction-consumer.ts:142-171`

**Vấn đề:**
```typescript
// Line 150: Nack message
this.channel!.nack(msg, false, false);

// Line 154: Republish cùng message
await this.channel!.sendToQueue(this.QUEUE, msg.content, {...});
```

**Rủi ro:** 
- Message bị nack nhưng chưa được xóa khỏi queue
- Republish ngay lập tức có thể tạo duplicate
- Nếu consumer crash giữa nack và republish, message có thể bị mất

**Giải pháp:**
- Sử dụng delay queue hoặc message TTL cho retry
- Hoặc sử dụng `basic.reject` với `requeue: true` thay vì nack + republish

---

### 3. **TransactionConsumer - Không có Idempotency Check**

**File:** `src/queue/transaction-consumer.ts:99-140`

**Vấn đề:** 
- Không kiểm tra xem transaction đã được xử lý chưa trước khi parse
- Cùng một transaction có thể được xử lý nhiều lần nếu message bị duplicate

**Rủi ro:** 
- Duplicate activities trong database
- Waste resources

**Giải pháp:**
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

---

### 4. **Activity Parser - Không có Error Handling cho từng Parser**

**File:** `src/etl/activity-parser.ts:207-213`

**Vấn đề:**
```typescript
for (const parser of PARSERS) {
  const activity = await parser.parse(tx);
  // ⚠️ Nếu parser.parse() throw error, toàn bộ parse sẽ fail
}
```

**Rủi ro:** 
- Một parser lỗi có thể làm fail toàn bộ transaction
- Không biết parser nào gây lỗi

**Giải pháp:**
```typescript
for (const parser of PARSERS) {
  try {
    const activity = await parser.parse(tx);
    if (activity) {
      results.push({ activityType: parser.activityType, ...activity });
    }
  } catch (error) {
    logger.warn(`Parser ${parser.activityType} failed for ${tx.signature}`, error);
    // Continue with other parsers
  }
}
```

---

## 🟡 Vấn đề trung bình (Medium Issues)

### 5. **TransactionConsumer - Metrics Logger không được cleanup**

**File:** `src/queue/transaction-consumer.ts:182-196`

**Vấn đề:**
```typescript
private startMetricsLogger(): void {
  setInterval(() => {
    // Log metrics
  }, 30000);
  // ⚠️ Interval không được lưu, không thể clear khi stop
}
```

**Rủi ro:** Memory leak nếu consumer được restart nhiều lần.

**Giải pháp:**
```typescript
private metricsInterval: NodeJS.Timeout | null = null;

private startMetricsLogger(): void {
  this.metricsInterval = setInterval(() => {
    // Log metrics
  }, 30000);
}

async stop(): Promise<void> {
  if (this.metricsInterval) {
    clearInterval(this.metricsInterval);
    this.metricsInterval = null;
  }
  // ... rest of stop logic
}
```

---

### 6. **TransactionConsumer - Không có Timeout cho Message Processing**

**Vấn đề:** 
- Message có thể bị xử lý vô hạn nếu có deadlock hoặc hang
- Không có mechanism để detect và retry

**Giải pháp:** 
- Thêm timeout wrapper cho `handleMessage`
- Sử dụng `Promise.race()` với timeout

---

### 7. **RabbitMQ Publisher - Reconnect có thể gây Memory Leak**

**File:** `solana-tx-crawler/src/queue/rabbitmq-publisher.ts:67-80`

**Vấn đề:**
```typescript
private handleDisconnect(): void {
  // ...
  if (!this.reconnectTimer) {
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;  // ⚠️ Clear trước khi connect
      this.connect().catch(console.error);  // ⚠️ Error không được handle
    }, 5000);
  }
}
```

**Rủi ro:**
- Nếu `connect()` fail, không có retry mechanism
- Reconnect có thể tạo nhiều connections nếu gọi nhiều lần

**Giải pháp:**
- Thêm exponential backoff
- Track reconnect attempts
- Clear timer properly

---

### 8. **Activity Parser - Không có Logging khi Parse không tìm thấy Activity**

**File:** `src/etl/activity-parser.ts:201-227`

**Vấn đề:**
- Khi transaction không match bất kỳ activity type nào, không có log
- Khó debug tại sao transaction không được parse

**Giải pháp:**
```typescript
if (results.length === 0) {
  logger.debug(`No activities found for transaction ${tx.signature}`);
}
```

---

## 🟢 Cải thiện đề xuất (Improvements)

### 9. **TransactionConsumer - Thêm Circuit Breaker**

**Đề xuất:** 
- Thêm circuit breaker để tránh spam retry khi có lỗi liên tục
- Tạm dừng processing nếu error rate quá cao

---

### 10. **TransactionConsumer - Thêm Dead Letter Queue Monitoring**

**Đề xuất:**
- Monitor DLQ size và alert khi quá lớn
- Auto-retry DLQ messages sau khi fix bug

---

### 11. **Activity Parser - Parallel Parsing**

**Đề xuất:**
```typescript
// Parse các parsers song song thay vì tuần tự
const results = await Promise.allSettled(
  PARSERS.map(parser => parser.parse(tx))
);
```

---

### 12. **Test Script - Thêm Option để Test với Message từ RabbitMQ**

**Đề xuất:**
- Thêm option để lấy message trực tiếp từ RabbitMQ queue
- Test với exact message format từ queue

---

## 📊 Tóm tắt

### Critical Issues: 4
1. ❌ Thiếu error handling cho channel/connection
2. ❌ Retry logic có thể gây duplicate
3. ❌ Không có idempotency check
4. ❌ Không có error handling cho từng parser

### Medium Issues: 4
5. ⚠️ Metrics logger không được cleanup
6. ⚠️ Không có timeout cho message processing
7. ⚠️ Reconnect có thể gây memory leak
8. ⚠️ Thiếu logging khi parse không tìm thấy activity

### Improvements: 4
9. 💡 Circuit breaker
10. 💡 DLQ monitoring
11. 💡 Parallel parsing
12. 💡 Test với message từ RabbitMQ

---

## 🎯 Priority Actions

1. **URGENT:** Fix error handling cho channel/connection (Issue #1)
2. **URGENT:** Fix retry logic để tránh duplicate (Issue #2)
3. **HIGH:** Thêm idempotency check (Issue #3)
4. **HIGH:** Thêm error handling cho từng parser (Issue #4)
5. **MEDIUM:** Fix metrics logger cleanup (Issue #5)
6. **MEDIUM:** Thêm timeout cho message processing (Issue #6)

---

## 📝 Notes

- Code structure tổng thể tốt, dễ maintain
- Error handling cần được cải thiện
- Cần thêm monitoring và alerting
- Test coverage cần được mở rộng

