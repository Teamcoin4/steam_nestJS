// src/auth/user-id.decorator.ts
import {
  createParamDecorator,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';

interface AuthUser {
  sub?: number | string;
  id?: number | string;
  userId?: number | string;
}

export const UserId = createParamDecorator((_data, ctx: ExecutionContext) => {
  const req = ctx.switchToHttp().getRequest<Request & { user?: AuthUser }>();
  const u = req.user;
  const sub = u?.sub ?? u?.id ?? u?.userId;
  if (!sub) throw new UnauthorizedException('Unauthorized: missing user id');
  return String(sub);
});
