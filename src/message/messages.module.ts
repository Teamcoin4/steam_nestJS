import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { Message } from 'src/domain/message/message.entity';
import { MessagesService } from './messages.service';
import { MessagesGateway } from './messages.gateway';
import { MessagesRepository } from 'src/domain/message/message.repository';
import { WsJwtGuard } from 'src/auth/ws-jwt.guard';

@Module({
  imports: [
    TypeOrmModule.forFeature([Message]),
    JwtModule.register({
      secret: process.env.JWT_SECRET!,
      signOptions: { expiresIn: '15m' },
    }),
  ],
  providers: [MessagesService, MessagesRepository, MessagesGateway, WsJwtGuard],
  exports: [MessagesService],
})
export class MessagesModule {}
