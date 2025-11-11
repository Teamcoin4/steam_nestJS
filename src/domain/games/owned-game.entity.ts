import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  Unique,
  Index,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { User } from '../users/user.entity';
import { Game } from './game.entity';

@Entity()
@Unique(['userId', 'gameId'])
export class OwnedGame {
  @PrimaryGeneratedColumn() id!: number;
  @Index()
  @Column()
  userId!: number;
  @Index() @Column() gameId!: number;
  @Column({ default: 0 }) playtimeForever!: number;
  @Column({ default: 0 }) playtime2Weeks!: number;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  created_at!: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updated_at!: Date;
  @Column({
    type: 'timestamptz',
    nullable: true,
    name: 'last_played_at',
    update: false,
  })
  lastPlayedAt!: Date | null;
  @Column({ default: false }) installed!: boolean;
  @Column({ default: false }) hidden!: boolean;

  @Column({
    type: 'timestamptz',
    nullable: true,
    name: 'added_at',
    default: () => 'NOW()',
  })
  addedAt!: Date | null;

  @ManyToOne(() => User, (user) => user.ownedGames, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user!: User;

  @ManyToOne(() => Game, (game) => game.ownedGames, {
    onDelete: 'CASCADE',
    eager: true,
  })
  @JoinColumn({ name: 'gameId' })
  game!: Game;
}
