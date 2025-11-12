import bs58 from 'bs58';

/**
 * Convert MongoDB BN (BigNumber) representation to Solana Pubkey string
 */
export function bnToPubkey(bn: any): string | null {
  try {
    if (!bn || !bn._bn || !bn._bn.words) return null;
    
    const words = bn._bn.words;
    const buffer = Buffer.alloc(32);
    
    // Convert words array to buffer
    // Each word is a 32-bit integer stored in little-endian
    for (let i = 0; i < words.length && i < 8; i++) {
      buffer.writeUInt32LE(words[i], i * 4);
    }
    
    // Convert to base58 Pubkey string
    return bs58.encode(buffer);
  } catch (error) {
    console.error('Error converting BN to pubkey:', error);
    return null;
  }
}

/**
 * Extract pubkey from account in various formats
 */
export function extractPubkey(account: any): string | null {
  if (!account) return null;
  
  // Already a string
  if (typeof account === 'string') return account;
  
  // Has pubkey field
  if (account.pubkey) {
    if (typeof account.pubkey === 'string') return account.pubkey;
    if (account.pubkey._bn) return bnToPubkey(account.pubkey);
  }
  
  // Direct BN format
  if (account._bn) return bnToPubkey(account);
  
  return null;
}

