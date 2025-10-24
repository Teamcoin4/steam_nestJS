import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ThrottlerModule } from '@nestjs/throttler';
import { FriendsController } from './friends.controller';
import { FriendsService } from './friends.service';
import { Friend } from './friends.entity';
import { User } from '../users/user.entity';
import { OwnedGame } from '../games/owned-game.entity';
import { SteamModule } from '../../integrations/steam/steam.module';
import { AuthModule } from '../../auth/auth.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Friend, User, OwnedGame]),
    SteamModule,
    ThrottlerModule,
    forwardRef(() => AuthModule),
  ],
  controllers: [FriendsController],
  providers: [FriendsService],
  exports: [TypeOrmModule, FriendsService],
})
export class FriendsModule {}
