# Phase 1: Foundation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Set up the SWM Producer Portal as a deployable Next.js app with authentication, database schema, and a working dashboard shell.

**Architecture:** Next.js 15 App Router with Server Actions, PostgreSQL via Prisma ORM, NextAuth v5 for Google OAuth + credentials auth. The app serves as a standalone portal that will communicate with a WordPress REST API in later phases.

**Tech Stack:** Next.js 15, TypeScript, NextAuth v5, Prisma, PostgreSQL, Tailwind CSS, shadcn/ui

**Spec:** `../../../website-stolenwatermedia/docs/superpowers/specs/2026-03-26-swm-producer-portal-design.md`

---

## File Structure

```
swm-producer-portal/
├── .env.example
├── .env.local                    (git-ignored, local dev secrets)
├── .gitignore
├── next.config.ts
├── package.json
├── tailwind.config.ts
├── tsconfig.json
├── prisma/
│   ├── schema.prisma             (database schema)
│   └── seed.ts                   (seed script for dev data)
├── src/
│   ├── app/
│   │   ├── layout.tsx            (root layout with providers)
│   │   ├── page.tsx              (redirect to /dashboard)
│   │   ├── login/
│   │   │   └── page.tsx          (login page)
│   │   ├── dashboard/
│   │   │   ├── layout.tsx        (authenticated layout with sidebar)
│   │   │   └── page.tsx          (dashboard home)
│   │   ├── settings/
│   │   │   └── page.tsx          (producer visibility preferences)
│   │   └── api/
│   │       └── auth/
│   │           └── [...nextauth]/
│   │               └── route.ts  (NextAuth route handler)
│   ├── lib/
│   │   ├── auth.ts               (NextAuth configuration)
│   │   ├── auth-guard.ts         (server-side auth helpers)
│   │   ├── db.ts                 (Prisma client singleton)
│   │   └── constants.ts          (content types enum, roles)
│   └── components/
│       ├── sidebar.tsx           (main navigation sidebar)
│       ├── header.tsx            (top header with user menu)
│       ├── providers.tsx         (session provider wrapper)
│       └── ui/                   (shadcn/ui components — installed via CLI)
└── tests/
    ├── lib/
    │   └── constants.test.ts
    └── setup.ts
```

---

### Task 1: Initialize Next.js Project

**Files:**
- Create: `package.json`, `next.config.ts`, `tailwind.config.ts`, `tsconfig.json`, `.gitignore`, `.env.example`

- [ ] **Step 1: Create Next.js app**

```bash
cd /Users/bretkramer/Development/bwk-digital/swm-producer-portal
npx create-next-app@latest . --typescript --tailwind --eslint --app --src-dir --import-alias "@/*" --use-npm --no-turbopack
```

Accept defaults. This scaffolds the project with App Router, TypeScript, Tailwind, and ESLint.

- [ ] **Step 2: Install core dependencies**

```bash
npm install next-auth@beta @prisma/client @auth/prisma-adapter
npm install -D prisma vitest @vitejs/plugin-react jsdom @testing-library/react @testing-library/jest-dom
```

- [ ] **Step 3: Create .env.example**

Create `.env.example` with the required environment variables (no real values):

```env
# Database
DATABASE_URL="postgresql://user:password@localhost:5432/swm_producer_portal"

# NextAuth
NEXTAUTH_URL="http://localhost:3000"
NEXTAUTH_SECRET="generate-with-openssl-rand-base64-32"

# Google OAuth
GOOGLE_CLIENT_ID=""
GOOGLE_CLIENT_SECRET=""

# WordPress
WP_API_URL="https://stolenwatermedia.com/wp-json/wp/v2"
WP_APP_USER=""
WP_APP_PASSWORD=""
```

- [ ] **Step 4: Create vitest config**

Create `vitest.config.ts`:

```typescript
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/**/*.test.{ts,tsx}"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
```

Create `tests/setup.ts`:

```typescript
import "@testing-library/jest-dom/vitest";
```

- [ ] **Step 5: Add test script to package.json**

Add to the `scripts` section of `package.json`:

```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 6: Verify setup**

```bash
npm run build
```

Expected: Build succeeds with no errors.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: initialize Next.js 15 project with TypeScript, Tailwind, Vitest"
```

