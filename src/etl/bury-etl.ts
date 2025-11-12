import { MongoManager } from '../database/mongo-manager';
import { logger } from '../utils/logger';
import { LogParser, BuryLog } from '../parsers/log-parser';
import { BuryActivity, RawTransaction } from '../types/schemas';
import { config } from '../config';

const LAMPORTS_PER_SOL = 1_000_000_000;
const GRAMS_PER_ORE = 100_000_000_000;

export class BuryETL {
  constructor(private readonly mongoManager: MongoManager) {}

  async run(): Promise<void> {
    logger.info('Starting Bury ETL...');

    try {
      const state = await this.mongoManager.getETLState('bury');
      const lastSlot = state?.lastProcessedSlot || 0;

      logger.info(`Last processed slot (Bury): ${lastSlot}`);

      await this.mongoManager.updateETLState({
        type: 'bury',
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
          logger.info('No more Bury transactions to process');
          break;
        }

        const activities = await this.processBatch(batch);

        if (activities.length > 0) {
          await this.mongoManager.saveBatch(
            this.mongoManager.getBuryCollection(),
            activities
          );
        }

        processed += activities.length;
        currentSlot = batch[batch.length - 1].slot;

        logger.info(`Processed ${activities.length} Bury txs, total: ${processed}`);

        await this.mongoManager.updateETLState({
          type: 'bury',
          lastProcessedSlot: currentSlot,
          lastProcessedSignature: batch[batch.length - 1].signature,
          totalProcessed: (state?.totalProcessed || 0) + processed,
          lastRunAt: new Date(),
          status: 'running',
        });
      }

      await this.mongoManager.updateETLState({
        type: 'bury',
        lastProcessedSlot: currentSlot,
        lastProcessedSignature: '',
        totalProcessed: (state?.totalProcessed || 0) + processed,
        lastRunAt: new Date(),
        status: 'idle',
      });

      logger.info(`Bury ETL completed. Processed ${processed} new transactions`);
    } catch (error) {
      logger.error('Error in Bury ETL', error);

      const state = await this.mongoManager.getETLState('bury');
      await this.mongoManager.updateETLState({
        type: 'bury',
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
        'parsedData.meta.logMessages': { $regex: 'Swapped.*SOL' },
      })
      .sort({ slot: 1 })
      .limit(config.etl.batchSize)
      .toArray();
  }

  private async processBatch(transactions: RawTransaction[]): Promise<BuryActivity[]> {
    const activities: BuryActivity[] = [];

    for (const tx of transactions) {
      try {
        const activity = await this.processTransaction(tx);
        if (activity) {
          activities.push(activity);
        }
      } catch (error) {
        logger.error(`Error processing Bury transaction ${tx.signature}`, error);
      }
    }

    return activities;
  }

  // Public for testing
  async processTransaction(tx: RawTransaction): Promise<BuryActivity | null> {
    try {
      const logs = tx.parsedData?.meta?.logMessages || [];
      const success = tx.err === null;

      const parsedLogs = LogParser.parseAll(logs);
      const buryLogs = parsedLogs.filter(
        (log): log is BuryLog => log.type === 'bury'
      );

      if (buryLogs.length === 0) {
        return null;
      }

      const merged = LogParser.mergeBuryLogs(buryLogs);

      const solSwappedAmount = merged.solSwapped ?? 0;
      const oreReceivedAmount = merged.oreReceived ?? 0;
      const oreSharedAmount = merged.oreShared ?? 0;
      const oreBurnedAmount = merged.oreBurned ?? 0;

      const activity: BuryActivity = {
        signature: tx.signature,
        slot: tx.slot,
        blockTime: tx.blockTime || 0,
        solSwapped: Math.round(solSwappedAmount * LAMPORTS_PER_SOL),
        solSwappedAmount,
        oreReceived: Math.round(oreReceivedAmount * GRAMS_PER_ORE),
        oreReceivedAmount,
        oreShared: Math.round(oreSharedAmount * GRAMS_PER_ORE),
        oreSharedAmount,
        oreBurned: Math.round(oreBurnedAmount * GRAMS_PER_ORE),
        oreBurnedAmount,
        success,
        createdAt: new Date(),
      };

      return activity;
    } catch (error) {
      logger.error(`Error parsing Bury transaction ${tx.signature}`, error);
      return null;
    }
  }
}

