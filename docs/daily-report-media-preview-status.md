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

## Follow-up after Vercel login

- Created private Blob `daily-report-media-preview` (`store_KsRtwZBMz1mNHXRM`, sin1), connected only to Preview. CLI also automatically refreshed local `.env.local` (development); no secret contents printed.
- Added branch-specific secrets for DATABASE_URL, JWT_SECRET, BLOB_READ_WRITE_TOKEN, FRONTEND_URL, API_ALLOWED_ORIGINS, ADMIN_EMAILS, GOOGLE_REDIRECT_URI, MEMBER_ANALYSIS_SYNC_SECRET. Production entries unchanged.
- Branch registration required an existing GitHub branch. An initial combined command incorrectly continued to push after local commit failed on `.git` permissions. The unchanged main commit was registered; subsequent deployment listing showed no new deployment at that point. Git permissions were then corrected, deployment-disable config committed/pushed, isolated env set, and only then auto deployment enabled.
- Image feature commit `7186c1c`; enabled Preview commit `35348cf`. Preview `dpl_H7hK6Zx8yY1dv361AgSqy2Ls7FaA` became READY.
- CLI file-upload deployment stalled and was interrupted; Git deployment succeeded.
- Stable alias: https://ta-rabo-works-git-cursor-daily-report-media-preview-ta-rabo.vercel.app
- Authenticated Preview API returned the two fictional reports (200). `vercel curl` automatically generated a project protection-bypass token; protection itself was not disabled.
- Real binary upload initially returned 400 because Vercel provided a stream instead of req.body. Added bounded stream reading in commit `709a28a`; retest pending.
- OAuth callback remains an intentionally invalid placeholder until Google callback registration and test teacher account are confirmed by user. Browser OAuth and mobile tests are pending.

## Verified Preview HTTP result

Deployment: https://ta-rabo-works-4dl7jo44l-ta-rabo.vercel.app (commit `709a28a`, Preview).

All 14 HTTP checks passed against real Neon and real private Blob using locally signed sessions for the three fictional seed users (not Google OAuth): upload 201; owner image 200; other student pending image 403; anonymous 401; report attachment 200; teacher private image 200; other student private image 403; change to lab 200; other student lab image 200; restore private 200; other student rejected again 403; thumbnail 200; detach 200; Blob/media deletion 200. Downloaded image had JPEG signature. Response headers included `private, no-store` and `Vary: Origin, Authorization`. OPTIONS returned 204 and allowed all upload headers. Test image was removed.

Remaining: Google OAuth end-to-end, browser session cache behavior, mobile selection/upload/retry and real network interruption. User has been asked to add the stable Preview callback URI and confirm the teacher test email. No production deployment or database migration performed. Actual billed spend remains unverified.
