import { keccak256 } from 'js-sha3';
import bs58 from 'bs58';

/**
 * Generate random mask for squares selection
 * Port of Rust generate_random_mask() function from deploy.rs
 * 
 * @param numSquares Number of squares to select (1-25)
 * @param hashBytes 32-byte hash buffer (keccak256 result)
 * @returns Array of square indices [0-24] that were selected
 */
export function generateRandomMask(numSquares: number, hashBytes: Buffer): number[] {
  const squares: number[] = [];
  let selected = 0;

  for (let i = 0; i < 25; i++) {
    const randByte = hashBytes[i];
    const remainingNeeded = numSquares - selected;
    const remainingPositions = 25 - i;

    if (remainingNeeded > 0 && 
        randByte * remainingPositions < remainingNeeded * 256) {
      squares.push(i);
      selected++;
    }
  }

  return squares;
}

/**
 * Reconstruct squares for automation transactions with Random strategy
 * Matches the logic in deploy.rs: AutomationStrategy::Random
 * 
 * Algorithm:
 * 1. Decode authority from base58 to 32-byte buffer
 * 2. Convert roundId to 8-byte little-endian buffer
 * 3. Concatenate: authority_bytes + roundId_bytes
 * 4. Hash with keccak256 (matches Solana's hashv)
 * 5. Generate random mask from hash
 * 
 * @param authority Automation authority pubkey (base58 string)
 * @param roundId Round ID (u64)
 * @param numSquares Number of squares to deploy to (from automation.mask & 0xFF)
 * @returns Array of square indices [0-24] that were selected
 */
export function reconstructSquaresForAutomation(
  authority: string,
  roundId: number,
  numSquares: number
): number[] {
  // Decode authority from base58 to bytes (32 bytes)
  let authorityBytes: Buffer;
  try {
    authorityBytes = Buffer.from(bs58.decode(authority));
  } catch (error) {
    throw new Error(`Invalid authority format: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
  
  if (authorityBytes.length !== 32) {
    throw new Error(`Invalid authority length: expected 32 bytes, got ${authorityBytes.length}`);
  }

  // Convert roundId to 8-byte little-endian buffer
  const roundIdBytes = Buffer.alloc(8);
  roundIdBytes.writeBigUInt64LE(BigInt(roundId), 0);

  // Concatenate: authority_bytes + roundId_bytes
  const combined = Buffer.concat([authorityBytes, roundIdBytes]);

  // Hash with keccak256 (matches Solana's hashv)
  const hashHex = keccak256(combined);
  const hashBytes = Buffer.from(hashHex, 'hex');

  // Generate random mask from hash
  return generateRandomMask(numSquares, hashBytes);
}

