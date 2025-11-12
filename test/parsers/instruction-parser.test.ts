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

    it('should extract accounts from claim SOL transaction', () => {
      const tx = samples.claims_sol[0];
      const instructions = tx.parsedData.transaction.message.instructions;

      const claimInstruction = instructions.find(
        (ix: any) =>
          (ix.accounts?.length || 0) >= 3 && InstructionParser.getInstructionType(ix.data) === 3
      );

      if (claimInstruction) {
        const accounts = InstructionParser.extractAccounts(claimInstruction);

        expect(accounts.signer).toBeDefined();
        expect(accounts.authority).toBe(accounts.signer);
        expect(accounts.miner).toBeDefined();
        expect(accounts.systemProgram).toBeDefined();
      }
    });

    it('should extract accounts from claim ORE transaction', () => {
      const tx = samples.claims_ore[0];
      const instructions = tx.parsedData.transaction.message.instructions;

      const claimInstruction = instructions.find(
        (ix: any) =>
          (ix.accounts?.length || 0) >= 9 && InstructionParser.getInstructionType(ix.data) === 4
      );

      if (claimInstruction) {
        const accounts = InstructionParser.extractAccounts(claimInstruction);

        expect(accounts.signer).toBeDefined();
        expect(accounts.authority).toBe(accounts.signer);
        expect(accounts.mint).toBeDefined();
        expect(accounts.recipient).toBeDefined();
        expect(accounts.treasury).toBeDefined();
        expect(accounts.treasuryTokens).toBeDefined();
        expect(accounts.tokenProgram).toBeDefined();
        expect(accounts.associatedTokenProgram).toBeDefined();
      }
    });

    it('should extract accounts from deposit transaction', () => {
      const tx = samples.deposits[0];
      const instructions = tx.parsedData.transaction.message.instructions;

      const depositInstruction = instructions.find(
        (ix: any) =>
          (ix.accounts?.length || 0) >= 9 && InstructionParser.getInstructionType(ix.data) === 10
      );

      if (depositInstruction) {
        const accounts = InstructionParser.extractAccounts(depositInstruction);

        expect(accounts.signer).toBeDefined();
        expect(accounts.authority).toBe(accounts.signer);
        expect(accounts.stake).toBeDefined();
        expect(accounts.treasury).toBeDefined();
        expect(accounts.stakeTokens).toBeDefined();
      }
    });

    it('should extract accounts from withdraw transaction', () => {
      const tx = samples.withdraws[0];
      const instructions = tx.parsedData.transaction.message.instructions;

      const withdrawInstruction = instructions.find(
        (ix: any) =>
          (ix.accounts?.length || 0) >= 9 && InstructionParser.getInstructionType(ix.data) === 11
      );

      if (withdrawInstruction) {
        const accounts = InstructionParser.extractAccounts(withdrawInstruction);

        expect(accounts.signer).toBeDefined();
        expect(accounts.authority).toBe(accounts.signer);
        expect(accounts.recipient).toBeDefined();
        expect(accounts.stake).toBeDefined();
        expect(accounts.stakeTokens).toBeDefined();
      }
    });

    it('should extract accounts from claim yield instruction layout', () => {
      const mockInstruction = {
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
      };

      const accounts = InstructionParser.extractAccounts(mockInstruction);

      expect(accounts.signer).toBe('Signer1111111111111111111111111111111111');
      expect(accounts.authority).toBe(accounts.signer);
      expect(accounts.recipient).toBe('Recipient1111111111111111111111111111111');
      expect(accounts.stake).toBe('Stake11111111111111111111111111111111111');
      expect(accounts.treasury).toBe('Treasury1111111111111111111111111111111');
      expect(accounts.treasuryTokens).toBe('TreasuryTok11111111111111111111111111111');
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

