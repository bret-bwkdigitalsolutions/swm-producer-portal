import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import Credentials from "next-auth/providers/credentials";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { db } from "@/lib/db";
import bcrypt from "bcryptjs";

export const { handlers, signIn, signOut, auth } = NextAuth({
  adapter: PrismaAdapter(db),
  session: { strategy: "jwt" },
  pages: {
    signIn: "/login",
  },
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
    Credentials({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;

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
    async jwt({ token, user }) {
      if (user) {
        // Initial sign-in: populate token with DB data
        const dbUser = await db.user.findUnique({
          where: { email: user.email! },
          select: { id: true, role: true, hasDistributionAccess: true },
        });
        if (dbUser) {
          token.id = dbUser.id;
          token.role = dbUser.role;
          token.hasDistributionAccess = dbUser.hasDistributionAccess;
          token.lastRefreshed = Date.now();
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
