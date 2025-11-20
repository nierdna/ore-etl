import { MongoClient, Db, Collection } from 'mongodb';
import { config } from '../config';
import { logger } from '../utils/logger';
import {
  RawTransaction,
  DeployActivity,
  CheckpointActivity,
  ClaimSOLActivity,
  ClaimOREActivity,
  DepositActivity,
  WithdrawActivity,
  ClaimYieldActivity,
  BuryActivity,
  ResetActivity,
  ETLState,
  TransformChunkState,
  COLLECTIONS,
} from '../types/schemas';

export class MongoManager {
  private client: MongoClient;
  private sourceDb: Db | null = null;
  private targetDb: Db | null = null;
  private isConnected: boolean = false;

  constructor() {
    this.client = new MongoClient(config.mongodb.uri);
  }

  async connect(): Promise<void> {
    try {
      await this.client.connect();
      this.sourceDb = this.client.db(config.mongodb.sourceDatabase);
      this.targetDb = this.client.db(config.mongodb.targetDatabase);
      this.isConnected = true;
      
      logger.info(`Connected to MongoDB`);
      logger.info(`Source DB: ${config.mongodb.sourceDatabase}`);
      logger.info(`Target DB: ${config.mongodb.targetDatabase}`);
      
      await this.createIndexes();
    } catch (error) {
      logger.error('Failed to connect to MongoDB', error);
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    if (this.isConnected) {
      await this.client.close();
      this.isConnected = false;
      logger.info('Disconnected from MongoDB');
    }
  }

  public isConnectionActive(): boolean {
    return this.isConnected;
  }

  private async createIndexes(): Promise<void> {
    if (!this.targetDb) throw new Error('Target database not connected');

    try {
      // Deploys indexes
      const deploysCol = this.targetDb.collection<DeployActivity>(COLLECTIONS.DEPLOYS);
      await deploysCol.createIndex({ signature: 1 }, { unique: true });
      await deploysCol.createIndex({ slot: -1 });
      await deploysCol.createIndex({ authority: 1, slot: -1 });
      await deploysCol.createIndex({ roundId: 1 });
      await deploysCol.createIndex({ blockTime: -1 });

      // Checkpoints indexes
      const checkpointsCol = this.targetDb.collection<CheckpointActivity>(COLLECTIONS.CHECKPOINTS);
      await checkpointsCol.createIndex({ signature: 1 }, { unique: true });
      await checkpointsCol.createIndex({ slot: -1 });
      await checkpointsCol.createIndex({ authority: 1, slot: -1 });
      await checkpointsCol.createIndex({ roundId: 1 });

      // Claims indexes
      const claimSOLCol = this.targetDb.collection<ClaimSOLActivity>(COLLECTIONS.CLAIM_SOL);
      await claimSOLCol.createIndex({ signature: 1 }, { unique: true });
      await claimSOLCol.createIndex({ authority: 1, slot: -1 });

      const claimORECol = this.targetDb.collection<ClaimOREActivity>(COLLECTIONS.CLAIM_ORE);
      await claimORECol.createIndex({ signature: 1 }, { unique: true });
      await claimORECol.createIndex({ authority: 1, slot: -1 });

      // Staking indexes
      const depositsCol = this.targetDb.collection<DepositActivity>(COLLECTIONS.DEPOSITS);
      await depositsCol.createIndex({ signature: 1 }, { unique: true });
      await depositsCol.createIndex({ authority: 1, slot: -1 });

      const withdrawsCol = this.targetDb.collection<WithdrawActivity>(COLLECTIONS.WITHDRAWS);
      await withdrawsCol.createIndex({ signature: 1 }, { unique: true });
      await withdrawsCol.createIndex({ authority: 1, slot: -1 });

      const claimYieldsCol = this.targetDb.collection<ClaimYieldActivity>(COLLECTIONS.CLAIM_YIELDS);
      await claimYieldsCol.createIndex({ signature: 1 }, { unique: true });
      await claimYieldsCol.createIndex({ authority: 1, slot: -1 });

      // Bury indexes
      const buryCol = this.targetDb.collection<BuryActivity>(COLLECTIONS.BURY);
      await buryCol.createIndex({ signature: 1 }, { unique: true });
      await buryCol.createIndex({ slot: -1 });

      // Resets indexes
      const resetsCol = this.targetDb.collection<ResetActivity>(COLLECTIONS.RESETS);
      await resetsCol.createIndex({ signature: 1 }, { unique: true });
      await resetsCol.createIndex({ roundId: 1 }, { unique: true });
      await resetsCol.createIndex({ slot: -1 });

      // ETL state indexes
      const etlStateCol = this.targetDb.collection<ETLState>(COLLECTIONS.ETL_STATE);
      await etlStateCol.createIndex({ type: 1 }, { unique: true });

      // Transform chunk state indexes
      const transformChunksCol = this.targetDb.collection<TransformChunkState>(COLLECTIONS.TRANSFORM_CHUNKS);
      await transformChunksCol.createIndex({ chunkId: 1 }, { unique: true });
      await transformChunksCol.createIndex({ status: 1 });

      logger.info('Created indexes for all collections');
    } catch (error) {
      logger.error('Error creating indexes', error);
      throw error;
    }
  }

  // ========== Source Collections ==========
  
  getRawTransactionsCollection(): Collection<RawTransaction> {
    if (!this.sourceDb) throw new Error('Source database not connected');
    return this.sourceDb.collection<RawTransaction>(COLLECTIONS.RAW_TRANSACTIONS);
  }

  // ========== Target Collections ==========

  getDeploysCollection(): Collection<DeployActivity> {
    if (!this.targetDb) throw new Error('Target database not connected');
    return this.targetDb.collection<DeployActivity>(COLLECTIONS.DEPLOYS);
  }

  getCheckpointsCollection(): Collection<CheckpointActivity> {
    if (!this.targetDb) throw new Error('Target database not connected');
    return this.targetDb.collection<CheckpointActivity>(COLLECTIONS.CHECKPOINTS);
  }

  getClaimSOLCollection(): Collection<ClaimSOLActivity> {
    if (!this.targetDb) throw new Error('Target database not connected');
    return this.targetDb.collection<ClaimSOLActivity>(COLLECTIONS.CLAIM_SOL);
  }

  getClaimORECollection(): Collection<ClaimOREActivity> {
    if (!this.targetDb) throw new Error('Target database not connected');
    return this.targetDb.collection<ClaimOREActivity>(COLLECTIONS.CLAIM_ORE);
  }

  getDepositsCollection(): Collection<DepositActivity> {
    if (!this.targetDb) throw new Error('Target database not connected');
    return this.targetDb.collection<DepositActivity>(COLLECTIONS.DEPOSITS);
  }

  getWithdrawsCollection(): Collection<WithdrawActivity> {
    if (!this.targetDb) throw new Error('Target database not connected');
    return this.targetDb.collection<WithdrawActivity>(COLLECTIONS.WITHDRAWS);
  }

  getClaimYieldsCollection(): Collection<ClaimYieldActivity> {
    if (!this.targetDb) throw new Error('Target database not connected');
    return this.targetDb.collection<ClaimYieldActivity>(COLLECTIONS.CLAIM_YIELDS);
  }

  getBuryCollection(): Collection<BuryActivity> {
    if (!this.targetDb) throw new Error('Target database not connected');
    return this.targetDb.collection<BuryActivity>(COLLECTIONS.BURY);
  }

  getResetsCollection(): Collection<ResetActivity> {
    if (!this.targetDb) throw new Error('Target database not connected');
    return this.targetDb.collection<ResetActivity>(COLLECTIONS.RESETS);
  }

  getETLStateCollection(): Collection<ETLState> {
    if (!this.targetDb) throw new Error('Target database not connected');
    return this.targetDb.collection<ETLState>(COLLECTIONS.ETL_STATE);
  }

  getTransformChunksCollection(): Collection<TransformChunkState> {
    if (!this.targetDb) throw new Error('Target database not connected');
    return this.targetDb.collection<TransformChunkState>(COLLECTIONS.TRANSFORM_CHUNKS);
  }

  // ========== ETL State Management ==========

  async getETLState(type: string): Promise<ETLState | null> {
    const collection = this.getETLStateCollection();
    return await collection.findOne({ type });
  }

  async updateETLState(state: ETLState): Promise<void> {
    const collection = this.getETLStateCollection();
    await collection.updateOne(
      { type: state.type },
      { $set: { ...state, lastRunAt: new Date() } },
      { upsert: true }
    );
  }

  // ========== Batch Operations ==========

  async saveBatch<T extends { signature: string }>(
    collection: Collection<T>, 
    items: T[]
  ): Promise<void> {
    if (items.length === 0) return;

    const bulkOps = items.map(item => ({
      updateOne: {
        filter: { signature: item.signature } as any,
        update: { $set: item } as any,
        upsert: true,
      },
    }));

    await collection.bulkWrite(bulkOps as any, { ordered: false });
  }
}

