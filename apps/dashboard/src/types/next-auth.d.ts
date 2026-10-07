import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface User {
    role?: string;
    teamId?: string;
  }

  interface Session {
    user: {
      id: string;
      role: string;
      teamId: string;
    } & DefaultSession["user"];
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id?: string;
    role?: string;
    teamId?: string;
  }
}
