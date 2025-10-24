import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  Index,
  CreateDateColumn,
  UpdateDateColumn,
  Unique,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { User } from './user.entity';

@Entity()
@Unique(['userId', 'friendId'])
export class Friends {
  @PrimaryGeneratedColumn() id!: number;
  @Index() @Column() userId!: number;
  @Index() @Column() friendId!: number;

  @Column({ name: 'friend_since', type: 'timestamptz', nullable: true })
  friendSince!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @ManyToOne(() => User, (user) => user.friends, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user!: User;

  @ManyToOne(() => User, (user) => user.friendOf, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'friendId' })
  friend!: User;
}
