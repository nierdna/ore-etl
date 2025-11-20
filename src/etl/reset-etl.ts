import { MongoManager } from '../database/mongo-manager';
import { logger } from '../utils/logger';
import { ResetActivity, RawTransaction } from '../types/schemas';
import { config } from '../config';
import bs58 from 'bs58';

const LAMPORTS_PER_SOL = 1_000_000_000;
const GRAMS_PER_ORE = 100_000_000_000;
const ORE_PROGRAM_ID = 'oreV3EG1i9BEgiAJ8b177Z2S2rMarzak4NMv1kULvWv';
const LOG_INSTRUCTION_DISC = 8;

interface ResetEvent {
  disc: bigint;
  roundId: bigint;
  startSlot: bigint;
  endSlot: bigint;
  winningSquare: bigint;
  topMiner: string;
  numWinners: bigint;
  motherlode: bigint;
  totalDeployed: bigint;
  totalVaulted: bigint;
  totalWinnings: bigint;
  totalMinted: bigint;
  ts: bigint;
}

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

      // PRIORITY 1: Try to extract ResetEvent from innerInstructions
      const event = this.extractEventFromInnerInstructions(tx);

      if (event) {
        // Event-based parsing (accurate and complete)
        logger.debug(`Using Event-based parsing for ${tx.signature}`);

        const activity: ResetActivity = {
          signature: tx.signature,
          slot: tx.slot,
          blockTime: tx.blockTime || 0,
          roundId: Number(event.roundId),
          startSlot: Number(event.startSlot),
          endSlot: Number(event.endSlot),
          winningSquare: Number(event.winningSquare),
          topMiner: event.topMiner,
          numWinners: Number(event.numWinners),
          motherlode: Number(event.motherlode),
          totalDeployed: Number(event.totalDeployed),
          totalVaulted: Number(event.totalVaulted),
          totalWinnings: Number(event.totalWinnings),
          totalMinted: Number(event.totalMinted),
          success,
          createdAt: new Date(),
        };

        return activity;
      }

      // FALLBACK: Legacy log-based parsing (for old transactions)
      logger.debug(`Using legacy parsing for ${tx.signature}`);

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
      if (preTokenBalances.length > 0 && postTokenBalances.length > 0) {
        const preAmount = BigInt(preTokenBalances[0].uiTokenAmount.amount);
        const postAmount = BigInt(postTokenBalances[0].uiTokenAmount.amount);
        const mintedGrams = Number(postAmount - preAmount);
        totalMinted = mintedGrams;
      }

      // Extract treasury SOL balance change
      const preBalances = tx.parsedData.meta.preBalances || [];
      const postBalances = tx.parsedData.meta.postBalances || [];

      let totalVaulted = 0;
      for (let i = 0; i < preBalances.length; i++) {
        const change = postBalances[i] - preBalances[i];
        if (change > 100_000_000) {
          // > 0.1 SOL increase indicates treasury
          totalVaulted = change;
          break;
        }
      }

      // Legacy: Missing data fields
      const topMiner = '11111111111111111111111111111111'; // Default (System Program)
      const startSlot = tx.slot;
      const endSlot = tx.slot;
      const numWinners = 0;
      const motherlode = 0;
      const totalDeployed = 0;
      const totalWinnings = 0;

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
    // Guard: Skip if mongoManager doesn't have the method (stub mode)
    if (!this.mongoManager ||
      typeof this.mongoManager.getRawTransactionsCollection !== 'function') {
      return 0;
    }

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

  /**
   * Extract ResetEvent from innerInstructions
   * Returns null if event not found
   */
  private extractEventFromInnerInstructions(tx: RawTransaction): ResetEvent | null {
    const innerInstructions = tx.parsedData?.meta?.innerInstructions || [];

    for (const inner of innerInstructions) {
      for (const ix of inner.instructions) {
        // Check if this is an Ore Program call
        if (ix.programId?.toString() !== ORE_PROGRAM_ID) {
          continue;
        }

        // Check if instruction has data field (PartiallyDecodedInstruction)
        if (!('data' in ix)) {
          continue;
        }

        const dataBase58 = ix.data as string;
        const buffer = Buffer.from(bs58.decode(dataBase58));

        // Check if this is Log instruction (first byte = 8) and has enough data
        if (buffer.length >= 129 && buffer.readUInt8(0) === LOG_INSTRUCTION_DISC) {
          try {
            return this.decodeResetEvent(buffer, 1);
          } catch (error) {
            logger.warn(`Failed to decode ResetEvent from innerInstruction: ${error}`);
            continue;
          }
        }
      }
    }

    return null;
  }

  /**
   * Decode ResetEvent from buffer
   */
  private decodeResetEvent(buffer: Buffer, startOffset: number): ResetEvent {
    let offset = startOffset;

    const disc = buffer.readBigUInt64LE(offset); offset += 8;
    const roundId = buffer.readBigUInt64LE(offset); offset += 8;
    const startSlot = buffer.readBigUInt64LE(offset); offset += 8;
    const endSlot = buffer.readBigUInt64LE(offset); offset += 8;
    const winningSquare = buffer.readBigUInt64LE(offset); offset += 8;

    const topMinerBytes = buffer.subarray(offset, offset + 32);
    const topMiner = bs58.encode(topMinerBytes); offset += 32;

    const numWinners = buffer.readBigUInt64LE(offset); offset += 8;
    const motherlode = buffer.readBigUInt64LE(offset); offset += 8;
    const totalDeployed = buffer.readBigUInt64LE(offset); offset += 8;
    const totalVaulted = buffer.readBigUInt64LE(offset); offset += 8;
    const totalWinnings = buffer.readBigUInt64LE(offset); offset += 8;
    const totalMinted = buffer.readBigUInt64LE(offset); offset += 8;
    const ts = buffer.readBigInt64LE(offset); offset += 8;

    return {
      disc,
      roundId,
      startSlot,
      endSlot,
      winningSquare,
      topMiner,
      numWinners,
      motherlode,
      totalDeployed,
      totalVaulted,
      totalWinnings,
      totalMinted,
      ts
    };
  }
}

