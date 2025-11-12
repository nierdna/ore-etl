const { MongoClient } = require('mongodb');

const MONGODB_URI = 'mongodb://mongo:SMgVCOWRBjrAJxOvfVdkajdJjvAJRHTr@turntable.proxy.rlwy.net:56417';

async function checkInstructions() {
  const client = new MongoClient(MONGODB_URI);
  
  try {
    await client.connect();
    const db = client.db('ore');
    
    // Get sample deploy transaction
    const tx = await db.collection('transactions').findOne({
      'parsedData.meta.logMessages': { $regex: 'deploying' }
    });
    
    console.log('Signature:', tx.signature);
    console.log('\nInstructions:');
    
    const instructions = tx.parsedData.transaction.message.instructions;
    instructions.forEach((ix, idx) => {
      if (ix.data) {
        const buffer = Buffer.from(ix.data, 'base64');
        console.log(`\n[${idx}] Type: ${buffer[0]}, Length: ${buffer.length}, Data: ${ix.data.slice(0, 20)}...`);
        
        if (buffer[0] === 6 && buffer.length >= 13) {
          console.log('  ✅ This is Deploy instruction!');
          const amount = buffer.readBigUInt64LE(1);
          const mask = buffer.readUInt32LE(9);
          console.log('  Amount:', Number(amount) / 1e9, 'SOL');
          console.log('  Mask:', mask);
          
          const squares = [];
          for (let i = 0; i < 25; i++) {
            if (mask & (1 << i)) squares.push(i);
          }
          console.log('  Squares:', squares);
        }
      }
    });
    
    await client.close();
  } catch (error) {
    console.error('Error:', error);
  }
}

checkInstructions();
