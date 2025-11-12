import { MongoManager } from '../database/mongo-manager';
import { BuryETL } from './bury-etl';
import { logger } from '../utils/logger';

async function main() {
  const mongoManager = new MongoManager();

  try {
    await mongoManager.connect();

    logger.info('='.repeat(50));
    logger.info('Starting Bury ETL');
    logger.info('='.repeat(50));

    const buryETL = new BuryETL(mongoManager);
    await buryETL.run();

    await mongoManager.disconnect();
    logger.info('Bury ETL completed successfully');
    process.exit(0);
  } catch (error) {
    logger.error('Bury ETL failed', error);
    await mongoManager.disconnect();
    process.exit(1);
  }
}

main();

