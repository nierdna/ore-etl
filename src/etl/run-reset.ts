import { MongoManager } from '../database/mongo-manager';
import { ResetETL } from './reset-etl';
import { logger } from '../utils/logger';

async function main() {
  const mongoManager = new MongoManager();

  try {
    logger.info('Connecting to MongoDB...');
    await mongoManager.connect();

    const resetETL = new ResetETL(mongoManager);
    await resetETL.run();

    logger.info('Reset ETL completed successfully');
  } catch (error) {
    logger.error('Reset ETL failed', error);
    process.exit(1);
  } finally {
    await mongoManager.disconnect();
  }
}

main();

