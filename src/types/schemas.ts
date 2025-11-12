import { ObjectId } from 'mongodb';

// ========== Raw Transaction (Source) ==========
export interface RawTransaction {
  _id: ObjectId;
  signature: string;
  slot: number;
  blockTime: number | null;
  err: any;
  parsedData: any;
  createdAt: Date;
}

// ========== Transformed Schemas (Target) ==========

// Deploy activity
export interface DeployActivity {
  _id?: ObjectId;
  signature: string;
  slot: number;
  blockTime: number;
  authority: string;
  roundId: number;
  amount: number; // lamports
  amountSOL: number;
  numSquares: number;
  squaresMask?: number;
  squares?: number[];
  isAutomation: boolean;
  success: boolean;
  createdAt: Date;
}

// Checkpoint activity
export interface CheckpointActivity {
  _id?: ObjectId;
  signature: string;
  slot: number;
  blockTime: number;
  authority: string;
  roundId: number;
  baseRewardsSOL?: number;
  splitRewardsORE?: number;
  topMinerRewardsORE?: number;
  motherlodeRewardsORE?: number;
  refundSOL?: number;
  totalRewardsSOL: number;
  totalRewardsORE: number;
  success: boolean;
  createdAt: Date;
}

// Claim SOL activity
export interface ClaimSOLActivity {
  _id?: ObjectId;
  signature: string;
  slot: number;
  blockTime: number;
  authority: string;
  amount: number; // lamports
  amountSOL: number;
  success: boolean;
  createdAt: Date;
}

// Claim ORE activity
export interface ClaimOREActivity {
  _id?: ObjectId;
  signature: string;
  slot: number;
  blockTime: number;
  authority: string;
  amount: number; // grams (10^11 per ORE)
  amountORE: number;
  success: boolean;
  createdAt: Date;
}

// Deposit activity (staking)
export interface DepositActivity {
  _id?: ObjectId;
  signature: string;
  slot: number;
  blockTime: number;
  authority: string;
  amount: number;
  amountORE: number;
  success: boolean;
  createdAt: Date;
}

// Withdraw activity (staking)
export interface WithdrawActivity {
  _id?: ObjectId;
  signature: string;
  slot: number;
  blockTime: number;
  authority: string;
  amount: number;
  amountORE: number;
  success: boolean;
  createdAt: Date;
}

// Claim Yield activity (staking)
export interface ClaimYieldActivity {
  _id?: ObjectId;
  signature: string;
  slot: number;
  blockTime: number;
  authority: string;
  amount: number;
  amountORE: number;
  success: boolean;
  createdAt: Date;
}

// Bury activity (buy-and-burn)
export interface BuryActivity {
  _id?: ObjectId;
  signature: string;
  slot: number;
  blockTime: number;
  solSwapped: number;
  solSwappedAmount: number;
  oreReceived: number;
  oreReceivedAmount: number;
  oreShared: number;
  oreSharedAmount: number;
  oreBurned: number;
  oreBurnedAmount: number;
  newCirculatingSupply?: number;
  success: boolean;
  createdAt: Date;
}

// Reset activity (round end)
export interface ResetActivity {
  _id?: ObjectId;
  signature: string;
  slot: number;
  blockTime: number;
  roundId: number;
  startSlot: number;
  endSlot: number;
  winningSquare: number;
  topMiner: string;
  numWinners: number;
  motherlode: number;
  totalDeployed: number;
  totalVaulted: number;
  totalWinnings: number;
  totalMinted: number;
  success: boolean;
  createdAt: Date;
}

// ETL processing state
export interface ETLState {
  _id?: ObjectId;
  type: string; // 'deploy', 'checkpoint', etc.
  lastProcessedSlot: number;
  lastProcessedSignature: string;
  totalProcessed: number;
  lastRunAt: Date;
  status: 'idle' | 'running' | 'error';
  errorMessage?: string;
}

export interface TransformChunkState {
  _id?: ObjectId;
  chunkId: string;
  startSlot: number;
  endSlot: number;
  status: 'pending' | 'running' | 'completed' | 'error';
  updatedAt: Date;
  lastProcessedSlot?: number;
  lastProcessedSignature?: string;
  errorMessage?: string;
}

// Collection names
export const COLLECTIONS = {
  // Source
  RAW_TRANSACTIONS: 'transactions',
  
  // Target
  DEPLOYS: 'deploys',
  CHECKPOINTS: 'checkpoints',
  CLAIM_SOL: 'claim_sol',
  CLAIM_ORE: 'claim_ore',
  DEPOSITS: 'deposits',
  WITHDRAWS: 'withdraws',
  CLAIM_YIELDS: 'claim_yields',
  BURY: 'bury',
  RESETS: 'resets',
  ETL_STATE: 'etl_state',
  TRANSFORM_CHUNKS: 'transform_chunks',
} as const;

