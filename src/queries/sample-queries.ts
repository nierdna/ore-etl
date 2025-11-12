/**
 * Sample queries để test với raw transaction data
 */

import { MongoManager } from '../database/mongo-manager';
import { logger } from '../utils/logger';
import { config } from '../config';

export class SampleQueries {
  constructor(private mongoManager: MongoManager) {}

  /**
   * Query 1: Count transactions by type (from logs)
   */
  async countTransactionsByType() {
    logger.info('Counting transactions by type...');
    
    const collection = this.mongoManager.getRawTransactionsCollection();
    
    const results = await Promise.all([
      collection.countDocuments({ 
        'parsedData.meta.logMessages': { $regex: 'deploying.*SOL' } 
      }),
      collection.countDocuments({ 
        'parsedData.meta.logMessages': { $regex: 'Base rewards' } 
      }),
      collection.countDocuments({ 
        'parsedData.meta.logMessages': { $regex: 'Claiming.*SOL' } 
      }),
      collection.countDocuments({ 
        'parsedData.meta.logMessages': { $regex: 'Claiming.*ORE' } 
      }),
      collection.countDocuments({ 
        'parsedData.meta.logMessages': { $regex: 'Depositing.*ORE' } 
      }),
      collection.countDocuments({ 
        'parsedData.meta.logMessages': { $regex: 'Withdrawing.*ORE' } 
      }),
      collection.countDocuments({ 
        'parsedData.meta.logMessages': { $regex: 'Swapped.*SOL' } 
      }),
    ]);

    return {
      deploys: results[0],
      checkpoints: results[1],
      claimSOL: results[2],
      claimORE: results[3],
      deposits: results[4],
      withdraws: results[5],
      bury: results[6],
      total: await collection.countDocuments({}),
    };
  }

  /**
   * Query 2: Get recent deploy transactions
   */
  async getRecentDeploys(limit: number = 10) {
    logger.info(`Getting ${limit} recent deploy transactions...`);
    
    const collection = this.mongoManager.getRawTransactionsCollection();
    
    const txs = await collection
      .find({ 
        'parsedData.meta.logMessages': { $regex: 'deploying.*SOL' },
        err: null
      })
      .sort({ slot: -1 })
      .limit(limit)
      .project({
        signature: 1,
        slot: 1,
        blockTime: 1,
        'parsedData.meta.logMessages': 1,
      })
      .toArray();

    return txs.map(tx => {
      const logs = tx.parsedData?.meta?.logMessages || [];
      const deployLog = logs.find((l: string) => l.includes('deploying'));
      
      return {
        signature: tx.signature,
        slot: tx.slot,
        blockTime: tx.blockTime,
        deployLog,
      };
    });
  }

  /**
   * Query 3: Parse deploy details from sample transaction
   */
  async parseDeploySample(signature?: string) {
    logger.info('Parsing deploy transaction sample...');
    
    const collection = this.mongoManager.getRawTransactionsCollection();
    
    const tx = signature 
      ? await collection.findOne({ signature })
      : await collection.findOne({ 
          'parsedData.meta.logMessages': { $regex: 'deploying.*SOL' } 
        });

    if (!tx) {
      logger.warn('No deploy transaction found');
      return null;
    }

    const logs = tx.parsedData?.meta?.logMessages || [];
    const instructions = tx.parsedData?.transaction?.message?.instructions || [];

    // Find deploy log
    const deployLog = logs.find((l: string) => l.includes('deploying'));
    
    // Find deploy instruction
    let deployInstruction = null;
    for (const ix of instructions) {
      if (ix.data && typeof ix.data === 'string') {
        try {
          const data = Buffer.from(ix.data, 'base64');
          if (data[0] === 6) { // Deploy instruction
            const amount = data.readBigUInt64LE(1);
            const mask = data.readUInt32LE(9);
            
            const squares = [];
            for (let i = 0; i < 25; i++) {
              if (mask & (1 << i)) squares.push(i);
            }
            
            deployInstruction = {
              type: 'Deploy',
              amount: amount.toString(),
              amountSOL: Number(amount) / 1e9,
              mask,
              squares,
            };
            break;
          }
        } catch (err) {
          // Skip invalid instruction
        }
      }
    }

    return {
      signature: tx.signature,
      slot: tx.slot,
      blockTime: tx.blockTime,
      deployLog,
      deployInstruction,
      allLogs: logs.filter((l: string) => l.startsWith('Program log:')),
    };
  }

