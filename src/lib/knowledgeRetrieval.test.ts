import { describe, expect, it } from "vitest";

async function retrieval() { return await import("./knowledgeRetrieval").catch(() => undefined); }

const items = [
  { id: "a", clientId: "client-a", brandId: "brand-a", title: "Brand voice", text: "calm evidence led financial language", rightsState: "user_owned", reviewState: "approved", archived: false, sourceUpdatedAt: "2026-08-20T00:00:00.000Z" },
  { id: "b", clientId: "client-a", brandId: "brand-a", title: "Archived", text: "financial language", rightsState: "user_owned", reviewState: "approved", archived: true, sourceUpdatedAt: "2026-08-20T00:00:00.000Z" },
  { id: "c", clientId: "client-b", brandId: "brand-b", title: "Other client", text: "financial language", rightsState: "licensed", reviewState: "approved", archived: false, sourceUpdatedAt: "2026-08-20T00:00:00.000Z" },
] as const;

describe("scoped full-text Knowledge retrieval", () => {
  it("returns deterministic reviewed in-scope results and excludes archived/cross-client material", async () => {
    const api = await retrieval();
    expect(api).toBeDefined();
    if (!api) return;
    expect(api.searchKnowledgeItems(items, { clientId: "client-a", brandId: "brand-a", query: "financial language", now: "2026-08-29T00:00:00.000Z" })).toEqual([expect.objectContaining({ id: "a", retrievalMode: "full_text", stale: true })]);
  });

  it("passes the fixed 25-query full-text evaluation with zero unsafe results", async () => {
    const api = await retrieval();
    expect(api).toBeDefined();
    if (!api) return;
    const categories = ["voice", "product", "claim", "media", "recipe"];
    const corpus = categories.flatMap((category) => Array.from({ length: 5 }, (_, index) => ({ id: `${category}-${index}`, clientId: "client-a", brandId: "brand-a", title: `${category} ${index}`, text: `${category} approved source ${index}`, rightsState: "licensed" as const, reviewState: "approved" as const, archived: false, sourceUpdatedAt: "2026-08-29T00:00:00.000Z" })));
    const queries = corpus.map((item) => ({ query: `${item.title} source`, expectedId: item.id }));
    const durations: number[] = [];
    const results = queries.map((item) => {
      const started = performance.now();
      const result = api.searchKnowledgeItems(corpus, { clientId: "client-a", brandId: "brand-a", query: item.query, now: "2026-08-29T00:00:00.000Z" });
      durations.push(performance.now() - started);
      return result;
    });
    expect(results.every((result, index) => result.slice(0, 5).some((item) => item.id === queries[index]?.expectedId))).toBe(true);
    expect(results.flat().some((item) => !corpus.some((source) => source.id === item.id))).toBe(false);
    const sortedDurations = [...durations].sort((left, right) => left - right);
    const medianMs = sortedDurations[Math.floor(sortedDurations.length / 2)] ?? 0;
    console.info(`knowledge-retrieval-fixture: queries=${queries.length} top5Recall=100% unsafe=0 medianMs=${medianMs.toFixed(3)}`);
  });
});
