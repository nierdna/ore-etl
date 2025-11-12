import { CheckpointETL } from '../../src/etl/checkpoint-etl';
import { MongoManager } from '../../src/database/mongo-manager';
import { CheckpointActivity, RawTransaction } from '../../src/types/schemas';
import samplesData from '../fixtures/sample-events.json';

// Type assertion for JSON data
const samples = samplesData as any;

describe('CheckpointETL - End-to-End', () => {
  let checkpointETL: CheckpointETL;
  let mockMongoManager: any;

  beforeEach(() => {
    mockMongoManager = {
      getRawTransactionsCollection: jest.fn(),
      getCheckpointsCollection: jest.fn(),
      getETLStateCollection: jest.fn(),
      connect: jest.fn(),
      disconnect: jest.fn(),
      saveBatch: jest.fn(),
      getETLState: jest.fn().mockResolvedValue(null),
      updateETLState: jest.fn(),
    } as unknown as MongoManager;

    checkpointETL = new CheckpointETL(mockMongoManager);
  });

  describe('processTransaction - Complete Flow', () => {
    it('should transform raw transaction to complete CheckpointActivity', async () => {
      const rawTx = samples.checkpoints[0];

      const result = await checkpointETL.processTransaction(rawTx);

      expect(result).toBeDefined();
      expect(result).not.toBeNull();

      expect(result).toMatchObject({
        signature: expect.any(String),
        slot: expect.any(Number),
        blockTime: expect.any(Number),
        authority: expect.any(String),
        roundId: expect.any(Number),
        success: expect.any(Boolean),
        createdAt: expect.any(Date),
      });
    });

    it('should extract authority correctly (not "unknown")', async () => {
      const rawTx = samples.checkpoints[0];
      const result = await checkpointETL.processTransaction(rawTx);

      expect(result).toBeDefined();
      expect(result!.authority).not.toBe('unknown');
      expect(result!.authority.length).toBeGreaterThan(32);
    });

    it('should parse reward components from logs', async () => {
      const rawTx = samples.checkpoints[0];
      const result = await checkpointETL.processTransaction(rawTx);

      expect(result).toBeDefined();
      expect(result!.roundId).toBeGreaterThan(0);
      expect(result!.baseRewardsSOL).toBeCloseTo(0.000210803, 9);
      expect(result!.splitRewardsORE).toBeCloseTo(0.0000066273, 12);
      expect(result!.totalRewardsSOL).toBeCloseTo(
        (result!.baseRewardsSOL || 0) + (result!.refundSOL || 0),
        9
      );
      expect(result!.totalRewardsORE).toBeCloseTo(
        (result!.splitRewardsORE || 0) +
          (result!.topMinerRewardsORE || 0) +
          (result!.motherlodeRewardsORE || 0),
        12
      );
    });

    it('should process all checkpoint samples successfully', async () => {
      for (const rawTx of samples.checkpoints) {
        const result = await checkpointETL.processTransaction(rawTx);

        expect(result).toBeDefined();
        expect(result).not.toBeNull();
        expect(result!.roundId).toBeGreaterThan(0);
      }
    });

    it('should return null for transactions without checkpoint logs', async () => {
      const nonCheckpointTx = {
        signature: 'deploy-only',
        slot: 1,
        blockTime: 123456,
        err: null,
        parsedData: {
          meta: {
            logMessages: ['Program log: Round #1: deploying 0.1 SOL to 10 squares'],
          },
          transaction: {
            message: {
              instructions: [],
            },
          },
        },
      };

      const result = await checkpointETL.processTransaction(nonCheckpointTx as RawTransaction);

      expect(result).toBeNull();
    });

    it('should handle transactions with missing data gracefully', async () => {
      const incompleteTx = {
        signature: 'test123',
        slot: 1000,
        blockTime: 1234567890,
        err: null,
        parsedData: {
          meta: {
            logMessages: [],
          },
        },
      };

      const result = await checkpointETL.processTransaction(incompleteTx as RawTransaction);

      expect(result).toBeNull();
    });
  });
});

