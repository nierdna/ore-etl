const { MongoClient } = require('mongodb');

const MONGODB_URI = 'mongodb://mongo:SMgVCOWRBjrAJxOvfVdkajdJjvAJRHTr@turntable.proxy.rlwy.net:56417';

async function cleanAndPrepare() {
  const client = new MongoClient(MONGODB_URI);
  
  try {
    await client.connect();
    console.log('🔌 Connected to MongoDB\n');
    
    const db = client.db('ore_transformed');
    
    // Check current state
    const currentCount = await db.collection('deploys').countDocuments({});
    console.log(`📊 Current deploys: ${currentCount}`);
    
    // Delete test data
    if (currentCount > 0) {
      const result = await db.collection('deploys').deleteMany({});
      console.log(`🗑️  Deleted ${result.deletedCount} test deploys\n`);
    }
    
    // Reset ETL state
    const stateResult = await db.collection('etl_state').deleteMany({ type: 'deploy' });
    console.log(`🔄 Reset ETL state: ${stateResult.deletedCount} records\n`);
    
    // Verify clean
    const finalCount = await db.collection('deploys').countDocuments({});
    console.log(`✅ Final count: ${finalCount}`);
    console.log('✅ Ready for fresh ETL run!\n');
    
    await client.close();
  } catch (error) {
    console.error('❌ Error:', error);
    await client.close();
    process.exit(1);
  }
}

cleanAndPrepare();
