import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
} from '@nestjs/websockets';
import { UseGuards } from '@nestjs/common';
import type { Server as IOServer, Socket as IOSocket } from 'socket.io';
import { MessagesService } from './messages.service';
import { WsJwtGuard } from '../auth/ws-jwt.guard';

type SendPayload = { toUserId: number; text: string };
type HistoryPayload = {
  withUserId: number;
  cursor?: string | number | null;
  limit?: number;
};

type WsMessage = {
  id: number;
  senderId: number;
  recipientId: number;
  text: string;
  createdAt: string; // ISO
};

@WebSocketGateway({
  path: '/socket.io',
  cors: { origin: true, credentials: true },
})
@UseGuards(WsJwtGuard)
export class MessagesGateway implements OnGatewayConnection {
  @WebSocketServer() server!: IOServer;

  constructor(private readonly messages: MessagesService) {}

  private userRoom(userId: number) {
    return `user:${userId}`;
  }

  /** 안전하게 userId 추출 (eslint no-unsafe-*) */
  private getUserIdSafe(sock: IOSocket): number | null {
    // sock.data의 형태를 강제하지 않고, 안전하게 단계적으로 좁힘
    const maybeData: unknown = (sock as unknown as { data?: unknown }).data;
    if (typeof maybeData !== 'object' || maybeData === null) return null;

    const uidUnknown = (maybeData as { userId?: unknown }).userId;
    if (
      typeof uidUnknown === 'number' &&
      Number.isFinite(uidUnknown) &&
      uidUnknown > 0
    ) {
      return uidUnknown;
    }
    if (uidUnknown != null) {
      const n = Number(uidUnknown);
      if (Number.isFinite(n) && n > 0) return n;
    }
    return null;
  }

  handleConnection(client: IOSocket): void {
    const uid = this.getUserIdSafe(client);
    if (!uid) {
      client.disconnect(true);
      return;
    }
    // join은 Promise 반환 → 명시적으로 무시
    void client.join(this.userRoom(uid));
  }

  private emitToUser(userId: number, event: string, payload: unknown) {
    this.server.to(this.userRoom(userId)).emit(event, payload);
  }
  private emitToClient(client: IOSocket, event: string, payload: unknown) {
    client.emit(event, payload);
  }

  @SubscribeMessage('message.send')
  async onSend(
    @ConnectedSocket() client: IOSocket,
    @MessageBody() body: SendPayload,
  ): Promise<void> {
    const meId = this.getUserIdSafe(client);
    if (!meId || !body?.toUserId || !body?.text?.trim()) return;

    const saved = await this.messages.create({
      senderId: meId,
      recipientId: Number(body.toUserId),
      text: body.text.trim(),
    });

    const out: WsMessage = {
      id: saved.id,
      senderId: saved.senderId,
      recipientId: saved.recipientId,
      text: saved.text,
      createdAt: saved.createdAt.toISOString(),
    };

    this.emitToClient(client, 'message.sent', out);
    this.emitToUser(saved.recipientId, 'message.receive', out);
  }

  @SubscribeMessage('message.history')
  async onHistory(
    @ConnectedSocket() client: IOSocket,
    @MessageBody() body: HistoryPayload,
  ): Promise<void> {
    const meId = this.getUserIdSafe(client);
    const peerId = Number(body?.withUserId);
    if (!meId || !peerId) return;

    const cursorDate =
      body?.cursor != null
        ? new Date(
            typeof body.cursor === 'number' ? body.cursor : String(body.cursor),
          )
        : null;

    const { items } = await this.messages.findConversationPaged(meId, peerId, {
      cursor: cursorDate ?? undefined,
      limit: body?.limit ?? 50,
    });

    const payload: WsMessage[] = items.map((m) => ({
      id: m.id,
      senderId: m.senderId,
      recipientId: m.recipientId,
      text: m.text,
      createdAt: m.createdAt.toISOString(),
    }));

    this.emitToClient(client, 'message.history.result', payload);
  }
}
