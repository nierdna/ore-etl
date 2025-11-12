import { RawTransaction, DeployActivity, CheckpointActivity, ClaimSOLActivity, ClaimOREActivity, ClaimYieldActivity, DepositActivity, WithdrawActivity, BuryActivity } from '../types/schemas';
import { DeployETL } from './deploy-etl';
import { CheckpointETL } from './checkpoint-etl';
import { ClaimSOLETL } from './claim-sol-etl';
import { ClaimOREETL } from './claim-ore-etl';
import { ClaimYieldETL } from './claim-yield-etl';
import { DepositETL } from './deposit-etl';
import { WithdrawETL } from './withdraw-etl';
import { BuryETL } from './bury-etl';

type ActivityCommon = {
  activityType: ActivityType;
};

export type ActivityType =
  | 'deploy'
  | 'checkpoint'
  | 'claim_sol'
  | 'claim_ore'
  | 'claim_yield'
  | 'deposit'
  | 'withdraw'
  | 'bury';

export type ParsedActivity =
  | (DeployActivity & ActivityCommon & { activityType: 'deploy' })
  | (CheckpointActivity & ActivityCommon & { activityType: 'checkpoint' })
  | (ClaimSOLActivity & ActivityCommon & { activityType: 'claim_sol' })
  | (ClaimOREActivity & ActivityCommon & { activityType: 'claim_ore' })
  | (ClaimYieldActivity & ActivityCommon & { activityType: 'claim_yield' })
  | (DepositActivity & ActivityCommon & { activityType: 'deposit' })
  | (WithdrawActivity & ActivityCommon & { activityType: 'withdraw' })
  | (BuryActivity & ActivityCommon & { activityType: 'bury' });

type ParserEntry<T> = {
  activityType: ActivityType;
  parse: (tx: RawTransaction) => Promise<T | null>;
};

// The individual ETL processors only require MongoManager for batch operations.
// For single-transaction parsing we can safely instantiate them with a stub.
const stubMongoManager: any = {};

const deployParser = new DeployETL(stubMongoManager);
const checkpointParser = new CheckpointETL(stubMongoManager);
const claimSolParser = new ClaimSOLETL(stubMongoManager);
const claimOreParser = new ClaimOREETL(stubMongoManager);
const claimYieldParser = new ClaimYieldETL(stubMongoManager);
const depositParser = new DepositETL(stubMongoManager);
const withdrawParser = new WithdrawETL(stubMongoManager);
const buryParser = new BuryETL(stubMongoManager);

const PARSERS: ParserEntry<any>[] = [
  { activityType: 'claim_yield', parse: tx => claimYieldParser.processTransaction(tx) },
  { activityType: 'claim_ore', parse: tx => claimOreParser.processTransaction(tx) },
  { activityType: 'claim_sol', parse: tx => claimSolParser.processTransaction(tx) },
  { activityType: 'deposit', parse: tx => depositParser.processTransaction(tx) },
  { activityType: 'withdraw', parse: tx => withdrawParser.processTransaction(tx) },
  { activityType: 'bury', parse: tx => buryParser.processTransaction(tx) },
  { activityType: 'checkpoint', parse: tx => checkpointParser.processTransaction(tx) },
  { activityType: 'deploy', parse: tx => deployParser.processTransaction(tx) },
];

export async function parseRawTransaction(tx: RawTransaction): Promise<ParsedActivity[]> {
  const results: ParsedActivity[] = [];

  for (const parser of PARSERS) {
    const activity = await parser.parse(tx);
    if (activity) {
      results.push({ activityType: parser.activityType, ...activity } as ParsedActivity);
    }
  }

  return results;
}

export async function parseTransactionsBatch(transactions: RawTransaction[]): Promise<ParsedActivity[]> {
  const results: ParsedActivity[] = [];
  for (const tx of transactions) {
    const parsed = await parseRawTransaction(tx);
    if (parsed.length > 0) {
      results.push(...parsed);
    }
  }
  return results;
}
