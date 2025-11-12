import { performance } from 'perf_hooks';
import { MongoManager } from '../database/mongo-manager';
import { parseTransactionsBatch } from './activity-parser';
import { RawTransaction, TransformChunkState } from '../types/schemas';
import { config } from '../config';
import { logger } from '../utils/logger';

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
  private readonly chunkSize: number;
  private readonly batchSize: number;
  private readonly concurrency: number;
  private readonly forceReinitialize: boolean;

  constructor(mongoManager: MongoManager, options: TransactionTransformerOptions = {}) {
    this.mongoManager = mongoManager;
    this.chunkSize = Math.max(1, options.chunkSize ?? config.transformer.chunkSize);
    this.batchSize = Math.max(1, options.batchSize ?? config.transformer.batchSize);
    this.concurrency = Math.max(1, options.concurrency ?? config.transformer.concurrency);
    this.forceReinitialize = options.forceReinitialize ?? false;
  }

  async run(): Promise<void> {
    if (this.forceReinitialize) {
      await this.resetChunks();
    }

    const created = await this.initializeChunks();
    if (created > 0) {
      logger.info(`Transaction transformer initialized ${created} chunks (chunkSize=${this.chunkSize})`);
    }

    // Đếm tổng số chunk để tính %
    const chunksCollection = this.mongoManager.getTransformChunksCollection();
    const totalChunks = await chunksCollection.countDocuments({});
    let processedChunks = await chunksCollection.countDocuments({ status: 'completed' });

    logger.info(`Starting transformer: ${processedChunks}/${totalChunks} chunks completed (${((processedChunks / totalChunks) * 100).toFixed(1)}%)`);

    const errors: string[] = [];

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
            const progressPct = ((processedChunks / totalChunks) * 100).toFixed(1);
            logger.info(
              `Chunk ${chunk.chunkId} completed: ${result.processedTransactions} tx → ${result.processedActivities} activities in ${(
                result.durationMs / 1000
              ).toFixed(2)}s | Progress: ${processedChunks}/${totalChunks} (${progressPct}%)`
            );
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            const errMsg = `Chunk ${chunk.chunkId} failed: ${message}`;
            logger.error(errMsg, error);
            errors.push(errMsg);
          }
        })
      );
    }

    if (errors.length > 0) {
      throw new Error(`Transaction transformer finished with ${errors.length} chunk errors`);
    }

    logger.info('Transaction transformer completed successfully');
  }

  async runSample(limit: number): Promise<ChunkProcessResult> {
    const rawCollection = this.mongoManager.getRawTransactionsCollection();
    const transactions = await rawCollection.find({}, { sort: { slot: 1 }, limit }).toArray();
    const start = performance.now();
    const activities = await parseTransactionsBatch(transactions, { mongoManager: this.mongoManager });
    const durationMs = performance.now() - start;

    logger.info(
      `Sample transform: ${transactions.length} transactions → ${activities.length} activities in ${(durationMs / 1000).toFixed(2)}s`
    );

    return {
      processedTransactions: transactions.length,
      processedActivities: activities.length,
      durationMs,
    };
  }

  private async resetChunks(): Promise<void> {
    const chunksCollection = this.mongoManager.getTransformChunksCollection();
    await chunksCollection.deleteMany({});
  }

  private async initializeChunks(): Promise<number> {
    const chunksCollection = this.mongoManager.getTransformChunksCollection();
    const existing = await chunksCollection.estimatedDocumentCount();

    if (existing > 0) {
      logger.info(`Found ${existing} existing transform chunks, skipping initialization`);
      return 0;
    }

    const rawCollection = this.mongoManager.getRawTransactionsCollection();

    // Lấy min/max slot để chia đều theo range
    const [minDoc, maxDoc] = await Promise.all([
      rawCollection.findOne({}, { sort: { slot: 1 }, projection: { slot: 1 } }),
      rawCollection.findOne({}, { sort: { slot: -1 }, projection: { slot: 1 } }),
    ]);

    if (!minDoc || !maxDoc) {
      logger.warn('No transactions found in raw collection');
      return 0;
    }

    const minSlot = minDoc.slot;
    const maxSlot = maxDoc.slot;
    const totalSlotRange = maxSlot - minSlot + 1;

    // Tính số chunk cần tạo dựa trên chunkSize (số slot mỗi chunk)
    const numChunks = Math.ceil(totalSlotRange / this.chunkSize);
    logger.info(`Creating ${numChunks} chunks for slot range ${minSlot}-${maxSlot} (chunkSize=${this.chunkSize} slots)`);

    let buffer: TransformChunkState[] = [];

    for (let i = 0; i < numChunks; i++) {
      const startSlot = minSlot + i * this.chunkSize;
      const endSlot = Math.min(startSlot + this.chunkSize - 1, maxSlot);
      buffer.push(this.buildChunkDoc(i + 1, startSlot, endSlot));

      if (buffer.length >= INSERT_BATCH_SIZE) {
        await chunksCollection.insertMany(buffer);
        buffer = [];
      }
    }

    if (buffer.length > 0) {
      await chunksCollection.insertMany(buffer);
    }

    return numChunks;
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
      .find({ status: { $in: ['pending', 'error'] } })
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

    logger.info(`[processChunk] Claimed chunk ${initialChunk.chunkId}, claimResult: ${claimResult ? 'success' : 'failed'}`);

    const chunk = claimResult ?? initialChunk;

    if (chunk.status === 'completed') {
      logger.info(`[processChunk] Chunk ${chunk.chunkId} already completed, skipping`);
      return {
        processedTransactions: 0,
        processedActivities: 0,
        durationMs: 0,
      };
    }

    const startedAt = performance.now();
    const CHUNK_LOAD_LIMIT = 100;

    try {
      const rawCollection = this.mongoManager.getRawTransactionsCollection();
      
      let totalProcessedTransactions = 0;
      let totalProcessedActivities = 0;
      let lastProcessedSlot = chunk.startSlot;
      let lastProcessedSignature = '';
      let currentSlot = chunk.startSlot;

      logger.info(`[processChunk] Starting loop for chunk ${chunk.chunkId}, currentSlot=${currentSlot}, endSlot=${chunk.endSlot}`);

      // Loop tuần tự, mỗi lần load tối đa 100 transactions
      while (currentSlot <= chunk.endSlot) {
        logger.info(`[processChunk] Fetching transactions for chunk ${chunk.chunkId}, slot range ${currentSlot}-${chunk.endSlot}, limit=${CHUNK_LOAD_LIMIT}`);
        
        const transactions = await rawCollection
          .find<RawTransaction>({
            slot: {
              $gte: currentSlot,
              $lte: chunk.endSlot,
            },
          })
          .sort({ slot: 1, signature: 1 })
          .limit(CHUNK_LOAD_LIMIT)
          .toArray();

        logger.info(`[processChunk] Fetched ${transactions.length} transactions for chunk ${chunk.chunkId}`);

        if (transactions.length === 0) {
          break;
        }

        // Chia transactions thành các mini-batch
        const batches: RawTransaction[][] = [];
        for (let i = 0; i < transactions.length; i += this.batchSize) {
          batches.push(transactions.slice(i, i + this.batchSize));
        }

        logger.info(
          `Chunk ${chunk.chunkId}: processing ${transactions.length} transactions (slot ${currentSlot}-${transactions[transactions.length - 1].slot}) in ${batches.length} batches (parallel)`
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

        // Nếu load được ít hơn limit, có nghĩa đã hết
        if (transactions.length < CHUNK_LOAD_LIMIT) {
          break;
        }

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


