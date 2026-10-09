# SignalFlow Revo Content OS contract

Updated: 2026-09-01

This is the shared contract for manual and scheduled content. The trigger is the only difference between the two paths. The renderer may edit a run, but the Control Plane and worker remain authoritative for approval, target publication, and terminal state.

## Context

Every run is scoped to one `clientId`, `brandId`, `identityVersionId`, `generationProfileId`, and `providerTraceId`. Target destinations are represented by `bindingIds` and one `TargetPublication` per binding. A binding is never inferred from a display-only platform selector.

## Structured Content Run

```ts
{
  id,
  clientId,
  brandId,
  identityVersionId,
  generationProfileId,
  executionMode,
  providerTraceId,
  trigger: "manual" | "automation",
  topic,
  contentPillar,
  objective,
  caption,
  body,
  cta,
  hashtags,
  seoKeywords,
  scheduledAt,
  sources,
  notes,
  targetPlatforms,
  targetBindingIds,
  mediaOperations,
  qualityChecks,
  qualityStatus,
  approvalState,
  state,
  variants,
  trace
}
```

Each variant carries its platform, content kind, title/caption/body, normalized hashtags and SEO keywords, identity version, provider trace, media asset IDs, and media operation history. Image and video generation are separate operations under the same run; an unavailable capability is recorded as blocked/failed and never replaced by a silent provider fallback.

## Revo-style AI generation

`Tạo content` is an inline generation action, not a form submission. It sends the active Client/Brand identity, content-intelligence context, target platform, and existing-topic exclusions to the selected AI route without renderer-provided topic/pillar/CTA/hashtag/SEO defaults. The provider must return a complete structured variant: AI-selected topic/title, content pillar, objective, caption/body, CTA, hashtags, SEO keywords, optional scheduled time and truthful sources, internal notes, visual concept/prompt, and strategy rationale. The editor selects that new variant only after the response passes the structured-field validation; an empty or partial provider response becomes an explicit error and does not create a fake draft.

For managed ChatGPT/Gemini subscription routes, the native bridge resolves the live composer and send control from the DOM, verifies visibility/topmost state, performs a CDP mouse click, and polls the same session for the structured JSON response. It never stops after merely inserting text into the composer.

## State machine

```text
proposed | needs_review
  → quality_passed | failed
quality_passed
  → ready | failed
ready
  → scheduled | failed
scheduled
  → publishing | failed
publishing
  → published | failed
published | failed
  → terminal
```

`persistQualityChecks` stores every check and only enters `quality_passed` when all checks pass. Approval is a separate Control Plane decision. `checkPublishReadiness` requires approval, quality, identity, generation profile, provider trace, and non-empty variant copy; it never performs a live publish attempt.

## Readiness and actions

The Content OS exposes the ten persisted checks: hook, caption length, CTA, hashtag count, visual, playbook, pillar/objective, format, factual sources, and Research Brief. Save normalizes list fields and resets quality to pending. Copy/export returns the caption plus hashtags and the complete manual publish package. Telegram creates an auditable pending relay payload; without a configured relay it must not send.

Approval creates one idempotent target-publication job per binding after target-specific preflight. A terminal `published` state is written only after provider confirmation and worker reconciliation. Manual and scheduler-created runs open in the same selected-post editor and use the same save, quality, approval, queue, and failure paths.

## Safety invariants

- No renderer-only `published` state.
- No cross-client binding or identity assignment.
- No provider fallback after an error; retry stays on the selected route.
- No publish without explicit approval, target readiness, required public media evidence, and idempotency.
- Missing provider, media, research, rights, or instrumentation state is visible as a block/review state, never fabricated as success.
