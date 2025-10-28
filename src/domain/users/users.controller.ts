import { Controller, Get, NotFoundException, Query } from '@nestjs/common';
import { UsersService } from './users.service';

@Controller('users') // => /api/v1/users
export class UsersController {
  constructor(private readonly users: UsersService) {}

  // /api/v1/users/resolve?steamId=...  (steamid도 허용)
  @Get('resolve')
  async resolve(
    @Query('steamId') steamId?: string,
    @Query('steamid') steamidAlt?: string,
  ) {
    const sid = steamId ?? steamidAlt;
    if (!sid) throw new NotFoundException('steamId required');

    const user = await this.users.findBySteamId(sid);
    if (!user) throw new NotFoundException('User not found');

    return { data: { userId: user.id } };
  }
}
