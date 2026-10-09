import { describe, expect, it } from "vitest";
import { appendContentRevision, buildRestoredRevision, runRevisionGeneration } from "./contentRevision";

describe("content revisions", () => {
  it("retains the previous copy and provider trace in order", () => {
    expect(appendContentRevision(undefined, { title: "Old", body: "Old body", providerTraceId: "trace-old" }, "revision-1", "2026-09-11T00:00:00.000Z")).toEqual([{ id: "revision-1", title: "Old", body: "Old body", createdAt: "2026-09-11T00:00:00.000Z", providerTraceId: "trace-old" }]);
  });

  it("waits for provider output before persistence and keeps the old copy outside the transaction", async () => {
    const persisted: string[] = [];
    const result = await runRevisionGeneration({ generate: async () => ({ body: "new" }) }, { prompt: "rewrite" }, async (output) => { persisted.push(output.body); });
    expect(result).toEqual({ body: "new" });
    expect(persisted).toEqual(["new"]);
    await expect(runRevisionGeneration({ generate: async () => { throw new Error("PROVIDER_FAILED"); } }, {}, async () => { throw new Error("MUST_NOT_PERSIST"); })).rejects.toThrow("PROVIDER_FAILED");
    await expect(runRevisionGeneration({ generate: async () => ({ body: "new" }) }, {}, async () => { throw new Error("CP_PERSIST_FAILED"); })).rejects.toThrow("CP_PERSIST_FAILED");
  });

  it("restores selected copy as a new review revision while retaining current copy in history", () => {
    const restored = buildRestoredRevision([{ id: "revision-old", title: "Older", body: "Older body", createdAt: "2026-09-10T00:00:00.000Z" }], { title: "Current", body: "Current body", providerTraceId: "trace-current" }, { id: "revision-old", title: "Older", body: "Older body", createdAt: "2026-09-10T00:00:00.000Z" }, { revisionId: "revision-restored", requestId: "request-restore", createdAt: "2026-09-11T00:00:00.000Z" });
    expect(restored).toMatchObject({ revisionId: "revision-restored", parentRevisionId: "revision-old", requestId: "request-restore", title: "Older", body: "Older body" });
    expect(restored.revisionHistory).toEqual([
      { id: "revision-old", title: "Older", body: "Older body", createdAt: "2026-09-10T00:00:00.000Z" },
      { id: "revision-restored-parent", title: "Current", body: "Current body", createdAt: "2026-09-11T00:00:00.000Z", providerTraceId: "trace-current" },
    ]);
  });
});
