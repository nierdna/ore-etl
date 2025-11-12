import { MongoManager } from '../database/mongo-manager';
import { DeployETL } from './deploy-etl';
import { CheckpointETL } from './checkpoint-etl';
import { ClaimSOLETL } from './claim-sol-etl';
import { ClaimOREETL } from './claim-ore-etl';
import { DepositETL } from './deposit-etl';
import { WithdrawETL } from './withdraw-etl';
import { ClaimYieldETL } from './claim-yield-etl';
import { BuryETL } from './bury-etl';
import { logger } from '../utils/logger';

async function main() {
  const mongoManager = new MongoManager();

  try {
    await mongoManager.connect();

    // Run Deploy ETL
    logger.info('='.repeat(50));
    logger.info('Starting Deploy ETL');
    logger.info('='.repeat(50));
    const deployETL = new DeployETL(mongoManager);
    await deployETL.run();

    // Run Checkpoint ETL
    logger.info('='.repeat(50));
    logger.info('Starting Checkpoint ETL');
    logger.info('='.repeat(50));
    const checkpointETL = new CheckpointETL(mongoManager);
    await checkpointETL.run();

    // Run Claim SOL ETL
    logger.info('='.repeat(50));
    logger.info('Starting Claim SOL ETL');
    logger.info('='.repeat(50));
    const claimSolETL = new ClaimSOLETL(mongoManager);
    await claimSolETL.run();

    // Run Claim ORE ETL
    logger.info('='.repeat(50));
    logger.info('Starting Claim ORE ETL');
    logger.info('='.repeat(50));
    const claimOreETL = new ClaimOREETL(mongoManager);
    await claimOreETL.run();

    // Run Deposit ETL
    logger.info('='.repeat(50));
    logger.info('Starting Deposit ETL');
    logger.info('='.repeat(50));
    const depositETL = new DepositETL(mongoManager);
    await depositETL.run();

    // Run Withdraw ETL
    logger.info('='.repeat(50));
    logger.info('Starting Withdraw ETL');
    logger.info('='.repeat(50));
    const withdrawETL = new WithdrawETL(mongoManager);
    await withdrawETL.run();

    // Run Claim Yield ETL
    logger.info('='.repeat(50));
    logger.info('Starting Claim Yield ETL');
    logger.info('='.repeat(50));
    const claimYieldETL = new ClaimYieldETL(mongoManager);
    await claimYieldETL.run();

    // Run Bury ETL
    logger.info('='.repeat(50));
    logger.info('Starting Bury ETL');
    logger.info('='.repeat(50));
    const buryETL = new BuryETL(mongoManager);
    await buryETL.run();

    await mongoManager.disconnect();
    logger.info('='.repeat(50));
    logger.info('All ETL processes completed successfully');
    logger.info('='.repeat(50));
    process.exit(0);
  } catch (error) {
    logger.error('ETL failed', error);
    await mongoManager.disconnect();
    process.exit(1);
  }
}

main();

