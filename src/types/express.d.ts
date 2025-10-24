// src/types/express.d.ts
import 'express';

declare module 'express-serve-static-core' {
  interface Request {
    user?: {
      id: number;
      steamId: string;
      personaName?: string | null;
      avatar?: string | null;
    };
  }
}

declare namespace Express {
  export interface Request {
    cookies?: Record<string, string>;
  }
}
