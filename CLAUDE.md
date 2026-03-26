@AGENTS.md

# SWM Producer Portal

## Overview
Standalone Next.js portal for Stolen Water Media producers to submit content and manage episode distribution. Replaces WordPress admin forms.

## Tech Stack
- **Framework:** Next.js 16 (App Router, Server Actions)
- **Auth:** NextAuth v5 (Google OAuth + credentials)
- **Database:** PostgreSQL via Prisma 7 with PrismaPg driver adapter
- **UI:** Tailwind v4 + shadcn/ui v4 (uses @base-ui/react, NOT Radix)
- **Rich Text:** Tiptap
- **Hosting:** Railway (planned)

## Key Patterns
- **Prisma 7:** No `url` in schema.prisma datasource — connection configured in `prisma.config.ts` and via PrismaPg adapter in `src/lib/db.ts`
- **Server Actions:** Co-located `actions.ts` files using `(prevState, formData) => Promise<FormState>` pattern with `useActionState`
- **Auth Guards:** `requireAuth()`, `requireAdmin()`, `requireContentTypeAccess(type)` in `src/lib/auth-guard.ts`
- **WordPress:** Write-through to WP REST API. WP is source of truth for content. Portal DB stores user config, credentials, job state, and logs only.
- **shadcn/ui v4:** Components use `@base-ui/react`, not Radix. No `asChild` prop — triggers render children directly.
- **revalidateTag:** Next.js 16 requires 2 args: `revalidateTag("tag", "max")`

## Development
```bash
npm run dev       # Start dev server
npm run build     # Production build
npm test          # Run vitest tests
npx prisma studio # Browse database
npx prisma db seed # Seed dev data
```

## Database
Uses Docker PostgreSQL on port 5434 (container: cairn-postgres). Database: `swm_producer_portal`.

## Project Structure
- `src/lib/wordpress/` — WP REST API client + cache
- `src/components/forms/` — Shared form components (rich text, image input, etc.)
- `src/app/dashboard/` — Producer content forms
- `src/app/admin/` — Admin panel (user management, activity log)
- `prisma/` — Schema and migrations
