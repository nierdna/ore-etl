import { performance } from 'perf_hooks';
import { MongoManager } from '../database/mongo-manager';
import { parseTransactionsBatch } from './activity-parser';
import { RawTransaction, TransformChunkState } from '../types/schemas';
import { config } from '../config';
import { logger } from '../utils/logger';
import { TransactionSource } from '../datasource/interface';

export interface TransactionTransformerOptions {
  chunkSize?: number;
  batchSize?: number;
  concurrency?: number;
  forceReinitialize?: boolean;
}

type ChunkProcessResult = {
  processedTransactions: number;
  processedActivities: number;
  durationMs: number;
};

const INSERT_BATCH_SIZE = 500;

export class TransactionTransformer {
  private readonly mongoManager: MongoManager;
  private readonly transactionSource: TransactionSource;
  private readonly chunkSize: number;
  private readonly batchSize: number;
  private readonly concurrency: number;
  private readonly forceReinitialize: boolean;

  constructor(
    mongoManager: MongoManager, 
    transactionSource: TransactionSource, 
    options: TransactionTransformerOptions = {}
  ) {
    this.mongoManager = mongoManager;
    this.transactionSource = transactionSource;
    this.chunkSize = Math.max(1, options.chunkSize ?? config.transformer.chunkSize);
    this.batchSize = Math.max(1, options.batchSize ?? config.transformer.batchSize);
    this.concurrency = Math.max(1, options.concurrency ?? config.transformer.concurrency);
    this.forceReinitialize = options.forceReinitialize ?? false;
  }

  async run(): Promise<void> {
    if (this.forceReinitialize) {
      await this.resetChunks();
    }

    // Connect source
    await this.transactionSource.connect();

    try {
      const created = await this.initializeChunks();
      if (created > 0) {
        logger.info(`Transaction transformer initialized ${created} chunks (chunkSize=${this.chunkSize})`);
      }

      while (true) {
        const chunksCollection = this.mongoManager.getTransformChunksCollection();
        const totalChunks = await chunksCollection.countDocuments({});
        let processedChunks = await chunksCollection.countDocuments({ status: 'completed' });

        logger.info(`Starting transformer cycle: ${processedChunks}/${totalChunks} chunks completed (${((processedChunks / totalChunks) * 100).toFixed(1)}%)`);

        // Process all pending chunks
        await this.processPendingChunks();

        // Check if we need to continue running (Continuous Mode)
        if (config.etl.continuousMode) {
          logger.info('[run] Continuous mode enabled. Polling for new data...');
          
          // Try to find new data and create chunks
          const newChunksCreated = await this.checkForNewSlots();
          
          if (newChunksCreated === 0) {
            // Sleep before next poll if no new data
            logger.info('[run] No new data found. Sleeping for 5s...');
            await new Promise(resolve => setTimeout(resolve, 5000));
          }
        } else {
          // If not continuous, and we finished all chunks, we are done
          const remaining = await chunksCollection.countDocuments({ status: { $ne: 'completed' } });
          if (remaining === 0) {
            break;
          }
        }
      }

      logger.info('Transaction transformer completed successfully');
    } finally {
      await this.transactionSource.disconnect();
    }
  }

