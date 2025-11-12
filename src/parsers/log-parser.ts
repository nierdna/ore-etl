/**
 * Parse program logs to extract structured data
 */

const LAMPORTS_PER_SOL = 1_000_000_000;
const GRAMS_PER_ORE = 100_000_000_000; // 10^11

export interface DeployLog {
  type: 'deploy';
  roundId: number;
  amountSOL: number;
  numSquares: number;
}

export interface CheckpointLog {
  type: 'checkpoint';
  roundId?: number;
  baseRewardsSOL?: number;
  splitRewardsORE?: number;
  topMinerRewardsORE?: number;
  motherlodeRewardsORE?: number;
  refundSOL?: number;
}

export interface ClaimSOLLog {
  type: 'claim_sol';
  amountSOL: number;
}

export interface ClaimORELog {
  type: 'claim_ore';
  amountORE: number;
}

export interface DepositLog {
  type: 'deposit';
  amountORE: number;
}

export interface WithdrawLog {
  type: 'withdraw';
  amountORE: number;
}

export interface ClaimYieldLog {
  type: 'claim_yield';
  amountORE: number;
}

export interface BuryLog {
  type: 'bury';
  solSwapped?: number;
  oreReceived?: number;
  oreShared?: number;
  oreBurned?: number;
}

export type ParsedLog = 
  | DeployLog 
  | CheckpointLog 
  | ClaimSOLLog 
  | ClaimORELog
  | DepositLog
  | WithdrawLog
  | ClaimYieldLog
  | BuryLog;

export class LogParser {
  static parseAll(logs: string[]): ParsedLog[] {
    const results: ParsedLog[] = [];
    
    for (const log of logs) {
      if (!log.startsWith('Program log:')) continue;
      
      const content = log.replace('Program log: ', '');
      const parsed = this.parseLog(content);
      if (parsed) {
        results.push(parsed);
      }
    }
    
    return results;
  }

