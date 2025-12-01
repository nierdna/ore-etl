import { RawTransaction, DeployActivity, CheckpointActivity, ClaimSOLActivity, ClaimOREActivity, ClaimYieldActivity, DepositActivity, WithdrawActivity, BuryActivity, ResetActivity } from '../types/schemas';
import { MongoManager } from '../database/mongo-manager';
import { logger } from '../utils/logger';
import { DeployETL } from './deploy-etl';
import { CheckpointETL } from './checkpoint-etl';
import { ClaimSOLETL } from './claim-sol-etl';
import { ClaimOREETL } from './claim-ore-etl';
import { ClaimYieldETL } from './claim-yield-etl';
import { DepositETL } from './deposit-etl';
import { WithdrawETL } from './withdraw-etl';
import { BuryETL } from './bury-etl';
import { ResetETL } from './reset-etl';
import { ActivityPublisher } from '../queue/activity-publisher';

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
  | 'bury'
  | 'reset';

export type ParsedActivity =
  | (DeployActivity & ActivityCommon & { activityType: 'deploy' })
  | (CheckpointActivity & ActivityCommon & { activityType: 'checkpoint' })
  | (ClaimSOLActivity & ActivityCommon & { activityType: 'claim_sol' })
  | (ClaimOREActivity & ActivityCommon & { activityType: 'claim_ore' })
  | (ClaimYieldActivity & ActivityCommon & { activityType: 'claim_yield' })
  | (DepositActivity & ActivityCommon & { activityType: 'deposit' })
  | (WithdrawActivity & ActivityCommon & { activityType: 'withdraw' })
  | (BuryActivity & ActivityCommon & { activityType: 'bury' })
  | (ResetActivity & ActivityCommon & { activityType: 'reset' });

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

// Reset parser with caching (needs real mongoManager for roundId extraction)
const resetParser = new ResetETL(stubMongoManager);
const resetParserCache = new Map<MongoManager, ResetETL>();

function getOrCreateResetParser(mongoManager?: MongoManager): ResetETL {
  if (!mongoManager) {
    return resetParser; // Use stub parser for testing
  }

  // Check cache
  if (!resetParserCache.has(mongoManager)) {
    resetParserCache.set(mongoManager, new ResetETL(mongoManager));
  }

  return resetParserCache.get(mongoManager)!;
}

const PARSERS: ParserEntry<any>[] = [
  { activityType: 'claim_yield', parse: tx => claimYieldParser.processTransaction(tx) },
  { activityType: 'claim_ore', parse: tx => claimOreParser.processTransaction(tx) },
  { activityType: 'claim_sol', parse: tx => claimSolParser.processTransaction(tx) },
  { activityType: 'deposit', parse: tx => depositParser.processTransaction(tx) },
  { activityType: 'withdraw', parse: tx => withdrawParser.processTransaction(tx) },
  { activityType: 'bury', parse: tx => buryParser.processTransaction(tx) },
  { activityType: 'checkpoint', parse: tx => checkpointParser.processTransaction(tx) },
  { activityType: 'deploy', parse: tx => deployParser.processTransaction(tx) },
  // Reset is handled specially in parseRawTransaction()
];

export type ActivityParserOptions = {
  mongoManager?: MongoManager;
  activityPublisher?: ActivityPublisher;
};

