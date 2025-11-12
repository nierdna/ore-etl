/**
 * Test parse ORE events - Super simple version
 * Run: node test-events.js
 */

const { MongoClient } = require('mongodb');
const URI = 'mongodb://mongo:SMgVCOWRBjrAJxOvfVdkajdJjvAJRHTr@turntable.proxy.rlwy.net:56417';

async function test() {
  const client = new MongoClient(URI);
  await client.connect();
  const db = client.db('ore');
  
  // 1. Reset Event (Program data)
  console.log('🔄 RESET EVENT:\n');
  const reset = await db.collection('transactions')
    .findOne({ 'parsedData.meta.logMessages': { $regex: 'Program data:' } });
  
  if (reset) {
    const eventLog = reset.parsedData.meta.logMessages
      .find(l => l.startsWith('Program data:'));
    const data = eventLog.replace('Program data: ', '');
    const buf = Buffer.from(data, 'base64');
    
    console.log('Signature:', reset.signature.slice(0, 30) + '...');
    console.log('Data length:', buf.length, 'bytes');
    console.log('Hex:', buf.toString('hex').slice(0, 80) + '...');
    console.log('\nParsed fields:');
    console.log('  Discriminator:', buf.readBigUInt64LE(0));
    console.log('  Round ID:', buf.readBigUInt64LE(8));
    console.log('  Winning Square:', buf.readBigUInt64LE(32));
  }
  
  // 2. Bury Event (from logs)
  console.log('\n\n🔥 BURY EVENT:\n');
  const bury = await db.collection('transactions')
    .findOne({ 'parsedData.meta.logMessages': { $regex: 'Buried' } });
  
  if (bury) {
    const logs = bury.parsedData.meta.logMessages;
    
    console.log('Signature:', bury.signature.slice(0, 30) + '...');
    logs.filter(l => l.includes('📈') || l.includes('💰') || l.includes('🔥'))
      .forEach(l => console.log(' ', l));
    
    // Parse amounts
    const swap = logs.find(l => l.includes('Swapped'));
    if (swap) {
      const [sol, ore] = swap.match(/[\d.]+/g) || [];
      console.log('\n💰 Parsed:');
      console.log('  SOL → ORE:', sol, '→', ore);
    }
  }
  
  await client.close();
  console.log('\n✅ Done!');
}

test();
