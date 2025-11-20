
import { PostgresTransactionSource } from './src/datasource/postgres';
import { MongoManager } from './src/database/mongo-manager';
import { parseRawTransaction } from './src/etl/activity-parser';
import { RawTransaction } from './src/types/schemas';
import { logger } from './src/utils/logger';

// Tắt logger info bình thường để dễ nhìn
logger.info = () => logger; 

async function debugSingleTx() {
  const targetSignature = '5MgHc62UnJG2i6irobwGHNtpmYuuqNV8ARGLA5h9NQDH672vuc4EhVHHpxfQXUbLeTsU9zYofuTknbWAqvsCQDW6';
  const targetSlot = 381281426;

  console.log(`=== Debugging Transaction: ${targetSignature} ===`);

  // 1. Fetch from Postgres
  console.log('Fetching from Postgres...');
  const pgSource = new PostgresTransactionSource();
  await pgSource.connect();

  // Fetch range bao quanh slot mục tiêu
  const txs = await pgSource.getTransactions(targetSlot, targetSlot);
  await pgSource.disconnect();

  const tx = txs.find(t => t.signature === targetSignature);

  if (!tx) {
    console.error('❌ Transaction not found in Postgres at specified slot.');
    return;
  }

  console.log('✅ Found transaction in Postgres.');
  // console.log('Raw Data:', JSON.stringify(tx.parsedData, null, 2).substring(0, 500) + '...');

  // 2. Parse & Persist to Mongo
  console.log('Connecting to Mongo...');
  const mongo = new MongoManager();
  await mongo.connect();

  console.log('Parsing transaction...');
  try {
    const parsed = await parseRawTransaction(tx, { mongoManager: mongo });
    
    console.log(`Parsed ${parsed.length} activities.`);
    parsed.forEach(act => {
        console.log(`- Type: ${act.activityType}`);
        if (act.activityType === 'reset') {
            console.log('  -> Reset Activity Details:', JSON.stringify(act, null, 2));
        }
    });

  } catch (error) {
    console.error('❌ Error during parsing/persisting:', error);
  }

  await mongo.disconnect();
}

debugSingleTx();

