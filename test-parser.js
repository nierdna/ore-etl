/**
 * Test pubkey conversion từ BN format
 */

const bs58 = require('bs58');

function bnToPubkey(bn) {
  try {
    if (!bn || !bn._bn || !bn._bn.words) return null;
    
    const words = bn._bn.words;
    const buffer = Buffer.alloc(32);
    
    // Convert words array to buffer
    for (let i = 0; i < words.length && i < 8; i++) {
      buffer.writeUInt32LE(words[i], i * 4);
    }
    
    return bs58.encode(buffer);
  } catch (error) {
    console.error('Error:', error);
    return null;
  }
}

// Test với sample data từ transaction
const sampleAccount = {
  "_bn": {
    "negative": 0,
    "words": [64516534, 24133206, 51540035, 36527328, 18825788, 35057909, 46552102, 51754101, 60513809, 3985264, 0],
    "length": 10,
    "red": null
  }
};

const pubkey = bnToPubkey(sampleAccount);
console.log('✅ Converted pubkey:', pubkey);

// Test parse instruction data
const testData = "VzAhkh6ZUfxYGMPtj"; // base64 from real transaction

try {
  const buffer = Buffer.from(testData, 'base64');
  console.log('\n📦 Instruction data:');
  console.log('  Length:', buffer.length, 'bytes');
  console.log('  Type:', buffer[0]);
  
  if (buffer.length >= 13 && buffer[0] === 6) {
    const amount = buffer.readBigUInt64LE(1);
    const mask = buffer.readUInt32LE(9);
    
    console.log('  Amount:', amount.toString(), 'lamports');
    console.log('  Amount SOL:', Number(amount) / 1e9);
    console.log('  Mask:', mask);
    
    // Extract squares
    const squares = [];
    for (let i = 0; i < 25; i++) {
      if (mask & (1 << i)) squares.push(i);
    }
    
    console.log('  Squares:', squares);
    console.log('  Num squares:', squares.length);
    console.log('\n✅ Deploy instruction parsed successfully!');
  } else {
    console.log('  ⚠️ Not a Deploy instruction (type', buffer[0], ')');
  }
} catch (err) {
  console.error('❌ Error parsing instruction:', err);
}

