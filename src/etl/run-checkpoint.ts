import { MongoManager } from '../database/mongo-manager';
import { CheckpointETL } from './checkpoint-etl';
import { logger } from '../utils/logger';

async function main() {
  const mongoManager = new MongoManager();

  try {
    await mongoManager.connect();

    const checkpointETL = new CheckpointETL(mongoManager);
    await checkpointETL.run();

    await mongoManager.disconnect();
    logger.info('Checkpoint ETL completed successfully');
    process.exit(0);
  } catch (error) {
    logger.error('Checkpoint ETL failed', error);
    await mongoManager.disconnect();
    process.exit(1);
  }
}

main();

