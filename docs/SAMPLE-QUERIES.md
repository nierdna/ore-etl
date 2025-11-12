# 📊 Sample Queries - ORE ETL

> Tổng hợp queries hữu ích cho phân tích data

---

## 🎯 Direct Raw Data Queries

### Query 1: Count by Activity Type

```javascript
// Deploy transactions
db.transactions.countDocuments({
  'parsedData.meta.logMessages': { $regex: 'deploying.*SOL' }
});

// Checkpoint transactions
db.transactions.countDocuments({
  'parsedData.meta.logMessages': { $regex: 'Base rewards' }
});

// Claim SOL
db.transactions.countDocuments({
  'parsedData.meta.logMessages': { $regex: 'Claiming.*SOL$' }
});

// Claim ORE
db.transactions.countDocuments({
  'parsedData.meta.logMessages': { $regex: 'Claiming.*ORE$' }
});

// Bury operations
db.transactions.countDocuments({
  'parsedData.meta.logMessages': { $regex: 'Swapped.*SOL into.*ORE' }
});
```

### Query 2: Recent Deploys

```javascript
db.transactions.aggregate([
  {
    $match: {
      'parsedData.meta.logMessages': { $regex: 'deploying' }
    }
  },
  {
    $project: {
      signature: 1,
      slot: 1,
      blockTime: 1,
      logs: {
        $filter: {
          input: '$parsedData.meta.logMessages',
          as: 'log',
          cond: {
            $regexMatch: {
              input: '$$log',
              regex: 'deploying|Round #'
            }
          }
        }
      }
    }
  },
  { $sort: { slot: -1 } },
  { $limit: 10 }
]);
```

### Query 3: Parse Deploy Log

```javascript
db.transactions.aggregate([
  {
    $match: {
      'parsedData.meta.logMessages': { $regex: 'deploying' }
    }
  },
  {
    $addFields: {
      deployLog: {
        $arrayElemAt: [
          {
            $filter: {
              input: '$parsedData.meta.logMessages',
              as: 'log',
              cond: { $regexMatch: { input: '$$log', regex: 'deploying' } }
            }
          },
          0
        ]
      }
    }
  },
  {
    $project: {
      signature: 1,
      slot: 1,
      deployLog: 1
    }
  },
  { $limit: 10 }
]);
```

---

## 📈 Transformed Data Queries

### Query 1: Top Miners by Total Deployment

```javascript
db.deploys.aggregate([
  { $match: { success: true } },
  {
    $group: {
      _id: '$authority',
      totalSOL: { $sum: '$amountSOL' },
      totalDeploys: { $sum: 1 },
      rounds: { $addToSet: '$roundId' },
      avgDeploySize: { $avg: '$amountSOL' }
    }
  },
  {
    $project: {
      authority: '$_id',
      totalSOL: 1,
      totalDeploys: 1,
      numRounds: { $size: '$rounds' },
      avgDeploySize: 1
    }
  },
  { $sort: { totalSOL: -1 } },
  { $limit: 20 }
]);
```

**Expected Output:**
```json
[
  {
    "authority": "6Er6L78mTiS1f8s7m7yTrZjLusYpbRxiB3aMbxeLktok",
    "totalSOL": 125.5,
    "totalDeploys": 1250,
    "numRounds": 45,
    "avgDeploySize": 0.1004
  },
  ...
]
```

### Query 2: Square Popularity

```javascript
db.deploys.aggregate([
  { $match: { 
      success: true, 
      squares: { $exists: true, $ne: null } 
  }},
  { $unwind: '$squares' },
  {
    $group: {
      _id: '$squares',
      deployCount: { $sum: 1 },
      totalSOL: { $sum: '$amountSOL' },
      uniqueMiners: { $addToSet: '$authority' }
    }
  },
  {
    $project: {
      square: '$_id',
      deployCount: 1,
      totalSOL: 1,
      numMiners: { $size: '$uniqueMiners' }
    }
  },
  { $sort: { deployCount: -1 } }
]);
```

**Expected Output:**
```json
[
  {
    "square": 12,
    "deployCount": 15234,
    "totalSOL": 1523.4,
    "numMiners": 523
  },
  {
    "square": 7,
    "deployCount": 14891,
    "totalSOL": 1489.1,
    "numMiners": 498
  },
  ...
]
```

### Query 3: Round Statistics

