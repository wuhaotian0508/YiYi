# Rollback

1. Redeploy the previous Vercel deployment for commit
   `085b09d92dd33e48377018a503a7706b7421d1f9` if the RC fails before data use.
2. Keep live provider routes in mock mode or remove live mode; do not bypass the
   distributed rate-limit fail-closed check.
3. Dexie remains at schema version 6 in this RC. No downgrade migration is needed;
   the previous build reads the same schema. Never delete user IndexedDB as rollback.
4. If a profile/outfit recovery error appears, preserve the database and collect
   sanitized version IDs; use the app reset only on explicit user request.
5. Revert the RC commit as one unit and rebuild from a clean checkout. Do not copy
   `.env.local` into commits or artifacts.
