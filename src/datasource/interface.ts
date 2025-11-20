import { RawTransaction } from '../types/schemas';

export interface TransactionSource {
  /**
   * Connect to the data source
   */
  connect(): Promise<void>;

  /**
   * Disconnect from the data source
   */
  disconnect(): Promise<void>;

  /**
   * Get the min and max slot available in the source
   */
  getSlotRange(): Promise<{ min: number; max: number }>;

  /**
   * Get raw transactions within a slot range (inclusive)
   * @param startSlot Start slot number
   * @param endSlot End slot number
   */
  getTransactions(startSlot: number, endSlot: number): Promise<RawTransaction[]>;
}

