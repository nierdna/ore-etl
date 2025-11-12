/**
 * Example analytics queries using transformed data
 */

import { MongoManager } from '../database/mongo-manager';
import { logger } from '../utils/logger';

export class Analytics {
  constructor(private mongoManager: MongoManager) {}

  /**
   * Get top miners by total SOL deployed
   */
  async getTopMinersByDeployment(limit: number = 10) {
    const collection = this.mongoManager.getDeploysCollection();
    
    const result = await collection.aggregate([
      { $match: { success: true } },
      { $group: {
          _id: '$authority',
          totalSOL: { $sum: '$amountSOL' },
          totalDeploys: { $sum: 1 },
          rounds: { $addToSet: '$roundId' },
      }},
      { $project: {
          authority: '$_id',
          totalSOL: 1,
          totalDeploys: 1,
          numRounds: { $size: '$rounds' },
      }},
      { $sort: { totalSOL: -1 } },
      { $limit: limit },
    ]).toArray();

    return result;
  }

  /**
   * Get square popularity statistics
   */
  async getSquarePopularity() {
    const collection = this.mongoManager.getDeploysCollection();
    
    const result = await collection.aggregate([
      { $match: { success: true, squares: { $exists: true, $ne: null } } },
      { $unwind: '$squares' },
      { $group: {
          _id: '$squares',
          deployCount: { $sum: 1 },
          totalSOL: { $sum: '$amountSOL' },
          uniqueMiners: { $addToSet: '$authority' },
      }},
      { $project: {
          square: '$_id',
          deployCount: 1,
          totalSOL: 1,
          numMiners: { $size: '$uniqueMiners' },
      }},
      { $sort: { deployCount: -1 } },
    ]).toArray();

    return result;
  }

  /**
   * Get round statistics
   */
  async getRoundStats(roundId: number) {
    const deploysCol = this.mongoManager.getDeploysCollection();
    const checkpointsCol = this.mongoManager.getCheckpointsCollection();
    
    // Get deploy stats
    const deployStats = await deploysCol.aggregate([
      { $match: { roundId, success: true } },
      { $group: {
          _id: null,
          totalSOL: { $sum: '$amountSOL' },
          totalDeploys: { $sum: 1 },
          uniqueMiners: { $addToSet: '$authority' },
          avgSOLPerDeploy: { $avg: '$amountSOL' },
      }},
    ]).toArray();

    // Get checkpoint stats
    const checkpointStats = await checkpointsCol.aggregate([
      { $match: { roundId, success: true } },
      { $group: {
          _id: null,
          totalSOLRewarded: { $sum: '$totalRewardsSOL' },
          totalOERewarded: { $sum: '$totalRewardsORE' },
          numWinners: { $sum: 1 },
      }},
    ]).toArray();

    return {
      roundId,
      deploys: deployStats[0] || {},
      checkpoints: checkpointStats[0] || {},
    };
  }

  /**
   * Get automation vs manual statistics
   */
  async getAutomationStats() {
    const collection = this.mongoManager.getDeploysCollection();
    
    const result = await collection.aggregate([
      { $match: { success: true } },
      { $group: {
          _id: '$isAutomation',
          count: { $sum: 1 },
          totalSOL: { $sum: '$amountSOL' },
          avgSOL: { $avg: '$amountSOL' },
          avgSquares: { $avg: '$numSquares' },
      }},
    ]).toArray();

    return result;
  }

  /**
   * Get miner performance
   */
  async getMinerPerformance(authority: string) {
    const deploysCol = this.mongoManager.getDeploysCollection();
    const checkpointsCol = this.mongoManager.getCheckpointsCollection();

    // Get deploy history
    const deploys = await deploysCol.find({ 
      authority, 
      success: true 
    }).sort({ slot: -1 }).limit(100).toArray();

    // Get checkpoint history
    const checkpoints = await checkpointsCol.find({ 
      authority, 
      success: true 
    }).sort({ slot: -1 }).limit(100).toArray();

    // Calculate statistics
    const totalDeployed = deploys.reduce((sum, d) => sum + d.amountSOL, 0);
    const totalSOLRewards = checkpoints.reduce((sum, c) => sum + c.totalRewardsSOL, 0);
    const totalORERewards = checkpoints.reduce((sum, c) => sum + c.totalRewardsORE, 0);
    const winRate = deploys.length > 0 ? (checkpoints.length / deploys.length) * 100 : 0;

    return {
      authority,
      stats: {
        totalDeploys: deploys.length,
        totalCheckpoints: checkpoints.length,
        totalDeployed,
        totalSOLRewards,
        totalORERewards,
        winRate: winRate.toFixed(2) + '%',
        roi: totalDeployed > 0 ? ((totalSOLRewards / totalDeployed - 1) * 100).toFixed(2) + '%' : 'N/A',
      },
      recentDeploys: deploys.slice(0, 5),
      recentCheckpoints: checkpoints.slice(0, 5),
    };
  }