  /**
   * Query 4: Analyze rounds
   */
  async analyzeRounds() {
    logger.info('Analyzing rounds...');
    
    const collection = this.mongoManager.getRawTransactionsCollection();
    
    const result = await collection.aggregate([
      { $match: { 
          'parsedData.meta.logMessages': { $regex: 'Round #' },
          err: null
      }},
      { $project: {
          slot: 1,
          blockTime: 1,
          logs: '$parsedData.meta.logMessages',
      }},
      { $limit: 100 },
    ]).toArray();

    const roundCounts: { [key: number]: number } = {};
    
    for (const tx of result) {
      const logs = tx.logs || [];
      for (const log of logs) {
        const match = log.match(/Round #(\d+)/);
        if (match) {
          const roundId = parseInt(match[1]);
          roundCounts[roundId] = (roundCounts[roundId] || 0) + 1;
        }
      }
    }

    const sorted = Object.entries(roundCounts)
      .map(([roundId, count]) => ({ roundId: parseInt(roundId), count }))
      .sort((a, b) => b.count - a.count);

    return sorted.slice(0, 20);
  }

  /**
   * Query 5: Get checkpoint rewards summary
   */
  async getCheckpointRewardsSummary(limit: number = 10) {
    logger.info('Getting checkpoint rewards summary...');
    
    const collection = this.mongoManager.getRawTransactionsCollection();
    
    const txs = await collection
      .find({ 
        'parsedData.meta.logMessages': { $regex: 'Base rewards' },
        err: null
      })
      .sort({ slot: -1 })
      .limit(limit)
      .project({
        signature: 1,
        slot: 1,
        blockTime: 1,
        'parsedData.meta.logMessages': 1,
      })
      .toArray();

    return txs.map(tx => {
      const logs = tx.parsedData?.meta?.logMessages || [];
      
      const roundIdLog = logs.find((l: string) => l.includes('Round ID:'));
      const baseRewardsLog = logs.find((l: string) => l.includes('Base rewards:'));
      const splitRewardsLog = logs.find((l: string) => l.includes('Split rewards:'));
      const topMinerLog = logs.find((l: string) => l.includes('Top miner rewards:'));
      const motherlodeLog = logs.find((l: string) => l.includes('Motherlode rewards:'));

      return {
        signature: tx.signature,
        slot: tx.slot,
        blockTime: tx.blockTime,
        roundIdLog,
        baseRewardsLog,
        splitRewardsLog,
        topMinerLog,
        motherlodeLog,
      };
    });
  }
}

// CLI runner
async function main() {
  const mongoManager = new MongoManager();
  
  try {
    await mongoManager.connect();
    const queries = new SampleQueries(mongoManager);

    const command = process.argv[2] || 'all';

    switch (command) {
      case 'count':
        const counts = await queries.countTransactionsByType();
        console.log('\n📊 Transaction Counts:');
        console.log(JSON.stringify(counts, null, 2));
        break;

      case 'recent':
        const recent = await queries.getRecentDeploys(10);
        console.log('\n📝 Recent Deploys:');
        recent.forEach((d, i) => {
          console.log(`${i + 1}. ${d.signature.slice(0, 16)}...`);
          console.log(`   Slot: ${d.slot}`);
          console.log(`   Log: ${d.deployLog}`);
        });
        break;

      case 'parse':
        const sig = process.argv[3];
        const parsed = await queries.parseDeploySample(sig);
        console.log('\n🔍 Parsed Deploy:');
        console.log(JSON.stringify(parsed, null, 2));
        break;

      case 'rounds':
        const rounds = await queries.analyzeRounds();
        console.log('\n🎮 Active Rounds:');
        rounds.forEach((r, i) => {
          console.log(`${i + 1}. Round #${r.roundId}: ${r.count} transactions`);
        });
        break;

      case 'checkpoints':
        const checkpoints = await queries.getCheckpointRewardsSummary(10);
        console.log('\n💰 Recent Checkpoints:');
        checkpoints.forEach((c, i) => {
          console.log(`${i + 1}. ${c.signature.slice(0, 16)}...`);
          console.log(`   ${c.baseRewardsLog || 'No base rewards'}`);
          console.log(`   ${c.splitRewardsLog || c.topMinerLog || 'No ORE rewards'}`);
          if (c.motherlodeLog) console.log(`   ${c.motherlodeLog} 🎰`);
        });
        break;

      case 'all':
      default:
        console.log('\n🚀 Running all sample queries...\n');
        
        const allCounts = await queries.countTransactionsByType();
        console.log('📊 Transaction Counts:');
        console.log(JSON.stringify(allCounts, null, 2));

        console.log('\n📝 Recent Deploys:');
        const allRecent = await queries.getRecentDeploys(5);
        allRecent.forEach((d, i) => {
          console.log(`${i + 1}. ${d.deployLog}`);
        });

        console.log('\n🎮 Active Rounds:');
        const allRounds = await queries.analyzeRounds();
        allRounds.slice(0, 10).forEach((r, i) => {
          console.log(`${i + 1}. Round #${r.roundId}: ${r.count} transactions`);
        });

        break;
    }

    await mongoManager.disconnect();
    process.exit(0);
  } catch (error) {
    logger.error('Query failed', error);
    await mongoManager.disconnect();
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

