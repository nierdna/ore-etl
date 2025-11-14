/**
 * Test ResetETL với real database
 * Run: node test-reset-etl-real.js
 */

const { MongoClient } = require('mongodb');
const URI = 'mongodb://mongo:SMgVCOWRBjrAJxOvfVdkajdJjvAJRHTr@turntable.proxy.rlwy.net:56417';

// Load compiled ResetETL
const { ResetETL } = require('./dist/etl/reset-etl');
const { MongoManager } = require('./dist/database/mongo-manager');

async function test() {
  const mongoManager = new MongoManager();
  
  try {
    await mongoManager.connect();
    console.log('✅ Connected to MongoDB\n');
    
    const resetETL = new ResetETL(mongoManager);
    
    // Fetch 3 Reset transactions
    const collection = mongoManager.getRawTransactionsCollection();
    const resetTxs = await collection
      .find({ 'parsedData.meta.logMessages': { $regex: 'var slothash' } })
      .sort({ slot: -1 })
      .limit(3)
      .toArray();
    
    console.log(`Found ${resetTxs.length} Reset transactions\n`);
    console.log('='.repeat(80));
    
    for (let i = 0; i < resetTxs.length; i++) {
      const tx = resetTxs[i];
      console.log(`\n${i + 1}. Processing ${tx.signature.substring(0, 30)}...`);
      
      const result = await resetETL.processTransaction(tx);
      
      if (result) {
        console.log(`   ✅ Parsed successfully:`);
        console.log(`      Round ID: ${result.roundId}`);
        console.log(`      Slot: ${result.slot}`);
        console.log(`      Winning Square: ${result.winningSquare}`);
        console.log(`      Total Minted: ${(result.totalMinted / 1e11).toFixed(4)} ORE`);
        console.log(`      Total Vaulted: ${(result.totalVaulted / 1e9).toFixed(4)} SOL`);
      } else {
        console.log(`   ❌ Failed to parse`);
      }
    }
    
    console.log('\n' + '='.repeat(80));
    console.log('\n✅ Test complete!');
    
    await mongoManager.disconnect();
  } catch (error) {
    console.error('❌ Error:', error.message);
    await mongoManager.disconnect();
    process.exit(1);
  }
}

test();

