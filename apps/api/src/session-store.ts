import type { AuthSession } from "@diva-drive/domain";

export const readSession = async (accessToken: string): Promise<AuthSession | null> => {
  void accessToken;
  return null;
};

export const writeSession = async (session: AuthSession) => {
  void session;
};
