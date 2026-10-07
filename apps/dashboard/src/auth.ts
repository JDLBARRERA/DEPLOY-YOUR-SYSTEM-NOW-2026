import { PrismaAdapter } from "@auth/prisma-adapter";
import bcrypt from "bcryptjs";
import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import GitHub from "next-auth/providers/github";
import { authConfig } from "@/auth.config";
import { prisma } from "@/db";
import { githubOAuthCredentials } from "@/lib/github-oauth";
import { ensurePersonalTeam } from "@/lib/teams";

const providers = [];
const github = githubOAuthCredentials();

if (github) {
  providers.push(
    GitHub({
      clientId: github.clientId,
      clientSecret: github.clientSecret,
      allowDangerousEmailAccountLinking: true,
    }),
  );
}

providers.push(
  Credentials({
    credentials: {
      email: { label: "Email", type: "email" },
      password: { label: "Password", type: "password" },
    },
    async authorize(credentials) {
      const email = String(credentials?.email ?? "")
        .toLowerCase()
        .trim();
      const password = String(credentials?.password ?? "");
      if (!email || !password) {
        return null;
      }

      const user = await prisma.user.findUnique({ where: { email } });
      if (!user?.passwordHash) {
        return null;
      }

      const matches = await bcrypt.compare(password, user.passwordHash);
      if (!matches) {
        return null;
      }

      return {
        id: user.id,
        email: user.email,
        name: user.name,
        image: user.image,
        role: user.role,
      };
    },
  }),
);

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  adapter: PrismaAdapter(prisma),
  trustHost: true,
  providers,
  callbacks: {
    ...authConfig.callbacks,
    async jwt({ token, user }) {
      const userId = user?.id ?? token.sub;
      if (!userId) {
        return token;
      }

      token.id = userId;
      if (user || typeof token.teamId !== "string" || token.teamId.length === 0) {
        const row = await prisma.user.findUnique({
          where: { id: userId },
          select: { id: true, role: true, email: true, name: true },
        });
        if (row?.email) {
          token.role = row.role;
          token.teamId = await ensurePersonalTeam(row.id, row.email, row.name);
        }
      }

      return token;
    },
    session({ session, token }) {
      if (session.user) {
        session.user.id = String(token.sub ?? token.id ?? "");
        session.user.role =
          typeof token.role === "string" ? token.role : "member";
        session.user.teamId =
          typeof token.teamId === "string" ? token.teamId : "";
      }
      return session;
    },
  },
  events: {
    async createUser({ user }) {
      if (!user.id || !user.email) {
        return;
      }

      const total = await prisma.user.count();
      if (total === 1) {
        await prisma.user.update({
          where: { id: user.id },
          data: { role: "admin" },
        });
      }

      await ensurePersonalTeam(user.id, user.email, user.name);
    },
  },
});
