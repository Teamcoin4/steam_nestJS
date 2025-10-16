// 오류 담당 서비스

import { Injectable, HttpException, HttpStatus } from '@nestjs/common';

@Injectable()
export class ExceptionService {
  throwUnauthorized(message = '401 토큰 누락/만료') {
    throw new HttpException(message, HttpStatus.UNAUTHORIZED);
  }

  throwSteamLinkRequired(message = '403 Steam 미연동') {
    throw new HttpException(message, HttpStatus.FORBIDDEN);
  }

  throwGameNotFound(message = '404 지원하지 않는/모르는 gameId') {
    throw new HttpException(message, HttpStatus.NOT_FOUND);
  }

  throwAchievementsNotAvailable(
    message = '404 해당 게임이 업적 시스템 미지원',
  ) {
    throw new HttpException(message, HttpStatus.NOT_FOUND);
  }

  throwRateLimited(message = '429 호출 한도 초과') {
    throw new HttpException(message, HttpStatus.TOO_MANY_REQUESTS);
  }

  throwSteamUpstreamError(message = '502 Steam API 오류') {
    throw new HttpException(message, HttpStatus.BAD_GATEWAY);
  }

  throwServiceUnavailable(message = '503 서킷 브레이커/일시 차단') {
    throw new HttpException(message, HttpStatus.SERVICE_UNAVAILABLE);
  }

  throwInternalError(message = '500 일반 서버 오류') {
    throw new HttpException(message, HttpStatus.INTERNAL_SERVER_ERROR);
  }
}
