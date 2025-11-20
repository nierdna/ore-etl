import { TransactionSource } from './interface';
import { MongoManager } from '../database/mongo-manager';
import { RawTransaction } from '../types/schemas';
import { logger } from '../utils/logger';

export class MongoTransactionSource implements TransactionSource {
  constructor(private mongoManager: MongoManager) {}

  async connect(): Promise<void> {
    // MongoManager usually connects at app startup, but we can ensure it here
    if (!this.mongoManager.isConnectionActive()) {
      await this.mongoManager.connect();
    }
  }

  async disconnect(): Promise<void> {
    // We generally don't want to close the shared MongoManager connection here
    // unless we own it. For now, do nothing or rely on app shutdown.
  }

  async getSlotRange(): Promise<{ min: number; max: number }> {
    const rawCollection = this.mongoManager.getRawTransactionsCollection();

    const [minDoc, maxDoc] = await Promise.all([
      rawCollection.findOne({}, { sort: { slot: 1 }, projection: { slot: 1 } }),
      rawCollection.findOne({}, { sort: { slot: -1 }, projection: { slot: 1 } }),
    ]);

    if (!minDoc || !maxDoc) {
      return { min: 0, max: 0 };
    }

    return {
      min: minDoc.slot,
      max: maxDoc.slot,
    };
  }

  async getTransactions(startSlot: number, endSlot: number): Promise<RawTransaction[]> {
    const rawCollection = this.mongoManager.getRawTransactionsCollection();
    
    // Limit is implicitly handled by the slot range logic in the transformer
    // but for safety we can rely on the caller to set reasonable ranges
    return await rawCollection
      .find<RawTransaction>({
        slot: {
          $gte: startSlot,
          $lte: endSlot,
        },
      })
      .sort({ slot: 1, signature: 1 })
      .toArray();
  }
}

