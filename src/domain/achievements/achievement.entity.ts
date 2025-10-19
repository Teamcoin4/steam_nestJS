import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  Index,
  Unique,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  OneToMany,
  JoinColumn,
} from 'typeorm';
import { Game } from '../games/game.entity';
import { UserAchievement } from './user-achievement.entity';

@Entity('achievement')
@Unique(['gameId', 'apiName'])
export class Achievement {
  @PrimaryGeneratedColumn()
  id!: number;

  @Index()
  @Column()
  gameId!: number;

  // Game <- Achievement (N:1)
  @ManyToOne(() => Game, (game) => game.achievements, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'gameId' })
  game?: Game;

  // Steam 스키마의 apiname
  @Index()
  @Column()
  apiName!: string;

  // 표시용 이름
  @Column()
  displayName!: string;

  // 설명(없을 수 있음)
  @Column({ type: 'text', nullable: true })
  description?: string;

  @Column({ default: false })
  hidden!: boolean;

  @Column({ nullable: true })
  icon?: string;

  @Column({ name: 'icon_gray', nullable: true })
  iconGray?: string;

  // Achievement <- UserAchievement (1:N)
  @OneToMany(() => UserAchievement, (ua) => ua.achievement)
  userAchievements?: UserAchievement[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