  private async processPendingChunks(): Promise<void> {
    const chunksCollection = this.mongoManager.getTransformChunksCollection();
    let totalChunks = await chunksCollection.countDocuments({});
    let processedChunks = await chunksCollection.countDocuments({ status: 'completed' });

    while (true) {
      const nextChunks = await this.getNextChunks(this.concurrency);
      if (nextChunks.length === 0) {
        break;
      }

      logger.info(`[run] Processing ${nextChunks.length} chunks in parallel: ${nextChunks.map(c => c.chunkId).join(', ')}`);

      await Promise.all(
        nextChunks.map(async chunk => {
          try {
            logger.info(`[run] Starting processChunk for ${chunk.chunkId}`);
            const result = await this.processChunk(chunk);
            processedChunks++;
            
            // Update total just in case continuous mode added more while running
            totalChunks = await chunksCollection.countDocuments({});
            const progressPct = totalChunks > 0 ? ((processedChunks / totalChunks) * 100).toFixed(1) : '0.0';
            
            logger.info(
              `Chunk ${chunk.chunkId} completed: ${result.processedTransactions} tx → ${result.processedActivities} activities in ${(
                result.durationMs / 1000
              ).toFixed(2)}s | Progress: ${processedChunks}/${totalChunks} (${progressPct}%)`
            );
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            const errMsg = `Chunk ${chunk.chunkId} failed: ${message}`;
            logger.error(errMsg, error);
          }
        })
      );
    }
  }

  private async checkForNewSlots(): Promise<number> {
    const chunksCollection = this.mongoManager.getTransformChunksCollection();
    
    // Get the highest endSlot currently covered by chunks
    const lastChunk = await chunksCollection.findOne({}, { sort: { endSlot: -1 } });
    const currentMaxCoveredSlot = lastChunk ? lastChunk.endSlot : 0;

    // Get the max slot available in source
    const { max: sourceMaxSlot } = await this.transactionSource.getSlotRange();

    if (sourceMaxSlot > currentMaxCoveredSlot) {
      logger.info(`[checkForNewSlots] Found new slots: ${currentMaxCoveredSlot + 1} -> ${sourceMaxSlot}`);
      return await this.createChunksForRange(currentMaxCoveredSlot + 1, sourceMaxSlot);
    }

    return 0;
  }

  async runSample(limit: number): Promise<ChunkProcessResult> {
    await this.transactionSource.connect();
    try {
      // For sample, we just grab transactions from the start
      const { min } = await this.transactionSource.getSlotRange();
      // This is an approximation as we don't know exactly which slots have data
      // We'll try to get a range that covers enough transactions
      // Assuming roughly 1-2 tx per slot on average for Ore?
      const transactions = await this.transactionSource.getTransactions(min, min + limit * 2); 
      const limitedTxs = transactions.slice(0, limit);

      const start = performance.now();
      const activities = await parseTransactionsBatch(limitedTxs, { mongoManager: this.mongoManager });
      const durationMs = performance.now() - start;

      logger.info(
        `Sample transform: ${limitedTxs.length} transactions → ${activities.length} activities in ${(durationMs / 1000).toFixed(2)}s`
      );

      return {
        processedTransactions: limitedTxs.length,
        processedActivities: activities.length,
        durationMs,
      };
    } finally {
      await this.transactionSource.disconnect();
    }
  }

  private async resetChunks(): Promise<void> {
    const chunksCollection = this.mongoManager.getTransformChunksCollection();
    await chunksCollection.deleteMany({});
  }

  private async initializeChunks(): Promise<number> {
    const chunksCollection = this.mongoManager.getTransformChunksCollection();
    const existing = await chunksCollection.estimatedDocumentCount();

    if (existing > 0) {
      logger.info(`Found ${existing} existing transform chunks, checking if expansion is needed`);
      return await this.checkForNewSlots();
    }

    // Initial load
    const { min, max } = await this.transactionSource.getSlotRange();
    
    if (min === 0 && max === 0) {
      logger.warn('No transactions found in source');
      return 0;
    }

    return await this.createChunksForRange(min, max);
  }

