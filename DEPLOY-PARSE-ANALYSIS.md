# Phân tích lỗi Parse Deploy Instructions

## Tổng quan

**Tổng số record deploy:** 5,437,393

### Kết quả parse:
- ✅ **Đúng 1** (numSquares < 25 và numSquares = squares.length): **464,837** records (8.5%)
- ✅ **Đúng 2** (numSquares = 25 và squares = []): **2,117,182** records (39.0%)
- ❌ **Sai:** **2,855,374** records (52.5%)

**Tỷ lệ parse đúng:** 47.5%

---

## Phân loại các trường hợp sai

### 1. **numSquares < 25 nhưng squares = []** (Có squaresMask nhưng không có squares)

**Số lượng:** ~2.8M records

**Nguyên nhân:**
- Instruction data có `mask = 0` (không có squares nào được set)
- Log message vẫn báo số lượng squares (từ log parsing)
- Parser không thể extract squares từ mask = 0

**Ví dụ:**
- Signature: `2aXT12yniP3dvVDC3hWtVkHWDoTi6aVcVHwUzsaPFYpQcf3v6334Avs7vhb1CGWjZmJz1FZG5fRMzbroyfVBw2kG`
- Log: "deploying 0.00005 SOL to 20 squares"
- Instruction data: `VzAhkh6ZUfxYGMPtj` (bs58)
- Decoded: `06000000000000000000000000` (13 bytes)
  - Type: 6 (Deploy) ✅
  - Amount: 0 SOL
  - Mask: 0x0 (không có squares) ❌
  - Squares: [] (rỗng)

**Phân bố theo numSquares:**
- numSquares = 20, squares = []: 423,888 records
- numSquares = 1, squares = []: 279,388 records
- numSquares = 22, squares = []: 169,074 records
- numSquares = 15, squares = []: 168,421 records
- ... (và nhiều giá trị khác)

### 2. **numSquares = 25 nhưng squares.length = 25** (Có đầy đủ squares)

**Số lượng:** 57,138 records

**Nguyên nhân:**
- Instruction data có mask với tất cả 25 bits được set
- Parser extract được đầy đủ 25 squares [0,1,2,...,24]
- Nhưng theo tiêu chí, numSquares = 25 phải có squares = []

**Ví dụ:**
- Signature: `3XAdTLAakazppvPjz3ismQcWKcbwaYnVUZYRJ9g2Q2LXjEkWDynUP9T44wBzG6LnMWuBR7DADbsjYFvnjcAyHRdR`
- Log: "deploying 0.0002 SOL to 25 squares"
- Instruction data: `XCGkWZTMzXoSfCW8Y` (base64) - chỉ 12 bytes, không đủ để parse
- Hoặc có thể có instruction khác với mask đầy đủ

---

## Nguyên nhân gốc rễ

### Vấn đề 1: Instruction data không đủ dài hoặc sai format

**Trường hợp 1:** Instruction data quá ngắn
- Data "3" (base64) → decode = 0 bytes (không hợp lệ)
- Data "VzAhkh6ZUfxYGMPtj" (base64) → decode = 12 bytes (thiếu 1 byte so với yêu cầu 13 bytes)

**Trường hợp 2:** Instruction data có mask = 0
- Data decode được đúng 13 bytes
- Type = 6 (Deploy) ✅
- Nhưng mask = 0 → không có squares nào được set
- Log message vẫn báo số lượng squares (có thể từ nguồn khác hoặc tính toán khác)

### Vấn đề 2: Mâu thuẫn giữa log message và instruction data

- **Log message** (từ program log): "deploying X SOL to Y squares"
  - Được parse bởi `LogParser` → `numSquares`
  - Có thể không chính xác hoặc là số lượng squares được deploy thực tế (không phải từ mask)

- **Instruction data** (từ transaction instruction):
  - Được parse bởi `InstructionParser` → `squares` từ mask
  - Mask = 0 → không có squares nào được set trong instruction

### Vấn đề 3: Có thể có nhiều instructions trong transaction

- Transaction có thể có nhiều instructions
- Instruction thứ 3 (index 2) có data "3" - không phải Deploy
- Instruction thứ 4 (index 3) có data "VzAhkh6ZUfxYGMPtj" - có thể là Deploy nhưng mask = 0
- Parser chỉ tìm instruction đầu tiên có type = 6, có thể bỏ sót instruction đúng

---

