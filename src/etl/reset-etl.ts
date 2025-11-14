import { MongoManager } from '../database/mongo-manager';
import { logger } from '../utils/logger';
import { ResetActivity, RawTransaction } from '../types/schemas';
import { config } from '../config';
import bs58 from 'bs58';

const LAMPORTS_PER_SOL = 1_000_000_000;
const GRAMS_PER_ORE = 100_000_000_000;

export class ResetETL {
  constructor(private readonly mongoManager: MongoManager) {}

  async run(): Promise<void> {
    logger.info('Starting Reset ETL...');

    try {
      const state = await this.mongoManager.getETLState('reset');
      const lastSlot = state?.lastProcessedSlot || 0;

      logger.info(`Last processed slot (Reset): ${lastSlot}`);

      await this.mongoManager.updateETLState({
        type: 'reset',
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
          logger.info('No more Reset transactions to process');
          break;
        }

        const activities = await this.processBatch(batch);

        if (activities.length > 0) {
          await this.mongoManager.saveBatch(
            this.mongoManager.getResetsCollection(),
            activities
          );
        }

        processed += activities.length;
        currentSlot = batch[batch.length - 1].slot;

        logger.info(`Processed ${activities.length} Reset txs, total: ${processed}`);

        await this.mongoManager.updateETLState({
          type: 'reset',
          lastProcessedSlot: currentSlot,
          lastProcessedSignature: batch[batch.length - 1].signature,
          totalProcessed: (state?.totalProcessed || 0) + processed,
          lastRunAt: new Date(),
          status: 'running',
        });
      }

      await this.mongoManager.updateETLState({
        type: 'reset',
        lastProcessedSlot: currentSlot,
        lastProcessedSignature: '',
        totalProcessed: (state?.totalProcessed || 0) + processed,
        lastRunAt: new Date(),
        status: 'idle',
      });

      logger.info(`Reset ETL completed. Processed ${processed} new transactions`);
    } catch (error) {
      logger.error('Error in Reset ETL', error);

      const state = await this.mongoManager.getETLState('reset');
      await this.mongoManager.updateETLState({
        type: 'reset',
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
        'parsedData.meta.logMessages': { $regex: 'var slothash' },
      })
      .sort({ slot: 1 })
      .limit(config.etl.batchSize)
      .toArray();
  }

  private async processBatch(transactions: RawTransaction[]): Promise<ResetActivity[]> {
    const activities: ResetActivity[] = [];

    for (const tx of transactions) {
      try {
        const activity = await this.processTransaction(tx);
        if (activity) {
          activities.push(activity);
        }
      } catch (error) {
        logger.error(`Error processing Reset transaction ${tx.signature}`, error);
      }
    }

    return activities;
  }

  // Public for testing
  async processTransaction(tx: RawTransaction): Promise<ResetActivity | null> {
    try {
      const logs = tx.parsedData?.meta?.logMessages || [];
      const success = tx.err === null;

      // Verify this is a Reset transaction
      const hasVarSlothash = logs.some((l: string) => l.includes('var slothash'));
      if (!hasVarSlothash) {
        return null;
      }

      // Extract var value for winning square calculation
      const varValueLog = logs.find((l: string) => l.includes('var value:'));
      if (!varValueLog) {
        logger.warn(`No var value log found in Reset transaction ${tx.signature}`);
        return null;
      }

      const varValueMatch = varValueLog.match(/var value: ([A-Za-z0-9]+)/);
      if (!varValueMatch) {
        logger.warn(`Could not parse var value from log in ${tx.signature}`);
        return null;
      }

      const varValue = varValueMatch[1];

      // Calculate RNG and winning square
      const rng = this.calculateRNG(varValue);
      const winningSquare = Number(rng % 25n);

      // Extract roundId from Deploy logs before this Reset
      const roundId = await this.extractRoundId(tx);

      // Extract total minted from token balance changes
      const preTokenBalances = tx.parsedData.meta.preTokenBalances || [];
      const postTokenBalances = tx.parsedData.meta.postTokenBalances || [];

      let totalMinted = 0;
      let totalMintedAmount = 0;
      if (preTokenBalances.length > 0 && postTokenBalances.length > 0) {
        const preAmount = BigInt(preTokenBalances[0].uiTokenAmount.amount);
        const postAmount = BigInt(postTokenBalances[0].uiTokenAmount.amount);
        const mintedGrams = Number(postAmount - preAmount);
        totalMinted = mintedGrams;
        totalMintedAmount = mintedGrams / GRAMS_PER_ORE;
      }

      // Extract treasury SOL balance change
      const preBalances = tx.parsedData.meta.preBalances || [];
      const postBalances = tx.parsedData.meta.postBalances || [];

      let totalVaulted = 0;
      let totalVaultedAmount = 0;
      for (let i = 0; i < preBalances.length; i++) {
        const change = postBalances[i] - preBalances[i];
        if (change > 100_000_000) {
          // > 0.1 SOL increase indicates treasury
          totalVaulted = change;
          totalVaultedAmount = change / LAMPORTS_PER_SOL;
          break;
        }
      }

      // Extract top miner if available (from logs or account keys)
      // For now, use default empty string (would need account state lookup)
      const topMiner = '0'.repeat(64); // Default placeholder

      // Other fields with defaults or approximate values
      const startSlot = tx.slot; // Approximate
      const endSlot = tx.slot; // Approximate
      const numWinners = 0; // Would need Round account state
      const motherlode = 0; // Would need to check if motherlode was triggered
      const totalDeployed = 0; // Would need Round account state
      const totalWinnings = 0; // Would need Round account state

      const activity: ResetActivity = {
        signature: tx.signature,
        slot: tx.slot,
        blockTime: tx.blockTime || 0,
        roundId,
        startSlot,
        endSlot,
        winningSquare,
        topMiner,
        numWinners,
        motherlode,
        totalDeployed,
        totalVaulted: totalVaulted,
        totalWinnings,
        totalMinted: totalMinted,
        success,
        createdAt: new Date(),
      };

      return activity;
    } catch (error) {
      logger.error(`Error parsing Reset transaction ${tx.signature}`, error);
      return null;
    }
  }

  /**
   * Extract roundId from Deploy transactions before this Reset
   * Deploy logs contain "Round #XXXXX: deploying..."
   */
  private async extractRoundId(tx: RawTransaction): Promise<number> {
    try {
      const collection = this.mongoManager.getRawTransactionsCollection();

      // Find Deploy transaction before this Reset (within 1000 slots)
      const deployTx = await collection.findOne(
        {
          slot: { $lt: tx.slot, $gt: tx.slot - 1000 },
          'parsedData.meta.logMessages': { $regex: 'Round #' },
        },
        { sort: { slot: -1 } }
      );

      if (!deployTx) {
        logger.warn(`No Deploy transaction found before Reset at slot ${tx.slot}`);
        return 0;
      }

      const logs = deployTx.parsedData?.meta?.logMessages || [];
      const deployLog = logs.find((l: string) => l.includes('Round #'));

      if (!deployLog) {
        return 0;
      }

      const roundMatch = deployLog.match(/Round #(\d+)/);
      if (!roundMatch) {
        return 0;
      }

      const roundId = parseInt(roundMatch[1]);
      return roundId;
    } catch (error) {
      logger.warn(`Error extracting roundId for transaction ${tx.signature}:`, error);
      return 0;
    }
  }

  /**
   * Calculate RNG from var value (base58 encoded 32-byte hash)
   * Implements the same logic as Round.rng() in Rust
   */
  private calculateRNG(varValueBase58: string): bigint {
    const buf = Buffer.from(bs58.decode(varValueBase58));

    // XOR 4 chunks of 8 bytes each
    const r1 = buf.readBigUInt64LE(0);
    const r2 = buf.readBigUInt64LE(8);
    const r3 = buf.readBigUInt64LE(16);
    const r4 = buf.readBigUInt64LE(24);

    return r1 ^ r2 ^ r3 ^ r4;
  }
}

