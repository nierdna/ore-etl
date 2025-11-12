import { MongoManager } from '../database/mongo-manager';
import { ClaimOREETL } from './claim-ore-etl';
import { logger } from '../utils/logger';

async function main() {
  const mongoManager = new MongoManager();

  try {
    await mongoManager.connect();

    logger.info('='.repeat(50));
    logger.info('Starting Claim ORE ETL');
    logger.info('='.repeat(50));

    const claimOreETL = new ClaimOREETL(mongoManager);
    await claimOreETL.run();

    await mongoManager.disconnect();
    logger.info('Claim ORE ETL completed successfully');
    process.exit(0);
  } catch (error) {
    logger.error('Claim ORE ETL failed', error);
    await mongoManager.disconnect();
    process.exit(1);
  }
}

main();