---

### Task 2: Database Schema with Prisma

**Files:**
- Create: `prisma/schema.prisma`, `src/lib/db.ts`, `src/lib/constants.ts`
- Test: `tests/lib/constants.test.ts`

- [ ] **Step 1: Write the constants module test**

Create `tests/lib/constants.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { ContentType, UserRole, CONTENT_TYPE_LABELS } from "@/lib/constants";

describe("ContentType", () => {
  it("defines all content types", () => {
    expect(ContentType.REVIEW).toBe("review");
    expect(ContentType.TRAILER).toBe("trailer");
    expect(ContentType.APPEARANCE).toBe("appearance");
    expect(ContentType.EPISODE).toBe("episode");
    expect(ContentType.CASE_DOCUMENT).toBe("case_document");
    expect(ContentType.SHOW).toBe("show");
  });

  it("has labels for all content types", () => {
    const types = Object.values(ContentType);
    for (const type of types) {
      expect(CONTENT_TYPE_LABELS[type]).toBeDefined();
      expect(typeof CONTENT_TYPE_LABELS[type]).toBe("string");
    }
  });
});

describe("UserRole", () => {
  it("defines admin and producer roles", () => {
    expect(UserRole.ADMIN).toBe("admin");
    expect(UserRole.PRODUCER).toBe("producer");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- tests/lib/constants.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write the constants module**

Create `src/lib/constants.ts`:

```typescript
export const ContentType = {
  REVIEW: "review",
  TRAILER: "trailer",
  APPEARANCE: "appearance",
  EPISODE: "episode",
  CASE_DOCUMENT: "case_document",
  SHOW: "show",
} as const;

export type ContentTypeValue = (typeof ContentType)[keyof typeof ContentType];

export const CONTENT_TYPE_LABELS: Record<ContentTypeValue, string> = {
  [ContentType.REVIEW]: "Reviews",
  [ContentType.TRAILER]: "Trailers",
  [ContentType.APPEARANCE]: "Appearances",
  [ContentType.EPISODE]: "Episodes",
  [ContentType.CASE_DOCUMENT]: "Case Documents",
  [ContentType.SHOW]: "Shows",
};

export const UserRole = {
  ADMIN: "admin",
  PRODUCER: "producer",
} as const;

