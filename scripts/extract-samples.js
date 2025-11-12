/**
 * Extract sample events from MongoDB for testing
 * Run: node scripts/extract-samples.js
 */

const { MongoClient } = require('mongodb');
const fs = require('fs');
const path = require('path');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://mongo:SMgVCOWRBjrAJxOvfVdkajdJjvAJRHTr@turntable.proxy.rlwy.net:56417';
const SOURCE_DB = 'ore';

async function extractSamples() {
  console.log('🔍 Extracting sample events from MongoDB...\n');
  
  const client = new MongoClient(MONGODB_URI);
  
  try {
    await client.connect();
    const db = client.db(SOURCE_DB);
    const collection = db.collection('transactions');

    const samples = {};

    // 1. Deploy samples
    console.log('📦 Extracting Deploy samples...');
    samples.deploys = await collection
      .find({ 'parsedData.meta.logMessages': { $regex: 'deploying.*SOL' } })
      .limit(5)
      .project({ signature: 1, slot: 1, blockTime: 1, err: 1, parsedData: 1, createdAt: 1 })
      .toArray();
    console.log(`   Found ${samples.deploys.length} samples\n`);

    // 2. Checkpoint samples
    console.log('💰 Extracting Checkpoint samples...');
    samples.checkpoints = await collection
      .find({ 'parsedData.meta.logMessages': { $regex: 'Base rewards' } })
      .limit(5)
      .project({ signature: 1, slot: 1, blockTime: 1, err: 1, parsedData: 1, createdAt: 1 })
      .toArray();
    console.log(`   Found ${samples.checkpoints.length} samples\n`);

    // 3. Claim SOL samples
    console.log('💵 Extracting Claim SOL samples...');
    samples.claims_sol = await collection
      .find({ 'parsedData.meta.logMessages': { $regex: 'Claiming.*SOL$' } })
      .limit(3)
      .project({ signature: 1, slot: 1, blockTime: 1, err: 1, parsedData: 1, createdAt: 1 })
      .toArray();
    console.log(`   Found ${samples.claims_sol.length} samples\n`);

    // 4. Claim ORE samples
    console.log('🪙 Extracting Claim ORE samples...');
    samples.claims_ore = await collection
      .find({ 'parsedData.meta.logMessages': { $regex: 'Claiming.*ORE$' } })
      .limit(3)
      .project({ signature: 1, slot: 1, blockTime: 1, err: 1, parsedData: 1, createdAt: 1 })
      .toArray();
    console.log(`   Found ${samples.claims_ore.length} samples\n`);

    // 5. Claim Yield samples
    console.log('🌾 Extracting Claim Yield samples...');
    samples.claim_yields = await collection
      .find({
        'parsedData.meta.logMessages': { $regex: 'Claiming.*ORE$' },
        'parsedData.transaction.message.instructions': { $elemMatch: { data: 'D' } },
      })
      .limit(3)
      .project({ signature: 1, slot: 1, blockTime: 1, err: 1, parsedData: 1, createdAt: 1 })
      .toArray();
    console.log(`   Found ${samples.claim_yields.length} samples\n`);

    // 6. Deposit samples
    console.log('📥 Extracting Deposit samples...');
    samples.deposits = await collection
      .find({ 'parsedData.meta.logMessages': { $regex: 'Depositing.*ORE' } })
      .limit(3)
      .project({ signature: 1, slot: 1, blockTime: 1, err: 1, parsedData: 1, createdAt: 1 })
      .toArray();
    console.log(`   Found ${samples.deposits.length} samples\n`);

    // 7. Withdraw samples
    console.log('📤 Extracting Withdraw samples...');
    samples.withdraws = await collection
      .find({ 'parsedData.meta.logMessages': { $regex: 'Withdrawing.*ORE' } })
      .limit(3)
      .project({ signature: 1, slot: 1, blockTime: 1, err: 1, parsedData: 1, createdAt: 1 })
      .toArray();
    console.log(`   Found ${samples.withdraws.length} samples\n`);

    // 8. Bury samples
    console.log('🔥 Extracting Bury samples...');
    samples.bury = await collection
      .find({ 'parsedData.meta.logMessages': { $regex: 'Swapped.*SOL' } })
      .limit(3)
      .project({ signature: 1, slot: 1, blockTime: 1, err: 1, parsedData: 1, createdAt: 1 })
      .toArray();
    console.log(`   Found ${samples.bury.length} samples\n`);

    // Save to file
    const outputDir = path.join(__dirname, '..', 'test', 'fixtures');
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const outputFile = path.join(outputDir, 'sample-events.json');
    fs.writeFileSync(outputFile, JSON.stringify(samples, null, 2));

    console.log('✅ Sample events extracted successfully!');
    console.log(`📁 Saved to: ${outputFile}\n`);

    // Summary
    console.log('📊 Summary:');
    console.log(`   Deploys: ${samples.deploys.length}`);
    console.log(`   Checkpoints: ${samples.checkpoints.length}`);
    console.log(`   Claims SOL: ${samples.claims_sol.length}`);
    console.log(`   Claims ORE: ${samples.claims_ore.length}`);
    console.log(`   Claim Yields: ${samples.claim_yields.length}`);
    console.log(`   Deposits: ${samples.deposits.length}`);
    console.log(`   Withdraws: ${samples.withdraws.length}`);
    console.log(`   Bury: ${samples.bury.length}`);
    console.log(`   Total: ${Object.values(samples).reduce((sum, arr) => sum + arr.length, 0)} samples`);

    await client.close();
  } catch (error) {
    console.error('❌ Error:', error);
    await client.close();
    process.exit(1);
  }
}

extractSamples();