async function persistParsedActivities(
  mongoManager: MongoManager,
  activities: ParsedActivity[],
  activityPublisher?: ActivityPublisher
): Promise<void> {
  if (activities.length === 0) {
    return;
  }

  try {
    const deploys = activities.filter(
      (activity): activity is Extract<ParsedActivity, { activityType: 'deploy' }> =>
        activity.activityType === 'deploy'
    );
    if (deploys.length > 0) {
      await mongoManager.saveBatch(
        mongoManager.getDeploysCollection(),
        deploys.map(({ activityType, ...rest }) => rest)
      );
    }

    const checkpoints = activities.filter(
      (activity): activity is Extract<ParsedActivity, { activityType: 'checkpoint' }> =>
        activity.activityType === 'checkpoint'
    );
    if (checkpoints.length > 0) {
      await mongoManager.saveBatch(
        mongoManager.getCheckpointsCollection(),
        checkpoints.map(({ activityType, ...rest }) => rest)
      );
    }

    const claimSol = activities.filter(
      (activity): activity is Extract<ParsedActivity, { activityType: 'claim_sol' }> =>
        activity.activityType === 'claim_sol'
    );
    if (claimSol.length > 0) {
      await mongoManager.saveBatch(
        mongoManager.getClaimSOLCollection(),
        claimSol.map(({ activityType, ...rest }) => rest)
      );
    }

    const claimOre = activities.filter(
      (activity): activity is Extract<ParsedActivity, { activityType: 'claim_ore' }> =>
        activity.activityType === 'claim_ore'
    );
    if (claimOre.length > 0) {
      await mongoManager.saveBatch(
        mongoManager.getClaimORECollection(),
        claimOre.map(({ activityType, ...rest }) => rest)
      );
    }

    const claimYield = activities.filter(
      (activity): activity is Extract<ParsedActivity, { activityType: 'claim_yield' }> =>
        activity.activityType === 'claim_yield'
    );
    if (claimYield.length > 0) {
      await mongoManager.saveBatch(
        mongoManager.getClaimYieldsCollection(),
        claimYield.map(({ activityType, ...rest }) => rest)
      );
    }

    const deposits = activities.filter(
      (activity): activity is Extract<ParsedActivity, { activityType: 'deposit' }> =>
        activity.activityType === 'deposit'
    );
    if (deposits.length > 0) {
      await mongoManager.saveBatch(
        mongoManager.getDepositsCollection(),
        deposits.map(({ activityType, ...rest }) => rest)
      );
    }

    const withdraws = activities.filter(
      (activity): activity is Extract<ParsedActivity, { activityType: 'withdraw' }> =>
        activity.activityType === 'withdraw'
    );
    if (withdraws.length > 0) {
      await mongoManager.saveBatch(
        mongoManager.getWithdrawsCollection(),
        withdraws.map(({ activityType, ...rest }) => rest)
      );
    }

    const buries = activities.filter(
      (activity): activity is Extract<ParsedActivity, { activityType: 'bury' }> =>
        activity.activityType === 'bury'
    );
    if (buries.length > 0) {
      await mongoManager.saveBatch(
        mongoManager.getBuryCollection(),
        buries.map(({ activityType, ...rest }) => rest)
      );
    }

    const resets = activities.filter(
      (activity): activity is Extract<ParsedActivity, { activityType: 'reset' }> =>
        activity.activityType === 'reset'
    );
    if (resets.length > 0) {
      await mongoManager.saveBatch(
        mongoManager.getResetsCollection(),
        resets.map(({ activityType, ...rest }) => rest)
      );
    }

    // Publish to RabbitMQ after successful MongoDB save
    if (activityPublisher) {
      for (const activity of activities) {
        await activityPublisher
          .publishActivity(activity.activityType, activity)
          .catch((err) => {
            // Log but don't throw - don't block ETL flow
            logger.error(
              `Failed to publish activity ${activity.activityType} (${activity.signature}):`,
              err
            );
          });
      }
    }
  } catch (error) {
    logger.error('Failed to persist parsed activities', error);
    throw error;
  }
}

export async function parseRawTransaction(
  tx: RawTransaction,
  options: ActivityParserOptions = {}
): Promise<ParsedActivity[]> {
  const results: ParsedActivity[] = [];

  // Parse with standard parsers
  for (const parser of PARSERS) {
    const activity = await parser.parse(tx);
    if (activity) {
      results.push({ activityType: parser.activityType, ...activity } as ParsedActivity);
    }
  }

  // Handle Reset parser with caching (needs real mongoManager for roundId extraction)
  const resetETL = getOrCreateResetParser(options.mongoManager);
  const resetActivity = await resetETL.processTransaction(tx);
  if (resetActivity) {
    results.push({ activityType: 'reset', ...resetActivity } as ParsedActivity);
  }

  if (results.length > 0 && options.mongoManager) {
    await persistParsedActivities(
      options.mongoManager,
      results,
      options.activityPublisher
    );
  }

  return results;
}

export async function parseTransactionsBatch(
  transactions: RawTransaction[],
  options: ActivityParserOptions = {}
): Promise<ParsedActivity[]> {
  const results: ParsedActivity[] = [];
  for (const tx of transactions) {
    const parsed = await parseRawTransaction(tx, options);
    if (parsed.length > 0) {
      results.push(...parsed);
    }
  }
  return results;
}
