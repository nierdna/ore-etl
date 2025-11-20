import { MongoManager } from './database/mongo-manager';
import { TransactionTransformer } from './etl/transaction-transformer';
import { MongoTransactionSource } from './datasource/mongo';
import { PostgresTransactionSource } from './datasource/postgres';
import { config } from './config';
import { logger } from './utils/logger';
import { TransactionSource } from './datasource/interface';

async function main() {
  const mongoManager = new MongoManager();

  try {
    await mongoManager.connect();

    // Initialize Data Source based on config
    let transactionSource: TransactionSource;
    if (config.dataSource === 'postgres') {
      logger.info('Using Postgres as transaction source');
      transactionSource = new PostgresTransactionSource();
    } else {
      logger.info('Using Mongo as transaction source');
      transactionSource = new MongoTransactionSource(mongoManager);
    }

    const args = process.argv.slice(2);
    const command = args[0] || 'transform';

    switch (command) {
      case 'transform':
        logger.info(`Running Transaction Transformer (Continuous: ${config.etl.continuousMode})`);
        const transformer = new TransactionTransformer(mongoManager, transactionSource);
        await transformer.run();
        break;
      
      case 'sample':
        logger.info('Running Transaction Transformer Sample');
        const sampleTransformer = new TransactionTransformer(mongoManager, transactionSource);
        await sampleTransformer.runSample(100);
        break;

      default:
        logger.info('Unknown command. Available: transform, sample');
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
