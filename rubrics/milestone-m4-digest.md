# Milestone M4 — Email Digest Rubric

**Purpose:** Ship the "📧 Email me this week's events" feature per `docs/SPEC.md` lines 71-79: a single-send digest with no subscriber list, no confirmation email, no unsubscribe. Gates on master rubric D9 (digest delivers + renders cleanly).

**Method discipline:** Every dimension is an integration test, a Resend API response, an HTML validator pass, or a Playwright assertion on the modal. The "judgment" calls are visual rendering across email clients (C1-C3), which use manual screenshot review.

**Iteration cap:** 3 per dimension. Past 3, mark `HUMAN-REVIEW-NEEDED`.

---

## Pre-flight (must be true before any digest code lands)

| # | Check | Pass |
|---|---|---|
| P1 | `RESEND_API_KEY` in `.env.local` and Vercel env | `grep '^RESEND_API_KEY=' .env.local` matches; `vercel env ls production` shows it |
| P2 | Sender domain DNS configured (SPF + DKIM verified in Resend dashboard) | manual check in Resend UI; required for D2 |
| P3 | `lib/format/price.ts` exports `formatPriceDisplay` | already true |
| P4 | `/api/events` route exists (M4 reuses the same query layer) | `curl localhost:3000/api/events` 200 |
| P5 | `resend` npm package installed | `grep '"resend"' package.json` matches |
| P6 | `digest_sends` table exists in schema | already true (M0 schema) |

---

## A. Send endpoint

`POST /api/digest`

| # | Failure mode | Check | Pass |
|---|---|---|---|
| A1 | Endpoint returns 5xx on valid input | integration test: POST with valid email + filters | 200 |
| A2 | Endpoint returns 200 on invalid email | POST `{ email: "not-an-email" }` | 400 with `{ error: "invalid email" }` |
| A3 | Endpoint doesn't write `digest_sends` row | after success, SELECT confirms one new row with email + filters + event_count | row exists |
| A4 | Endpoint doesn't call Resend | mock Resend in test; assert `resend.emails.send` was called once | called |
| A5 | UI / app/ writes to other tables | grep `app/api/digest/` for `db.insert` against tables other than `digest_sends` | only `digest_sends` |
| A6 | No rate limiting | second POST from same IP within 60s returns 429 | 429 with retry-after |
| A7 | Email NOT validated server-side | server-side regex/zod check rejects malformed | rejected |

## B. Email content

| # | Failure mode | Check | Pass |
|---|---|---|---|
| B1 | Empty body when DB has events for the window | send digest, fetch from Resend logs / spy on email body | body has ≥ 1 `<a>` per event in scope |
| B2 | Empty filter result has no "no events" treatment | send with filters that match nothing | body has graceful "No events match" message + link back to calendar |
| B3 | Source-link missing on any event | parse rendered HTML, every event row has anchor with `href=<source_url>` | matches |
| B4 | Price not shown per event | every event row contains a price string from `formatPriceDisplay` | matches |
| B5 | Invalid HTML | `html-validate` or W3C validator on rendered body | 0 errors |
| B6 | Title / venue / date missing | per-row assertion against fixture | all present |
| B7 | Email body > 102KB (Gmail clipping threshold) | `Buffer.byteLength(html, 'utf8')` | ≤ 102KB (soft — flag if approaching) |

## C. Cross-client rendering (manual review)

| # | Description | Method | Pass |
|---|---|---|---|
| C1 | Gmail (web + iOS app) | send to a real Gmail address; open in both; screenshot | layout intact, links clickable, dark mode acceptable |
| C2 | Apple Mail | same in Apple Mail desktop + iOS | renders cleanly |
| C3 | Outlook web | same in outlook.live.com | renders cleanly (Outlook is the canary — if it works here, most clients do) |
| C4 | Plain-text fallback | View source on the email | `text/plain` alternative present with same content readable |

## D. Deliverability

| # | Failure mode | Check | Pass |
|---|---|---|---|
| D1 | Resend send fails | response from `resend.emails.send` | `id` present, no error |
| D2 | Email lands in spam | manual: send to fresh Gmail + Outlook addresses; check Inbox vs Spam | Inbox in both |
| D3 | SPF / DKIM not aligned | Resend dashboard verification status | both green for sender domain |
| D4 | DMARC missing | DNS TXT lookup on `_dmarc.<sender-domain>` | record exists (soft) |

