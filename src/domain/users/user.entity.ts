import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  Index,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
} from 'typeorm';
import { OwnedGame } from '../games/owned-game.entity';
import { UserAchievement } from '../achievements/user-achievement.entity';
import { Friend } from '../friends/friends.entity';

@Entity()
export class User {
  @PrimaryGeneratedColumn()
  id!: number;

  @Index({ unique: true })
  @Column({
    type: 'bigint',
    unique: true,
    transformer: {
      to: (value: string) => value,
      from: (value: string) => value,
    },
  })
  steamId!: string;

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

  @OneToMany(() => UserAchievement, (UserA) => UserA.user, { cascade: false })
  userAchievements!: UserAchievement[];

  @OneToMany(() => Friend, (friend) => friend.user, { cascade: false })
  friends!: Friend[];

  @OneToMany(() => Friend, (friend) => friend.friend, { cascade: false })
  friendedBy!: Friend[];
}
