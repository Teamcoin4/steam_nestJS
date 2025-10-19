import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ThrottlerModule } from '@nestjs/throttler'; // 추가
import { FriendsController } from '../../myfriends/friends.controller';
import { FriendsService } from '../../myfriends/friends.service';
import { Friend } from './friends.entity';
import { User } from '../users/user.entity';
import { OwnedGame } from '../games/owned-game.entity';
import { SteamModule } from '../../integrations/steam/steam.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Friend, User, OwnedGame]),
    SteamModule,
    ThrottlerModule, // 추가
  ],
  controllers: [FriendsController],
  providers: [FriendsService],
  exports: [TypeOrmModule, FriendsService],
})
export class FriendsModule {}
