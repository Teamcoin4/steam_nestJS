// userDTO

export class UserDto {
  id!: number;
  steamid!: string;
  personaName?: string;
  avatar?: string;
  created_at!: Date;
  updated_at!: Date;
}