  private async createChunksForRange(startSlot: number, endSlot: number): Promise<number> {
    const chunksCollection = this.mongoManager.getTransformChunksCollection();
    const totalSlotRange = endSlot - startSlot + 1;
    const numChunks = Math.ceil(totalSlotRange / this.chunkSize);
    
    logger.info(`Creating ${numChunks} chunks for slot range ${startSlot}-${endSlot} (chunkSize=${this.chunkSize} slots)`);

    // Get the highest chunk index currently used to continue numbering
    const lastChunk = await chunksCollection.findOne({}, { sort: { chunkId: -1 } });
    let lastChunkIndex = 0;
    if (lastChunk) {
        const match = lastChunk.chunkId.match(/chunk-(\d+)/);
        if (match) {
            lastChunkIndex = parseInt(match[1], 10);
        }
    }

    let buffer: TransformChunkState[] = [];
    let createdCount = 0;

    for (let i = 0; i < numChunks; i++) {
      const chunkStart = startSlot + i * this.chunkSize;
      const chunkEnd = Math.min(chunkStart + this.chunkSize - 1, endSlot);
      const chunkIndex = lastChunkIndex + i + 1;
      
      buffer.push(this.buildChunkDoc(chunkIndex, chunkStart, chunkEnd));
      createdCount++;

      if (buffer.length >= INSERT_BATCH_SIZE) {
        await chunksCollection.insertMany(buffer);
        buffer = [];
      }
    }

    if (buffer.length > 0) {
      await chunksCollection.insertMany(buffer);
    }

    return createdCount;
  }

  private buildChunkDoc(index: number, startSlot: number, endSlot: number): TransformChunkState {
    return {
      chunkId: `chunk-${index.toString().padStart(6, '0')}`,
      startSlot,
      endSlot,
      status: 'pending',
      updatedAt: new Date(),
    };
  }

  private async getNextChunks(limit: number): Promise<TransformChunkState[]> {
    const chunksCollection = this.mongoManager.getTransformChunksCollection();
    return await chunksCollection
      .find({ status: { $in: ['pending', 'error', 'running'] } })
      .sort({ startSlot: 1 })
      .limit(limit)
      .toArray();
  }

