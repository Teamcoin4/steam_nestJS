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
  id!: number; // ! 추가

  @Column()
  userId!: number; // ! 추가

  @Column({
    type: 'bigint',
    transformer: {
      to: (value: string) => value,
      from: (value: string) => value,
    },
  })
  friendId!: string; // ! 추가, Steam ID는 string으로 처리

  @Column({ type: 'timestamp', nullable: true })
  friend_since!: Date | null; // ! 추가, nullable이면 | null 추가

  @Column({
    type: 'enum',
    enum: FriendStatus,
    default: FriendStatus.PENDING,
  })
  status!: FriendStatus; // ! 추가

  @CreateDateColumn()
  created_at!: Date; // ! 추가

  @UpdateDateColumn()
  updated_at!: Date; // ! 추가

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'userId' })
  user?: User; // ? 로 optional 처리 (관계는 lazy loading될 수 있음)

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'friendId', referencedColumnName: 'steamId' })
  friend?: User; // ? 로 optional 처리
}
