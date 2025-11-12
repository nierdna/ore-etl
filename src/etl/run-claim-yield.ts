import { MongoManager } from '../database/mongo-manager';
import { ClaimYieldETL } from './claim-yield-etl';
import { logger } from '../utils/logger';

async function main() {
  const mongoManager = new MongoManager();

  try {
    await mongoManager.connect();

    logger.info('='.repeat(50));
    logger.info('Starting Claim Yield ETL');
    logger.info('='.repeat(50));

    const claimYieldETL = new ClaimYieldETL(mongoManager);
    await claimYieldETL.run();

    await mongoManager.disconnect();
    logger.info('Claim Yield ETL completed successfully');
    process.exit(0);
  } catch (error) {
    logger.error('Claim Yield ETL failed', error);
    await mongoManager.disconnect();
    process.exit(1);
  }
}

main();

