# Preview preparation status — 2026-11-22

## Completed

- Local branch: `cursor/daily-report-media-preview`. Existing mixed WIP stash preserved.
- Neon project: `dawn-dew-35301522` (`ta-rabo-works`).
- Created schema-only test branch `preview-daily-report-media`, ID `br-proud-bird-ao53b772`.
- Compute `ep-raspy-night-aokjpuuz`: fixed 0.25 CU, suspend after 300 idle seconds.
- Before seed, verified `students=0`, `daily_reports=0`.
- Applied `2026-11-daily-report-media.sql`, including deletion claim token, only to this test branch.
- Applied fictional seed: three users, two reports. No production rows copied.
- Re-ran local media unit/memory integration, Preview configuration, and auth session scripts successfully.
- Added `scripts/verify-daily-report-media-neon.mjs`: explicitly gated by expected test hostname and a separate credential file. Real Neon / mocked Blob checks passed (4): actual report creation with attachment, rollback of report and attachment, attachment winning against purge, deletion winning followed by attachment conflict and report rollback. Test-created rows cleaned up.

## Blocker and remaining work

Vercel CLI initially returned the signed-in user, but subsequent commands failed. After granting access to the CLI credential directory, `vercel whoami` returned: "The specified token is not valid. Use vercel login to generate a new token." User was asked to log in again. The connector independently lacks access to the `ta-rabo` team.

The attempted private Blob creation failed at user authentication; no successful Blob creation confirmed. Re-list stores after login before retrying, to avoid duplicates.

- Preview environment overrides have NOT been written.
- No commit, push, or deployment performed.
- Production configuration and database unchanged.
- Real Blob, Vercel raw request handling, browser OAuth/access controls, session switching and smartphone tests remain unverified.
- Next: recheck CLI login and stores, create isolated private Blob, set branch-scoped Preview DB/JWT/config overrides, verify separation before push. Complete real HTTP and browser tests afterward.

## Costs

Neon Launch is usage-billed; creation of this test resource may incur compute/storage costs. Compute is minimized and auto-suspends, but storage remains. Actual current invoice/usage amount remains unverified. No provider spending cap was configured. Production compute settings were not changed.

Connection credentials are stored outside Git in a restricted temporary file and are not included in this report. Regenerate the file via the explicit test branch if it is removed.
