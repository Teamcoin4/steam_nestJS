import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan, FindOptionsWhere } from 'typeorm';
import { Message } from '../domain/message/message.entity';

@Injectable()
export class MessagesService {
  constructor(
    @InjectRepository(Message) private readonly repo: Repository<Message>,
  ) {}

  async create(input: { senderId: number; recipientId: number; text: string }) {
    const msg = this.repo.create({
      senderId: input.senderId,
      recipientId: input.recipientId,
      text: input.text,
    });
    return this.repo.save(msg);
  }

  async findConversationPaged(
    me: number,
    peer: number,
    opts?: { cursor?: Date | null; limit?: number },
  ) {
    const limit = Math.min(Math.max(opts?.limit ?? 30, 1), 100);

    const whereA: FindOptionsWhere<Message> = {
      senderId: me,
      recipientId: peer,
    };
    const whereB: FindOptionsWhere<Message> = {
      senderId: peer,
      recipientId: me,
    };

    if (opts?.cursor) {
      // LessThan<Date>(cursor)는 FindOperator<Date>를 반환하므로 타입 안전
      whereA.createdAt = LessThan(opts.cursor);
      whereB.createdAt = LessThan(opts.cursor);
    }

    const rows = await this.repo.find({
      where: [whereA, whereB],
      order: { createdAt: 'DESC' },
      take: limit,
    });

    const items = rows.reverse(); // ASC로 변환해 반환
    const nextCursor = items.length ? items[0].createdAt : null;

    return { items, nextCursor };
  }

  async findConversation(me: number, peer: number, limit = 50) {
    const where: FindOptionsWhere<Message>[] = [
      { senderId: me, recipientId: peer },
      { senderId: peer, recipientId: me },
    ];
    const rows = this.repo.find({
      where,
      order: { createdAt: 'ASC' },
      take: limit,
    });
    return (await rows).reverse();
  }
}
