# 🏗️ ORE ETL Architecture

> Chi tiết kiến trúc và luồng xử lý của ETL pipeline

---

## 📊 Overview

ETL pipeline transform raw Solana transaction data thành structured activities cho phân tích.

```
┌─────────────────────────────────────────────────────────┐
│              Source: ore.transactions                    │
│         (1.2M+ raw transaction documents)                │
└────────────────────┬────────────────────────────────────┘
                     │
                     ↓
         ┌───────────────────────┐
         │    ETL Pipeline       │
         │  ┌─────────────────┐  │
         │  │  Log Parser     │  │  Parse program logs
         │  └─────────────────┘  │
         │  ┌─────────────────┐  │
         │  │ Instruction     │  │  Parse instruction data
         │  │ Parser          │  │  (deploy squares, etc)
         │  └─────────────────┘  │
         │  ┌─────────────────┐  │
         │  │ Account         │  │  Extract addresses
         │  │ Extractor       │  │
         │  └─────────────────┘  │
         └───────────┬───────────┘
                     │
                     ↓
┌────────────────────────────────────────────────────────┐
│        Target: ore_transformed.*                       │
│                                                         │
│  ├─ deploys (50K+ docs)         - Deploy activities   │
│  ├─ checkpoints (40K+ docs)     - Reward checkpoints  │
│  ├─ claim_sol                    - SOL claims          │
│  ├─ claim_ore                    - ORE claims          │
│  ├─ deposits                     - Staking deposits    │
│  ├─ withdraws                    - Staking withdraws   │
│  ├─ claim_yields                 - Yield claims        │
│  ├─ bury                         - Buy-and-burn        │
│  ├─ resets                       - Round resets        │
│  └─ etl_state                    - Processing state    │
└────────────────────────────────────────────────────────┘
```

---

## 🔄 ETL Flow

### 1. **Extract Phase**

```typescript
// Fetch raw transactions from source DB
const batch = await collection.find({
  slot: { $gt: lastProcessedSlot },
  'parsedData.meta.logMessages': { $regex: 'deploying.*SOL' }
})
.sort({ slot: 1 })
.limit(1000)
.toArray();
```

**Đặc điểm:**
- ✅ Incremental processing (track last slot)
- ✅ Filtered by log patterns (fast query)
- ✅ Batch processing (1000 txs/batch)
- ✅ Ordered by slot (sequential)

### 2. **Transform Phase**

#### A. Parse Program Logs

```typescript
const logs = tx.parsedData.meta.logMessages;

// Example logs:
// "Program log: Round #48888: deploying 0.1 SOL to 5 squares"
// "Program log: Base rewards: 5.5 SOL"
// "Program log: Split rewards: 0.5 ORE"

const parsedLogs = LogParser.parseAll(logs);
// → [{ type: 'deploy', roundId: 48888, amountSOL: 0.1, numSquares: 5 }]
```

#### B. Parse Instruction Data

```typescript
const instruction = tx.parsedData.transaction.message.instructions[3];
const data = Buffer.from(instruction.data, 'base64');

// Instruction format: [type:u8][amount:u64][mask:u32]
const instructionType = data[0];  // 6 = Deploy
const amount = data.readBigUInt64LE(1);
const mask = data.readUInt32LE(9);

// Extract squares from mask
const squares = [];
for (let i = 0; i < 25; i++) {
  if (mask & (1 << i)) squares.push(i);
}
// → [0, 5, 10, 15, 20]
```

#### C. Extract Accounts

```typescript
const accounts = instruction.accounts;
// → [signer, authority, automation, board, miner, round, systemProgram]

const authority = accounts[1];  // Authority address
const isAutomation = accounts[2] !== '11111...'; // Has automation account
```

#### D. Build Structured Document

```typescript
const activity: DeployActivity = {
  signature: tx.signature,
  slot: tx.slot,
  blockTime: tx.blockTime,
  authority: authority,
  roundId: deployLog.roundId,
  amount: Number(amount),
  amountSOL: deployLog.amountSOL,
  numSquares: deployLog.numSquares,
  squaresMask: mask,
  squares: squares,
  isAutomation: isAutomation,
  success: tx.err === null,
  createdAt: new Date()
};
```

### 3. **Load Phase**

