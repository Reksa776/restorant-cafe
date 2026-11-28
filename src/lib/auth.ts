import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { headers } from "next/headers";
import { prisma } from "./prisma";
import authConfig from "@/auth.config";
import { authSessionTokenCookie } from "./auth-cookie";
import { authenticateLogin, resolveLoginScope } from "./login-scope";

/**
 * Session cookie (see `authSessionTokenCookie()` in `auth-cookie.ts`): ONE
 * rule for name + scope, shared with `src/auth.config.ts`. A `Domain=` value
 * shares the cookie with `*.<ROOT_DOMAIN>` so an owner can sign in on the root
 * domain and continue on their store subdomain; without one it stays
 * host-only. The cookie is never written twice with different scopes — the
 * per-host claim check in middleware / requireRestaurantContext is what keeps
 * tenants apart.
 */
export const { handlers, signIn, signOut, auth } = NextAuth({
  ...authConfig,
  adapter: PrismaAdapter(prisma),
  session: {
    strategy: "jwt",
  },
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
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) {
          return null;
        }

        // The SAME host policy `POST /api/auth/login` applies — a direct POST
        // to /api/auth/callback/credentials must not bypass subdomain rules.
        let incoming: Headers;
        try {
          incoming = new Headers(await headers());
        } catch {
          incoming = new Headers();
        }

        const outcome = await authenticateLogin({
          email: String(credentials.email),
          password: String(credentials.password),
          scope: resolveLoginScope(incoming),
          headers: incoming,
        });

        if (!outcome.ok) {
          return null;
        }

        return {
          id: outcome.user.id,
          name: outcome.user.name,
          email: outcome.user.email,
          role: outcome.user.role,
          restaurantSlug: outcome.user.restaurantSlug,
          // Carried into the JWT by the jwt callback so the API layer can
          // reject sessions that predate a password change / deactivation.
          sessionVersion: outcome.user.sessionVersion,
        };
      },
    }),
  ],
});
