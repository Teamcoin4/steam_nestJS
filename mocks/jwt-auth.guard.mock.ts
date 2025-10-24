// test/mocks/jwt-auth.guard.mock.ts
import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import type { Request } from 'express';

interface AuthUserClaims {
  sub: number;
  id: number;
  steamId: string;
  personaName: string;
}

@Injectable()
export class MockJwtAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context
      .switchToHttp()
      .getRequest<Request & { user?: AuthUserClaims }>();
    req.user = {
      sub: 1,
      id: 1,
      steamId: '76561198000000001',
      personaName: 'TestUser1',
    };
    return true;
  }
}
