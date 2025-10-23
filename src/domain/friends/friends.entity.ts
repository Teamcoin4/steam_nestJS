import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  Index,
  Unique,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  UpdateDateColumn,
  ValueTransformer,
} from 'typeorm';
import { User } from '../users/user.entity';

export enum FriendStatus {
  PENDING = 'pending',
  ACCEPTED = 'accepted',
  BLOCKED = 'blocked',
}

const bigintToNumber: ValueTransformer = {
  to: (v: number | null | undefined) =>
    typeof v === 'number' ? v.toString() : (v ?? null),
  from: (v: string | null): number | null => (v == null ? null : Number(v)),
};

@Entity('friends')
@Unique(['userId', 'friendSteamId'])
export class Friend {
  @PrimaryGeneratedColumn()
  id!: number;

  @Index()
  @Column({ type: 'int' })
  userId!: number;

  // 스팀 친구의 SteamID64는 문자열로 보관(정밀도 보장)
  @Index()
  @Column({ type: 'varchar', length: 20, name: 'friend_steam_id' })
  friendSteamId!: string;

  // 우리 서비스의 사용자 ID(해당 친구가 가입한 경우에만 채움)
  @Index()
  @Column({ type: 'integer', nullable: true, transformer: bigintToNumber })
  friendId!: number | null;

  @Index()
  @Column({ type: 'varchar', length: 16, default: FriendStatus.ACCEPTED })
  status!: FriendStatus;

  // Steam 친구가 된 시점(선택)
  @Column({ type: 'timestamptz', name: 'friend_since', nullable: true })
  friendSince!: Date | null;

  @ManyToOne(() => User, (u) => u.friends, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId', referencedColumnName: 'id' })
  user!: User;

  // friendId → User.id 매핑(타입 이슈로 FK 제약 비활성)
  @ManyToOne(() => User, (u) => u.friendOf, {
    onDelete: 'CASCADE',
    createForeignKeyConstraints: false,
  })
  @JoinColumn({ name: 'friendId', referencedColumnName: 'id' })
  friend!: User;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt!: Date;
}
