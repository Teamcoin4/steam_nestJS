export type ApiError = { code: string; message: string } | null;

export type MeProfileDto = {
  id: number;
  steamId: string;
  personaName: string | null;
  avatar: string | null;
  created_at: string;
  updated_at: string;
};

export type Envelope<T> = {
  data: T | null;
  error: ApiError;
};
