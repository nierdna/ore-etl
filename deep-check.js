const { MongoClient } = require('mongodb');
const bs58 = require('bs58');

const MONGODB_URI = 'mongodb://mongo:SMgVCOWRBjrAJxOvfVdkajdJjvAJRHTr@turntable.proxy.rlwy.net:56417';

async function deepCheck() {
  const client = new MongoClient(MONGODB_URI);
  
  try {
    await client.connect();
    const db = client.db('ore');
    
    // Try different deploy transaction
    const tx = await db.collection('transactions').findOne({
      'parsedData.meta.logMessages': { $regex: 'deploying 0.1 SOL' }
    });
    
    if (!tx) {
      console.log('No transaction with 0.1 SOL found, trying another...');
      return;
    }
    
    console.log('Found tx:', tx.signature);
    
    const deployLog = tx.parsedData.meta.logMessages.find(l => l.includes('deploying'));
    console.log('Log:', deployLog);
    
    console.log('\nAll instructions with data:');
    const instructions = tx.parsedData.transaction.message.instructions;
    
    instructions.forEach((ix, idx) => {
      if (ix.data && ix.data !== '' && ix.data.length > 0) {
        try {
          const buffer = Buffer.from(ix.data, 'base64');
          console.log(`\n[${idx}] ${buffer.length} bytes, first byte: ${buffer[0]}`);
          console.log(`    Hex: ${buffer.toString('hex')}`);
          console.log(`    Base64: ${ix.data}`);
          
          // Try all possible instruction types
          if (buffer.length >= 13) {
            // Try reading as Deploy format
            for (let offset = 0; offset < Math.min(buffer.length - 12, 5); offset++) {
              const testType = buffer[offset];
              if (testType === 6) {
                console.log(`    ⭐ Found type 6 at offset ${offset}!`);
              }
            }
            
            // Alternative: maybe no discriminator, just data
            console.log(`    Try as raw Deploy data:`);
            try {
              const amount = buffer.readBigUInt64LE(0);
              const mask = buffer.readUInt32LE(8);
              const squares = [];
              for (let i = 0; i < 25; i++) {
                if (mask & (1 << i)) squares.push(i);
              }
              console.log(`      Amount: ${Number(amount) / 1e9} SOL, Mask: ${mask}, Squares: ${squares.length}`);
            } catch {}
          }
        } catch (err) {
          console.log(`    Error: ${err.message}`);
        }
      }
    });
    
    await client.close();
  } catch (error) {
    console.error('Error:', error);
  }
}

deepCheck();
