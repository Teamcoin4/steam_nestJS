import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  Index,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
  ValueTransformer,
} from 'typeorm';
import { OwnedGame } from '../games/owned-game.entity';
import { UserAchievement } from '../achievements/user-achievement.entity';
import { Friend } from '../friends/friends.entity';

const bigintToNumber: ValueTransformer = {
  to: (v: number | null | undefined) =>
    typeof v === 'number' ? v.toString() : (v ?? null),
  from: (v: string | null): number | null => (v == null ? null : Number(v)),
};

@Entity('user')
export class User {
  @PrimaryGeneratedColumn()
  id!: number;

  @Index({ unique: true })
  @Column({ type: 'integer', unique: true, transformer: bigintToNumber })
  steamId!: number;

  @Column({ type: 'varchar', length: 255, nullable: true })
  personaName!: string | null;

  @Column({ type: 'varchar', length: 512, nullable: true })
  avatar!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @OneToMany(() => OwnedGame, (og) => og.user, { cascade: false })
  ownedGames!: OwnedGame[];

  @OneToMany(() => UserAchievement, (ua) => ua.user, { cascade: false })
  userAchievements!: UserAchievement[];

  // Friend.friend / Friend.user 양방향 매핑과 일치
  @OneToMany(() => Friend, (f) => f.user)
  friends?: Friend[];

  @OneToMany(() => Friend, (f) => f.friend)
  friendOf?: Friend[];
}
