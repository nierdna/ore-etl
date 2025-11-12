import { BuryETL } from '../../src/etl/bury-etl';
import { MongoManager } from '../../src/database/mongo-manager';
import { BuryActivity, RawTransaction } from '../../src/types/schemas';
import samplesData from '../fixtures/sample-events.json';

const samples = samplesData as any;
const LAMPORTS_PER_SOL = 1_000_000_000;
const GRAMS_PER_ORE = 100_000_000_000;

describe('BuryETL - End-to-End', () => {
  let buryETL: BuryETL;
  let mockMongoManager: any;

  beforeEach(() => {
    mockMongoManager = {
      getRawTransactionsCollection: jest.fn(),
      getBuryCollection: jest.fn(),
      getETLStateCollection: jest.fn(),
      connect: jest.fn(),
      disconnect: jest.fn(),
      saveBatch: jest.fn(),
      getETLState: jest.fn().mockResolvedValue(null),
      updateETLState: jest.fn(),
    } as unknown as MongoManager;

    buryETL = new BuryETL(mockMongoManager);
  });

  describe('processTransaction - Complete Flow', () => {
    it('should transform raw transaction to complete BuryActivity', async () => {
      const rawTx = samples.bury[0];

      const result = await buryETL.processTransaction(rawTx);

      expect(result).toBeDefined();
      expect(result).not.toBeNull();

      expect(result).toMatchObject({
        signature: expect.any(String),
        slot: expect.any(Number),
        blockTime: expect.any(Number),
        solSwapped: expect.any(Number),
        solSwappedAmount: expect.any(Number),
        oreReceived: expect.any(Number),
        oreReceivedAmount: expect.any(Number),
        oreShared: expect.any(Number),
        oreSharedAmount: expect.any(Number),
        oreBurned: expect.any(Number),
        oreBurnedAmount: expect.any(Number),
        success: expect.any(Boolean),
        createdAt: expect.any(Date),
      });
    });

    it('should parse amounts from logs', async () => {
      const rawTx = samples.bury[0];
      const result = await buryETL.processTransaction(rawTx);

      expect(result).toBeDefined();
      expect(result!.solSwappedAmount).toBeCloseTo(13.568739222, 12);
      expect(result!.solSwapped).toBe(Math.round(13.568739222 * LAMPORTS_PER_SOL));
      expect(result!.oreReceivedAmount).toBeCloseTo(5.19539780134, 12);
      expect(result!.oreReceived).toBe(Math.round(5.19539780134 * GRAMS_PER_ORE));
      expect(result!.oreSharedAmount).toBeCloseTo(0.51953978013, 12);
      expect(result!.oreBurnedAmount).toBeCloseTo(4.67585802121, 12);
    });

    it('should process all bury samples successfully', async () => {
      for (const rawTx of samples.bury) {
        const result = await buryETL.processTransaction(rawTx);

        expect(result).toBeDefined();
        expect(result).not.toBeNull();
        expect(result!.solSwappedAmount).toBeGreaterThan(0);
      }
    });

    it('should return null for transactions without bury logs', async () => {
      const nonBuryTx = samples.deploys[0];
      const result = await buryETL.processTransaction(nonBuryTx);

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

      const result = await buryETL.processTransaction(incompleteTx as RawTransaction);

      expect(result).toBeNull();
    });
  });
});

