import { InstructionParser } from '../../src/parsers/instruction-parser';
import { bnToPubkey, extractPubkey } from '../../src/utils/pubkey-converter';
import samples from '../fixtures/sample-events.json';

describe('InstructionParser', () => {
  describe('Account Extraction', () => {
    it('should extract accounts from deploy transaction', () => {
      const tx = samples.deploys[0];
      const instructions = tx.parsedData.transaction.message.instructions;
      
      // Find ORE program instruction
      const oreInstruction = instructions.find((ix: any) => {
        const programWords = ix.programId?._bn?.words;
        return programWords && programWords[0] === 36997443; // ORE program signature
      });

      if (oreInstruction) {
        const accounts = InstructionParser.extractAccounts(oreInstruction);
        
        expect(accounts).toBeDefined();
        expect(accounts.signer).toBeDefined();
      }
    });

    it('should extract authority from accountKeys', () => {
      const tx = samples.deploys[0];
      const accountKeys = tx.parsedData.transaction.message.accountKeys;
      
      if (accountKeys && accountKeys.length > 0) {
        const signerKey = accountKeys[0];
        const pubkey = extractPubkey(signerKey.pubkey);
        
        expect(pubkey).toBeDefined();
        expect(typeof pubkey).toBe('string');
        expect(pubkey?.length).toBeGreaterThan(32); // base58 encoded
      }
    });

  it('should extract accounts from checkpoint transaction', () => {
    const tx = samples.checkpoints[0];
    const instructions = tx.parsedData.transaction.message.instructions;

    const oreInstruction = instructions.find((ix: any) => {
      const accountsLength = ix.accounts?.length || 0;
      return accountsLength >= 5 && InstructionParser.getInstructionType(ix.data) === 2;
    });

    if (oreInstruction) {
      const accounts = InstructionParser.extractAccounts(oreInstruction);

      expect(accounts.signer).toBeDefined();
      expect(accounts.authority).toBe(accounts.signer);
      expect(accounts.board).toBeDefined();
      expect(accounts.miner).toBeDefined();
      expect(accounts.round).toBeDefined();
    }
  });
  });

  describe('BN to Pubkey Conversion', () => {
    it('should convert BN format to base58 pubkey', () => {
      const sampleBN = {
        _bn: {
          negative: 0,
          words: [64516534, 24133206, 51540035, 36527328, 18825788, 35057909, 46552102, 51754101, 60513809, 3985264, 0],
          length: 10,
          red: null
        }
      };

      const pubkey = bnToPubkey(sampleBN);
      
      expect(pubkey).toBeDefined();
      expect(typeof pubkey).toBe('string');
      expect(pubkey?.length).toBeGreaterThan(32);
    });

    it('should handle null/undefined BN', () => {
      expect(bnToPubkey(null)).toBeNull();
      expect(bnToPubkey(undefined)).toBeNull();
      expect(bnToPubkey({})).toBeNull();
    });

    it('should convert all sample account keys', () => {
      samples.deploys.forEach(tx => {
        const accountKeys = tx.parsedData.transaction.message.accountKeys;
        
        accountKeys.forEach((acc: any) => {
          if (acc.pubkey) {
            const pubkey = extractPubkey(acc.pubkey);
            
            if (pubkey) {
              expect(typeof pubkey).toBe('string');
              expect(pubkey.length).toBeGreaterThan(30);
            }
          }
        });
      });
    });
  });

  describe('Deploy Instruction Parsing', () => {
    it('should parse deploy instruction data including squares', () => {
      const tx = samples.deploys[0];
      const instructions = tx.parsedData.transaction.message.instructions;
      
      let foundDeploy = false;
      
      for (const ix of instructions) {
        if (ix.data && typeof ix.data === 'string') {
          const parsed = InstructionParser.parseDeployInstruction(ix.data);
          
          if (parsed) {
            foundDeploy = true;
            expect(parsed.instructionType).toBe(6);
            expect(parsed.amount).toBeDefined();
            expect(parsed.mask).toBeDefined();
            expect(parsed.squares).toBeInstanceOf(Array);
            expect(parsed.squares?.length).toBeGreaterThan(0);
            expect(parsed.squares).toEqual([
              0, 1, 3, 7, 9, 11, 13, 15, 17, 19, 21,
            ]);
            break;
          }
        }
      }

      expect(foundDeploy).toBe(true);
    });
  });

  describe('Automation Detection', () => {
    it('should detect automation from accounts', () => {
      const accountsWithAutomation = ['addr1', 'addr2', 'automation_addr', 'board', 'miner'];
      const accountsWithoutAutomation = ['addr1', 'addr2', null, 'board', 'miner'];
      
      expect(InstructionParser.isAutomationDeploy(accountsWithAutomation)).toBe(true);
      expect(InstructionParser.isAutomationDeploy(accountsWithoutAutomation)).toBe(false);
    });
  });
});

