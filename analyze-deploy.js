const { MongoClient } = require('mongodb');
const bs58 = require('bs58');

const MONGODB_URI = 'mongodb://mongo:SMgVCOWRBjrAJxOvfVdkajdJjvAJRHTr@turntable.proxy.rlwy.net:56417';
const PROGRAM_ID = 'oreV3EG1i9BEgiAJ8b177Z2S2rMarzak4NMv1kULvWv';

async function analyze() {
  const client = new MongoClient(MONGODB_URI);
  
  try {
    await client.connect();
    const db = client.db('ore');
    
    const tx = await db.collection('transactions').findOne({
      signature: '5xzseU8y6YWH58ASyx6g5jg3QueeENQfMnvDV1PDz8ThmjkzSQKgPdv3keXEeCa2zo6nuNnu31qzPpVnTTzKLuse'
    });
    
    console.log('Transaction logs:');
    const logs = tx.parsedData.meta.logMessages;
    logs.filter(l => l.startsWith('Program log:')).forEach(l => console.log(' ', l));
    
    console.log('\n\nInstructions:');
    const instructions = tx.parsedData.transaction.message.instructions;
    
    for (let i = 0; i < instructions.length; i++) {
      const ix = instructions[i];
      console.log(`\n[${i}] Data: "${ix.data}"`);
      
      if (ix.data && ix.data.length > 0) {
        try {
          const buffer = Buffer.from(ix.data, 'base64');
          console.log(`    Raw bytes: ${buffer.length}`);
          console.log(`    First byte: ${buffer[0]}`);
          console.log(`    Hex: ${buffer.toString('hex').slice(0, 40)}...`);
          
          // Try parse as Deploy (type 6)
          if (buffer.length >= 13 && buffer[0] === 6) {
            const amount = buffer.readBigUInt64LE(1);
            const mask = buffer.readUInt32LE(9);
            
            const squares = [];
            for (let j = 0; j < 25; j++) {
              if (mask & (1 << j)) squares.push(j);
            }
            
            console.log('    ✅ DEPLOY INSTRUCTION FOUND!');
            console.log('    Amount:', Number(amount) / 1e9, 'SOL');
            console.log('    Mask:', mask);
            console.log('    Squares:', squares);
            
            // Parse accounts
            console.log('    Accounts:', ix.accounts.length);
            if (ix.accounts[1] && ix.accounts[1]._bn) {
              const words = ix.accounts[1]._bn.words;
              const buf = Buffer.alloc(32);
              for (let k = 0; k < Math.min(words.length, 8); k++) {
                buf.writeUInt32LE(words[k], k * 4);
              }
              const authority = bs58.encode(buf);
              console.log('    Authority:', authority);
            }
          }
        } catch (err) {
          console.log('    Error parsing:', err.message);
        }
      }
    }
    
    await client.close();
  } catch (error) {
    console.error('Error:', error);
  }
}

analyze();
