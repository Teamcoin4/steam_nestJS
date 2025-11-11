// src/domain/users/user-summary.entity.ts
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  Index,
  CreateDateColumn,
  UpdateDateColumn,
  OneToOne,
  JoinColumn,
} from 'typeorm';
import { User } from './user.entity';

@Entity('user_summary')
export class UserSummary {
  @PrimaryGeneratedColumn()
  id!: number;

  @Index()
  @Column()
  userId!: number;

  // ✅ 올바른 관계 설정 (UserSummary → User)
  @OneToOne(() => User, (u) => u.summary, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user!: User;

  // ❌ 잘못된 자기참조 제거
  // @OneToOne(() => UserSummary, (summary) => summary.user, { cascade: true })
  // summary?: UserSummary;

  @Column({ default: 0 })
  total_games!: number;

  @Column({ default: 0 })
  total_playtime_minutes!: number;

  @Column({ default: 0 })
  recent_playtime_2weeks_minutes!: number;

  @Column({ type: 'jsonb', nullable: true })
  most_played_game?: {
    gameId: number;
    title: string;
    playtime_forever: number;
    icon?: string;
  };

  @Column({ type: 'timestamptz', nullable: true })
  last_played_at?: Date;

  @Column({ default: 0 })
  achievement_earned!: number;

  @Column({ default: 0 })
  achievement_total!: number;

  @Column({ type: 'float', default: 0 })
  achievement_ratio!: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  created_at!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updated_at!: Date;
}
