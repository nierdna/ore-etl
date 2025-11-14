import { ResetETL } from '../../src/etl/reset-etl';
import { MongoManager } from '../../src/database/mongo-manager';
import { ResetActivity, RawTransaction } from '../../src/types/schemas';
import samplesData from '../fixtures/sample-events.json';

const samples = samplesData as any;
const LAMPORTS_PER_SOL = 1_000_000_000;
const GRAMS_PER_ORE = 100_000_000_000;

describe('ResetETL - End-to-End', () => {
  let resetETL: ResetETL;
  let mockMongoManager: any;

  beforeEach(() => {
    // Mock collection for roundId extraction
    const mockCollection = {
      findOne: jest.fn().mockResolvedValue({
        parsedData: {
          meta: {
            logMessages: ['Program log: Round #52641: deploying 0.1 SOL to 5 squares'],
          },
        },
      }),
      find: jest.fn(),
    };

    mockMongoManager = {
      getRawTransactionsCollection: jest.fn().mockReturnValue(mockCollection),
      getResetsCollection: jest.fn(),
      getETLStateCollection: jest.fn(),
      connect: jest.fn(),
      disconnect: jest.fn(),
      saveBatch: jest.fn(),
      getETLState: jest.fn().mockResolvedValue(null),
      updateETLState: jest.fn(),
    } as unknown as MongoManager;

    resetETL = new ResetETL(mockMongoManager);
  });

  describe('processTransaction - Complete Flow', () => {
    it('should transform raw Reset transaction to complete ResetActivity', async () => {
      const rawTx = samples.reset[0];

      const result = await resetETL.processTransaction(rawTx);

      expect(result).toBeDefined();
      expect(result).not.toBeNull();

      expect(result).toMatchObject({
        signature: expect.any(String),
        slot: expect.any(Number),
        blockTime: expect.any(Number),
        roundId: expect.any(Number),
        startSlot: expect.any(Number),
        endSlot: expect.any(Number),
        winningSquare: expect.any(Number),
        topMiner: expect.any(String),
        numWinners: expect.any(Number),
        motherlode: expect.any(Number),
        totalDeployed: expect.any(Number),
        totalVaulted: expect.any(Number),
        totalWinnings: expect.any(Number),
        totalMinted: expect.any(Number),
        success: expect.any(Boolean),
        createdAt: expect.any(Date),
      });
    });

    it('should calculate winning square correctly', async () => {
      const rawTx = samples.reset[0];
      const result = await resetETL.processTransaction(rawTx);

      expect(result).toBeDefined();
      expect(result!.winningSquare).toBeGreaterThanOrEqual(0);
      expect(result!.winningSquare).toBeLessThan(25);
      // Should match expected winning square from var value
      expect(result!.winningSquare).toBe(24);
    });

    it('should extract roundId from Deploy logs', async () => {
      const rawTx = samples.reset[0];
      const result = await resetETL.processTransaction(rawTx);

      expect(result).toBeDefined();
      expect(result!.roundId).toBe(52641);
    });

    it('should extract total minted from token balances', async () => {
      const rawTx = samples.reset[0];
      const result = await resetETL.processTransaction(rawTx);

      expect(result).toBeDefined();
      expect(result!.totalMinted).toBeGreaterThan(0);
      // Typical Reset mints 1.2 ORE (1.0 + 0.2 for motherlode)
      expect(result!.totalMinted).toBe(120000000000); // 1.2 ORE in grams
    });

    it('should extract treasury vaulted SOL from balance changes', async () => {
      const rawTx = samples.reset[0];
      const result = await resetETL.processTransaction(rawTx);

      expect(result).toBeDefined();
      expect(result!.totalVaulted).toBeGreaterThan(0);
      // Should be positive SOL amount
      expect(result!.totalVaulted / LAMPORTS_PER_SOL).toBeGreaterThan(0.1);
    });

    it('should handle transactions without var slothash', async () => {
      const nonResetTx = samples.deploys[0];
      const result = await resetETL.processTransaction(nonResetTx);

      expect(result).toBeNull();
    });

    it('should return null for transactions without var value log', async () => {
      const incompleteTx = {
        signature: 'test123',
        slot: 1000,
        blockTime: 1234567890,
        err: null,
        parsedData: {
          meta: {
            logMessages: [
              'Program log: Ore accounts: 14',
              'Program log: var slothash: test',
              // Missing var value log
            ],
          },
        },
      };

      const result = await resetETL.processTransaction(incompleteTx as RawTransaction);

      expect(result).toBeNull();
    });

    it('should handle malformed var value gracefully', async () => {
      const malformedTx = {
        signature: 'test456',
        slot: 1001,
        blockTime: 1234567890,
        err: null,
        parsedData: {
          meta: {
            logMessages: [
              'Program log: var slothash: test',
              'Program log: var value: INVALID_BASE58!!!',
            ],
            preTokenBalances: [],
            postTokenBalances: [],
            preBalances: [],
            postBalances: [],
          },
        },
      };

      const result = await resetETL.processTransaction(malformedTx as RawTransaction);

      expect(result).toBeNull();
    });

    it('should process all reset samples successfully', async () => {
      for (const rawTx of samples.reset) {
        const result = await resetETL.processTransaction(rawTx);

        expect(result).toBeDefined();
        expect(result).not.toBeNull();
        expect(result!.winningSquare).toBeGreaterThanOrEqual(0);
        expect(result!.winningSquare).toBeLessThan(25);
      }
    });

    it('should mark successful transactions correctly', async () => {
      const rawTx = samples.reset[0];
      const result = await resetETL.processTransaction(rawTx);

      expect(result).toBeDefined();
      expect(result!.success).toBe(true);
    });

    it('should mark failed transactions correctly', async () => {
      const failedTx = {
        ...samples.reset[0],
        err: { InstructionError: [0, 'Custom'] },
      };

      const result = await resetETL.processTransaction(failedTx);

      expect(result).toBeDefined();
      expect(result!.success).toBe(false);
    });
  });
});