```javascript
db.deploys.aggregate([
  { $match: { success: true } },
  {
    $group: {
      _id: '$roundId',
      totalSOL: { $sum: '$amountSOL' },
      totalDeploys: { $sum: 1 },
      uniqueMiners: { $addToSet: '$authority' },
      avgDeploySize: { $avg: '$amountSOL' },
      minDeploySize: { $min: '$amountSOL' },
      maxDeploySize: { $max: '$amountSOL' }
    }
  },
  {
    $project: {
      roundId: '$_id',
      totalSOL: 1,
      totalDeploys: 1,
      numMiners: { $size: '$uniqueMiners' },
      avgDeploySize: 1,
      minDeploySize: 1,
      maxDeploySize: 1
    }
  },
  { $sort: { roundId: -1 } },
  { $limit: 20 }
]);
```

### Query 4: Miner Performance

```javascript
// Get miner's total rewards vs deployed
db.deploys.aggregate([
  {
    $lookup: {
      from: 'checkpoints',
      let: { authority: '$authority', roundId: '$roundId' },
      pipeline: [
        {
          $match: {
            $expr: {
              $and: [
                { $eq: ['$authority', '$$authority'] },
                { $eq: ['$roundId', '$$roundId'] }
              ]
            }
          }
        }
      ],
      as: 'checkpoint'
    }
  },
  { $unwind: { path: '$checkpoint', preserveNullAndEmptyArrays: true } },
  {
    $group: {
      _id: '$authority',
      totalDeployed: { $sum: '$amountSOL' },
      totalSOLRewards: { $sum: '$checkpoint.totalRewardsSOL' },
      totalORERewards: { $sum: '$checkpoint.totalRewardsORE' },
      numDeploys: { $sum: 1 },
      numWins: {
        $sum: { $cond: [{ $gt: ['$checkpoint.totalRewardsSOL', 0] }, 1, 0] }
      }
    }
  },
  {
    $project: {
      authority: '$_id',
      totalDeployed: 1,
      totalSOLRewards: 1,
      totalORERewards: 1,
      numDeploys: 1,
      numWins: 1,
      winRate: {
        $multiply: [
          { $divide: ['$numWins', '$numDeploys'] },
          100
        ]
      },
      roi: {
        $multiply: [
          {
            $subtract: [
              { $divide: ['$totalSOLRewards', '$totalDeployed'] },
              1
            ]
          },
          100
        ]
      }
    }
  },
  { $sort: { roi: -1 } },
  { $limit: 20 }
]);
```

### Query 5: Automation vs Manual

```javascript
db.deploys.aggregate([
  { $match: { success: true } },
  {
    $group: {
      _id: '$isAutomation',
      count: { $sum: 1 },
      totalSOL: { $sum: '$amountSOL' },
      avgSOL: { $avg: '$amountSOL' },
      avgSquares: { $avg: '$numSquares' }
    }
  }
]);
```

**Expected Output:**
```json
[
  {
    "_id": true,  // Automation
    "count": 200000,
    "totalSOL": 20000.0,
    "avgSOL": 0.1,
    "avgSquares": 15.5
  },
  {
    "_id": false,  // Manual
    "count": 100000,
    "totalSOL": 10000.0,
    "avgSOL": 0.1,
    "avgSquares": 8.3
  }
]
```

### Query 6: Daily Activity

```javascript
db.deploys.aggregate([
  { $match: { success: true } },
  {
    $group: {
      _id: {
        $dateToString: {
          format: '%Y-%m-%d',
          date: { $toDate: { $multiply: ['$blockTime', 1000] } }
        }
      },
      totalSOL: { $sum: '$amountSOL' },
      totalDeploys: { $sum: 1 },
      uniqueMiners: { $addToSet: '$authority' }
    }
  },
  {
    $project: {
      date: '$_id',
      totalSOL: 1,
      totalDeploys: 1,
      numMiners: { $size: '$uniqueMiners' }
    }
  },
  { $sort: { date: -1 } },
  { $limit: 30 }
]);
```

### Query 7: Hourly Deploy Volume

```javascript
db.deploys.aggregate([
  { $match: { success: true } },
  {
    $group: {
      _id: {
        $dateToString: {
          format: '%Y-%m-%d %H:00',
          date: { $toDate: { $multiply: ['$blockTime', 1000] } }
        }
      },
      volume: { $sum: '$amountSOL' },
      count: { $sum: 1 }
    }
  },
  { $sort: { _id: -1 } },
  { $limit: 24 }
]);
```

### Query 8: Motherlode Winners

```javascript
db.checkpoints.find({
  motherlodeRewardsORE: { $gt: 0 },
  success: true
}).sort({ slot: -1 });
```

### Query 9: Biggest Single Deploys

```javascript
db.deploys.find({
  success: true
}).sort({ amountSOL: -1 }).limit(10);
```

### Query 10: Bury/Burn Summary

```javascript
db.bury.aggregate([
  { $match: { success: true } },
  {
    $group: {
      _id: null,
      totalBuryEvents: { $sum: 1 },
      totalSOLSwapped: { $sum: '$solSwappedAmount' },
      totalOREBurned: { $sum: '$oreBurnedAmount' },
      totalOREShared: { $sum: '$oreSharedAmount' },
      avgBurnSize: { $avg: '$oreBurnedAmount' }
    }
  }
]);
```

