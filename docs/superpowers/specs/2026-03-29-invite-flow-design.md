# Invite Flow Design

Admin-driven invite flow for onboarding producers to the SWM Producer Portal.

## Flow Summary

1. Admin creates user in invite dialog (name, email, role — no password)
2. Admin configures permissions on user edit page (content types, shows, distribution access)
3. Admin clicks "Send Invite" on the edit page
4. Producer receives email with a "Set Your Password" link (+ note about Google sign-in)
5. Producer sets their password and is signed in automatically, or signs in with Google directly

## Data Model

### New Model: InviteToken

```
InviteToken
  id          String    @id @default(cuid())
  userId      String    @unique          // one active invite per user
  token       String    @unique          // crypto.randomBytes, URL-safe
  expiresAt   DateTime                   // 48 hours from creation
  usedAt      DateTime?                  // null until password is set
  createdAt   DateTime  @default(now())

  user        User      @relation(fields: [userId], references: [id], onDelete: Cascade)
```

The `@unique` on `userId` enforces one active invite token per user. Resending replaces the previous token.

### User Model Addition

Add to the existing `User` model:

```
inviteSentAt  DateTime?    // tracks whether an invite has been sent
inviteToken   InviteToken? // relation
```

## Admin UI Changes

### Invite Dialog (simplified)

Remove the temporary password field. Collect only:
- Name (required)
- Email (required)
- Role (producer/admin dropdown)

On submit: creates the user and redirects to their edit page (`/admin/users/[id]`).

### User Edit Page — Invite Section

Add an invite section below the existing permissions controls. Display varies by state:

| State | Display |
|-------|---------|
| Never invited | "Send Invite" button |
| Invited, not accepted | Sent date + "Resend Invite" button |
| Invite accepted | "Accepted on [date]" |
| User signed in via Google (no invite needed) | "Active" — no invite controls |

If the user has no content types assigned when the admin clicks Send Invite, show a warning: "This user has no content types assigned yet. Send anyway?"

### User List Page

Add an invite status indicator to each row: Not Invited, Pending, Accepted, or Active.

## Set Password Page

### Route: `/set-password/[token]` (public)

Unauthenticated route — add to middleware's public paths.

**Token validation:**
- Look up token in `InviteToken` table
- If not found or expired (`expiresAt < now`): show error — "This invite has expired. Contact your admin for a new one."
- If already used (`usedAt` is set): show message — "You've already set up your account." with link to `/login`
- If valid: show password form

**Password form:**
- Password field (min 8 characters)
- Confirm password field
- Submit button

**On submit:**
1. Hash password with bcrypt (salt rounds: 12)
2. Save to `User.hashedPassword`
3. Set `InviteToken.usedAt` to current time
4. Sign the user in automatically via NextAuth credentials
5. Redirect to `/dashboard`

## Invite Email

Sent via existing Resend integration (`notifications@stolenwatermedia.com`).

**Subject:** You're invited to the SWM Producer Portal

**Body:**
- Greeting with the user's name
- One-liner: "You've been set up to submit content on the SWM Producer Portal."
- Primary CTA: "Set Your Password" button/link to `/set-password/[token]`
- Secondary note: "Have a Google account? You can also sign in with Google at [login URL]."
- Expiry notice: "This link expires in 48 hours."

Simple HTML email — no heavy template.

## Edge Cases

**Google sign-in for pre-created user:** Admin creates the user, sends invite. User ignores the set-password link and signs in with Google at `/login`. NextAuth's PrismaAdapter links the Google account to the existing user. The invite token sits unused — no issue.

**Resend invite:** Deletes the existing `InviteToken` for the user, creates a new one with a fresh 48-hour expiry, sends a new email.

**Expired token:** User sees "This invite has expired. Contact your admin for a new one." Admin can resend from the edit page.

**Already-used token:** User sees "You've already set up your account. Sign in here." with link to `/login`.

**No permissions configured:** Admin gets a warning before sending but can proceed. Producer signs in to an empty dashboard. This is the admin's responsibility.

## Technical Notes

- Token generation: `crypto.randomBytes(32).toString('base64url')`
- Password hashing: bcrypt with 12 salt rounds (matches existing implementation)
- Email sending: reuse existing Resend client from `src/lib/notifications.ts`
- Middleware: add `/set-password` to unauthenticated routes in `src/middleware.ts`
- The invite email needs `NEXTAUTH_URL` (or equivalent) to construct absolute links

## Out of Scope

- Password reset flow (separate feature, not needed for launch)
- Email verification for Google users (handled by Google)
- First-login onboarding page (straight to dashboard per decision)
- Self-service sign-up (admin-only user creation)
