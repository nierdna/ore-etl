import { RealtimeListener } from './realtime-listener';
import { logger } from '../utils/logger';

async function main() {
  const listener = new RealtimeListener();

  try {
    await listener.start();
    
    // Keep process running
    logger.info('Press Ctrl+C to stop');
  } catch (error) {
    logger.error('Fatal error in realtime listener', error);
    process.exit(1);
  }
}

main();