  private static parseLog(content: string): ParsedLog | null {
    // Deploy: "Round #31460: deploying 0.1 SOL to 5 squares"
    const deployMatch = content.match(/Round #(\d+): deploying ([\d.]+) SOL to (\d+) squares/);
    if (deployMatch) {
      return {
        type: 'deploy',
        roundId: parseInt(deployMatch[1]),
        amountSOL: parseFloat(deployMatch[2]),
        numSquares: parseInt(deployMatch[3]),
      };
    }

    // Round ID for checkpoint
    const roundIdMatch = content.match(/Round ID: (\d+)/);
    if (roundIdMatch) {
      return {
        type: 'checkpoint',
        roundId: parseInt(roundIdMatch[1]),
      };
    }

    // Checkpoint - Base rewards: "Base rewards: 5.5 SOL"
    const baseRewardsMatch = content.match(/Base rewards: ([\d.]+) SOL/);
    if (baseRewardsMatch) {
      return {
        type: 'checkpoint',
        baseRewardsSOL: parseFloat(baseRewardsMatch[1]),
      };
    }

    // Checkpoint - Split: "Split rewards: 0.5 ORE"
    const splitRewardsMatch = content.match(/Split rewards: ([\d.]+) ORE/);
    if (splitRewardsMatch) {
      return {
        type: 'checkpoint',
        splitRewardsORE: parseFloat(splitRewardsMatch[1]),
      };
    }

    // Checkpoint - Top miner: "Top miner rewards: 1.0 ORE"
    const topMinerMatch = content.match(/Top miner rewards: ([\d.]+) ORE/);
    if (topMinerMatch) {
      return {
        type: 'checkpoint',
        topMinerRewardsORE: parseFloat(topMinerMatch[1]),
      };
    }

    // Checkpoint - Motherlode: "Motherlode rewards: 2.0 ORE"
    const motherlodeMatch = content.match(/Motherlode rewards: ([\d.]+) ORE/);
    if (motherlodeMatch) {
      return {
        type: 'checkpoint',
        motherlodeRewardsORE: parseFloat(motherlodeMatch[1]),
      };
    }

    // Checkpoint - Refund: "Refunding 10.0 SOL"
    const refundMatch = content.match(/Refunding ([\d.]+) SOL/);
    if (refundMatch) {
      return {
        type: 'checkpoint',
        refundSOL: parseFloat(refundMatch[1]),
      };
    }

    // Claim SOL: "Claiming 10.5 SOL"
    const claimSOLMatch = content.match(/^Claiming ([\d.]+) SOL$/);
    if (claimSOLMatch) {
      return {
        type: 'claim_sol',
        amountSOL: parseFloat(claimSOLMatch[1]),
      };
    }

    // Claim ORE: "Claiming X.X ORE"
    const claimOREMatch = content.match(/^Claiming ([\d.]+) ORE$/);
    if (claimOREMatch) {
      return {
        type: 'claim_ore',
        amountORE: parseFloat(claimOREMatch[1]),
      };
    }

    // Deposit: "Depositing X.X ORE"
    const depositMatch = content.match(/^Depositing ([\d.]+) ORE$/);
    if (depositMatch) {
      return {
        type: 'deposit',
        amountORE: parseFloat(depositMatch[1]),
      };
    }

    // Withdraw: "Withdrawing X.X ORE"
    const withdrawMatch = content.match(/^Withdrawing ([\d.]+) ORE$/);
    if (withdrawMatch) {
      return {
        type: 'withdraw',
        amountORE: parseFloat(withdrawMatch[1]),
      };
    }

    // Bury - Swapped: "📈 Swapped X.X SOL into Y.Y ORE"
    const swapMatch = content.match(/📈 Swapped ([\d.]+) SOL into ([\d.]+) ORE/);
    if (swapMatch) {
      return {
        type: 'bury',
        solSwapped: parseFloat(swapMatch[1]),
        oreReceived: parseFloat(swapMatch[2]),
      };
    }

    // Bury - Shared: "💰 Shared X.X ORE"
    const sharedMatch = content.match(/💰 Shared ([\d.]+) ORE/);
    if (sharedMatch) {
      return {
        type: 'bury',
        oreShared: parseFloat(sharedMatch[1]),
      };
    }

    // Bury - Burned: "🔥 Buried X.X ORE"
    const buriedMatch = content.match(/🔥 Buried ([\d.]+) ORE/);
    if (buriedMatch) {
      return {
        type: 'bury',
        oreBurned: parseFloat(buriedMatch[1]),
      };
    }

    return null;
  }

  static mergeCheckpointLogs(logs: CheckpointLog[]): CheckpointLog {
    const merged: CheckpointLog = { type: 'checkpoint' };
    
    for (const log of logs) {
      if (log.roundId !== undefined) merged.roundId = log.roundId;
      if (log.baseRewardsSOL !== undefined) merged.baseRewardsSOL = log.baseRewardsSOL;
      if (log.splitRewardsORE !== undefined) merged.splitRewardsORE = log.splitRewardsORE;
      if (log.topMinerRewardsORE !== undefined) merged.topMinerRewardsORE = log.topMinerRewardsORE;
      if (log.motherlodeRewardsORE !== undefined) merged.motherlodeRewardsORE = log.motherlodeRewardsORE;
      if (log.refundSOL !== undefined) merged.refundSOL = log.refundSOL;
    }
    
    return merged;
  }

  static mergeBuryLogs(logs: BuryLog[]): BuryLog {
    const merged: BuryLog = { type: 'bury' };
    
    for (const log of logs) {
      if (log.solSwapped !== undefined) merged.solSwapped = log.solSwapped;
      if (log.oreReceived !== undefined) merged.oreReceived = log.oreReceived;
      if (log.oreShared !== undefined) merged.oreShared = log.oreShared;
      if (log.oreBurned !== undefined) merged.oreBurned = log.oreBurned;
    }
    
    return merged;
  }
}