## E. Modal UX

| # | Failure mode | Check | Pass |
|---|---|---|---|
| E1 | Modal doesn't open from button | Playwright: click "📧 Email me this week's events" | modal becomes visible |
| E2 | Email input lacks client-side validation | enter `nope`, click Send | input shows error, no network call |
| E3 | Category checkboxes missing | inspect modal DOM | all 5 categories present as checkboxes |
| E4 | Submit not disabled while in-flight | mock slow response; assert button disabled during pending | true |
| E5 | No success state after send | after 200, assert success message visible | visible |
| E6 | No error state on failure | mock 500; assert error message visible | visible |
| E7 | Modal not dismissible | press Esc + click backdrop + click X | all three close it |
| E8 | Modal traps focus | Tab cycles within modal, can't reach background | true |

## F. No-account invariants (SPEC non-goals)

| # | Failure mode | Check | Pass |
|---|---|---|---|
| F1 | A subscriber list / user-events table got created | review `db/schema.ts` after M4 | only `digest_sends` is new — no `subscribers` |
| F2 | A confirmation email sent | no second send queued after the digest | only one outbound |
| F3 | Unsubscribe link in email | grep email HTML for "unsubscribe" | not present (intentional — there's no list to unsubscribe from) |
| F4 | `digest_sends` queried for user state anywhere | grep for `db.select.*digest_sends` in `app/` outside the audit-log writer | only the writer |

## G. Performance

| # | Failure mode | Check | Pass |
|---|---|---|---|
| G1 | Send takes > 5s end-to-end | timing on integration test | ≤ 5s (P95) |
| G2 | Email body > 102KB | reused B7 | same |

---

## Deferred decisions (first PR sets defaults; subsequent PRs match)

- **Sender domain.** SPEC line 503 says domain is pending. Recommend: a transactional subdomain like `digest.<rootdomain>` for spam isolation.
- **From-name.** "SF Events" or similar; keep stable across runs.
- **Subject line template.** "Your SF events for the week of {date}" or terser. A/B testing is non-goal.
- **Email template framework.** Recommend `react-email` (composable, JSX-based, Resend-native) over raw HTML strings or MJML.
- **Event count cap per email.** SPEC says "next 7 days"; if filter matches 200 events, do we cap at 50? Recommend yes (G2 keeps body small).
- **Dark-mode email.** Default to light; honor `@media (prefers-color-scheme: dark)` if cheap.

---

## Ship gate for M4

**MUST PASS:** A1, A2, A3, A4, A5, A7, B1, B2, B3, B4, B5, B6, C1, C2, D1, D3, E1, E2, E3, E4, E5, E6, E7, F1, F2, F3, F4, G1.

**SOFT (informational, do not block):** A6 (rate limiting can be follow-up), B7, C3, C4, D2 (deliverability tuning iterates post-launch), D4, E8, G2.

---

## Revision protocol

Same pattern as M1/M2/M3. Cite failing dimension + concrete evidence.

> "B5 FAILED: rendered HTML has 3 errors per html-validate (`<a>` nested inside `<a>`, missing `alt` on banner img, invalid `style=""` on row 12). Inspect `lib/digest/template.tsx` line 47 — the event-row component wraps the entire card in a link and then has a per-button link inside; flatten to a single anchor."

Generator/evaluator separation: the agent writing the digest template does NOT validate its own output. The evaluator opens a fresh shell, runs `html-validate <captured-email.html>` and the integration test, and produces the next revision instruction.

---

## Out of scope for M4

- **Recurring subscriptions** (SPEC non-goal — single send only)
- **Personalization** (no accounts, no preferences saved)
- **Multi-language** (English only)
- **Attachments** (links only)
- **Read receipts / open tracking** (Resend supports it; we don't use it)
- **A/B testing of subject or template** (defer until we have volume)
- **Bounces / complaint handling** (digest_sends is a fire-and-forget audit log; if a recipient bounces, that's between them and their mail provider)
