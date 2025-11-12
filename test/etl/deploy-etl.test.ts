import { DeployETL } from '../../src/etl/deploy-etl';
import { MongoManager } from '../../src/database/mongo-manager';
import { DeployActivity, RawTransaction } from '../../src/types/schemas';
import samplesData from '../fixtures/sample-events.json';

// Type assertion for JSON data
const samples = samplesData as any;

describe('DeployETL - End-to-End', () => {
  let deployETL: DeployETL;
  let mockMongoManager: any;

  beforeEach(() => {
    // Mock MongoManager (don't need real DB connection for unit test)
    mockMongoManager = {
      getRawTransactionsCollection: jest.fn(),
      getDeploysCollection: jest.fn(),
      getETLStateCollection: jest.fn(),
      connect: jest.fn(),
      disconnect: jest.fn(),
      saveBatch: jest.fn(),
      getETLState: jest.fn().mockResolvedValue(null),
      updateETLState: jest.fn(),
    } as any;
    
    deployETL = new DeployETL(mockMongoManager);
  });

  describe('processTransaction - Complete Flow', () => {
    it('should transform raw transaction to complete DeployActivity', async () => {
      const rawTx = samples.deploys[0];
      
      const result = await deployETL.processTransaction(rawTx);
      
      // Validate result exists
      expect(result).toBeDefined();
      expect(result).not.toBeNull();
      
      // Validate all required fields
      expect(result).toMatchObject({
        signature: expect.any(String),
        slot: expect.any(Number),
        blockTime: expect.any(Number),
        authority: expect.any(String),
        roundId: expect.any(Number),
        amount: expect.any(Number),
        amountSOL: expect.any(Number),
        numSquares: expect.any(Number),
        isAutomation: expect.any(Boolean),
        success: expect.any(Boolean),
        createdAt: expect.any(Date),
      });
    });

    it('should extract authority correctly (not "unknown")', async () => {
      const rawTx = samples.deploys[0];
      const result = await deployETL.processTransaction(rawTx);
      
      expect(result).toBeDefined();
      expect(result!.authority).not.toBe('unknown');
      expect(result!.authority.length).toBeGreaterThan(32); // base58 pubkey
    });

    it('should parse roundId from logs', async () => {
      const rawTx = samples.deploys[0];
      const result = await deployETL.processTransaction(rawTx);
      
      expect(result).toBeDefined();
      expect(result!.roundId).toBeGreaterThan(0);
      expect(result!.roundId).toBeLessThan(100000); // reasonable round number
    });

    it('should parse amounts from logs', async () => {
      const rawTx = samples.deploys[0];
      const result = await deployETL.processTransaction(rawTx);
      
      expect(result).toBeDefined();
      expect(result!.amountSOL).toBeGreaterThan(0);
      expect(result!.amount).toBe(Math.round(result!.amountSOL * 1e9));
    });

    it('should parse numSquares from logs', async () => {
      const rawTx = samples.deploys[0];
      const result = await deployETL.processTransaction(rawTx);
      
      expect(result).toBeDefined();
      expect(result!.numSquares).toBeGreaterThanOrEqual(1);
      expect(result!.numSquares).toBeLessThanOrEqual(25);
    });

    it('should parse squares mask and indices from instruction data', async () => {
      const rawTx = samples.deploys[0];
      const result = await deployETL.processTransaction(rawTx);

      expect(result).toBeDefined();
      expect(result!.squaresMask).toBeGreaterThan(0);
      expect(result!.squares).toEqual([
        0, 1, 3, 7, 9, 11, 13, 15, 17, 19, 21,
      ]);
      expect(result!.squares?.length).toBe(result!.numSquares);
    });

    it('should use slot and blockTime from transaction', async () => {
      const rawTx = samples.deploys[0];
      const result = await deployETL.processTransaction(rawTx);
      
      expect(result).toBeDefined();
      expect(result!.signature).toBe(rawTx.signature);
      expect(result!.slot).toBe(rawTx.slot);
      expect(result!.blockTime).toBe(rawTx.blockTime);
    });

    it('should detect transaction success/failure', async () => {
      // Successful transaction
      const successTx = samples.deploys[0];
      const successResult = await deployETL.processTransaction(successTx);
      
      expect(successResult).toBeDefined();
      expect(successResult!.success).toBe(successTx.err === null);
    });

    it('should process all deploy samples successfully', async () => {
      for (const rawTx of samples.deploys) {
        const result = await deployETL.processTransaction(rawTx);
        
        expect(result).toBeDefined();
        expect(result).not.toBeNull();
        
        // Validate critical fields populated
        expect(result!.authority).not.toBe('unknown');
        expect(result!.roundId).toBeGreaterThan(0);
        expect(result!.amountSOL).toBeGreaterThan(0);
        expect(result!.signature).toBe(rawTx.signature);
      }
    });

    it('should return null for non-deploy transactions', async () => {
      // Create transaction without deploy log
      const nonDeployTx = {
        ...samples.checkpoints[0],
        parsedData: {
          ...samples.checkpoints[0].parsedData,
          meta: {
            ...samples.checkpoints[0].parsedData.meta,
            logMessages: samples.checkpoints[0].parsedData.meta.logMessages.filter(
              (l: string) => !l.includes('deploying')
            )
          }
        }
      };
      
      const result = await deployETL.processTransaction(nonDeployTx);
      
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
            logMessages: [] // No logs
          }
        }
      };
      
      const result = await deployETL.processTransaction(incompleteTx as any);
      
      expect(result).toBeNull(); // Should return null, not crash
    });
  });

  describe('Output Schema Validation', () => {
    it('should match DeployActivity interface exactly', async () => {
      const rawTx = samples.deploys[0];
      const result = await deployETL.processTransaction(rawTx);
      
      expect(result).toBeDefined();
      
      // Check all DeployActivity fields
      const expectedKeys = [
        'signature',
        'slot',
        'blockTime',
        'authority',
        'roundId',
        'amount',
        'amountSOL',
        'numSquares',
        'isAutomation',
        'success',
        'createdAt'
      ];
      
      expectedKeys.forEach(key => {
        expect(result).toHaveProperty(key);
      });
    });

    it('should have correct data types for all fields', async () => {
      const rawTx = samples.deploys[0];
      const result = await deployETL.processTransaction(rawTx);
      
      expect(result).toBeDefined();
      
      expect(typeof result!.signature).toBe('string');
      expect(typeof result!.slot).toBe('number');
      expect(typeof result!.blockTime).toBe('number');
      expect(typeof result!.authority).toBe('string');
      expect(typeof result!.roundId).toBe('number');
      expect(typeof result!.amount).toBe('number');
      expect(typeof result!.amountSOL).toBe('number');
      expect(typeof result!.numSquares).toBe('number');
      expect(typeof result!.isAutomation).toBe('boolean');
      expect(typeof result!.success).toBe('boolean');
      expect(result!.createdAt).toBeInstanceOf(Date);
    });
  });

  describe('Real Data Validation', () => {
    it('should extract realistic values from real transactions', async () => {
      const results: DeployActivity[] = [];
      
      for (const rawTx of samples.deploys) {
        const result = await deployETL.processTransaction(rawTx);
        if (result) results.push(result);
      }
      
      expect(results.length).toBe(samples.deploys.length);
      
      // Validate realistic ranges
      results.forEach(deploy => {
        // Reasonable slot range
        expect(deploy.slot).toBeGreaterThan(370000000);
        expect(deploy.slot).toBeLessThan(400000000);
        
        // Reasonable timestamp (2024-2025)
        expect(deploy.blockTime).toBeGreaterThan(1700000000);
        expect(deploy.blockTime).toBeLessThan(1800000000);
        
        // Reasonable amounts (0.00001 to 100 SOL)
        expect(deploy.amountSOL).toBeGreaterThan(0);
        expect(deploy.amountSOL).toBeLessThan(100);
        
        // Valid round IDs
        expect(deploy.roundId).toBeGreaterThan(0);
        expect(deploy.roundId).toBeLessThan(100000);
      });
    });

    it('should preserve transaction signature for traceability', async () => {
      const rawTx = samples.deploys[0];
      const result = await deployETL.processTransaction(rawTx);
      
      expect(result).toBeDefined();
      expect(result!.signature).toBe(rawTx.signature);
      
      // Can trace back to original transaction
      expect(result!.signature.length).toBeGreaterThan(80);
    });
  });

  describe('Integration Points', () => {
    it('should integrate LogParser correctly', async () => {
      const rawTx = samples.deploys[0];
      const logs = rawTx.parsedData.meta.logMessages;
      
      // What LogParser extracts
      const { LogParser } = require('../../src/parsers/log-parser');
      const parsedLogs = LogParser.parseAll(logs);
      const deployLog = parsedLogs.find((l: any) => l.type === 'deploy');
      
      // What DeployETL produces
      const result = await deployETL.processTransaction(rawTx);
      
      // Should match
      expect(result!.roundId).toBe(deployLog.roundId);
      expect(result!.amountSOL).toBe(deployLog.amountSOL);
      expect(result!.numSquares).toBe(deployLog.numSquares);
    });

    it('should integrate account extraction correctly', async () => {
      const rawTx = samples.deploys[0];
      const accountKeys = rawTx.parsedData.transaction.message.accountKeys;
      
      // What extractPubkey produces
      const { extractPubkey } = require('../../src/utils/pubkey-converter');
      const expectedAuthority = extractPubkey(accountKeys[0].pubkey);
      
      // What DeployETL produces
      const result = await deployETL.processTransaction(rawTx);
      
      // Should match
      expect(result!.authority).toBe(expectedAuthority);
    });
  });
});

