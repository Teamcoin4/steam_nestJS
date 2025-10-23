// src/types/express.d.ts
declare namespace Express {
  export interface Request {
    cookies?: Record<string, string>;
  }
}
