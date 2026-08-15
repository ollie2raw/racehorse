import type { Logger } from '../logger';

declare global {
  namespace Express {
    interface Request {
      log: Logger;
    }
  }
}

export {};
