
import { PostgresTransactionSource } from './src/datasource/postgres';
import { MongoManager } from './src/database/mongo-manager';
import { config } from './src/config';

async function verifyData() {
  console.log('=== Starting Smart Verification ===');
  
  // 1. Get ETL State to find where we are
  const mongo = new MongoManager();
  await mongo.connect();
  
  const etlState = await mongo.getETLStateCollection().findOne({ type: 'deploy' }); // Check deploy state as reference
  
  if (!etlState) {
    console.log('❌ ETL State not found. ETL might haven\'t run successfully yet.');
    await mongo.disconnect();
    return;
  }
  
  const processedSlot = etlState.lastProcessedSlot;
  console.log(`ETL Last Processed Slot: ${processedSlot}`);
  
  // 2. Query Postgres AT that slot
  console.log('Connecting to Postgres...');
  const pgSource = new PostgresTransactionSource();
  await pgSource.connect();
  
  // Lấy 500 transaction quanh vùng vừa process xong
  // Lùi lại 500 slot để chắc chắn nằm trong vùng an toàn
  const targetSlot = processedSlot - 500; 
  console.log(`Fetching transactions around slot ${targetSlot}...`);
  
  const txs = await pgSource.getTransactions(targetSlot, targetSlot + 100);
  console.log(`Fetched ${txs.length} transactions from Postgres.`);
  
  await pgSource.disconnect();

  // 3. Compare
  console.log(`Checking ${txs.length} signatures against Mongo...`);
  let foundCount = 0;
  
  const collections = {
    'Deploys': mongo.getDeploysCollection(),
    'ClaimORE': mongo.getClaimORECollection(),
    'Checkpoints': mongo.getCheckpointsCollection(),
    'Resets': mongo.getResetsCollection()
  };

  for (const tx of txs) {
    // Skip transactions with error (usually ETL ignores them or stores differently)
    if (tx.err) continue;

    for (const [name, col] of Object.entries(collections)) {
        const doc = await col.findOne({ signature: tx.signature });
        if (doc) {
            console.log(`\n✅ MATCH FOUND!`);
            console.log(`Signature: ${tx.signature}`);
            console.log(`Slot: ${tx.slot}`);
            console.log(`Type: ${name}`);
            console.log(`URL: https://solscan.io/tx/${tx.signature}`);
            foundCount++;
            break;
        }
    }
    if (foundCount >= 3) break;
  }

  if (foundCount === 0) {
    console.log('\n❌ Still no matches. Maybe Parser rejected them or they are other types (deposit, withdraw...).');
  }

  await mongo.disconnect();
  console.log('=== Verification Complete ===');
}

verifyData().catch(console.error);
