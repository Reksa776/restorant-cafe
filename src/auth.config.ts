import type { NextAuthConfig } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { authSessionTokenCookie } from "@/lib/auth-cookie";

/** Extra claims carried on the Auth.js user/session objects (role + M3). */
interface SessionExtraClaims {
  role?: string;
  sessionVersion?: number;
  /**
   * Slug of the tenant the session was issued for. Middleware (and
   * requireRestaurantContext) compare it with the request's subdomain so a
   * session can never be used on another store's host.
   */
  restaurantSlug?: string;
}

export default {
  pages: {
    signIn: "/login",
  },
  // Same name + domain scope as the Node instance in `src/auth.ts`, so the
  // edge middleware reads exactly the cookie that `signIn` writes.
  cookies: {
    sessionToken: authSessionTokenCookie(),
  },
  providers: [
    Credentials({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize() {
        // authorize() is NOT called in edge/middleware context.
        // It only runs in Node.js runtime (API routes, server actions).
        // Return null here — the real logic lives in auth.ts.
        return null;
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        const extra = user as unknown as SessionExtraClaims;
        token.id = user.id;
        token.role = extra.role;
        // Session version — bumped on password change / deactivation so
        // existing JWTs are invalidated server-side (M3).
        token.sessionVersion = extra.sessionVersion ?? 0;
        token.restaurantSlug = extra.restaurantSlug;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        const extra = session.user as unknown as SessionExtraClaims;
        session.user.id = token.id as string;
        extra.role = token.role as string;
        extra.sessionVersion = token.sessionVersion as number;
        extra.restaurantSlug = token.restaurantSlug as string;
      }
      return session;
    },
  },
} satisfies NextAuthConfig;
