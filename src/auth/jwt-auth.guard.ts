import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt-access') {
  validate(payload: any) {
    console.log('[JWT validate payload]', payload);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return
    return payload;
  }
}
