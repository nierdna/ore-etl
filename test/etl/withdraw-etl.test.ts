import { WithdrawETL } from '../../src/etl/withdraw-etl';
import { MongoManager } from '../../src/database/mongo-manager';
import { WithdrawActivity, RawTransaction } from '../../src/types/schemas';
import samplesData from '../fixtures/sample-events.json';

const samples = samplesData as any;

describe('WithdrawETL - End-to-End', () => {
  let withdrawETL: WithdrawETL;
  let mockMongoManager: any;

  beforeEach(() => {
    mockMongoManager = {
      getRawTransactionsCollection: jest.fn(),
      getWithdrawsCollection: jest.fn(),
      getETLStateCollection: jest.fn(),
      connect: jest.fn(),
      disconnect: jest.fn(),
      saveBatch: jest.fn(),
      getETLState: jest.fn().mockResolvedValue(null),
      updateETLState: jest.fn(),
    } as unknown as MongoManager;

    withdrawETL = new WithdrawETL(mockMongoManager);
  });

  describe('processTransaction - Complete Flow', () => {
    it('should transform raw transaction to complete WithdrawActivity', async () => {
      const rawTx = samples.withdraws[0];

      const result = await withdrawETL.processTransaction(rawTx);

      expect(result).toBeDefined();
      expect(result).not.toBeNull();

      expect(result).toMatchObject({
        signature: expect.any(String),
        slot: expect.any(Number),
        blockTime: expect.any(Number),
        authority: expect.any(String),
        amount: expect.any(Number),
        amountORE: expect.any(Number),
        success: expect.any(Boolean),
        createdAt: expect.any(Date),
      });
    });

    it('should extract authority correctly (not "unknown")', async () => {
      const rawTx = samples.withdraws[0];
      const result = await withdrawETL.processTransaction(rawTx);

      expect(result).toBeDefined();
      expect(result!.authority).not.toBe('unknown');
      expect(result!.authority.length).toBeGreaterThan(32);
    });

    it('should parse amounts from logs', async () => {
      const rawTx = samples.withdraws[0];
      const result = await withdrawETL.processTransaction(rawTx);

      expect(result).toBeDefined();
      expect(result!.amountORE).toBeCloseTo(36.48519026337, 11);
      expect(result!.amount).toBe(Math.round(result!.amountORE * 1e11));
    });

    it('should process all withdraw samples successfully', async () => {
      for (const rawTx of samples.withdraws) {
        const result = await withdrawETL.processTransaction(rawTx);

        expect(result).toBeDefined();
        expect(result).not.toBeNull();
        expect(result!.amountORE).toBeGreaterThan(0);
      }
    });

    it('should return null for transactions without withdraw logs', async () => {
      const nonWithdrawTx = samples.deploys[0];
      const result = await withdrawETL.processTransaction(nonWithdrawTx);

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

      const result = await withdrawETL.processTransaction(incompleteTx as RawTransaction);

      expect(result).toBeNull();
    });
  });
});