export type UserRoleValue = (typeof UserRole)[keyof typeof UserRole];
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm test -- tests/lib/constants.test.ts
```

Expected: PASS.

- [ ] **Step 5: Write Prisma schema**

Create `prisma/schema.prisma`:

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model User {
  id                    String    @id @default(cuid())
  name                  String
  email                 String    @unique
  emailVerified         DateTime?
  hashedPassword        String?
  image                 String?
  role                  String    @default("producer") // "admin" | "producer"
  hasDistributionAccess Boolean   @default(false)
  createdAt             DateTime  @default(now())
  updatedAt             DateTime  @updatedAt

  accounts              Account[]
  sessions              Session[]
  allowedShows          UserShowAccess[]
  allowedContentTypes   UserContentTypeAccess[]
  preferences           UserPreference?
  activityLogs          ActivityLog[]

  @@map("users")
}

model Account {
  id                String  @id @default(cuid())
  userId            String
  type              String
  provider          String
  providerAccountId String
  refresh_token     String? @db.Text
  access_token      String? @db.Text
  expires_at        Int?
  token_type        String?
  scope             String?
  id_token          String? @db.Text
  session_state     String?

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([provider, providerAccountId])
  @@map("accounts")
}

model Session {
  id           String   @id @default(cuid())
  sessionToken String   @unique
  userId       String
  expires      DateTime

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@map("sessions")
}

model VerificationToken {
  identifier String
  token      String   @unique
  expires    DateTime

  @@unique([identifier, token])
  @@map("verification_tokens")
}

model UserShowAccess {
  id       String @id @default(cuid())
  userId   String
  wpShowId Int    // WordPress show post ID

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([userId, wpShowId])
  @@map("user_show_access")
}

model UserContentTypeAccess {
  id          String @id @default(cuid())
  userId      String
  contentType String // matches ContentType values

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([userId, contentType])
  @@map("user_content_type_access")
}

model UserPreference {
  id                  String   @id @default(cuid())
  userId              String   @unique
  visibleContentTypes String[] // subset of allowed content types
  visibleShowIds      Int[]    // subset of allowed show IDs

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@map("user_preferences")
}

model ShowStakeholder {
  id       String @id @default(cuid())
  wpShowId Int
  email    String
  name     String

  @@unique([wpShowId, email])
  @@map("show_stakeholders")
}

model PlatformCredential {
  id             String   @id @default(cuid())
  wpShowId       Int
  platform       String   // "youtube" | "spotify" | "apple" | "transistor" | "podbean" | "patreon"
  credentialType String   // "oauth" | "api_key"
  accessToken    String?  @db.Text
  refreshToken   String?  @db.Text
  apiKey         String?  @db.Text
  tokenExpiresAt DateTime?
  status         String   @default("valid") // "valid" | "expiring_soon" | "expired"
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  @@unique([wpShowId, platform])
  @@map("platform_credentials")
}

model DistributionJob {
  id        String   @id @default(cuid())
  userId    String
  wpShowId  Int
  title     String
  metadata  Json     // episode metadata (description, chapters, tags, etc.)
  status    String   @default("pending") // "pending" | "processing" | "awaiting_review" | "completed" | "failed"
  gcsPath   String?  // Google Cloud Storage path for uploaded file
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  platforms    DistributionJobPlatform[]
  aiSuggestions AiSuggestion[]

  @@map("distribution_jobs")
}

model DistributionJobPlatform {
  id          String    @id @default(cuid())
  jobId       String
  platform    String
  status      String    @default("queued") // "queued" | "uploading" | "processing" | "completed" | "failed"
  error       String?   @db.Text
  externalId  String?   // ID on the external platform (e.g., YouTube video ID)
  externalUrl String?   // URL on the external platform
  completedAt DateTime?

  job DistributionJob @relation(fields: [jobId], references: [id], onDelete: Cascade)

  @@map("distribution_job_platforms")
}

model AiSuggestion {
  id       String  @id @default(cuid())
  jobId    String
  type     String  // "chapters" | "summary" | "blog"
  content  String  @db.Text
  accepted Boolean @default(false)

  job DistributionJob @relation(fields: [jobId], references: [id], onDelete: Cascade)

  @@map("ai_suggestions")
}

model ActivityLog {
  id          String   @id @default(cuid())
  userId      String
  action      String   // "create" | "update" | "distribute"
  contentType String?
  wpPostId    Int?
  wpShowId    Int?
  details     String?  @db.Text
  createdAt   DateTime @default(now())

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@map("activity_logs")
}
```

- [ ] **Step 6: Create Prisma client singleton**

Create `src/lib/db.ts`:

```typescript
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const db = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = db;
}
```

- [ ] **Step 7: Generate Prisma client and create migration**

```bash
npx prisma generate
npx prisma migrate dev --name init
```

Expected: Migration created and applied. Prisma Client generated.

Note: Requires a running PostgreSQL instance. Set `DATABASE_URL` in `.env.local` before running.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: add Prisma schema with full data model and constants"
```

---

### Task 3: NextAuth Configuration

**Files:**
- Create: `src/lib/auth.ts`, `src/app/api/auth/[...nextauth]/route.ts`, `src/lib/auth-guard.ts`

- [ ] **Step 1: Create NextAuth configuration**

Create `src/lib/auth.ts`:

```typescript
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
        const dbUser = await db.user.findUnique({
          where: { email: user.email! },
          select: { id: true, role: true, hasDistributionAccess: true },
        });
        if (dbUser) {
          token.id = dbUser.id;
          token.role = dbUser.role;
          token.hasDistributionAccess = dbUser.hasDistributionAccess;
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
```

- [ ] **Step 2: Install bcryptjs**

```bash
npm install bcryptjs
npm install -D @types/bcryptjs
```

- [ ] **Step 3: Extend NextAuth types**

Create `src/types/next-auth.d.ts`:

```typescript
import "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      name: string;
      email: string;
      image?: string;
      role: string;
      hasDistributionAccess: boolean;
    };
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id: string;
    role: string;
    hasDistributionAccess: boolean;
  }
}
```

- [ ] **Step 4: Create NextAuth route handler**

Create `src/app/api/auth/[...nextauth]/route.ts`:

```typescript
import { handlers } from "@/lib/auth";

