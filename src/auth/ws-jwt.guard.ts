import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Socket, DefaultEventsMap } from 'socket.io';

type JwtPayload = { sub?: number; userId?: number; id?: number };

interface SocketData {
  userId?: number;
}

/** 우리가 접근하는 필드만 명시 (루트 export에 없는 Handshake 타입 사용 X) */
interface SafeHandshake {
  auth?: Record<string, unknown>;
  query?: Record<string, unknown>;
  headers: Record<string, string | string[] | undefined>;
}

/** Socket 제네릭을 명시하고, handshake 타입을 SafeHandshake로 덮어씀 */
type AuthedSocket = Socket<
  DefaultEventsMap,
  DefaultEventsMap,
  DefaultEventsMap,
  SocketData
> & { handshake: SafeHandshake };

@Injectable()
export class WsJwtGuard implements CanActivate {
  constructor(private readonly jwt: JwtService) {}

  canActivate(context: ExecutionContext): boolean {
    const client: AuthedSocket = context.switchToWs().getClient<AuthedSocket>();

    const token =
      (typeof client.handshake.auth?.token === 'string'
        ? client.handshake.auth.token
        : undefined) ??
      (typeof client.handshake.query?.token === 'string'
        ? client.handshake.query.token
        : undefined) ??
      (typeof client.handshake.headers.authorization === 'string'
        ? client.handshake.headers.authorization.replace(/^Bearer\s+/i, '')
        : undefined);

    if (!token) throw new UnauthorizedException('Missing token');

    const payload = this.jwt.verify<JwtPayload>(token);
    const uidRaw = payload.sub ?? payload.userId ?? payload.id;
    const uid = Number(uidRaw);

    if (!Number.isFinite(uid) || uid <= 0) {
      throw new UnauthorizedException('Invalid token payload');
    }

    client.data.userId = uid;

    return true;
  }
}
