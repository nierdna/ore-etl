# 🚀 Quick Start Guide - ORE ETL

> Hướng dẫn setup và chạy ETL pipeline trong 5 phút

---

## ⚡ 5-Minute Setup

### Step 1: Install Dependencies

```bash
cd ore-etl
npm install
```

### Step 2: Configure Environment

```bash
# Copy env template
cp .env.example .env

# Edit .env
nano .env
```

**Minimum config:**
```env
MONGODB_URI=mongodb://mongo:PASSWORD@turntable.proxy.rlwy.net:56417
SOURCE_DATABASE=ore
TARGET_DATABASE=ore_transformed
```

### Step 3: Run ETL

```bash
# Build TypeScript
npm run build

# Run all ETL processes
npm start all
```

Hoặc development mode:

```bash
# No build needed
npm run dev all
```

---

## 📊 Verify Results

### Check processed data

```javascript
// Connect to MongoDB
use ore_transformed;

// Check deploys
db.deploys.countDocuments({});
// → Should see numbers increasing

// View sample
db.deploys.findOne();
```

**Expected output:**
```json
{
  "_id": ObjectId("..."),
  "signature": "3Ebnk4g4y3JVX9xun7x...",
  "slot": 379189525,
  "blockTime": 1762789129,
  "authority": "6Er6L78mTiS1f8s7m7yTrZjLusYpbRxiB3aMbxeLktok",
  "roundId": 48888,
  "amount": 10000,
  "amountSOL": 0.00001,
  "numSquares": 11,
  "squaresMask": 33554431,
  "squares": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
  "isAutomation": false,
  "success": true,
  "createdAt": ISODate("2025-11-10T15:39:00.990Z")
}
```

### Check ETL state

```javascript
db.etl_state.find().pretty();
```

**Expected output:**
```json
{
  "type": "deploy",
  "lastProcessedSlot": 379189525,
  "totalProcessed": 50000,
  "lastRunAt": ISODate("2025-11-10T15:39:00.990Z"),
  "status": "idle"
}
```

---

## 🎯 Run Specific ETL

### Deploy only

```bash
npm run etl:deploy
```

### Checkpoint only

```bash
npm run etl:checkpoint
```

### All (recommended)

```bash
npm run etl:all
```

---

## 📈 Run Analytics

```bash
# Run example analytics
npm run dev analytics/examples
```

**Output:**
```
=== Top 10 Miners by Deployment ===
1. 6Er6L78m... - 125.50 SOL (1250 deploys, 45 rounds)
2. DFePzUQk... - 98.30 SOL (980 deploys, 38 rounds)
...

=== Square Popularity ===
Square 0: 5234 deploys, 523.4 SOL, 234 miners
Square 1: 4891 deploys, 489.1 SOL, 221 miners
...

=== Automation vs Manual ===
Automation: 35000 deploys, 3500.00 SOL (avg: 0.1000 SOL)
Manual: 15000 deploys, 1500.00 SOL (avg: 0.1000 SOL)
```

---

## 🔧 Troubleshooting

### ETL stuck in "running"

```javascript
// Reset status
db.etl_state.updateOne(
  { type: "deploy" },
  { $set: { status: "idle" } }
);
```

### Re-run from beginning

```javascript
// Delete state
db.etl_state.deleteOne({ type: "deploy" });

// Delete processed data
db.deploys.deleteMany({});

// Run again
npm run etl:deploy
```

### Check errors

```bash
# View error logs
cat etl-error.log

# View all logs
cat etl-combined.log
```

---

## 📊 Example Queries

### Query trong MongoDB

```javascript
// Find deploys by specific miner
db.deploys.find({ 
  authority: "6Er6L78mTiS1f8s7m7yTrZjLusYpbRxiB3aMbxeLktok" 
}).sort({ slot: -1 }).limit(10);

// Find checkpoints with motherlode
db.checkpoints.find({ 
  motherlodeRewardsORE: { $gt: 0 } 
});

// Get round statistics
db.deploys.aggregate([
  { $match: { roundId: 48888 } },
  { $group: {
      _id: null,
      totalSOL: { $sum: "$amountSOL" },
      totalDeploys: { $sum: 1 },
      miners: { $addToSet: "$authority" }
  }}
]);
```

---

## ⏰ Scheduled Runs

### Using cron

```bash
# Edit crontab
crontab -e

# Add hourly run
0 * * * * cd /path/to/ore-etl && npm start all >> etl-cron.log 2>&1
```

### Using systemd (Linux)

```ini
# /etc/systemd/system/ore-etl.service
[Unit]
Description=ORE ETL Pipeline
After=network.target

[Service]
Type=oneshot
User=your-user
WorkingDirectory=/path/to/ore-etl
ExecStart=/usr/bin/npm start all

[Install]
WantedBy=multi-user.target
```

```bash
# Enable timer
systemctl enable ore-etl.timer
systemctl start ore-etl.timer
```

---

## 🎓 Next Steps

1. ✅ Setup & run basic ETL
2. 📊 Run analytics examples
3. 🔍 Create custom queries
4. 📈 Build dashboard (Grafana, Metabase, etc)
5. 🤖 Automate with cron/systemd

---

## 🆘 Support

Nếu gặp vấn đề:

1. Check logs: `cat etl-error.log`
2. Check ETL state: `db.etl_state.find()`
3. Verify MongoDB connection
4. Check source data exists: `db.transactions.countDocuments()`

---

*Happy analyzing! 📊*

