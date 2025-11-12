/**
 * Parse instruction data to extract deploy squares and other structured data
 */

import bs58 from 'bs58';
import { bnToPubkey, extractPubkey } from '../utils/pubkey-converter';

export interface ParsedDeploy {
  instructionType: number;
  amount: bigint;
  amountSOL: number;
  mask: number;
  squares: number[];
}

export class InstructionParser {
  /**
   * Parse Deploy instruction data
   * Format: [type:u8][amount:u64][mask:u32]
   */
  static parseDeployInstruction(dataString: string): ParsedDeploy | null {
    try {
      const data = InstructionParser.decodeInstructionData(dataString);
      
      // Check minimum length (1 + 8 + 4 = 13 bytes)
      if (!data || data.length < 13) return null;
      
      // Parse instruction type
      const instructionType = data[0];
      if (instructionType !== 6) return null; // Not a Deploy instruction
      
      // Parse amount (bytes 1-8, little-endian u64)
      const amount = data.readBigUInt64LE(1);
      const amountSOL = Number(amount) / 1e9;
      
      // Parse mask (bytes 9-12, little-endian u32)
      const mask = data.readUInt32LE(9);
      
      // Extract squares from mask
      const squares: number[] = [];
      for (let i = 0; i < 25; i++) {
        if (mask & (1 << i)) {
          squares.push(i);
        }
      }
      
      return {
        instructionType,
        amount,
        amountSOL,
        mask,
        squares,
      };
    } catch (error) {
      return null;
    }
  }

  static getInstructionType(dataString?: string): number | null {
    if (!dataString) return null;
    const data = InstructionParser.decodeInstructionData(dataString);
    if (!data || data.length === 0) return null;
    return data[0];
  }

  private static decodeInstructionData(dataString: string): Buffer | null {
    if (!dataString) {
      return null;
    }

    try {
      const decoded = bs58.decode(dataString);
      return Buffer.from(decoded);
    } catch (error) {
      try {
        return Buffer.from(dataString, 'base64');
      } catch (innerError) {
        return null;
      }
    }
  }

  /**
   * Extract account addresses from instruction
   * For Deploy instruction: [signer, authority, automation, board, miner, round, systemProgram]
   * For Checkpoint: [signer, board, miner, round, treasury, systemProgram]
   */
  static extractAccounts(instruction: any): {
    signer?: string;
    authority?: string;
    automation?: string;
    board?: string;
    miner?: string;
    round?: string;
    systemProgram?: string;
    mint?: string;
    recipient?: string;
    treasury?: string;
    treasuryTokens?: string;
    tokenProgram?: string;
    associatedTokenProgram?: string;
    stake?: string;
    stakeTokens?: string;
    sender?: string;
  } {
    try {
      if (!instruction.accounts || instruction.accounts.length === 0) {
        return {};
      }

      const accounts = instruction.accounts
        .map((acc: any) => extractPubkey(acc))
        .filter(Boolean) as string[];

      const instructionType = InstructionParser.getInstructionType(instruction.data);

      if (instructionType === 6) {
        // Deploy instruction layout
        return {
          signer: accounts[0],
          authority: accounts[1] || accounts[0], // Fallback to signer if no authority
          automation: accounts[2],
          board: accounts[3],
          miner: accounts[4],
          round: accounts[5],
        };
      }

      if (instructionType === 2) {
        // Checkpoint instruction layout: [signer, board, miner, round, treasury, systemProgram]
        return {
          signer: accounts[0],
          authority: accounts[0],
          board: accounts[1],
          miner: accounts[2],
          round: accounts[3],
          treasury: accounts[4],
          systemProgram: accounts[5],
        };
      }

      if (instructionType === 3) {
        // Claim SOL layout: [signer, miner, systemProgram]
        return {
          signer: accounts[0],
          authority: accounts[0],
          miner: accounts[1],
          systemProgram: accounts[2],
        };
      }

      if (instructionType === 4) {
        // Claim ORE layout:
        // [signer, miner, mint, recipient, treasury, treasury_tokens, system_program, token_program, associated_token_program]
        return {
          signer: accounts[0],
          authority: accounts[0],
          miner: accounts[1],
          mint: accounts[2],
          recipient: accounts[3],
          treasury: accounts[4],
          treasuryTokens: accounts[5],
          systemProgram: accounts[6],
          tokenProgram: accounts[7],
          associatedTokenProgram: accounts[8],
        };
      }

      if (instructionType === 10) {
        // Deposit layout:
        // [signer, mint, sender, stake, stake_tokens, treasury, system_program, token_program, associated_token_program]
        return {
          signer: accounts[0],
          authority: accounts[0],
          mint: accounts[1],
          sender: accounts[2],
          stake: accounts[3],
          stakeTokens: accounts[4],
          treasury: accounts[5],
          systemProgram: accounts[6],
          tokenProgram: accounts[7],
          associatedTokenProgram: accounts[8],
        };
      }

      if (instructionType === 11) {
        // Withdraw layout:
        // [signer, mint, recipient, stake, stake_tokens, treasury, system_program, token_program, associated_token_program]
        return {
          signer: accounts[0],
          authority: accounts[0],
          mint: accounts[1],
          recipient: accounts[2],
          stake: accounts[3],
          stakeTokens: accounts[4],
          treasury: accounts[5],
          systemProgram: accounts[6],
          tokenProgram: accounts[7],
          associatedTokenProgram: accounts[8],
        };
      }

      if (instructionType === 12) {
        // Claim Yield layout:
        // [signer, mint, recipient, stake, treasury, treasury_tokens, system_program, token_program, associated_token_program]
        return {
          signer: accounts[0],
          authority: accounts[0],
          mint: accounts[1],
          recipient: accounts[2],
          stake: accounts[3],
          treasury: accounts[4],
          treasuryTokens: accounts[5],
          systemProgram: accounts[6],
          tokenProgram: accounts[7],
          associatedTokenProgram: accounts[8],
        };
      }

      // Fallback for unknown instructions - try best-effort extraction
      return {
        signer: accounts[0],
        authority: accounts[1] || accounts[0],
      };
    } catch (error) {
      console.error('Error extracting accounts:', error);
      return {};
    }
  }

  /**
   * Determine if transaction involves automation
   */
  static isAutomationDeploy(accounts: any[]): boolean {
    // If automation account (index 2) is not empty, it's an automation
    if (accounts.length >= 3 && accounts[2]) {
      return true;
    }
    return false;
  }
}