export const { GET, POST } = handlers;
```

- [ ] **Step 5: Create auth guard helper**

Create `src/lib/auth-guard.ts`:

```typescript
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";

export async function requireAuth() {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }
  return session;
}

export async function requireAdmin() {
  const session = await requireAuth();
  if (session.user.role !== "admin") {
    redirect("/dashboard");
  }
  return session;
}
```

- [ ] **Step 6: Verify build**

```bash
npm run build
```

Expected: Build succeeds. (Auth won't function without env vars, but it should compile.)

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: configure NextAuth with Google OAuth and credentials providers"
```

---

### Task 4: Session Provider and Root Layout

**Files:**
- Create: `src/components/providers.tsx`
- Modify: `src/app/layout.tsx`

- [ ] **Step 1: Create session provider component**

Create `src/components/providers.tsx`:

```typescript
"use client";

import { SessionProvider } from "next-auth/react";

export function Providers({ children }: { children: React.ReactNode }) {
  return <SessionProvider>{children}</SessionProvider>;
}
```

- [ ] **Step 2: Update root layout**

Replace the contents of `src/app/layout.tsx`:

```typescript
import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { Providers } from "@/components/providers";
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "SWM Producer Portal",
  description: "Content management portal for Stolen Water Media producers",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
```

- [ ] **Step 3: Create root page redirect**

Replace the contents of `src/app/page.tsx`:

```typescript
import { redirect } from "next/navigation";

export default function Home() {
  redirect("/dashboard");
}
```

- [ ] **Step 4: Verify build**

```bash
npm run build
```

