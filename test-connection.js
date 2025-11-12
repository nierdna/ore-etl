/**
 * Quick test script to verify MongoDB connection and data
 * Run with: node test-connection.js
 */

const { MongoClient } = require('mongodb');

const MONGODB_URI = 'mongodb://mongo:SMgVCOWRBjrAJxOvfVdkajdJjvAJRHTr@turntable.proxy.rlwy.net:56417';
const SOURCE_DB = 'ore';

async function test() {
  console.log('🔌 Testing MongoDB connection...\n');
  
  const client = new MongoClient(MONGODB_URI);
  
  try {
    await client.connect();
    console.log('✅ Connected to MongoDB\n');
    
    const db = client.db(SOURCE_DB);
    
    // Check transactions collection
    const txCount = await db.collection('transactions').countDocuments({});
    console.log(`📊 Total transactions: ${txCount.toLocaleString()}\n`);
    
    // Check deploy transactions
    const deployCount = await db.collection('transactions').countDocuments({
      'parsedData.meta.logMessages': { $regex: 'deploying.*SOL' }
    });
    console.log(`🎯 Deploy transactions: ${deployCount.toLocaleString()}\n`);
    
    // Get recent deploy
    const recentDeploy = await db.collection('transactions').findOne(
      { 'parsedData.meta.logMessages': { $regex: 'deploying' } },
      { sort: { slot: -1 } }
    );
    
    if (recentDeploy) {
      const logs = recentDeploy.parsedData?.meta?.logMessages || [];
      const deployLog = logs.find(l => l.includes('deploying'));
      
      console.log('📝 Recent deploy sample:');
      console.log(`   Signature: ${recentDeploy.signature.slice(0, 20)}...`);
      console.log(`   Slot: ${recentDeploy.slot}`);
      console.log(`   Log: ${deployLog}\n`);
    }
    
    // Check checkpoint transactions
    const checkpointCount = await db.collection('transactions').countDocuments({
      'parsedData.meta.logMessages': { $regex: 'Base rewards' }
    });
    console.log(`💰 Checkpoint transactions: ${checkpointCount.toLocaleString()}\n`);
    
    // Get recent checkpoint
    const recentCheckpoint = await db.collection('transactions').findOne(
      { 'parsedData.meta.logMessages': { $regex: 'Base rewards' } },
      { sort: { slot: -1 } }
    );
    
    if (recentCheckpoint) {
      const logs = recentCheckpoint.parsedData?.meta?.logMessages || [];
      const rewardLogs = logs.filter(l => 
        l.includes('Round ID') || 
        l.includes('rewards') ||
        l.includes('Refunding')
      );
      
      console.log('💰 Recent checkpoint sample:');
      console.log(`   Signature: ${recentCheckpoint.signature.slice(0, 20)}...`);
      console.log(`   Slot: ${recentCheckpoint.slot}`);
      rewardLogs.forEach(log => {
        console.log(`   ${log}`);
      });
      console.log();
    }
    
    console.log('✅ Data verification complete!');
    console.log('✅ ETL pipeline is ready to run!\n');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  } finally {
    await client.close();
  }
}

test();

