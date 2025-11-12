const { MongoClient } = require('mongodb');

const MONGODB_URI = 'mongodb://mongo:SMgVCOWRBjrAJxOvfVdkajdJjvAJRHTr@turntable.proxy.rlwy.net:56417';

async function check() {
  const client = new MongoClient(MONGODB_URI);
  
  try {
    await client.connect();
    const db = client.db('ore');
    
    // Find a deploy transaction with detailed structure
    const tx = await db.collection('transactions').findOne({
      'parsedData.meta.logMessages': { $regex: 'Round #47267: deploying 0.00003' }
    });
    
    console.log('Logs:', tx.parsedData.meta.logMessages.filter(l => l.includes('deploying')));
    console.log('\nInner instructions:', tx.parsedData.meta.innerInstructions?.length || 0);
    
    // Check program ID match
    console.log('\nLooking for ORE program instructions...');
    const instructions = tx.parsedData.transaction.message.instructions;
    
    // ORE program ID in BN format
    const ORE_PROGRAM_WORDS = [36997443,51088043,57296674,51308169,19650541,32316217,60730106,20807284,37277076,196662,0];
    
    instructions.forEach((ix, idx) => {
      const programWords = ix.programId?._bn?.words;
      if (programWords && JSON.stringify(programWords) === JSON.stringify(ORE_PROGRAM_WORDS)) {
        console.log(`\n[${idx}] ORE Program instruction found!`);
        console.log(`  Data: "${ix.data}"`);
        
        if (ix.data && ix.data.length > 0) {
          const buffer = Buffer.from(ix.data, 'base64');
          console.log(`  Length: ${buffer.length} bytes`);
          console.log(`  First byte: ${buffer[0]}`);
          console.log(`  Hex: ${buffer.toString('hex')}`);
        }
      }
    });
    
    await client.close();
  } catch (error) {
    console.error('Error:', error);
  }
}

check();