---

## 🔍 Advanced Analytics

### Query 11: Miner Retention

```javascript
// Miners who deployed in multiple consecutive rounds
db.deploys.aggregate([
  { $match: { success: true } },
  {
    $group: {
      _id: '$authority',
      rounds: { $addToSet: '$roundId' }
    }
  },
  {
    $addFields: {
      numRounds: { $size: '$rounds' }
    }
  },
  { $match: { numRounds: { $gte: 10 } } },
  { $sort: { numRounds: -1 } },
  { $limit: 20 }
]);
```

### Query 12: Deploy Patterns

```javascript
// Most common square combinations
db.deploys.aggregate([
  { $match: { 
      success: true,
      squares: { $exists: true, $ne: null }
  }},
  {
    $group: {
      _id: '$squares',
      count: { $sum: 1 }
    }
  },
  { $sort: { count: -1 } },
  { $limit: 20 }
]);
```

### Query 13: Time-to-Checkpoint Analysis

```javascript
// Average time between deploy and checkpoint
db.deploys.aggregate([
  {
    $lookup: {
      from: 'checkpoints',
      let: { authority: '$authority', roundId: '$roundId' },
      pipeline: [
        {
          $match: {
            $expr: {
              $and: [
                { $eq: ['$authority', '$$authority'] },
                { $eq: ['$roundId', '$$roundId'] }
              ]
            }
          }
        }
      ],
      as: 'checkpoint'
    }
  },
  { $unwind: { path: '$checkpoint', preserveNullAndEmptyArrays: false } },
  {
    $project: {
      timeDiff: {
        $subtract: ['$checkpoint.blockTime', '$blockTime']
      }
    }
  },
  {
    $group: {
      _id: null,
      avgTimeDiff: { $avg: '$timeDiff' },
      minTimeDiff: { $min: '$timeDiff' },
      maxTimeDiff: { $max: '$timeDiff' }
    }
  }
]);
```

### Query 14: Staking Activity Timeline

```javascript
db.deposits.aggregate([
  { $match: { success: true } },
  {
    $unionWith: {
      coll: 'withdraws',
      pipeline: [{ $match: { success: true } }]
    }
  },
  {
    $unionWith: {
      coll: 'claim_yields',
      pipeline: [{ $match: { success: true } }]
    }
  },
  {
    $group: {
      _id: {
        $dateToString: {
          format: '%Y-%m-%d',
          date: { $toDate: { $multiply: ['$blockTime', 1000] } }
        }
      },
      deposits: {
        $sum: { $cond: [{ $eq: ['$type', 'deposit'] }, '$amountORE', 0] }
      },
      withdraws: {
        $sum: { $cond: [{ $eq: ['$type', 'withdraw'] }, '$amountORE', 0] }
      }
    }
  },
  { $sort: { _id: -1 } },
  { $limit: 30 }
]);
```

---

## 📊 Business Intelligence Queries

### Query 15: Protocol Revenue

```javascript
// Total fees collected (from bury operations)
db.bury.aggregate([
  {
    $group: {
      _id: null,
      totalSOLIn: { $sum: '$solSwappedAmount' },
      totalOREOut: { $sum: '$oreReceivedAmount' },
      totalBurned: { $sum: '$oreBurnedAmount' },
      totalShared: { $sum: '$oreSharedAmount' }
    }
  },
  {
    $project: {
      totalSOLIn: 1,
      totalOREOut: 1,
      totalBurned: 1,
      totalShared: 1,
      burnRate: { $divide: ['$totalBurned', '$totalOREOut'] },
      shareRate: { $divide: ['$totalShared', '$totalOREOut'] }
    }
  }
]);
```

### Query 16: Active Users Over Time

```javascript
db.deploys.aggregate([
  { $match: { success: true } },
  {
    $group: {
      _id: {
        date: {
          $dateToString: {
            format: '%Y-%m-%d',
            date: { $toDate: { $multiply: ['$blockTime', 1000] } }
          }
        }
      },
      dailyActiveUsers: { $addToSet: '$authority' }
    }
  },
  {
    $project: {
      date: '$_id.date',
      dau: { $size: '$dailyActiveUsers' }
    }
  },
  { $sort: { date: -1 } },
  { $limit: 90 }
]);
```

### Query 17: Winning Rate by Square

