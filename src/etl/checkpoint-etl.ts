import { MongoManager } from '../database/mongo-manager';
import { logger } from '../utils/logger';
import { LogParser, CheckpointLog } from '../parsers/log-parser';
import { InstructionParser } from '../parsers/instruction-parser';
import { CheckpointActivity, RawTransaction } from '../types/schemas';
import { config } from '../config';

export class CheckpointETL {
  private mongoManager: MongoManager;

  constructor(mongoManager: MongoManager) {
    this.mongoManager = mongoManager;
  }

  async run(): Promise<void> {
    logger.info('Starting Checkpoint ETL...');

    try {
      const state = await this.mongoManager.getETLState('checkpoint');
      const lastSlot = state?.lastProcessedSlot || 0;

      logger.info(`Last processed slot: ${lastSlot}`);

      await this.mongoManager.updateETLState({
        type: 'checkpoint',
        lastProcessedSlot: lastSlot,
        lastProcessedSignature: state?.lastProcessedSignature || '',
        totalProcessed: state?.totalProcessed || 0,
        lastRunAt: new Date(),
        status: 'running',
      });

      let processed = 0;
      let currentSlot = lastSlot;

      while (true) {
        const batch = await this.fetchBatch(currentSlot);
        
        if (batch.length === 0) {
          logger.info('No more transactions to process');
          break;
        }

        const checkpoints = await this.processBatch(batch);
        
        if (checkpoints.length > 0) {
          await this.mongoManager.saveBatch(
            this.mongoManager.getCheckpointsCollection(),
            checkpoints
          );
        }

        processed += checkpoints.length;
        currentSlot = batch[batch.length - 1].slot;

        logger.info(`Processed ${checkpoints.length} checkpoints, total: ${processed}`);

        await this.mongoManager.updateETLState({
          type: 'checkpoint',
          lastProcessedSlot: currentSlot,
          lastProcessedSignature: batch[batch.length - 1].signature,
          totalProcessed: (state?.totalProcessed || 0) + checkpoints.length,
          lastRunAt: new Date(),
          status: 'running',
        });
      }

      await this.mongoManager.updateETLState({
        type: 'checkpoint',
        lastProcessedSlot: currentSlot,
        lastProcessedSignature: '',
        totalProcessed: (state?.totalProcessed || 0) + processed,
        lastRunAt: new Date(),
        status: 'idle',
      });

      logger.info(`Checkpoint ETL completed. Processed ${processed} new checkpoints`);
    } catch (error) {
      logger.error('Error in Checkpoint ETL', error);
      
      const state = await this.mongoManager.getETLState('checkpoint');
      await this.mongoManager.updateETLState({
        type: 'checkpoint',
        lastProcessedSlot: state?.lastProcessedSlot || 0,
        lastProcessedSignature: state?.lastProcessedSignature || '',
        totalProcessed: state?.totalProcessed || 0,
        lastRunAt: new Date(),
        status: 'error',
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
      });

      throw error;
    }
  }

  private async fetchBatch(afterSlot: number): Promise<RawTransaction[]> {
    const collection = this.mongoManager.getRawTransactionsCollection();
    
    return await collection
      .find({
        slot: { $gt: afterSlot },
        $or: [
          { 'parsedData.meta.logMessages': { $regex: 'Base rewards' } },
          { 'parsedData.meta.logMessages': { $regex: 'Split rewards' } },
          { 'parsedData.meta.logMessages': { $regex: 'Top miner rewards' } },
          { 'parsedData.meta.logMessages': { $regex: 'Refunding' } },
        ],
      })
      .sort({ slot: 1 })
      .limit(config.etl.batchSize)
      .toArray();
  }

  private async processBatch(transactions: RawTransaction[]): Promise<CheckpointActivity[]> {
    const checkpoints: CheckpointActivity[] = [];

    for (const tx of transactions) {
      try {
        const checkpoint = await this.processTransaction(tx);
        if (checkpoint) {
          checkpoints.push(checkpoint);
        }
      } catch (error) {
        logger.error(`Error processing transaction ${tx.signature}`, error);
      }
    }

    return checkpoints;
  }

  // Public for testing
  async processTransaction(tx: RawTransaction): Promise<CheckpointActivity | null> {
    try {
      const logs = tx.parsedData?.meta?.logMessages || [];
      const success = tx.err === null;

      // Parse logs
      const parsedLogs = LogParser.parseAll(logs);
      const checkpointLogs = parsedLogs.filter(l => l.type === 'checkpoint') as CheckpointLog[];
      
      if (checkpointLogs.length === 0) {
        return null;
      }

      // Merge all checkpoint logs
      const merged = LogParser.mergeCheckpointLogs(checkpointLogs);

      // Extract authority from accounts
      const instructions = tx.parsedData?.transaction?.message?.instructions || [];
      let authority = 'unknown';

      for (const ix of instructions) {
        if (ix.data) {
          const accounts = InstructionParser.extractAccounts(ix);
          if (accounts.authority || accounts.signer) {
            authority = accounts.authority || accounts.signer || 'unknown';
            break;
          }
        }
      }

      // Calculate totals
      const totalRewardsSOL = (merged.baseRewardsSOL || 0) + (merged.refundSOL || 0);
      const totalRewardsORE = 
        (merged.splitRewardsORE || 0) + 
        (merged.topMinerRewardsORE || 0) + 
        (merged.motherlodeRewardsORE || 0);

      const activity: CheckpointActivity = {
        signature: tx.signature,
        slot: tx.slot,
        blockTime: tx.blockTime || 0,
        authority,
        roundId: merged.roundId || 0,
        baseRewardsSOL: merged.baseRewardsSOL,
        splitRewardsORE: merged.splitRewardsORE,
        topMinerRewardsORE: merged.topMinerRewardsORE,
        motherlodeRewardsORE: merged.motherlodeRewardsORE,
        refundSOL: merged.refundSOL,
        totalRewardsSOL,
        totalRewardsORE,
        success,
        createdAt: new Date(),
      };

      return activity;
    } catch (error) {
      logger.error(`Error parsing checkpoint transaction ${tx.signature}`, error);
      return null;
    }
  }
}

