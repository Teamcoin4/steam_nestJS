import {
  Injectable,
  ExecutionContext,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { Request } from 'express';

type AuthUser = {
  id: number;
  steamId: string;
  personaName?: string | null;
  avatar?: string | null;
};

function isAuthUser(u: unknown): u is AuthUser {
  return (
    !!u &&
    typeof u === 'object' &&
    typeof (u as { id?: unknown }).id === 'number' &&
    typeof (u as { steamId?: unknown }).steamId === 'string'
  );
}

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt-access') {
  private readonly logger = new Logger(JwtAuthGuard.name);

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const ok = (await super.canActivate(context)) as boolean;

    const req = context.switchToHttp().getRequest<Request>();
    const maybeUser: unknown = req?.user;

    if (!isAuthUser(maybeUser)) {
      throw new UnauthorizedException('Invalid JWT user payload');
    }

    const user = maybeUser;
    req.user = user;

    this.logger.debug(`JWT authenticated userId=${user.id}`);

    return ok;
  }
}