## Code hiện tại

### `deploy-etl.ts` (dòng 150-160):
```typescript
for (const ix of instructions) {
  // Check if this is ORE program instruction
  if (ix.data && typeof ix.data === 'string') {
    const parsed = InstructionParser.parseDeployInstruction(ix.data);
    if (parsed) {
      deployInstruction = parsed;
      accounts = InstructionParser.extractAccounts(ix);
      break; // ⚠️ Dừng ngay khi tìm thấy instruction đầu tiên
    }
  }
}
```

### `instruction-parser.ts` (dòng 21-57):
```typescript
static parseDeployInstruction(dataString: string): ParsedDeploy | null {
  try {
    const data = InstructionParser.decodeInstructionData(dataString);
    
    // Check minimum length (1 + 8 + 4 = 13 bytes)
    if (!data || data.length < 13) return null;
    
    // Parse instruction type
    const instructionType = data[0];
    if (instructionType !== 6) return null; // Not a Deploy instruction
    
    // Parse amount (bytes 1-8, little-endian u64)
    const amount = data.readBigUInt64LE(1);
    const amountSOL = Number(amount) / 1e9;
    
    // Parse mask (bytes 9-12, little-endian u32)
    const mask = data.readUInt32LE(9);
    
    // Extract squares from mask
    const squares: number[] = [];
    for (let i = 0; i < 25; i++) {
      if (mask & (1 << i)) {
        squares.push(i);
      }
    }
    
    return {
      instructionType,
      amount,
      amountSOL,
      mask,
      squares,
    };
  } catch (error) {
    return null;
  }
}
```

### `instruction-parser.ts` (dòng 66-81) - decodeInstructionData:
```typescript
private static decodeInstructionData(dataString: string): Buffer | null {
  if (!dataString) {
    return null;
  }

  try {
    const decoded = bs58.decode(dataString); // ✅ Thử bs58 trước
    return Buffer.from(decoded);
  } catch (error) {
    try {
      return Buffer.from(dataString, 'base64'); // Fallback base64
    } catch (innerError) {
      return null;
    }
  }
}
```

---

## Khuyến nghị sửa lỗi

### 1. **Xử lý trường hợp mask = 0 nhưng numSquares > 0**

Khi mask = 0 nhưng log message báo có squares:
- Có thể đây là trường hợp deploy tất cả squares (25 squares)
- Hoặc cần tìm instruction khác trong transaction
- Hoặc cần parse từ nguồn khác (inner instructions?)

### 2. **Tìm tất cả Deploy instructions trong transaction**

Thay vì dừng ở instruction đầu tiên, nên:
- Tìm tất cả instructions có type = 6
- Chọn instruction có mask khác 0 hoặc có amount khớp với log

### 3. **Kiểm tra inner instructions**

Một số transactions có thể có Deploy instruction trong `innerInstructions`:
```typescript
const innerInstructions = tx.parsedData?.meta?.innerInstructions || [];
// Cần parse inner instructions cũng
```

### 4. **Xử lý trường hợp numSquares = 25**

Theo tiêu chí:
- numSquares = 25 → squares phải = []
- Nhưng nếu mask có tất cả 25 bits set → squares = [0,1,2,...,24]
- Có thể cần logic đặc biệt: nếu squares.length = 25 → coi như squares = []

### 5. **Logging và debugging**

Thêm logging để track:
- Số lượng instructions trong transaction
- Instruction nào được chọn
- Mask value và squares extracted
- So sánh với numSquares từ log

---

## Kết luận

**Vấn đề chính:**
1. Instruction data có mask = 0 nhưng log message báo có squares → mâu thuẫn
2. Parser chỉ tìm instruction đầu tiên → có thể bỏ sót instruction đúng
3. Không kiểm tra inner instructions → có thể bỏ sót Deploy instruction

**Tác động:**
- 52.5% records bị parse sai
- Chủ yếu là thiếu squares (squares = [] nhưng numSquares > 0)
- Một số có squares đầy đủ nhưng không đúng format (numSquares = 25 nhưng squares.length = 25)

**Ưu tiên sửa:**
1. ✅ Tìm tất cả Deploy instructions (không dừng ở instruction đầu tiên)
2. ✅ Kiểm tra inner instructions
3. ✅ Xử lý trường hợp mask = 0 (có thể là deploy tất cả squares)
4. ✅ Logic đặc biệt cho numSquares = 25

