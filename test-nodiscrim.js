const bs58 = require('bs58');

// Test với instruction data từ transaction
const testData = "VzAhkh6ZUfxYGMPtj"; // 12 bytes, first byte = 87
const buffer = Buffer.from(testData, 'base64');

console.log('Testing NO DISCRIMINATOR format:');
console.log('Buffer length:', buffer.length);
console.log('Hex:', buffer.toString('hex'));
console.log();

// Format: [amount:u64][mask:u32] (no discriminator!)
try {
  const amount = buffer.readBigUInt64LE(0); // Read from byte 0
  const mask = buffer.readUInt32LE(8);       // Read from byte 8
  
  console.log('Amount:', amount.toString(), 'lamports');
  console.log('Amount SOL:', Number(amount) / 1e9);
  console.log('Mask:', mask);
  
  const squares = [];
  for (let i = 0; i < 25; i++) {
    if (mask & (1 << i)) squares.push(i);
  }
  
  console.log('Squares:', squares);
  console.log('Num squares:', squares.length);
  
  // Compare với log
  console.log('\n✅ Expected from log: 0.00003 SOL to 10 squares');
  console.log('✅ Parsed:', Number(amount) / 1e9, 'SOL to', squares.length, 'squares');
  
  if (Math.abs(Number(amount) / 1e9 - 0.00003) < 0.000001 && squares.length === 10) {
    console.log('\n🎉 MATCH! Format is [amount:u64][mask:u32] with NO discriminator!');
  }
} catch (err) {
  console.error('Error:', err);
}
