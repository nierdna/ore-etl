import { ClaimYieldETL } from '../../src/etl/claim-yield-etl';
import { MongoManager } from '../../src/database/mongo-manager';
import { ClaimYieldActivity, RawTransaction } from '../../src/types/schemas';

const GRAMS_PER_ORE = 100_000_000_000;

function buildClaimYieldTransaction(amountORE: number): RawTransaction {
  return {
    _id: undefined as any,
    signature: 'yieldTxSignature',
    slot: 123456789,
    blockTime: 1700000000,
    err: null,
    parsedData: {
      meta: {
        logMessages: [`Program log: Claiming ${amountORE} ORE`],
      },
      transaction: {
        message: {
          instructions: [
            {
              data: 'D',
              accounts: [
                'Signer1111111111111111111111111111111111',
                'Mint111111111111111111111111111111111111',
                'Recipient1111111111111111111111111111111',
                'Stake11111111111111111111111111111111111',
                'Treasury1111111111111111111111111111111',
                'TreasuryTok11111111111111111111111111111',
                'Sys111111111111111111111111111111111111',
                'Token1111111111111111111111111111111111',
                'Assoc1111111111111111111111111111111111',
              ],
            },
          ],
          accountKeys: [
            { pubkey: 'Signer1111111111111111111111111111111111' },
          ],
        },
      },
    },
    createdAt: new Date(),
  } as unknown as RawTransaction;
}

describe('ClaimYieldETL - End-to-End', () => {
  let claimYieldETL: ClaimYieldETL;
  let mockMongoManager: any;

  beforeEach(() => {
    mockMongoManager = {
      getRawTransactionsCollection: jest.fn(),
      getClaimYieldsCollection: jest.fn(),
      getETLStateCollection: jest.fn(),
      connect: jest.fn(),
      disconnect: jest.fn(),
      saveBatch: jest.fn(),
      getETLState: jest.fn().mockResolvedValue(null),
      updateETLState: jest.fn(),
    } as unknown as MongoManager;

    claimYieldETL = new ClaimYieldETL(mockMongoManager);
  });

  describe('processTransaction - Complete Flow', () => {
    it('should transform synthetic transaction to ClaimYieldActivity', async () => {
      const rawTx = buildClaimYieldTransaction(0.12345678901);

      const result = await claimYieldETL.processTransaction(rawTx);

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
      const rawTx = buildClaimYieldTransaction(0.5);
      const result = await claimYieldETL.processTransaction(rawTx);

      expect(result).toBeDefined();
      expect(result!.authority).toBe('Signer1111111111111111111111111111111111');
    });

    it('should parse amounts from logs', async () => {
      const amountORE = 0.00001234567;
      const rawTx = buildClaimYieldTransaction(amountORE);
      const result = await claimYieldETL.processTransaction(rawTx);

      expect(result).toBeDefined();
      expect(result!.amountORE).toBeCloseTo(amountORE, 12);
      expect(result!.amount).toBe(Math.round(amountORE * GRAMS_PER_ORE));
    });

    it('should return null for transactions without claim yield instruction', async () => {
      const nonYieldTx = {
        signature: 'noYield',
        slot: 1,
        blockTime: 123,
        err: null,
        parsedData: {
          meta: { logMessages: ['Program log: Claiming 1 ORE'] },
          transaction: { message: { instructions: [], accountKeys: [] } },
        },
      };

      const result = await claimYieldETL.processTransaction(nonYieldTx as RawTransaction);

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
          transaction: { message: { instructions: [] } },
        },
      };

      const result = await claimYieldETL.processTransaction(incompleteTx as RawTransaction);

      expect(result).toBeNull();
    });
  });
});

