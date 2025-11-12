import { LogParser, DeployLog, CheckpointLog, BuryLog } from '../../src/parsers/log-parser';
import samples from '../fixtures/sample-events.json';

describe('LogParser', () => {
  describe('Deploy Logs', () => {
    it('should parse deploy log correctly', () => {
      const tx = samples.deploys[0];
      const logs = tx.parsedData.meta.logMessages;
      const parsed = LogParser.parseAll(logs);
      
      const deployLog = parsed.find(l => l.type === 'deploy') as DeployLog;
      
      expect(deployLog).toBeDefined();
      expect(deployLog.type).toBe('deploy');
      expect(deployLog.roundId).toBeGreaterThan(0);
      expect(deployLog.amountSOL).toBeGreaterThan(0);
      expect(deployLog.numSquares).toBeGreaterThanOrEqual(1);
      expect(deployLog.numSquares).toBeLessThanOrEqual(25);
    });

    it('should parse all deploy samples', () => {
      samples.deploys.forEach(tx => {
        const logs = tx.parsedData.meta.logMessages;
        const parsed = LogParser.parseAll(logs);
        const deployLog = parsed.find(l => l.type === 'deploy');
        
        expect(deployLog).toBeDefined();
        expect(deployLog?.type).toBe('deploy');
      });
    });

    it('should extract correct values from log text', () => {
      const testLog = 'Program log: Round #48888: deploying 0.1 SOL to 5 squares';
      const parsed = LogParser.parseAll([testLog]);
      
      expect(parsed[0]).toEqual({
        type: 'deploy',
        roundId: 48888,
        amountSOL: 0.1,
        numSquares: 5
      });
    });
  });

  describe('Checkpoint Logs', () => {
    it('should parse checkpoint logs with all reward types', () => {
      const tx = samples.checkpoints[0];
      const logs = tx.parsedData.meta.logMessages;
      const parsed = LogParser.parseAll(logs);
      
      const checkpointLogs = parsed.filter(l => l.type === 'checkpoint') as CheckpointLog[];
      
      expect(checkpointLogs.length).toBeGreaterThan(0);
    });

    it('should parse Round ID', () => {
      const testLog = 'Program log: Round ID: 48887';
      const parsed = LogParser.parseAll([testLog]);
      
      expect(parsed[0]).toEqual({
        type: 'checkpoint',
        roundId: 48887
      });
    });

    it('should parse Base rewards', () => {
      const testLog = 'Program log: Base rewards: 5.5 SOL';
      const parsed = LogParser.parseAll([testLog]);
      
      expect(parsed[0]).toEqual({
        type: 'checkpoint',
        baseRewardsSOL: 5.5
      });
    });

    it('should parse Split rewards', () => {
      const testLog = 'Program log: Split rewards: 0.5 ORE';
      const parsed = LogParser.parseAll([testLog]);
      
      expect(parsed[0]).toEqual({
        type: 'checkpoint',
        splitRewardsORE: 0.5
      });
    });

    it('should parse Top miner rewards', () => {
      const testLog = 'Program log: Top miner rewards: 1.0 ORE';
      const parsed = LogParser.parseAll([testLog]);
      
      expect(parsed[0]).toEqual({
        type: 'checkpoint',
        topMinerRewardsORE: 1.0
      });
    });

    it('should parse Motherlode rewards', () => {
      const testLog = 'Program log: Motherlode rewards: 2.5 ORE';
      const parsed = LogParser.parseAll([testLog]);
      
      expect(parsed[0]).toEqual({
        type: 'checkpoint',
        motherlodeRewardsORE: 2.5
      });
    });

    it('should parse Refund', () => {
      const testLog = 'Program log: Refunding 10.0 SOL';
      const parsed = LogParser.parseAll([testLog]);
      
      expect(parsed[0]).toEqual({
        type: 'checkpoint',
        refundSOL: 10.0
      });
    });

    it('should merge multiple checkpoint logs', () => {
      const checkpointLogs: CheckpointLog[] = [
        { type: 'checkpoint', roundId: 100 },
        { type: 'checkpoint', baseRewardsSOL: 5.5 },
        { type: 'checkpoint', splitRewardsORE: 0.5 }
      ];

      const merged = LogParser.mergeCheckpointLogs(checkpointLogs);

      expect(merged).toEqual({
        type: 'checkpoint',
        roundId: 100,
        baseRewardsSOL: 5.5,
        splitRewardsORE: 0.5
      });
    });

    it('should parse checkpoint sample into structured values', () => {
      const tx = samples.checkpoints[0];
      const parsed = LogParser.parseAll(tx.parsedData.meta.logMessages);
      const checkpointLogs = parsed.filter(l => l.type === 'checkpoint') as CheckpointLog[];
      const merged = LogParser.mergeCheckpointLogs(checkpointLogs);

      expect(merged.roundId).toBeGreaterThan(0);
      expect(merged.baseRewardsSOL).toBeCloseTo(0.000210803, 12);
      expect(merged.splitRewardsORE).toBeCloseTo(0.0000066273, 12);
      expect(merged.refundSOL ?? 0).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Claim Logs', () => {
    it('should parse Claim SOL log', () => {
      const testLog = 'Program log: Claiming 10.5 SOL';
      const parsed = LogParser.parseAll([testLog]);
      
      expect(parsed[0]).toEqual({
        type: 'claim_sol',
        amountSOL: 10.5
      });
    });

    it('should parse Claim ORE log', () => {
      const testLog = 'Program log: Claiming 5.25 ORE';
      const parsed = LogParser.parseAll([testLog]);
      
      expect(parsed[0]).toEqual({
        type: 'claim_ore',
        amountORE: 5.25
      });
    });

    it('should parse all claim SOL samples', () => {
      samples.claims_sol.forEach(tx => {
        const logs = tx.parsedData.meta.logMessages;
        const parsed = LogParser.parseAll(logs);
        const claimLog = parsed.find(l => l.type === 'claim_sol');
        
        if (claimLog && claimLog.type === 'claim_sol') {
          expect(claimLog.amountSOL).toBeGreaterThan(0);
        }
      });
    });
  });

  describe('Staking Logs', () => {
    it('should parse Deposit log', () => {
      const testLog = 'Program log: Depositing 100.0 ORE';
      const parsed = LogParser.parseAll([testLog]);
      
      expect(parsed[0]).toEqual({
        type: 'deposit',
        amountORE: 100.0
      });
    });

    it('should parse Withdraw log', () => {
      const testLog = 'Program log: Withdrawing 50.0 ORE';
      const parsed = LogParser.parseAll([testLog]);
      
      expect(parsed[0]).toEqual({
        type: 'withdraw',
        amountORE: 50.0
      });
    });

    it('should parse all deposit samples', () => {
      samples.deposits.forEach(tx => {
        const logs = tx.parsedData.meta.logMessages;
        const parsed = LogParser.parseAll(logs);
        const depositLog = parsed.find(l => l.type === 'deposit');
        
        if (depositLog && depositLog.type === 'deposit') {
          expect(depositLog.amountORE).toBeGreaterThan(0);
        }
      });
    });
  });

  describe('Bury Logs', () => {
    it('should parse Swapped log', () => {
      const testLog = 'Program log: 📈 Swapped 13.568 SOL into 5.195 ORE';
      const parsed = LogParser.parseAll([testLog]);
      
      expect(parsed[0]).toEqual({
        type: 'bury',
        solSwapped: 13.568,
        oreReceived: 5.195
      });
    });

    it('should parse Shared log', () => {
      const testLog = 'Program log: 💰 Shared 0.519 ORE';
      const parsed = LogParser.parseAll([testLog]);
      
      expect(parsed[0]).toEqual({
        type: 'bury',
        oreShared: 0.519
      });
    });

    it('should parse Buried log', () => {
      const testLog = 'Program log: 🔥 Buried 4.675 ORE';
      const parsed = LogParser.parseAll([testLog]);
      
      expect(parsed[0]).toEqual({
        type: 'bury',
        oreBurned: 4.675
      });
    });

    it('should merge bury logs', () => {
      const buryLogs: BuryLog[] = [
        { type: 'bury', solSwapped: 13.568, oreReceived: 5.195 },
        { type: 'bury', oreShared: 0.519 },
        { type: 'bury', oreBurned: 4.675 }
      ];

      const merged = LogParser.mergeBuryLogs(buryLogs);

      expect(merged).toEqual({
        type: 'bury',
        solSwapped: 13.568,
        oreReceived: 5.195,
        oreShared: 0.519,
        oreBurned: 4.675
      });
    });

    it('should parse all bury samples', () => {
      samples.bury.forEach(tx => {
        const logs = tx.parsedData.meta.logMessages;
        const parsed = LogParser.parseAll(logs);
        const buryLogs = parsed.filter(l => l.type === 'bury') as BuryLog[];
        
        expect(buryLogs.length).toBeGreaterThan(0);
        
        const merged = LogParser.mergeBuryLogs(buryLogs);
        expect(merged.type).toBe('bury');
      });
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty logs array', () => {
      const parsed = LogParser.parseAll([]);
      expect(parsed).toEqual([]);
    });

    it('should skip non-program logs', () => {
      const logs = [
        'Program ComputeBudget invoke [1]',
        'Program log: Round #100: deploying 0.1 SOL to 5 squares',
        'Program success'
      ];
      
      const parsed = LogParser.parseAll(logs);
      expect(parsed.length).toBe(1);
      expect(parsed[0].type).toBe('deploy');
    });

    it('should return null for unmatched patterns', () => {
      const testLog = 'Program log: Some random message';
      const parsed = LogParser.parseAll([testLog]);
      expect(parsed.length).toBe(0);
    });
  });
});