```typescript
// Batch upsert to target collection
await collection.bulkWrite(
  deploys.map(d => ({
    updateOne: {
      filter: { signature: d.signature },
      update: { $set: d },
      upsert: true
    }
  })),
  { ordered: false }
);
```

**Đặc điểm:**
- ✅ Upsert (idempotent - có thể re-run)
- ✅ Bulk write (fast)
- ✅ Unordered (parallel execution)
- ✅ Dedupe by signature

---

## 📐 Data Model

### Source Schema (Raw)

```typescript
interface RawTransaction {
  signature: string;
  slot: number;
  blockTime: number;
  err: any;
  parsedData: {
    meta: {
      logMessages: string[];
      err: any;
      // ... more fields
    };
    transaction: {
      message: {
        instructions: Array<{
          data: string;      // base64 encoded
          accounts: any[];
          programId: any;
        }>;
        accountKeys: any[];
      };
    };
  };
}
```

### Target Schema (Transformed)

```typescript
interface DeployActivity {
  // Identifiers
  signature: string;        // Unique
  slot: number;            // For ordering
  blockTime: number;       // For time-series
  
  // Business data
  authority: string;       // Miner address
  roundId: number;         // Game round
  amount: number;          // Lamports
  amountSOL: number;       // Human-readable
  numSquares: number;      // Count
  squaresMask?: number;    // Bit mask
  squares?: number[];      // [0,5,10,15,20]
  
  // Metadata
  isAutomation: boolean;   // Auto vs manual
  success: boolean;        // Tx status
  createdAt: Date;         // ETL timestamp
}
```

---

## 🎯 Design Decisions

### 1. **Incremental Processing**

**Why:** Efficient re-runs without reprocessing all data

```typescript
// Track last processed slot
const state = {
  type: 'deploy',
  lastProcessedSlot: 379189525,
  totalProcessed: 50000
};

// Next run: only process slot > 379189525
const batch = await find({ slot: { $gt: state.lastProcessedSlot } });
```

### 2. **Idempotent Operations**

**Why:** Safe to re-run, handle duplicates

```typescript
// Upsert by signature (natural key)
updateOne(
  { signature: tx.signature },
  { $set: activity },
  { upsert: true }
);
```

### 3. **Batch Processing**

**Why:** Balance memory usage and performance

```typescript
// Process 1000 at a time
const BATCH_SIZE = 1000;

while (hasMore) {
  const batch = await fetchBatch(BATCH_SIZE);
  const transformed = await processBatch(batch);
  await saveBatch(transformed);
}
```

### 4. **Separate Collections**

**Why:** Optimized queries per activity type

```
❌ BAD: One collection with type field
{
  type: 'deploy',
  data: { ... }
}

✅ GOOD: Separate collections
- deploys
- checkpoints
- claims
→ Better indexes, faster queries
```

### 5. **Denormalized Data**

**Why:** Query performance over storage

```typescript
// Store both raw and computed values
{
  amount: 100000000,        // Raw lamports
  amountSOL: 0.1,          // Computed for display
  
  squares: [0, 5, 10],     // Parsed array
  squaresMask: 1057,       // Original mask
}
```

---

## 🚀 Performance Optimizations

### 1. **Indexes**

```typescript
// Most important indexes
await collection.createIndex({ signature: 1 }, { unique: true });  // Uniqueness
await collection.createIndex({ slot: -1 });                        // Time-series
await collection.createIndex({ authority: 1, slot: -1 });         // User queries
await collection.createIndex({ roundId: 1 });                      // Round queries
```

### 2. **Projection**

```typescript
// Only fetch needed fields from source
const batch = await collection.find(query, {
  projection: {
    signature: 1,
    slot: 1,
    blockTime: 1,
    'parsedData.meta.logMessages': 1,
    'parsedData.transaction.message.instructions': 1
  }
});
```

### 3. **Bulk Operations**

```typescript
// Batch writes instead of individual
await collection.bulkWrite(operations, { 
  ordered: false  // Parallel execution
});
```

### 4. **Regex Filters**

```typescript
// Filter at DB level (faster than JS)
{
  'parsedData.meta.logMessages': { 
    $regex: 'deploying.*SOL' 
  }
}
```

---

## 📊 Processing Strategy

### Sequential Processing

