import type { NextAuthConfig } from "next-auth";

export const authConfig = {
  pages: {
    signIn: "/login",
  },
  session: {
    strategy: "jwt",
    maxAge: 30 * 24 * 60 * 60,
  },
  providers: [],
  callbacks: {
    authorized({ auth, request }) {
      const path = request.nextUrl.pathname;
      const loggedIn = !!auth?.user;
      const panel = new URL("/", request.nextUrl);

      if (path.startsWith("/api/auth")) {
        return true;
      }

      const authPage = path.startsWith("/login") || path.startsWith("/register");
      if (authPage) {
        if (loggedIn) {
          return Response.redirect(panel);
        }
        return true;
      }

      const panelAlias = ["/dashboard", "/projects", "/databases", "/deployments"].some(
        (route) => path === route || path.startsWith(`${route}/`),
      );
      if (panelAlias) {
        if (!loggedIn) {
          return false;
        }
        return Response.redirect(panel);
      }

      return loggedIn;
    },
    jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.role = user.role;
      }
      return token;
    },
    session({ session, token }) {
      if (session.user) {
        session.user.id = String(token.sub ?? "");
        session.user.role =
          typeof token.role === "string" ? token.role : "member";
        session.user.teamId =
          typeof token.teamId === "string" ? token.teamId : "";
      }
      return session;
    },
  },
} satisfies NextAuthConfig;