```javascript
// Requires reset data
db.resets.aggregate([
  {
    $group: {
      _id: '$winningSquare',
      timesWon: { $sum: 1 }
    }
  },
  {
    $project: {
      square: '$_id',
      timesWon: 1,
      percentage: {
        $multiply: [
          { $divide: ['$timesWon', { $sum: '$timesWon' }] },
          100
        ]
      }
    }
  },
  { $sort: { timesWon: -1 } }
]);
```

### Query 18: ROI Analysis

```javascript
db.deploys.aggregate([
  {
    $lookup: {
      from: 'checkpoints',
      let: { auth: '$authority', round: '$roundId' },
      pipeline: [
        {
          $match: {
            $expr: {
              $and: [
                { $eq: ['$authority', '$$auth'] },
                { $eq: ['$roundId', '$$round'] }
              ]
            }
          }
        }
      ],
      as: 'checkpoint'
    }
  },
  {
    $group: {
      _id: '$authority',
      invested: { $sum: '$amountSOL' },
      returned: {
        $sum: {
          $arrayElemAt: ['$checkpoint.totalRewardsSOL', 0]
        }
      }
    }
  },
  {
    $project: {
      authority: '$_id',
      invested: 1,
      returned: 1,
      profit: { $subtract: ['$returned', '$invested'] },
      roi: {
        $multiply: [
          {
            $divide: [
              { $subtract: ['$returned', '$invested'] },
              '$invested'
            ]
          },
          100
        ]
      }
    }
  },
  { $match: { invested: { $gt: 1 } } },
  { $sort: { roi: -1 } },
  { $limit: 20 }
]);
```

---

## 🎮 Game Mechanics Analysis

### Query 19: Deploy Distribution per Round

```javascript
db.deploys.aggregate([
  { $match: { roundId: 48888, success: true } },
  {
    $bucket: {
      groupBy: '$numSquares',
      boundaries: [1, 5, 10, 15, 20, 26],
      default: 'other',
      output: {
        count: { $sum: 1 },
        totalSOL: { $sum: '$amountSOL' }
      }
    }
  }
]);
```

**Output:**
```json
[
  { "_id": 1, "count": 5000, "totalSOL": 500.0 },    // 1-4 squares
  { "_id": 5, "count": 8000, "totalSOL": 800.0 },    // 5-9 squares
  { "_id": 10, "count": 3000, "totalSOL": 300.0 },   // 10-14 squares
  { "_id": 15, "count": 2000, "totalSOL": 200.0 },   // 15-19 squares
  { "_id": 20, "count": 10000, "totalSOL": 1000.0 }  // 20-25 squares
]
```

### Query 20: Checkpoint Reward Types

```javascript
db.checkpoints.aggregate([
  { $match: { success: true } },
  {
    $group: {
      _id: null,
      totalCheckpoints: { $sum: 1 },
      splitRewards: {
        $sum: { $cond: [{ $gt: ['$splitRewardsORE', 0] }, 1, 0] }
      },
      topMinerRewards: {
        $sum: { $cond: [{ $gt: ['$topMinerRewardsORE', 0] }, 1, 0] }
      },
      motherlodeRewards: {
        $sum: { $cond: [{ $gt: ['$motherlodeRewardsORE', 0] }, 1, 0] }
      }
    }
  },
  {
    $project: {
      totalCheckpoints: 1,
      splitRewards: 1,
      topMinerRewards: 1,
      motherlodeRewards: 1,
      splitPercentage: {
        $multiply: [
          { $divide: ['$splitRewards', '$totalCheckpoints'] },
          100
        ]
      },
      motherlodeProbability: {
        $multiply: [
          { $divide: ['$motherlodeRewards', '$totalCheckpoints'] },
          100
        ]
      }
    }
  }
]);
```

---

## 🔥 Performance Queries

### Query 21: Index Usage Stats

```javascript
db.deploys.aggregate([
  { $indexStats: {} }
]);
```

### Query 22: Collection Stats

```javascript
db.deploys.stats();
db.checkpoints.stats();
```

### Query 23: Slow Query Detection

```javascript
// Enable profiling
db.setProfilingLevel(1, { slowms: 100 });

// Run query
db.deploys.find({ authority: '...' });

// Check slow queries
db.system.profile.find().sort({ ts: -1 }).limit(10);
```

---

## 💡 Tips

### Optimize Queries

```javascript
// Use indexes
db.deploys.createIndex({ authority: 1, roundId: 1 });

// Use projection
db.deploys.find(
  { authority: '...' },
  { signature: 1, roundId: 1, amountSOL: 1 }
);

// Use limit
db.deploys.find().limit(100);
```

### Export Results

```javascript
// To JSON file
mongoexport --db ore_transformed --collection deploys --out deploys.json

// To CSV
mongoexport --db ore_transformed --collection deploys --type=csv --fields=signature,roundId,amountSOL --out deploys.csv
```

---

*Query cookbook for ORE analytics 📊*