Expected: Build succeeds.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: add session provider and root layout"
```

---

### Task 5: Install shadcn/ui and Core Components

**Files:**
- Create: `src/components/ui/*` (via shadcn CLI)

- [ ] **Step 1: Initialize shadcn/ui**

```bash
npx shadcn@latest init -d
```

This sets up the shadcn/ui configuration with defaults (New York style, Zinc color, CSS variables).

- [ ] **Step 2: Install needed components**

```bash
npx shadcn@latest add button card avatar dropdown-menu separator input label
```

- [ ] **Step 3: Verify build**

```bash
npm run build
```

Expected: Build succeeds.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: install shadcn/ui with core components"
```

---

### Task 6: Login Page

**Files:**
- Create: `src/app/login/page.tsx`

- [ ] **Step 1: Create login page**

Create `src/app/login/page.tsx`:

```typescript
"use client";

import { signIn } from "next-auth/react";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleCredentialsLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");

    const result = await signIn("credentials", {
      email,
      password,
      redirect: false,
    });

    if (result?.error) {
      setError("Invalid email or password");
      setLoading(false);
    } else {
      router.push("/dashboard");
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl">SWM Producer Portal</CardTitle>
          <p className="text-sm text-muted-foreground">
            Sign in to manage content
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <Button
            variant="outline"
            className="w-full"
            onClick={() => signIn("google", { callbackUrl: "/dashboard" })}
          >
            <svg className="mr-2 h-4 w-4" viewBox="0 0 24 24">
              <path
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
                fill="#4285F4"
              />
              <path
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                fill="#34A853"
              />
              <path
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                fill="#FBBC05"
              />
              <path
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                fill="#EA4335"
              />
            </svg>
            Continue with Google
          </Button>

          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <Separator />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-background px-2 text-muted-foreground">
                Or
              </span>
            </div>
          </div>

          <form onSubmit={handleCredentialsLogin} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            {error && (
              <p className="text-sm text-red-600">{error}</p>
            )}
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "Signing in..." : "Sign in"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 2: Verify build**

```bash
npm run build
```

Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat: add login page with Google OAuth and credentials"
```

---

### Task 7: Dashboard Layout with Sidebar

**Files:**
- Create: `src/components/sidebar.tsx`, `src/components/header.tsx`, `src/app/dashboard/layout.tsx`, `src/app/dashboard/page.tsx`

- [ ] **Step 1: Create header component**

Create `src/components/header.tsx`:

```typescript
"use client";

import { useSession, signOut } from "next-auth/react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function Header() {
  const { data: session } = useSession();

  const initials = session?.user?.name
    ?.split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase() ?? "?";

  return (
    <header className="flex h-14 items-center justify-between border-b bg-white px-6">
      <h1 className="text-lg font-semibold">SWM Producer Portal</h1>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" className="relative h-8 w-8 rounded-full">
            <Avatar className="h-8 w-8">
              <AvatarImage src={session?.user?.image ?? undefined} />
              <AvatarFallback>{initials}</AvatarFallback>
            </Avatar>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem className="font-medium">
            {session?.user?.name}
          </DropdownMenuItem>
          <DropdownMenuItem className="text-muted-foreground text-xs">
            {session?.user?.email}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => signOut({ callbackUrl: "/login" })}>
            Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  );
}
```

- [ ] **Step 2: Create sidebar component**

Create `src/components/sidebar.tsx`:

```typescript
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import { cn } from "@/lib/utils";
import { ContentType, CONTENT_TYPE_LABELS } from "@/lib/constants";

const CONTENT_TYPE_ICONS: Record<string, string> = {
  [ContentType.REVIEW]: "Star",
  [ContentType.TRAILER]: "Film",
  [ContentType.APPEARANCE]: "MapPin",
  [ContentType.EPISODE]: "Mic",
  [ContentType.CASE_DOCUMENT]: "FileText",
  [ContentType.SHOW]: "Radio",
};

interface SidebarProps {
  visibleContentTypes: string[];
}

export function Sidebar({ visibleContentTypes }: SidebarProps) {
  const pathname = usePathname();
  const { data: session } = useSession();

  const navItems = [
    { label: "Dashboard", href: "/dashboard", alwaysShow: true },
    ...visibleContentTypes.map((type) => ({
      label: CONTENT_TYPE_LABELS[type as keyof typeof CONTENT_TYPE_LABELS] ?? type,
      href: `/dashboard/${type.replace("_", "-")}`,
      alwaysShow: false,
    })),
    ...(session?.user?.hasDistributionAccess
      ? [{ label: "Episode Distribution", href: "/dashboard/distribute", alwaysShow: false }]
      : []),
    { label: "Settings", href: "/settings", alwaysShow: true },
  ];

  const isAdmin = session?.user?.role === "admin";
  if (isAdmin) {
    navItems.push({ label: "Admin", href: "/admin", alwaysShow: true });
  }

  return (
    <aside className="flex w-64 flex-col border-r bg-gray-50">
      <div className="p-4">
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Navigation
        </p>
      </div>
      <nav className="flex-1 space-y-1 px-2">
        {navItems.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "flex items-center rounded-md px-3 py-2 text-sm font-medium transition-colors",
              pathname === item.href
                ? "bg-gray-200 text-gray-900"
                : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
            )}
          >
            {item.label}
          </Link>
        ))}
      </nav>
    </aside>
  );
}
```

- [ ] **Step 3: Create dashboard layout**

Create `src/app/dashboard/layout.tsx`:

```typescript
import { requireAuth } from "@/lib/auth-guard";
import { db } from "@/lib/db";
import { Header } from "@/components/header";
import { Sidebar } from "@/components/sidebar";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await requireAuth();

  // Fetch the user's visible content types
  const user = await db.user.findUnique({
    where: { id: session.user.id },
    include: {
      allowedContentTypes: true,
      preferences: true,
    },
  });

  const allowedTypes = user?.allowedContentTypes.map((ct) => ct.contentType) ?? [];
  const visibleTypes = user?.preferences?.visibleContentTypes ?? allowedTypes;
  // Only show types that are both allowed AND visible
  const effectiveTypes = visibleTypes.filter((t) => allowedTypes.includes(t));

  return (
    <div className="flex h-screen flex-col">
      <Header />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar visibleContentTypes={effectiveTypes} />
        <main className="flex-1 overflow-y-auto p-6">{children}</main>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Create dashboard home page**

Create `src/app/dashboard/page.tsx`:

```typescript
import { requireAuth } from "@/lib/auth-guard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default async function DashboardPage() {
  const session = await requireAuth();

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold">
        Welcome, {session.user.name?.split(" ")[0] ?? "Producer"}
      </h2>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Recent Submissions
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              No submissions yet. Use the sidebar to create content.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Verify build**

```bash
npm run build
```

Expected: Build succeeds.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: add dashboard layout with sidebar and header"
```

---

### Task 8: Producer Settings Page

**Files:**
- Create: `src/app/settings/page.tsx`, `src/app/settings/actions.ts`

- [ ] **Step 1: Create settings server action**

Create `src/app/settings/actions.ts`:

```typescript
"use server";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { revalidatePath } from "next/cache";

export async function updateVisibilityPreferences(formData: FormData) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Not authenticated");

  const visibleContentTypes = formData.getAll("contentTypes") as string[];
  const visibleShowIds = formData
    .getAll("shows")
    .map((id) => parseInt(id as string, 10))
    .filter((id) => !isNaN(id));

  // Verify these are subsets of what the user is allowed
  const user = await db.user.findUnique({
    where: { id: session.user.id },
    include: {
      allowedContentTypes: true,
      allowedShows: true,
    },
  });

  if (!user) throw new Error("User not found");

  const allowedTypes = user.allowedContentTypes.map((ct) => ct.contentType);
  const allowedShowIds = user.allowedShows.map((s) => s.wpShowId);

  const validTypes = visibleContentTypes.filter((t) => allowedTypes.includes(t));
  const validShowIds = visibleShowIds.filter((id) => allowedShowIds.includes(id));

  await db.userPreference.upsert({
    where: { userId: session.user.id },
    update: {
      visibleContentTypes: validTypes,
      visibleShowIds: validShowIds,
    },
    create: {
      userId: session.user.id,
      visibleContentTypes: validTypes,
      visibleShowIds: validShowIds,
    },
  });

  revalidatePath("/dashboard");
  revalidatePath("/settings");
}
```

- [ ] **Step 2: Create settings page**

Create `src/app/settings/page.tsx`:

```typescript
import { requireAuth } from "@/lib/auth-guard";
import { db } from "@/lib/db";
import { CONTENT_TYPE_LABELS } from "@/lib/constants";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { updateVisibilityPreferences } from "./actions";

export default async function SettingsPage() {
  const session = await requireAuth();

  const user = await db.user.findUnique({
    where: { id: session.user.id },
    include: {
      allowedContentTypes: true,
      allowedShows: true,
      preferences: true,
    },
  });

  if (!user) throw new Error("User not found");

  const allowedTypes = user.allowedContentTypes.map((ct) => ct.contentType);
  const visibleTypes = user.preferences?.visibleContentTypes ?? allowedTypes;
  const allowedShowIds = user.allowedShows.map((s) => s.wpShowId);
  const visibleShowIds = user.preferences?.visibleShowIds ?? allowedShowIds;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <h2 className="text-2xl font-bold">Settings</h2>

      <form action={updateVisibilityPreferences}>
        <Card>
          <CardHeader>
            <CardTitle>Dashboard Visibility</CardTitle>
            <p className="text-sm text-muted-foreground">
              Choose which content types appear on your dashboard. You can only
              see types your admin has enabled for you.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <p className="text-sm font-medium">Content Types</p>
              {allowedTypes.map((type) => (
                <label key={type} className="flex items-center space-x-2">
                  <input
                    type="checkbox"
                    name="contentTypes"
                    value={type}
                    defaultChecked={visibleTypes.includes(type)}
                    className="rounded border-gray-300"
                  />
                  <span className="text-sm">
                    {CONTENT_TYPE_LABELS[type as keyof typeof CONTENT_TYPE_LABELS] ?? type}
                  </span>
                </label>
              ))}
              {allowedTypes.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  No content types have been assigned to you yet. Contact your admin.
                </p>
              )}
            </div>

            <div className="space-y-2">
              <p className="text-sm font-medium">Shows</p>
              {allowedShowIds.map((showId) => (
                <label key={showId} className="flex items-center space-x-2">
                  <input
                    type="checkbox"
                    name="shows"
                    value={showId.toString()}
                    defaultChecked={visibleShowIds.includes(showId)}
                    className="rounded border-gray-300"
                  />
                  <span className="text-sm">Show #{showId}</span>
                </label>
              ))}
              {allowedShowIds.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  No shows have been assigned to you yet. Contact your admin.
                </p>
              )}
            </div>

            <Button type="submit">Save Preferences</Button>
          </CardContent>
        </Card>
      </form>
    </div>
  );
}
```

Note: Show names display as "Show #ID" for now. In Phase 2, these will be resolved to actual show names from the WordPress REST API.

- [ ] **Step 3: Verify build**

```bash
npm run build
```

Expected: Build succeeds.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: add producer settings page for visibility preferences"
```

---

### Task 9: Database Seed Script

**Files:**
- Create: `prisma/seed.ts`
- Modify: `package.json` (add prisma seed config)

- [ ] **Step 1: Create seed script**

Create `prisma/seed.ts`:

```typescript
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  // Create admin user
  const adminPassword = await bcrypt.hash("admin123", 10);
  const admin = await prisma.user.upsert({
    where: { email: "bret@bwkdigital.com" },
    update: {},
    create: {
      name: "Bret Kramer",
      email: "bret@bwkdigital.com",
      hashedPassword: adminPassword,
      role: "admin",
      hasDistributionAccess: true,
    },
  });

  // Create a test producer
  const producerPassword = await bcrypt.hash("producer123", 10);
  const producer = await prisma.user.upsert({
    where: { email: "rob@stolenwatermedia.com" },
    update: {},
    create: {
      name: "Rob (Test Producer)",
      email: "rob@stolenwatermedia.com",
      hashedPassword: producerPassword,
      role: "producer",
      hasDistributionAccess: false,
    },
  });

  // Give the producer access to some content types
  const contentTypes = ["review", "trailer", "appearance"];
  for (const ct of contentTypes) {
    await prisma.userContentTypeAccess.upsert({
      where: {
        userId_contentType: { userId: producer.id, contentType: ct },
      },
      update: {},
      create: { userId: producer.id, contentType: ct },
    });
  }

  // Give admin access to all content types
  const allTypes = ["review", "trailer", "appearance", "episode", "case_document", "show"];
  for (const ct of allTypes) {
    await prisma.userContentTypeAccess.upsert({
      where: {
        userId_contentType: { userId: admin.id, contentType: ct },
      },
      update: {},
      create: { userId: admin.id, contentType: ct },
    });
  }

  // Give both users access to a test show (WP show ID 1 as placeholder)
  for (const user of [admin, producer]) {
    await prisma.userShowAccess.upsert({
      where: {
        userId_wpShowId: { userId: user.id, wpShowId: 1 },
      },
      update: {},
      create: { userId: user.id, wpShowId: 1 },
    });
  }

  console.log("Seed complete:");
  console.log(`  Admin: ${admin.email}`);
  console.log(`  Producer: ${producer.email}`);
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
```

- [ ] **Step 2: Add prisma seed config to package.json**

Add to `package.json` at the top level (not inside `scripts`):

```json
"prisma": {
  "seed": "npx tsx prisma/seed.ts"
}
```

Also add tsx as a dev dependency:

```bash
npm install -D tsx
```

- [ ] **Step 3: Run seed**

```bash
npx prisma db seed
```

Expected: Output showing "Seed complete" with both users listed.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: add database seed with admin and test producer"
```

---

### Task 10: Manual Smoke Test

- [ ] **Step 1: Set up .env.local**

Create `.env.local` with real database credentials and a generated NextAuth secret:

```bash
openssl rand -base64 32
```

Use the output as `NEXTAUTH_SECRET`. Google OAuth credentials can be added later — credentials login works without them.

- [ ] **Step 2: Run dev server and test**

```bash
npm run dev
```

Test manually:
1. Visit `http://localhost:3000` — should redirect to `/dashboard`, then to `/login`
2. Sign in with `bret@bwkdigital.com` / `admin123`
3. Should see dashboard with sidebar showing all content types + Admin link
4. Visit `/settings` — should see all content types with checkboxes
5. Sign out, sign in as `rob@stolenwatermedia.com` / `producer123`
6. Should see dashboard with only Reviews, Trailers, Appearances in sidebar — no Admin link

- [ ] **Step 3: Final commit if any fixes were needed**

```bash
git add -A
git commit -m "fix: address issues found in smoke test"
```
