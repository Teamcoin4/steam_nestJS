import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from './user.entity';
import { UsersRepository } from './users.repository';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { UserSummary } from './user-summary.entity';
import { UserSummaryRepository } from './user-summary.repository';

@Module({
  imports: [TypeOrmModule.forFeature([User, UserSummary])],
  providers: [UsersRepository, UsersService, UserSummaryRepository],
  controllers: [UsersController],
  exports: [UsersRepository, TypeOrmModule, UserSummaryRepository],
})
export class UsersModule {}
