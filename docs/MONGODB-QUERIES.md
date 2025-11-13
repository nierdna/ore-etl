# MongoDB Queries - Hướng Dẫn và Ví Dụ

## 📚 Mục lục
- [1. Queries Cơ Bản](#1-queries-cơ-bản)
- [2. Aggregation Queries](#2-aggregation-queries)
- [3. Phân Tích Gap trong Transactions](#3-phân-tích-gap-trong-transactions)
- [4. Window Functions](#4-window-functions)
- [5. Use Cases Thực Tế](#5-use-cases-thực-tế)

---

## 1. Queries Cơ Bản

### 1.1. Count - Đếm số documents
```javascript
// Đếm tổng số documents trong collection
db.transactions.count()

// Kết quả: 4,007,000 documents
```

### 1.2. Find - Tìm kiếm documents
```javascript
// Tìm transaction theo slot cụ thể
db.transactions.find(
  { slot: 379189525 },
  { slot: 1, blockTime: 1, signature: 1 }
).limit(5)

// Tìm transactions trong nhiều slots
db.transactions.find(
  { slot: { $in: [379189525, 379327757] } },
  { slot: 1, blockTime: 1, signature: 1 }
).limit(10)
```

**Giải thích:**
- Tham số đầu tiên: **filter** (điều kiện lọc)
- Tham số thứ hai: **projection** (chọn fields trả về, `1` = include, `0` = exclude)
- `.limit(N)`: Giới hạn số kết quả

### 1.3. Schema Analysis
```javascript
// Xem cấu trúc schema của collection
db.transactions.aggregate([
  { $sample: { size: 50 } },
  { $project: { 
    fields: { $objectToArray: "$$ROOT" }
  }}
])
```

---

## 2. Aggregation Queries

### 2.1. Group & Statistics - Nhóm và Thống kê
```javascript
// Tìm min, max slot và đếm tổng số documents
db.transactions.aggregate([
  {
    $sort: { slot: 1 }
  },
  {
    $group: {
      _id: null,
      minSlot: { $min: "$slot" },
      maxSlot: { $max: "$slot" },
      count: { $sum: 1 }
    }
  }
])

// Kết quả:
// {
//   _id: null,
//   minSlot: 378789774,
//   maxSlot: 379595538,
//   count: 4007000
// }
```

**Giải thích các stages:**
- `$sort`: Sắp xếp documents theo field
- `$group`: Nhóm documents và tính toán
  - `_id: null`: Nhóm tất cả vào 1 group duy nhất
  - `$min`, `$max`, `$sum`: Các accumulator operators

### 2.2. Unique Values - Giá trị duy nhất
```javascript
// Lấy danh sách unique slots (distinct)
db.transactions.aggregate([
  { $sort: { slot: 1 } },
  { $group: { _id: "$slot" } },
  { $sort: { _id: 1 } }
])

// Đếm số unique slots
db.transactions.aggregate([
  { $group: { _id: "$slot" } },
  { $count: "uniqueSlots" }
])
```

---

## 3. Phân Tích Gap trong Transactions

### 3.1. Tìm Gap giữa các Slots

**Pipeline hoàn chỉnh:**
```javascript
db.transactions.aggregate([
  // Bước 1: Sắp xếp theo slot tăng dần
  { $sort: { slot: 1 } },
  
  // Bước 2: Lấy unique slots
  { $group: { _id: "$slot" } },
  { $sort: { _id: 1 } },
  
  // Bước 3: Thêm field "prevSlot" (slot trước đó)
  {
    $setWindowFields: {
      sortBy: { _id: 1 },
      output: {
        prevSlot: {
          $shift: {
            output: "$_id",
            by: -1  // -1 = lấy document phía trước
          }
        }
      }
    }
  },
  
  // Bước 4: Tính khoảng cách gap
  {
    $project: {
      slot: "$_id",
      prevSlot: 1,
      gap: { $subtract: ["$_id", "$prevSlot"] }
    }
  },
  
  // Bước 5: Lọc chỉ lấy gaps > 1
  { $match: { gap: { $gt: 1 } } },
  
  // Bước 6: Giới hạn kết quả
  { $limit: 20 }
])
```

**Kết quả mẫu:**
```json
[
  { "_id": 378789794, "prevSlot": 378789792, "slot": 378789794, "gap": 2 },
  { "_id": 378789797, "prevSlot": 378789794, "slot": 378789797, "gap": 3 },
  { "_id": 378789824, "prevSlot": 378789818, "slot": 378789824, "gap": 6 },
  { "_id": 378789848, "prevSlot": 378789840, "slot": 378789848, "gap": 8 }
]
```

### 3.2. Tìm Gap LỚN NHẤT
```javascript
db.transactions.aggregate([
  { $sort: { slot: 1 } },
  { $group: { _id: "$slot" } },
  { $sort: { _id: 1 } },
  {
    $setWindowFields: {
      sortBy: { _id: 1 },
      output: {
        prevSlot: { $shift: { output: "$_id", by: -1 } }
      }
    }
  },
  {
    $project: {
      slot: "$_id",
      prevSlot: 1,
      gap: { $subtract: ["$_id", "$prevSlot"] }
    }
  },
  { $match: { gap: { $gte: 100 } } },  // Chỉ lấy gap >= 100
  { $sort: { gap: -1 } },               // Sắp xếp giảm dần theo gap
  { $limit: 20 }
])
```

**Kết quả:**
```json
[
  {
    "_id": 379327757,
    "prevSlot": 379189525,
    "slot": 379327757,
    "gap": 138232  // Gap lớn nhất: 138,232 slots (~15.38 giờ)
  }
]
```

### 3.3. Thống Kê Gaps
```javascript
db.transactions.aggregate([
  { $sort: { slot: 1 } },
  { $group: { _id: "$slot" } },
  { $sort: { _id: 1 } },
  {
    $setWindowFields: {
      sortBy: { _id: 1 },
      output: {
        prevSlot: { $shift: { output: "$_id", by: -1 } }
      }
    }
  },
  {
    $project: {
      gap: { $subtract: ["$_id", "$prevSlot"] }
    }
  },
  { $match: { gap: { $gt: 1 } } },
  {
    $group: {
      _id: null,
      totalGaps: { $sum: 1 },
      avgGap: { $avg: "$gap" },
      maxGap: { $max: "$gap" },
      minGap: { $min: "$gap" }
    }
  }
])
```

**Kết quả:**
```json
{
  "_id": null,
  "totalGaps": 119983,    // Tổng 119,983 gaps
  "avgGap": 5.05,         // Trung bình 5.05 slots
  "maxGap": 138232,       // Gap lớn nhất
  "minGap": 2             // Gap nhỏ nhất
}
```

### 3.4. Phân Bố Gaps (Bucket Analysis)
```javascript
db.transactions.aggregate([
  { $sort: { slot: 1 } },
  { $group: { _id: "$slot" } },
  { $sort: { _id: 1 } },
  {
    $setWindowFields: {
      sortBy: { _id: 1 },
      output: {
        prevSlot: { $shift: { output: "$_id", by: -1 } }
      }
    }
  },
  {
    $project: {
      slot: "$_id",
      prevSlot: 1,
      gap: { $subtract: ["$_id", "$prevSlot"] }
    }
  },
  {
    $bucket: {
      groupBy: "$gap",
      boundaries: [2, 5, 10, 50, 100, 1000, 10000, 200000],
      default: "null",
      output: {
        count: { $sum: 1 }
      }
    }
  }
])
```

**Kết quả:**
```json
[
  { "_id": 2, "count": 91632 },      // 91,632 gaps từ 2-4 slots
  { "_id": 5, "count": 22784 },      // 22,784 gaps từ 5-9 slots
  { "_id": 10, "count": 5594 },      // 5,594 gaps từ 10-49 slots
  { "_id": 50, "count": 4 },         // 4 gaps từ 50-99 slots
  { "_id": 10000, "count": 1 },      // 1 gap >= 10,000 slots
  { "_id": "null", "count": 199462 } // 199,462 slots có data (gap = 1)
]
```

---

## 4. Window Functions

### 4.1. $setWindowFields - Truy cập documents lân cận
```javascript
// Lấy giá trị từ document trước đó (previous row)
{
  $setWindowFields: {
    sortBy: { slot: 1 },           // Sắp xếp theo slot
    output: {
      prevSlot: {
        $shift: {
          output: "$slot",         // Field muốn lấy
          by: -1                   // -1 = document trước, 1 = document sau
        }
      }
    }
  }
}
```

**Ví dụ khác:**
```javascript
// Lấy 3 documents: trước, hiện tại, sau
{
  $setWindowFields: {
    sortBy: { slot: 1 },
    output: {
      prevSlot: { $shift: { output: "$slot", by: -1 } },
      nextSlot: { $shift: { output: "$slot", by: 1 } }
    }
  }
}
```

### 4.2. Running Total (Tổng tích lũy)
```javascript
db.transactions.aggregate([
  { $sort: { blockTime: 1 } },
  {
    $setWindowFields: {
      sortBy: { blockTime: 1 },
      output: {
        runningTotal: {
          $sum: 1,
          window: {
            documents: ["unbounded", "current"]
          }
        }
      }
    }
  }
])
```

---

## 5. Use Cases Thực Tế

### 5.1. Phát hiện Downtime hoặc Missing Data
```javascript
// Tìm các khoảng thời gian dài không có data (downtime)
db.transactions.aggregate([
  { $sort: { blockTime: 1 } },
  {
    $setWindowFields: {
      sortBy: { blockTime: 1 },
      output: {
        prevBlockTime: {
          $shift: { output: "$blockTime", by: -1 }
        }
      }
    }
  },
  {
    $project: {
      blockTime: 1,
      prevBlockTime: 1,
      timeDiff: {
        $subtract: ["$blockTime", "$prevBlockTime"]
      }
    }
  },
  {
    $match: {
      timeDiff: { $gt: 3600 }  // Gap > 1 giờ (3600 giây)
    }
  },
  { $sort: { timeDiff: -1 } },
  { $limit: 10 }
])
```

### 5.2. Tìm Slot có nhiều Transactions nhất
```javascript
db.transactions.aggregate([
  {
    $group: {
      _id: "$slot",
      txCount: { $sum: 1 },
      avgBlockTime: { $avg: "$blockTime" }
    }
  },
  { $sort: { txCount: -1 } },
  { $limit: 10 }
])
```

### 5.3. Phân tích theo Time Range
```javascript
// Transactions trong 1 giờ cụ thể
db.transactions.aggregate([
  {
    $match: {
      blockTime: {
        $gte: 1762789129,
        $lte: 1762792729  // +3600 giây
      }
    }
  },
  {
    $group: {
      _id: null,
      count: { $sum: 1 },
      avgSlot: { $avg: "$slot" }
    }
  }
])
```

### 5.4. Kiểm tra Continuity (Tính liên tục)
```javascript
// Kiểm tra xem dữ liệu có liên tục không
db.transactions.aggregate([
  { $sort: { slot: 1 } },
  { $group: { _id: "$slot" } },
  { $sort: { _id: 1 } },
  {
    $setWindowFields: {
      sortBy: { _id: 1 },
      output: {
        prevSlot: { $shift: { output: "$_id", by: -1 } }
      }
    }
  },
  {
    $project: {
      slot: "$_id",
      isContinuous: {
        $eq: [
          { $subtract: ["$_id", "$prevSlot"] },
          1
        ]
      }
    }
  },
  {
    $group: {
      _id: "$isContinuous",
      count: { $sum: 1 }
    }
  }
])
```

---

## 📊 Kết Quả Phân Tích Gap (Collection transactions - DB ore)

### Thông tin tổng quan:
- **Tổng transactions**: 4,007,000
- **Slot range**: 378,789,774 → 379,595,538
- **Unique slots**: ~199,463

### Gap Statistics:
- **Tổng gaps**: 119,983
- **Gap trung bình**: 5.05 slots
- **Gap nhỏ nhất**: 2 slots
- **Gap lớn nhất**: 138,232 slots (~15.38 giờ)

### Gap Details:
| Khoảng Gap | Số Lượng |
|-----------|----------|
| 2-4 slots | 91,632 |
| 5-9 slots | 22,784 |
| 10-49 slots | 5,594 |
| 50-99 slots | 4 |
| 10,000+ slots | 1 |

### Gap lớn nhất:
- **From**: Slot 379,189,525 (blockTime: 1,762,789,129)
- **To**: Slot 379,327,757 (blockTime: 1,762,844,493)
- **Duration**: 138,232 slots (~15.38 hours)

---

## 🎯 Tips & Best Practices

### 1. Performance
- Luôn dùng `$match` sớm trong pipeline để giảm số documents xử lý
- Tạo index cho các fields thường query
- Dùng `$limit` khi chỉ cần sample data

### 2. Memory
- Aggregation pipeline có giới hạn 100MB/stage
- Dùng `allowDiskUse: true` nếu cần xử lý data lớn
```javascript
db.transactions.aggregate(
  [...pipeline...],
  { allowDiskUse: true }
)
```

### 3. Index cho Gap Analysis
```javascript
// Tạo index cho slot để tăng tốc queries
db.transactions.createIndex({ slot: 1 })

// Compound index cho time-based queries
db.transactions.createIndex({ blockTime: 1, slot: 1 })
```

---

## 📚 Tài liệu tham khảo

- [MongoDB Aggregation Pipeline](https://docs.mongodb.com/manual/core/aggregation-pipeline/)
- [Window Functions ($setWindowFields)](https://docs.mongodb.com/manual/reference/operator/aggregation/setWindowFields/)
- [Query Operators](https://docs.mongodb.com/manual/reference/operator/query/)

---

**Được tạo bởi**: ORE ETL Project  
**Ngày**: 2025-11-13

