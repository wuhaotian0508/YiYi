# YiYi Supabase Cloud Sync Design

## Status

Approved by the repository owner on 2026-07-22. This design intentionally
supersedes the local-only persistence and no-cloud-database constraints in
`AGENTS.md` and `YIYI_MASTER_DEVELOPMENT_SPEC.md` for the scope defined here.

## Goal

Add optional Supabase email authentication and private cross-device sync for
wardrobe metadata, preference profiles, daily sessions, and outfit versions.
YiYi remains usable without an account and retains local image blobs only on
the device where they were uploaded.

## Chosen Approach

YiYi will use a local-first model:

- Dexie remains the immediate local cache and offline fallback.
- A signed-in user can opt into Supabase Magic Link authentication from
  Settings.
- Signed-in data is synchronized with Supabase Postgres after successful local
  mutations and when the application starts.
- A user who skips sign-in can continue using YiYi exactly as today.

This avoids blocking the voice-first flow with account creation while giving
signed-in users a safe, private sync path. A forced login would increase
friction, while an anonymous cloud identity cannot reliably restore data on a
new device.

## Scope

### Synced records

The cloud database stores these canonical Zod-validated records:

- wardrobe-item metadata, excluding image binary fields;
- the default preference profile;
- daily sessions;
- outfit versions.

Each record keeps its existing application ID, an owning `user_id`, a JSONB
`data` payload, and an `updated_at` timestamp. `outfit_versions` keeps the
same version/session relationships already used by YiYi's domain schemas.

### Local-only records

`itemImages`, image blobs, masks, thumbnails, processing jobs, and browser
storage settings remain in Dexie. Image bytes never enter Supabase in this
release. A newly signed-in device can therefore recover garment metadata and
history, but requires the user to add images again before visual item features
are available.

## Architecture

### Client configuration and authentication

The application adds `@supabase/supabase-js` and creates a browser client only
when both public environment variables are configured:

```text
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
```

The client enables persistent sessions and PKCE. Settings exposes an optional
email field, sends a Magic Link with a callback URL on the current YiYi origin,
shows connected/disconnected status, and supports sign-out. No Supabase secret
or service-role key is added to client code, the repository, or Vercel.

### Database and authorization

One versioned SQL migration creates `yiyi_wardrobe_items`,
`yiyi_preference_profiles`, `yiyi_daily_sessions`, and
`yiyi_outfit_versions`. Every table enables Row Level Security. Select, insert,
update, and delete policies require `auth.uid() = user_id`, so the browser's
authenticated Supabase session can only access its own records.

Indexes cover the user and update timestamp required for bootstrap and conflict
resolution. The migration is part of the repository, making a new Supabase
project reproducible rather than relying on manual dashboard changes.

### Synchronization

The synchronization layer sits behind focused repository functions rather than
spreading Supabase calls across React components. A write first succeeds in
Dexie. When a session is available, it schedules an upsert to Supabase using
the authenticated user's ID. Remote failures leave local data intact and
surface a recoverable sync status rather than blocking the product.

At sign-in and application bootstrap, cloud records are validated with the
existing Zod schemas before being merged into Dexie. Conflicts use a documented
last-updated-wins rule: the record with the greater `updatedAt` application
timestamp wins; equal timestamps prefer the already-local record. The code
never overwrites a local image record with cloud metadata.

## UI and Product Behavior

Settings is the sole entry point for cloud synchronization. The rest of YiYi
does not add a login gate, text-chat fallback, or alternate recommendation UI.
Visible product copy remains English. The section states that image files stay
on the current device and that signing in syncs wardrobe details, preferences,
and outfit history.

## Deployment

Supabase Auth will have the production YiYi URL as its Site URL and explicit
redirect URLs for the production deployment and local development. Vercel gets
only the two public client variables above in the relevant deployment
environments. After deployment, the real production callback and a cross-
browser data round trip must be tested before claiming sync is live.

## Error Handling

- Missing public configuration: cloud controls report that sync is unavailable;
  local-only YiYi remains fully functional.
- Magic Link request failure: show a concise retryable message without exposing
  provider details.
- Expired or signed-out session: preserve local data and prompt the user to
  reconnect from Settings.
- Invalid remote JSON: reject that record, retain local data, and report a
  safe sync error without logging image, audio, or personal content.
- Network failure: leave local commits intact and retry on the next supported
  synchronization trigger; no automatic retry loop is required for the first
  release.

## Testing and Acceptance

Unit tests cover configuration detection, authentication state mapping,
Zod-validated record serialization, merge precedence, local fallback, and
user-scoped repository calls. UI tests cover the Settings connected,
disconnected, missing-config, and Magic Link request states. Existing tests,
typecheck, lint, and production build must remain green.

The deployment acceptance sequence is:

1. Apply the committed migration to the chosen Supabase project.
2. Configure public variables in Vercel and correct Supabase redirect URLs.
3. Deploy the YiYi Vercel project.
4. Send and complete a Magic Link on the production domain.
5. Create or edit a non-image wardrobe record, preference, and recommendation
   history record; verify that the same account can read them in a separate
   browser context.
6. Verify that a different account receives no rows because RLS denies access.

## Out of Scope

- Supabase Storage and cloud image uploads;
- mandatory accounts;
- sharing, social features, and multi-user wardrobes;
- server-side service-role access;
- realtime collaborative updates;
- changing the deterministic recommendation rules or voice interaction model.