  private async processChunk(initialChunk: TransformChunkState): Promise<ChunkProcessResult> {
    const chunksCollection = this.mongoManager.getTransformChunksCollection();
    const now = new Date();

    logger.info(`[processChunk] Starting chunk ${initialChunk.chunkId} (slot ${initialChunk.startSlot}-${initialChunk.endSlot})`);

    // Claim chunk để xử lý
    const claimResult = await chunksCollection.findOneAndUpdate(
      { chunkId: initialChunk.chunkId, status: { $in: ['pending', 'error'] } },
      {
        $set: {
          status: 'running',
          updatedAt: now,
        },
        $unset: { errorMessage: '' },
      },
      { returnDocument: 'after' }
    );

    // logger.info(`[processChunk] Claimed chunk ${initialChunk.chunkId}, claimResult: ${claimResult ? 'success' : 'failed'}`);

    const chunk = claimResult ?? initialChunk;

    if (chunk.status === 'completed') {
      logger.info(`[processChunk] Chunk ${chunk.chunkId} already completed, skipping`);
      return {
        processedTransactions: 0,
        processedActivities: 0,
        durationMs: 0,
      };
    }

    // Kiểm tra nếu chunk đã xử lý xong hết slot range
    if (chunk.lastProcessedSlot && chunk.lastProcessedSlot >= chunk.endSlot) {
      logger.info(`[processChunk] Chunk ${chunk.chunkId} already processed all slots, marking as completed`);
      await chunksCollection.updateOne(
        { chunkId: chunk.chunkId },
        {
          $set: {
            status: 'completed',
            updatedAt: new Date(),
          },
        }
      );
      return {
        processedTransactions: 0,
        processedActivities: 0,
        durationMs: 0,
      };
    }

    const startedAt = performance.now();
    const CHUNK_LOAD_LIMIT = 500; // Increased limit as Postgres source handles batching better

    try {
      let totalProcessedTransactions = 0;
      let totalProcessedActivities = 0;
      let lastProcessedSlot = chunk.lastProcessedSlot ?? chunk.startSlot - 1;
      let lastProcessedSignature = chunk.lastProcessedSignature ?? '';

      // Resume từ lastProcessedSlot nếu chunk đã chạy một phần
      let currentSlot = chunk.lastProcessedSlot
        ? chunk.lastProcessedSlot + 1  // Tiếp tục từ slot kế tiếp
        : chunk.startSlot;              // Bắt đầu từ đầu

      if (chunk.lastProcessedSlot) {
        logger.info(`[processChunk] Resuming chunk ${chunk.chunkId} from slot ${currentSlot} (was at ${chunk.lastProcessedSlot})`);
      }

      // Loop tuần tự
      while (currentSlot <= chunk.endSlot) {
        // Determine next batch range
        // Instead of fetching 1 slot at a time, we try to fetch a range that might contain CHUNK_LOAD_LIMIT transactions
        // But since we don't know density, we'll just fetch the rest of the chunk or a safe upper bound
        const fetchEndSlot = Math.min(currentSlot + 1000, chunk.endSlot); // Fetch up to 1000 slots ahead or end of chunk
        
        logger.info(`[processChunk] Fetching transactions for chunk ${chunk.chunkId}, slot range ${currentSlot}-${fetchEndSlot}`);
        
        // Note: getTransactions logic in source should ideally support LIMIT if possible, but our interface is range-based
        // For efficient Postgres querying, the source implementation handles the range query efficiently.
        // We rely on the source to return ALL transactions in this range. 
        // If the range is too huge, we might need to adjust step size.
        const transactions = await this.transactionSource.getTransactions(currentSlot, fetchEndSlot);

        logger.info(`[processChunk] Fetched ${transactions.length} transactions for chunk ${chunk.chunkId}`);

        if (transactions.length > 0) {
            // Chia transactions thành các mini-batch để xử lý parse
            const batches: RawTransaction[][] = [];
            for (let i = 0; i < transactions.length; i += this.batchSize) {
              batches.push(transactions.slice(i, i + this.batchSize));
            }
    
            logger.info(
              `Chunk ${chunk.chunkId}: processing ${transactions.length} transactions in ${batches.length} batches (parallel)`
            );
    
            // Parse SONG SONG tất cả các batch trong sub-chunk này
            const results = await Promise.all(
              batches.map(batch => parseTransactionsBatch(batch, { mongoManager: this.mongoManager }))
            );
    
            const subChunkActivities = results.reduce((sum, activities) => sum + activities.length, 0);
            totalProcessedTransactions += transactions.length;
            totalProcessedActivities += subChunkActivities;
    
            const lastTx = transactions[transactions.length - 1];
            lastProcessedSlot = lastTx.slot;
            lastProcessedSignature = lastTx.signature;
        } else {
            // No transactions in this range, just fast forward
            lastProcessedSlot = fetchEndSlot;
        }

        // Cập nhật progress trong chunk
        await chunksCollection.updateOne(
          { chunkId: chunk.chunkId },
          {
            $set: {
              lastProcessedSlot,
              lastProcessedSignature,
              updatedAt: new Date(),
            },
          }
        );

        // Tiếp tục từ slot kế tiếp
        currentSlot = lastProcessedSlot + 1;
      }

      const durationMs = performance.now() - startedAt;

      // Đánh dấu chunk hoàn thành
      await chunksCollection.updateOne(
        { chunkId: chunk.chunkId },
        {
          $set: {
            status: 'completed',
            updatedAt: new Date(),
            lastProcessedSlot: chunk.endSlot,
            lastProcessedSignature,
          },
          $unset: { errorMessage: '' },
        }
      );

      return {
        processedTransactions: totalProcessedTransactions,
        processedActivities: totalProcessedActivities,
        durationMs,
      };
    } catch (error) {
      await chunksCollection.updateOne(
        { chunkId: chunk.chunkId },
        {
          $set: {
            status: 'error',
            updatedAt: new Date(),
            errorMessage: error instanceof Error ? error.message : 'Unknown error',
          },
        }
      );

      throw error;
    }
  }
}
