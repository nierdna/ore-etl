import { ClaimOREETL } from '../../src/etl/claim-ore-etl';
import { MongoManager } from '../../src/database/mongo-manager';
import { ClaimOREActivity, RawTransaction } from '../../src/types/schemas';
import samplesData from '../fixtures/sample-events.json';

const samples = samplesData as any;

describe('ClaimOREETL - End-to-End', () => {
  let claimOreETL: ClaimOREETL;
  let mockMongoManager: any;

  beforeEach(() => {
    mockMongoManager = {
      getRawTransactionsCollection: jest.fn(),
      getClaimORECollection: jest.fn(),
      getETLStateCollection: jest.fn(),
      connect: jest.fn(),
      disconnect: jest.fn(),
      saveBatch: jest.fn(),
      getETLState: jest.fn().mockResolvedValue(null),
      updateETLState: jest.fn(),
    } as unknown as MongoManager;

    claimOreETL = new ClaimOREETL(mockMongoManager);
  });

  describe('processTransaction - Complete Flow', () => {
    it('should transform raw transaction to complete ClaimOREActivity', async () => {
      const rawTx = samples.claims_ore[0];

      const result = await claimOreETL.processTransaction(rawTx);

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
      const rawTx = samples.claims_ore[0];
      const result = await claimOreETL.processTransaction(rawTx);

      expect(result).toBeDefined();
      expect(result!.authority).not.toBe('unknown');
      expect(result!.authority.length).toBeGreaterThan(32);
    });

    it('should parse amounts from logs', async () => {
      const rawTx = samples.claims_ore[0];
      const result = await claimOreETL.processTransaction(rawTx);

      expect(result).toBeDefined();
      expect(result!.amountORE).toBeCloseTo(0.05545121976, 12);
      expect(result!.amount).toBe(Math.round(result!.amountORE * 1e11));
    });

    it('should process all claim ORE samples successfully', async () => {
      for (const rawTx of samples.claims_ore) {
        const result = await claimOreETL.processTransaction(rawTx);

        expect(result).toBeDefined();
        expect(result).not.toBeNull();
        expect(result!.amountORE).toBeGreaterThan(0);
      }
    });

    it('should return null for transactions without claim ORE logs', async () => {
      const nonClaimTx = samples.deploys[0];
      const result = await claimOreETL.processTransaction(nonClaimTx);

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

      const result = await claimOreETL.processTransaction(incompleteTx as RawTransaction);

      expect(result).toBeNull();
    });
  });
});

