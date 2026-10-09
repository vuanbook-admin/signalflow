export type ContentRevision = { id: string; title: string; body: string; createdAt: string; providerTraceId?: string; requestId?: string; parentRevisionId?: string; revisionId?: string };

export function appendContentRevision(history: readonly ContentRevision[] | undefined, current: { title: string; body?: string; providerTraceId?: string }, id: string, createdAt: string, metadata: Pick<ContentRevision, "requestId" | "parentRevisionId" | "revisionId"> = {}): ContentRevision[] {
  return [...(history ?? []), { id, title: current.title, body: current.body ?? "", createdAt, providerTraceId: current.providerTraceId, ...metadata }];
}

export async function runRevisionGeneration<TRequest, TResult>(gateway: { generate(request: TRequest): Promise<TResult> }, request: TRequest, persist: (result: TResult) => Promise<void>): Promise<TResult> {
  const result = await gateway.generate(request);
  await persist(result);
  return result;
}

export function buildRestoredRevision(
  history: readonly ContentRevision[] | undefined,
  current: { title: string; body?: string; providerTraceId?: string },
  selected: Pick<ContentRevision, "id" | "title" | "body" | "createdAt" | "providerTraceId">,
  metadata: { revisionId: string; requestId: string; createdAt: string },
): { title: string; body: string; providerTraceId?: string; revisionHistory: ContentRevision[]; revisionId: string; parentRevisionId: string; requestId: string } {
  return {
    title: selected.title,
    body: selected.body,
    providerTraceId: selected.providerTraceId,
    revisionHistory: appendContentRevision(history, current, `${metadata.revisionId}-parent`, metadata.createdAt),
    revisionId: metadata.revisionId,
    parentRevisionId: selected.id,
    requestId: metadata.requestId,
  };
}
