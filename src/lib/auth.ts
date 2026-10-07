import NextAuth, { CredentialsSignin } from "next-auth";
import Google from "next-auth/providers/google";
import Credentials from "next-auth/providers/credentials";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { db } from "@/lib/db";
import bcrypt from "bcryptjs";
import { isGoogleSignInAllowed, LOGIN_RATE_LIMITS } from "@/lib/auth-policy";
import { clientIpFromHeaders, rateLimit } from "@/lib/rate-limit";

/** Surfaced to the login form as `result.code === "rate_limited"`. */
class RateLimitedSignin extends CredentialsSignin {
  code = "rate_limited";
}

export const { handlers, signIn, signOut, auth } = NextAuth({
  adapter: PrismaAdapter(db),
  session: { strategy: "jwt" },
  pages: {
    signIn: "/login",
    // Show auth errors (e.g. AccessDenied for uninvited Google accounts) on
    // the login page instead of Auth.js's built-in error page.
    error: "/login",
  },
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      // Lets an admin-created (invited) user sign in with Google the first
      // time without an existing Account row. Safe only together with the
      // invite-only signIn callback below (no self-created accounts) and
      // Google's verified-email check.
      allowDangerousEmailAccountLinking: true,
      authorization: {
        params: {
          prompt: "select_account",
        },
      },
    }),
    Credentials({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials, request) {
        if (!credentials?.email || !credentials?.password) return null;

        // Brute-force protection: per email and per client IP.
        const email = String(credentials.email).trim().toLowerCase();
        const ip = request ? clientIpFromHeaders(request.headers) : "unknown";
        const [byEmail, byIp] = await Promise.all([
          rateLimit(`login:email:${email}`, LOGIN_RATE_LIMITS.perEmail),
          rateLimit(`login:ip:${ip}`, LOGIN_RATE_LIMITS.perIp),
        ]);
        if (!byEmail.allowed || !byIp.allowed) {
          console.warn(`[auth] login rate limit hit (${!byEmail.allowed ? "email" : "ip"})`);
          throw new RateLimitedSignin();
        }

        const user = await db.user.findUnique({
          where: { email: credentials.email as string },
        });

        if (!user || !user.hashedPassword) return null;

        const isValid = await bcrypt.compare(
          credentials.password as string,
          user.hashedPassword
        );

        if (!isValid) return null;

        return {
          id: user.id,
          name: user.name,
          email: user.email,
          image: user.image,
        };
      },
    }),
  ],
  callbacks: {
    async signIn({ account, profile }) {
      // Google is invite-only: never create an account on first login.
      if (account?.provider === "google") {
        const allowed = await isGoogleSignInAllowed(
          profile?.email,
          profile?.email_verified as boolean | undefined
        );
        if (!allowed) {
          console.warn("[auth] Google sign-in refused for an email with no portal account");
        }
        return allowed;
      }
      return true;
    },
    async jwt({ token, user }) {
      if (user) {
        // Initial sign-in: populate token with DB data and record login time
        const dbUser = await db.user.findUnique({
          where: { email: user.email! },
          select: { id: true, role: true, hasDistributionAccess: true },
        });
        if (dbUser) {
          token.id = dbUser.id;
          token.role = dbUser.role;
          token.hasDistributionAccess = dbUser.hasDistributionAccess;
          token.lastRefreshed = Date.now();

          await db.user.update({
            where: { id: dbUser.id },
            data: { lastLoginAt: new Date() },
          });
        }
      } else if (token.id) {
        // Subsequent requests: refresh permissions every 5 minutes
        const fiveMinutes = 5 * 60 * 1000;
        const lastRefreshed = (token.lastRefreshed as number) ?? 0;
        if (Date.now() - lastRefreshed > fiveMinutes) {
          const dbUser = await db.user.findUnique({
            where: { id: token.id as string },
            select: { role: true, hasDistributionAccess: true },
          });
          if (dbUser) {
            token.role = dbUser.role;
            token.hasDistributionAccess = dbUser.hasDistributionAccess;
            token.lastRefreshed = Date.now();
          }
        }
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string;
        session.user.role = token.role as string;
        session.user.hasDistributionAccess =
          token.hasDistributionAccess as boolean;
      }
      return session;
    },
  },
});