  /**
   * Get daily statistics
   */
  async getDailyStats(days: number = 7) {
    const collection = this.mongoManager.getDeploysCollection();
    
    const startTime = Math.floor(Date.now() / 1000) - (days * 24 * 60 * 60);

    const result = await collection.aggregate([
      { $match: { 
          success: true,
          blockTime: { $gte: startTime }
      }},
      { $group: {
          _id: {
            $dateToString: {
              format: '%Y-%m-%d',
              date: { $toDate: { $multiply: ['$blockTime', 1000] } }
            }
          },
          totalSOL: { $sum: '$amountSOL' },
          totalDeploys: { $sum: 1 },
          uniqueMiners: { $addToSet: '$authority' },
          avgDeploySize: { $avg: '$amountSOL' },
      }},
      { $project: {
          date: '$_id',
          totalSOL: 1,
          totalDeploys: 1,
          numMiners: { $size: '$uniqueMiners' },
          avgDeploySize: 1,
      }},
      { $sort: { date: -1 } },
    ]).toArray();

    return result;
  }

  /**
   * Get bury/burn statistics
   */
  async getBuryStats() {
    const collection = this.mongoManager.getBuryCollection();
    
    const result = await collection.aggregate([
      { $match: { success: true } },
      { $group: {
          _id: null,
          totalBuryEvents: { $sum: 1 },
          totalSOLSwapped: { $sum: '$solSwappedAmount' },
          totalOREReceived: { $sum: '$oreReceivedAmount' },
          totalOREBurned: { $sum: '$oreBurnedAmount' },
          totalOREShared: { $sum: '$oreSharedAmount' },
      }},
      { $project: {
          _id: 0,
          totalBuryEvents: 1,
          totalSOLSwapped: 1,
          totalOREReceived: 1,
          totalOREBurned: 1,
          totalOREShared: 1,
          burnRate: { 
            $divide: ['$totalOREBurned', '$totalOREReceived'] 
          },
      }},
    ]).toArray();

    return result[0] || null;
  }
}

// Example usage
async function runExamples() {
  const mongoManager = new MongoManager();
  
  try {
    await mongoManager.connect();
    const analytics = new Analytics(mongoManager);

    // Top miners
    console.log('\n=== Top 10 Miners by Deployment ===');
    const topMiners = await analytics.getTopMinersByDeployment(10);
    topMiners.forEach((m, i) => {
      console.log(`${i + 1}. ${m.authority.slice(0, 8)}... - ${m.totalSOL.toFixed(2)} SOL (${m.totalDeploys} deploys, ${m.numRounds} rounds)`);
    });

    // Square popularity
    console.log('\n=== Square Popularity ===');
    const squares = await analytics.getSquarePopularity();
    squares.forEach((s, i) => {
      console.log(`Square ${s.square}: ${s.deployCount} deploys, ${s.totalSOL.toFixed(2)} SOL, ${s.numMiners} miners`);
    });

    // Automation stats
    console.log('\n=== Automation vs Manual ===');
    const autoStats = await analytics.getAutomationStats();
    autoStats.forEach(s => {
      const type = s._id ? 'Automation' : 'Manual';
      console.log(`${type}: ${s.count} deploys, ${s.totalSOL.toFixed(2)} SOL (avg: ${s.avgSOL.toFixed(4)} SOL)`);
    });

    // Daily stats
    console.log('\n=== Daily Stats (Last 7 days) ===');
    const dailyStats = await analytics.getDailyStats(7);
    dailyStats.forEach(d => {
      console.log(`${d.date}: ${d.totalDeploys} deploys, ${d.totalSOL.toFixed(2)} SOL, ${d.numMiners} miners`);
    });

    await mongoManager.disconnect();
  } catch (error) {
    logger.error('Error running analytics', error);
    await mongoManager.disconnect();
    process.exit(1);
  }
}

if (require.main === module) {
  runExamples();
}

