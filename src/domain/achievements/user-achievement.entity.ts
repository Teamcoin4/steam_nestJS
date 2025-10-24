import {
  Entity,
  PrimaryGeneratedColumn,
  Unique,
  Index,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Achievement } from './achievement.entity';
import { User } from '../users/user.entity';
import { Game } from '../games/game.entity';
@Entity('user_achievement')
@Unique(['userId', 'gameId', 'apiName'])
export class UserAchievement {
  @PrimaryGeneratedColumn() id!: number;
  @Index() @Column() userId!: number;
  @Index() @Column() gameId!: number;
  @Index() @Column() apiName!: string;
  @Column({ default: false }) achieved!: boolean;
  @Column({ type: 'timestamptz', nullable: true }) unlockedAt!: Date | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  created_at!: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updated_at!: Date;

  @ManyToOne(() => Achievement, (achievement) => achievement.userAchievements, {
    onDelete: 'CASCADE',
  })
  @JoinColumn([
    { name: 'apiName', referencedColumnName: 'apiName' },
    { name: 'gameId', referencedColumnName: 'gameId' },
  ])
  achievement!: Achievement;
  @ManyToOne(() => User, (user) => user.userAchievements, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'userId' })
  user!: User;

  @ManyToOne(() => Game, (g) => g.userAchievements, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'gameId', referencedColumnName: 'gameId' })
  game!: Game;
}
