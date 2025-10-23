import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { User } from '../users/user.entity';

export enum FriendStatus {
  PENDING = 'pending',
  ACCEPTED = 'accepted',
  BLOCKED = 'blocked',
}

@Entity('friends')
export class Friend {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column()
  userId!: number;

  @Column({
    type: 'varchar', // BIGINT에서 VARCHAR로 변경
    // transformer 로직 제거 (이제 데이터베이스와 타입이 일치하므로 필요 없음)
  })
  friendId!: string; // Steam ID는 string으로 처리

  @Column({ type: 'timestamp', nullable: true })
  friend_since!: Date | null; // nullable이면 | null 추가

  @Column({
    type: 'enum',
    enum: FriendStatus,
    default: FriendStatus.PENDING,
  })
  status!: FriendStatus;

  @CreateDateColumn()
  created_at!: Date;

  @UpdateDateColumn()
  updated_at!: Date;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'userId' })
  user?: User; // ? 로 optional 처리 (관계는 lazy loading될 수 있음)

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'friendId', referencedColumnName: 'steamId' })
  friend?: User; // ? 로 optional 처리
}
