import { ClaimSOLETL } from '../../src/etl/claim-sol-etl';
import { MongoManager } from '../../src/database/mongo-manager';
import { ClaimSOLActivity, RawTransaction } from '../../src/types/schemas';
import samplesData from '../fixtures/sample-events.json';

const samples = samplesData as any;

describe('ClaimSOLETL - End-to-End', () => {
  let claimSolETL: ClaimSOLETL;
  let mockMongoManager: any;

  beforeEach(() => {
    mockMongoManager = {
      getRawTransactionsCollection: jest.fn(),
      getClaimSOLCollection: jest.fn(),
      getETLStateCollection: jest.fn(),
      connect: jest.fn(),
      disconnect: jest.fn(),
      saveBatch: jest.fn(),
      getETLState: jest.fn().mockResolvedValue(null),
      updateETLState: jest.fn(),
    } as unknown as MongoManager;

    claimSolETL = new ClaimSOLETL(mockMongoManager);
  });

  describe('processTransaction - Complete Flow', () => {
    it('should transform raw transaction to complete ClaimSOLActivity', async () => {
      const rawTx = samples.claims_sol[0];

      const result = await claimSolETL.processTransaction(rawTx);

      expect(result).toBeDefined();
      expect(result).not.toBeNull();

      expect(result).toMatchObject({
        signature: expect.any(String),
        slot: expect.any(Number),
        blockTime: expect.any(Number),
        authority: expect.any(String),
        amount: expect.any(Number),
        amountSOL: expect.any(Number),
        success: expect.any(Boolean),
        createdAt: expect.any(Date),
      });
    });

    it('should extract authority correctly (not "unknown")', async () => {
      const rawTx = samples.claims_sol[0];
      const result = await claimSolETL.processTransaction(rawTx);

      expect(result).toBeDefined();
      expect(result!.authority).not.toBe('unknown');
      expect(result!.authority.length).toBeGreaterThan(32);
    });

    it('should parse amounts from logs', async () => {
      const rawTx = samples.claims_sol[0];
      const result = await claimSolETL.processTransaction(rawTx);

      expect(result).toBeDefined();
      expect(result!.amountSOL).toBeCloseTo(0.210803314, 12);
      expect(result!.amount).toBe(Math.round(result!.amountSOL * 1e9));
    });

    it('should process all claim SOL samples successfully', async () => {
      for (const rawTx of samples.claims_sol) {
        const result = await claimSolETL.processTransaction(rawTx);

        expect(result).toBeDefined();
        expect(result).not.toBeNull();
        expect(result!.amountSOL).toBeGreaterThan(0);
      }
    });

    it('should return null for transactions without claim SOL logs', async () => {
      const nonClaimTx = samples.deploys[0];
      const result = await claimSolETL.processTransaction(nonClaimTx);

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

      const result = await claimSolETL.processTransaction(incompleteTx as RawTransaction);

      expect(result).toBeNull();
    });
  });
});

