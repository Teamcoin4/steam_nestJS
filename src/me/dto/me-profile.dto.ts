export type ApiError = { code: string; message: string } | null;

export type MeProfileDto = {
  id: number;
  steamId: number;
  personaName: string | null;
  avatar: string | null;
  createdAt: string;
  updatedAt: string;
};

export type Envelope<T> = {
  data: T | null;
  error: ApiError;
};
