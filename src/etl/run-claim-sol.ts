import { MongoManager } from '../database/mongo-manager';
import { ClaimSOLETL } from './claim-sol-etl';
import { logger } from '../utils/logger';

async function main() {
  const mongoManager = new MongoManager();

  try {
    await mongoManager.connect();

    logger.info('='.repeat(50));
    logger.info('Starting Claim SOL ETL');
    logger.info('='.repeat(50));

    const claimSolETL = new ClaimSOLETL(mongoManager);
    await claimSolETL.run();

    await mongoManager.disconnect();
    logger.info('Claim SOL ETL completed successfully');
    process.exit(0);
  } catch (error) {
    logger.error('Claim SOL ETL failed', error);
    await mongoManager.disconnect();
    process.exit(1);
  }
}

main();

