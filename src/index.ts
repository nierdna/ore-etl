import { MongoManager } from './database/mongo-manager';
import { DeployETL } from './etl/deploy-etl';
import { CheckpointETL } from './etl/checkpoint-etl';
import { logger } from './utils/logger';

async function main() {
  const mongoManager = new MongoManager();

  try {
    await mongoManager.connect();

    const args = process.argv.slice(2);
    const command = args[0] || 'all';

    switch (command) {
      case 'deploy':
        logger.info('Running Deploy ETL only');
        const deployETL = new DeployETL(mongoManager);
        await deployETL.run();
        break;

      case 'checkpoint':
        logger.info('Running Checkpoint ETL only');
        const checkpointETL = new CheckpointETL(mongoManager);
        await checkpointETL.run();
        break;

      case 'all':
      default:
        logger.info('Running all ETL processes');
        
        // Run in sequence
        const deployETLAll = new DeployETL(mongoManager);
        await deployETLAll.run();

        const checkpointETLAll = new CheckpointETL(mongoManager);
        await checkpointETLAll.run();

        logger.info('All ETL processes completed');
        break;
    }

    await mongoManager.disconnect();
    process.exit(0);
  } catch (error) {
    logger.error('ETL failed', error);
    await mongoManager.disconnect();
    process.exit(1);
  }
}

main();

