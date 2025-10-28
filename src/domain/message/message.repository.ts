import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Message } from './message.entity';

@Injectable()
export class MessagesRepository {
  constructor(
    @InjectRepository(Message) private readonly repo: Repository<Message>,
  ) {}

  async createMessage(
    senderId: number,
    recipientId: number,
    text: string,
  ): Promise<Message> {
    const message = this.repo.create({ senderId, recipientId, text });
    return this.repo.save(message);
  }

  async findConversation(
    userId: number,
    friendId: number,
    limit = 50,
  ): Promise<Message[]> {
    return this.repo.find({
      where: [
        { senderId: userId, recipientId: friendId },
        { senderId: friendId, recipientId: userId },
      ],
      order: { createdAt: 'DESC' },
      take: limit,
    });
  }
}
