# 🔄 ORE ETL Pipeline

> Transform 1.2M+ raw ORE protocol transactions into structured analytics-ready data

[![TypeScript](https://img.shields.io/badge/TypeScript-5.3-blue)](https://www.typescriptlang.org/)
[![MongoDB](https://img.shields.io/badge/MongoDB-6.3-green)](https://www.mongodb.com/)
[![Status](https://img.shields.io/badge/Status-Production%20Ready-success)](.)

ETL pipeline để transform raw transaction data từ ORE protocol thành structured activities.

## 📋 Tổng quan

Pipeline này đọc raw transaction data từ collection `transactions` (được crawler thu thập) và transform thành các structured collections theo từng loại activity:

- **deploys** - Deploy SOL vào squares
- **checkpoints** - Checkpoint rewards
- **claim_sol** - Claim SOL rewards
- **claim_ore** - Claim ORE rewards
- **deposits** - Deposit ORE (staking)
- **withdraws** - Withdraw ORE (staking)
- **claim_yields** - Claim staking yields
- **bury** - Buy-and-burn operations
- **resets** - Round reset events

## 🏗️ Kiến trúc

```
Raw Transactions (ore.transactions)
          ↓
    [ETL Pipeline]
     ↓  ↓  ↓  ↓
    Transform & Parse
     - Program Logs Parser
     - Instruction Data Parser
     - Account Extractor
          ↓
Structured Collections (ore_transformed.*)
```

## 📦 Cài đặt

```bash
# Install dependencies
npm install

# Copy env file
cp .env.example .env

# Edit .env với MongoDB connection string
```

## ⚙️ Configuration

File `.env`:

```env
# MongoDB Configuration
MONGODB_URI=mongodb://user:password@host:port
SOURCE_DATABASE=ore
TARGET_DATABASE=ore_transformed

# RabbitMQ Configuration (for realtime processing)
RABBITMQ_URL=amqp://user:password@host:port
CONSUMER_PREFETCH=10
CONSUMER_MAX_RETRIES=3
ENABLE_ACTIVITY_EVENTS=true  # Enable publishing activity events to RabbitMQ

# ETL Configuration
BATCH_SIZE=1000
LOG_LEVEL=info

# ORE Program
PROGRAM_ID=oreV3EG1i9BEgiAJ8b177Z2S2rMarzak4NMv1kULvWv
```

## 🚀 Sử dụng

### Quick Test (30 seconds)

```bash
# Install dependencies
npm install

# Test connection & data
npm test
```

**Expected output:**
```
🔌 Testing MongoDB connection...
✅ Connected to MongoDB

📊 Total transactions: 1,222,500
🎯 Deploy transactions: 300,000+

📝 Recent deploy sample:
   Signature: 3Ebnk4g4y3JVX9xun7x...
   Slot: 379189525
   Log: Round #48888: deploying 0.00001 SOL to 11 squares

💰 Checkpoint transactions: 250,000+
✅ Data verification complete!
```

### Build

```bash
npm run build
```

### Run ETL

```bash
# Run all ETL processes
npm run etl:all

# Run specific ETL
npm run etl:deploy      # Deploy activities only
npm run etl:checkpoint  # Checkpoint activities only
```

### Development

```bash
# Run with ts-node (no build required)
npm run dev deploy
npm run dev checkpoint
npm run dev all
```

### Query & Analytics

```bash
# Run sample queries
npm run query all
npm run query count
npm run query recent

# Run analytics
npm run analytics
```

## 📊 Output Collections

### 1. **deploys**

```typescript
{
  signature: string;        // Transaction signature
  slot: number;            // Slot number
  blockTime: number;       // Unix timestamp
  authority: string;       // Miner address
  roundId: number;         // Round ID
  amount: number;          // Amount in lamports
  amountSOL: number;       // Amount in SOL
  numSquares: number;      // Number of squares deployed
  squaresMask?: number;    // Bit mask of squares
  squares?: number[];      // Array of square IDs [0-24]
  isAutomation: boolean;   // Is automated deploy
  success: boolean;        // Transaction success
  createdAt: Date;         // ETL processing time
}
```

### 2. **checkpoints**

```typescript
{
  signature: string;
  slot: number;
  blockTime: number;
  authority: string;
  roundId: number;
  baseRewardsSOL?: number;        // Base SOL rewards
  splitRewardsORE?: number;       // Split mode ORE rewards
  topMinerRewardsORE?: number;    // Top miner ORE rewards
  motherlodeRewardsORE?: number;  // Motherlode ORE rewards
  refundSOL?: number;             // Refund amount (if any)
  totalRewardsSOL: number;        // Total SOL earned
  totalRewardsORE: number;        // Total ORE earned
  success: boolean;
  createdAt: Date;
}
```

## 🔍 Queries Example

### Total SOL deployed by round

```javascript
db.deploys.aggregate([
  { $match: { success: true } },
  { $group: {
      _id: "$roundId",
      totalSOL: { $sum: "$amountSOL" },
      totalDeploys: { $sum: 1 },
      uniqueMiners: { $addToSet: "$authority" }
  }},
  { $project: {
      roundId: "$_id",
      totalSOL: 1,
      totalDeploys: 1,
      numMiners: { $size: "$uniqueMiners" }
  }},
  { $sort: { _id: -1 } },
  { $limit: 10 }
]);
```

### Top miners by total rewards

```javascript
db.checkpoints.aggregate([
  { $match: { success: true } },
  { $group: {
      _id: "$authority",
      totalSOL: { $sum: "$totalRewardsSOL" },
      totalORE: { $sum: "$totalRewardsORE" },
      numCheckpoints: { $sum: 1 }
  }},
  { $sort: { totalSOL: -1 } },
  { $limit: 10 }
]);
```

### Square popularity

```javascript
db.deploys.aggregate([
  { $match: { success: true, squares: { $exists: true } } },
  { $unwind: "$squares" },
  { $group: {
      _id: "$squares",
      deployCount: { $sum: 1 },
      totalSOL: { $sum: "$amountSOL" }
  }},
  { $sort: { deployCount: -1 } }
]);
```

### Automation vs Manual deploys

```javascript
db.deploys.aggregate([
  { $match: { success: true } },
  { $group: {
      _id: "$isAutomation",
      count: { $sum: 1 },
      totalSOL: { $sum: "$amountSOL" },
      avgSOL: { $avg: "$amountSOL" }
  }}
]);
```

## 📈 ETL State Tracking

Pipeline tự động track processing state trong collection `etl_state`:

```javascript
{
  type: "deploy",
  lastProcessedSlot: 379189525,
  lastProcessedSignature: "...",
  totalProcessed: 50000,
  lastRunAt: ISODate("2025-11-10T15:39:00Z"),
  status: "idle",  // idle | running | error
  errorMessage: null
}
```

## 🔄 Re-processing

Để re-process từ đầu:

```javascript
// Delete ETL state
db.etl_state.deleteOne({ type: "deploy" });

// Delete processed data
db.deploys.deleteMany({});

// Run ETL again
npm run etl:deploy
```

## 🏃 Performance

- **Batch size**: 1000 transactions per batch (configurable)
- **Processing speed**: ~1000-2000 tx/second
- **Memory usage**: ~100-200 MB
- **Indexes**: Tự động tạo indexes cho fast queries

## 📝 Logs

Logs được lưu vào:
- `etl-combined.log` - All logs
- `etl-error.log` - Error logs only
- Console output với colors

## 🛠️ Extending

Để thêm ETL processor mới:

1. Tạo file trong `src/etl/`
2. Implement processor class
3. Add vào `src/index.ts`
4. Update README

Example:

```typescript
// src/etl/claim-sol-etl.ts
export class ClaimSOLETL {
  constructor(private mongoManager: MongoManager) {}

  async run(): Promise<void> {
    // Implement ETL logic
  }

  private async fetchBatch(afterSlot: number) {
    // Fetch raw transactions
  }

  private async processBatch(transactions: RawTransaction[]) {
    // Transform to ClaimSOLActivity
  }
}
```

## 📚 Related Docs

- [Program Logs Analysis](../docs/program-logs-analysis.md)
- [Extracting Deploy Squares](../docs/extracting-deploy-squares.md)
- [Algorithms](../docs/algorithms.md)

## 🐛 Troubleshooting

### ETL stuck in "running" status

```javascript
db.etl_state.updateOne(
  { type: "deploy" },
  { $set: { status: "idle" } }
);
```

### Reset specific ETL

```javascript
db.etl_state.updateOne(
  { type: "deploy" },
  { $set: { 
      lastProcessedSlot: 0,
      totalProcessed: 0,
      status: "idle"
  }}
);
```

### Check ETL progress

```javascript
db.etl_state.find().pretty();
```

## 📄 License

Same as main ORE project - Apache 2.0

