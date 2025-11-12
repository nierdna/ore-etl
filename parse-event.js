/**
 * Parse ORE events đơn giản
 * Run: node parse-event.js
 */

const { MongoClient } = require('mongodb');
const URI = 'mongodb://mongo:SMgVCOWRBjrAJxOvfVdkajdJjvAJRHTr@turntable.proxy.rlwy.net:56417';

// Parse Reset Event
function parseResetEvent(base64Data) {
  const buf = Buffer.from(base64Data, 'base64');
  let offset = 0;
  
  const disc = buf.readBigUInt64LE(offset); offset += 8;
  const roundId = buf.readBigUInt64LE(offset); offset += 8;
  const startSlot = buf.readBigUInt64LE(offset); offset += 8;
  const endSlot = buf.readBigUInt64LE(offset); offset += 8;
  const winningSquare = buf.readBigUInt64LE(offset); offset += 8;
  // topMiner: 32 bytes pubkey
  const topMiner = buf.slice(offset, offset + 32).toString('hex'); offset += 32;
  const numWinners = buf.readBigUInt64LE(offset); offset += 8;
  const motherlode = buf.readBigUInt64LE(offset); offset += 8;
  const totalDeployed = buf.readBigUInt64LE(offset); offset += 8;
  const totalVaulted = buf.readBigUInt64LE(offset); offset += 8;
  const totalWinnings = buf.readBigUInt64LE(offset); offset += 8;
  const totalMinted = buf.readBigUInt64LE(offset); offset += 8;
  const ts = buf.readBigInt64LE(offset);
  
  return {
    type: 'Reset',
    roundId: Number(roundId),
    startSlot: Number(startSlot),
    endSlot: Number(endSlot),
    winningSquare: Number(winningSquare),
    numWinners: Number(numWinners),
    motherlode: Number(motherlode) / 1e11,
    totalDeployed: Number(totalDeployed) / 1e9,
    totalVaulted: Number(totalVaulted) / 1e9,
    totalWinnings: Number(totalWinnings) / 1e9,
    totalMinted: Number(totalMinted) / 1e11,
    timestamp: Number(ts),
  };
}

// Parse Bury logs
function parseBuryLogs(logs) {
  const swapped = logs.find(l => l.includes('Swapped'));
  const shared = logs.find(l => l.includes('Shared'));
  const buried = logs.find(l => l.includes('Buried'));
  
  return {
    type: 'Bury',
    solSwapped: swapped?.match(/([\d.]+) SOL/)?.[1],
    oreReceived: swapped?.match(/([\d.]+) ORE/)?.[1],
    oreShared: shared?.match(/([\d.]+) ORE/)?.[1],
    oreBurned: buried?.match(/([\d.]+) ORE/)?.[1],
  };
}

async function main() {
  const client = new MongoClient(URI);
  await client.connect();
  const db = client.db('ore');
  
  // Parse Reset Event
  console.log('🔄 RESET EVENT:\n');
  const resetTx = await db.collection('transactions')
    .findOne({ 'parsedData.meta.logMessages': { $regex: 'Program data:' } });
  
  if (resetTx) {
    const eventLog = resetTx.parsedData.meta.logMessages
      .find(l => l.startsWith('Program data:'));
    const eventData = eventLog.replace('Program data: ', '');
    const parsed = parseResetEvent(eventData);
    
    console.log('Signature:', resetTx.signature);
    console.log('Round ID:', parsed.roundId);
    console.log('Winning Square:', parsed.winningSquare);
    console.log('Num Winners:', parsed.numWinners);
    console.log('Total Deployed:', parsed.totalDeployed.toFixed(4), 'SOL');
    console.log('Total Winnings:', parsed.totalWinnings.toFixed(4), 'SOL');
    console.log('Total Minted:', parsed.totalMinted.toFixed(4), 'ORE');
    if (parsed.motherlode > 0) {
      console.log('🎰 Motherlode:', parsed.motherlode.toFixed(4), 'ORE');
    }
  }
  
  // Parse Bury Event
  console.log('\n\n🔥 BURY EVENT:\n');
  const buryTx = await db.collection('transactions')
    .findOne({ 'parsedData.meta.logMessages': { $regex: 'Buried' } });
  
  if (buryTx) {
    const parsed = parseBuryLogs(buryTx.parsedData.meta.logMessages);
    
    console.log('Signature:', buryTx.signature);
    console.log('SOL Swapped:', parsed.solSwapped, 'SOL');
    console.log('ORE Received:', parsed.oreReceived, 'ORE');
    console.log('ORE Shared (10%):', parsed.oreShared, 'ORE');
    console.log('ORE Burned (90%):', parsed.oreBurned, 'ORE');
  }
  
  await client.close();
  console.log('\n✅ Events parsed successfully!');
}

main();