```
Round 1: Slots 100-250
Round 2: Slots 251-400
Round 3: Slots 401-550
...

ETL processes in order:
100 → 101 → 102 → ... → 550

Benefits:
✅ Guaranteed order
✅ Can resume from any point
✅ No race conditions
```

### State Tracking

```typescript
interface ETLState {
  type: string;                 // 'deploy', 'checkpoint', etc.
  lastProcessedSlot: number;    // Resume point
  lastProcessedSignature: string;
  totalProcessed: number;       // Progress tracking
  lastRunAt: Date;
  status: 'idle' | 'running' | 'error';
  errorMessage?: string;
}
```

---

## 🔍 Error Handling

### 1. **Transaction Level**

```typescript
for (const tx of batch) {
  try {
    const activity = await processTransaction(tx);
    results.push(activity);
  } catch (error) {
    logger.error(`Failed to process ${tx.signature}`, error);
    // Continue with next transaction
  }
}
```

### 2. **Batch Level**

```typescript
try {
  await saveBatch(activities);
} catch (error) {
  // Log error but continue to next batch
  logger.error('Failed to save batch', error);
  
  // Update state with error
  await updateETLState({
    status: 'error',
    errorMessage: error.message
  });
}
```

### 3. **Pipeline Level**

```typescript
try {
  await runETL();
} catch (error) {
  // Critical error, stop pipeline
  logger.error('ETL pipeline failed', error);
  
  // Mark as error in state
  await updateETLState({ status: 'error' });
  
  throw error;
}
```

---

## 📈 Monitoring

### Check ETL Status

```javascript
// Current status
db.etl_state.find().pretty();

// Output:
{
  type: "deploy",
  lastProcessedSlot: 379189525,
  totalProcessed: 50000,
  lastRunAt: ISODate("2025-11-11T02:48:47Z"),
  status: "idle"
}
```

### Check Progress

```javascript
// Compare with source
db.transactions.countDocuments({ 
  'parsedData.meta.logMessages': { $regex: 'deploying' } 
});
// → 52000

db.deploys.countDocuments({});
// → 50000

// Progress: 50000/52000 = 96.15%
```

### Performance Metrics

```javascript
// Processing speed
db.etl_state.aggregate([
  {
    $project: {
      type: 1,
      totalProcessed: 1,
      runtime: {
        $subtract: ['$lastRunAt', '$createdAt']
      }
    }
  }
]);
```

---

## 🎓 Best Practices

### ✅ DO:

1. **Always check status before running**
   ```javascript
   db.etl_state.findOne({ type: 'deploy', status: 'running' });
   // If running, wait or kill
   ```

2. **Run incrementally**
   ```bash
   # Run daily or hourly
   0 * * * * npm run etl:all
   ```

3. **Monitor disk space**
   ```javascript
   db.stats(); // Check database size
   ```

4. **Backup before major changes**
   ```bash
   mongodump --db ore_transformed
   ```

### ❌ DON'T:

1. **Don't run multiple instances simultaneously**
   - Race conditions on state
   - Duplicate processing

2. **Don't skip error handling**
   - Always log errors
   - Update state on failure

3. **Don't ignore indexes**
   - Queries will be slow
   - ETL will timeout

---

## 🧪 Testing

### Unit Tests

```typescript
// Test log parser
const logs = ['Program log: Round #100: deploying 0.1 SOL to 5 squares'];
const parsed = LogParser.parseAll(logs);

expect(parsed[0]).toEqual({
  type: 'deploy',
  roundId: 100,
  amountSOL: 0.1,
  numSquares: 5
});
```

### Integration Tests

```typescript
// Test full ETL flow
const mockTx = {
  signature: 'test123',
  slot: 1000,
  parsedData: { /* ... */ }
};

const deployETL = new DeployETL(mongoManager);
const result = await deployETL.processTransaction(mockTx);

expect(result.roundId).toBe(100);
expect(result.squares).toEqual([0, 5, 10, 15, 20]);
```

---

## 📚 Related Docs

- [README](../README.md) - Quick start guide
- [Analytics Examples](../src/analytics/examples.ts) - Query examples
- [Program Logs Analysis](../../docs/program-logs-analysis.md)
- [Extracting Deploy Squares](../../docs/extracting-deploy-squares.md)

---

*Last updated: 2025-11-10*

