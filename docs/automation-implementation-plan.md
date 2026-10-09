# Brand Automation Vertical Slice

## Goal

Extend the existing SignalFlow planner, media library, persistence boundary, and closed-app worker with a deterministic, review-first automation contract. The implementation remains provider-neutral unless an existing native adapter is explicitly configured.

## Vertical slice

1. Add versioned domain records for brand plans, target accounts, media inventory, reservations, creative runs, provider capabilities, and pipeline states.
2. Add deterministic media fingerprinting, Drive URL/file-ID normalization, eligibility classification, duplicate detection, and an atomic idempotent reservation ledger.
3. Add per-Page exact-time schedules and activation validation while preserving existing platform plans and unsupported-adapter honesty.
4. Add backward-compatible snapshot migration/defaults for the new records without storing secrets.
5. Add worker payload validation for approved drafts, the selected Page, eligible media fingerprints, and reservation ownership.
6. Surface multi-Page schedule/account breakdowns and media inventory status in the existing planner/media views.

## Safety boundaries

The worker only publishes approved drafts. Simulation remains deterministic and local. Live providers remain capability-gated; browser-assisted subscription AI runs only while the app is open. No cookies, tokens, credentials, browser storage, or provider calls are read or transmitted by this slice.

## Test-first acceptance checks

Focused tests cover multi-Page exact schedules, media mix, Drive classification, exact/near duplicates, same-day cross-channel conflicts, reservation release/used transitions, idempotent daily runs, provider capability gates, backward-compatible persistence, and worker rejection of secret-shaped, private, duplicate, fingerprint-less, wrong-Page, or reused-reservation payloads.

## Provider matrix

| Provider | Mode | Capability state | Boundary |
| --- | --- | --- | --- |
| Google Flow | Managed Chromium | `configured/live` only after an explicit managed session | Browser-assisted, app-open only; no cookie extraction |
| Vertex AI | Official API | Live only with project ID plus shared `.env` credential file configuration | Native adapter boundary; renderer receives metadata only |
| Local preview | Deterministic local | Always configured, never live | Safe preview; no fake external generation claim |
| Facebook | Native Meta | Existing official Page route remains gated by discovery, shared `.env` credential file, approval and safe mode | Closed-app worker accepts only approved supported payloads |
| Instagram, TikTok, YouTube | Deferred/manual | Unsupported live adapters remain visibly unsupported | Manual export or future adapter; no false readiness claim |

## Dedupe and ledger rules

Exact duplicates match SHA-256 or normalized Drive file ID. Near duplicates match the deterministic 64-bit visual fingerprint within a small Hamming-distance threshold. The reservation ledger is idempotent by deterministic reservation key, excludes an already reserved asset across channels on the same run, releases failed creative/publish work, and marks an asset used only after publish confirmation.

## Migration and limits

The existing snapshot key and legacy planner shape remain readable. New records live under `automationState.schemaVersion = 1`; missing or unknown versions fall back to empty defaults. Persistence recursively removes exact secret-shaped keys such as `access_token`, `authorization`, `cookie`, `password`, `secret`, `token`, `api_key`, and `apikey`. Drive inventory remains metadata-first, while the Electron native boundary can download/analyze visible files and upload generated/local output through the managed Chromium session. Imported or generated records remain in Needs review until public reachability, SHA-256 and a real visual fingerprint are explicitly verified. The production planner and runner now use optional `pagePlans` overrides with legacy platform fallback, and the in-memory renderer ledger is not a replacement for a multi-user database.
