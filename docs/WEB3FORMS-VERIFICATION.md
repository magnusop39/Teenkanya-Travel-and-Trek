# Web3Forms Verification

Date: 2026-10-31  
Branch: `v1/web3forms-standard-review-fix`  
Intended PR base: `v1/enquiry-api` (restored on GitHub at `5d044f8` after explicit approval)

## Automated checks

- `pnpm check`: passed; TypeScript and all 24 tests passed, including the new streaming-size and forwarding-header regressions.
- `pnpm build`: passed for Next.js 16.4.3.
- GitHub Actions `Quality checks`: succeeded on commit `7becfc9c275c8060211c33791759a34c15c67c61` ([run](https://github.com/sudippandey/Teenkanya-Travel-and-Trek/actions/runs/41180735025)). This is a push check; no PR is open for this branch.
- Provider success mock: passed; only HTTP success plus `{ success: true }` is accepted.
- Provider rejection, invalid-key response, non-2xx response, malformed JSON, and network failure mocks: passed. Failures are reduced to generic reason codes and do not return provider or transport text.
- Enquiry workflow: valid submission, invalid-before-persistence, notification failure, and duplicate suppression tests passed.
- Client secret check: no Web3Forms access key or provider endpoint is present in the contact-form source. A scan of 15 compiled client assets found zero matches for either `WEB3FORMS_ACCESS_KEY` or `VERCEL_AUTOMATION_BYPASS_SECRET` (values or names).

## Live provider diagnosis

Prior live `/submit` probes with the configured key returned HTTP 403 with a non-JSON response; a probe with a synthetic invalid key returned the same category. No provider success was confirmed. Web3Forms documents this response as `403: This method is not allowed` when the standard endpoint is called server-side; server-side use requires a paid plan and the server IP on its safelist ([troubleshooting](https://docs.web3forms.com/getting-started/troubleshooting), [API reference](https://docs.web3forms.com/getting-started/api-reference)). The observed 403 therefore does not by itself establish that the key is invalid.

The Preview `WEB3FORMS_ACCESS_KEY` is configured and exactly matches the Development value; neither value was printed or logged. This confirms environment consistency, not which form or mailbox the key targets. The Standard access-key API does not expose the bound recipient or its verification state, so those two items remain unverified without the Web3Forms dashboard. No additional valid provider submissions were sent during this review pass.

## Vercel preview

The API hardening deployment reached `Ready` at:

`https://tenkanyatravelandtrek-omb2tq5ei-aura-ff3b.vercel.app`

The stable branch alias is `https://tenkanyatravelandtrek-git-v1-web3forms-verification-aura-ff3b.vercel.app`.

Vercel CLI requests reached the deployed API without creating or changing an enquiry:

- `{}` returned `422 invalid_submission` before persistence or notification.
- A 16,127-byte chunked JSON body returned `413 payload_too_large`.
- A 15,914-byte JSON body below the cap returned `422 invalid_submission`, confirming it reached validation rather than the size rejection.

The existing saved enquiry reference `TTT-261031-EEBDBC3046BF3F96` was not re-submitted or modified. No new valid enquiry or provider submission was created during these Preview checks. The prior saved notification attempt was not provider-confirmed; no inbox access is available to confirm delivery.

## Security and remaining limitations

- Supabase credentials remain server-only. In the free Standard browser integration, `WEB3FORMS_ACCESS_KEY` is recipient-bound and intentionally public; it is returned only after the enquiry is saved. The UI receives generic application messages and never receives raw provider response text.
- Vercel documents `x-real-ip` as the trusted client IP header. The current API validates and uses only `x-real-ip`; missing or malformed values fail closed with a retryable service error and never share an `unknown` bucket or fall back to `x-forwarded-for` ([Vercel request headers](https://vercel.com/docs/headers/request-headers)).
- Route logs contain fixed operational messages only; provider bodies, credentials, and transport errors are not logged. `VERCEL_AUTOMATION_BYPASS_SECRET` was used only by the Vercel CLI for protected-preview requests, not committed or passed to client code. `vercel env ls` initially showed it in Production, Preview, and Development. After approval, the Production scope was removed and verified; it now remains in Preview and Development. Vercel warned that removing the environment target does not rotate or revoke the underlying credential. No production deployment occurred.
- The Standard payload uses the recipient bound to `WEB3FORMS_ACCESS_KEY` and sends neither `to` nor Pro-only `ccemail`. The key-bound recipient and its verified status still require confirmation in the Web3Forms dashboard. The previously configured `CONTACT_TO_EMAIL` variable is no longer read by the application.
- No email arrival in the sandbox inbox was confirmed. The live provider response was not successful, and inbox access is unavailable.
- No production deployment or merge was performed. PR #3 is the already-merged foundation PR targeting `main`; it was left untouched. After explicit approval, the requested `v1/enquiry-api` base was restored on GitHub at `5d044f8`. The draft PR itself could not be opened from this workspace because GitHub CLI has read-only pull-request permissions. The current review branch is `v1/web3forms-standard-review-fix`.

## Follow-up review: browser-side Standard flow

- The current code saves to Supabase first, then submits to the browser-only Web3Forms Standard endpoint. The retry action calls only Web3Forms and does not re-post the enquiry. A short-lived signed token protects status updates; the UI reports provider acceptance separately from inbox delivery.
- Known idempotent retries are checked before consuming a rate-limit attempt. A concurrent first-request race can still consume an extra attempt because the existing limiter is a separate database RPC; the unique submission ID still prevents duplicate rows.
- `pnpm check` and `pnpm build` passed for this revision. The actual browser flow saved one clearly synthetic QA enquiry: reference `TTT-261031-F49DC6BFDFB252E6`. The API returned `201`, then the notification-status endpoint returned `200` after recording the failed provider attempt. Web3Forms returned `403` to the browser `OPTIONS` preflight from `http://localhost:3000`; the UI correctly kept the saved enquiry and showed a notification-only retry. No provider acceptance or inbox arrival is confirmed, and no real customer data was submitted.
- Web3Forms’ official troubleshooting docs say JavaScript requests should use `application/json`, while localhost and some free subdomains may be blocked. The current request format is correct; the local-origin rejection does not confirm how the configured recipient key behaves on an approved custom domain. No retry was made after the `403`.
- The feature deployment reached `Ready` at `https://tenkanyatravelandtrek-q3fjhplxa-aura-ff3b.vercel.app`, but Preview Protection prevented direct browser access. The local v0 Preview exercised the real Supabase and Web3Forms endpoints with a synthetic IP header for the rate limiter; it was not a mocked provider response. Production was not deployed.
