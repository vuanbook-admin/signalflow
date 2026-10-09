# SignalFlow Knowledge Retrieval evaluation

Updated: 2026-08-29

## Method

The shipped retrieval mode is scoped full-text. It filters by Client and Brand before scoring and excludes archived, unreviewed, and non-`user_owned`/`licensed` sources. Semantic retrieval is not shipped because the evaluated full-text gate passed; an embedding store would add cost without a measured quality gain.

## Fixed evaluation gate

The release fixture must contain 25 hand-labelled queries across these five source classes before semantic retrieval may be considered:

| Class | Queries | Acceptance |
| --- | ---: | --- |
| Brand voice | 5 | At least one approved in-scope voice source in top 5 |
| Product facts | 5 | At least one approved in-scope fact source in top 5 |
| Approved claims | 5 | At least one approved in-scope claim source in top 5 |
| Media references | 5 | At least one approved in-scope media source in top 5 |
| Recipes | 5 | At least one approved in-scope recipe source in top 5 |

Pass conditions: top-5 recall at least 80%, unsafe result count 0, and a recorded median response time. The operator-directed production-shaped corpus below passes these conditions. This is controlled test evidence, not a claim about an unprovided customer library; a future customer corpus may be rerun without changing the shipped retrieval mode.

## Deterministic fixture result

`src/lib/knowledgeRetrieval.test.ts` runs 25 in-scope, reviewed, licensed fixture queries: top-5 recall is 100%, unsafe result count is 0, and the latest local run recorded median response time `0.021 ms` (Vitest, 2026-08-29).

The operator-generated production-shaped backend run on 2026-08-29 used 25 reviewed in-scope items across the five source classes, 25 cross-client distractors, and 5 archived distractors. Its 25 hand-labelled queries returned `top5Recall=100%`, `unsafe=0`, and `medianMs=0.081`; an archived-only query returned no result. The full-text gate passed, so no semantic index was added.
