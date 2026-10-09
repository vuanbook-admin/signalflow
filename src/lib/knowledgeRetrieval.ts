import type { RightsState, ReviewState } from "./contentIntelligence";

export type SearchableKnowledgeItem = { id: string; clientId: string; brandId: string; title: string; text: string; rightsState: RightsState; reviewState: ReviewState; archived: boolean; sourceUpdatedAt: string };
export type KnowledgeSearchResult = { id: string; title: string; excerpt: string; score: number; stale: boolean; retrievalMode: "full_text" };

export function searchKnowledgeItems(items: readonly SearchableKnowledgeItem[], input: { clientId: string; brandId: string; query: string; now: string }): KnowledgeSearchResult[] {
  const terms = input.query.toLowerCase().split(/\s+/).filter(Boolean);
  const now = Date.parse(input.now);
  return items
    .filter((item) => item.clientId === input.clientId && item.brandId === input.brandId && !item.archived && item.reviewState === "approved" && (item.rightsState === "user_owned" || item.rightsState === "licensed"))
    .map((item) => {
      const text = `${item.title} ${item.text}`.toLowerCase();
      return { id: item.id, title: item.title, excerpt: item.text.slice(0, 280), score: terms.reduce((score, term) => score + (text.split(term).length - 1), 0), stale: !Number.isNaN(now) && now - Date.parse(item.sourceUpdatedAt) > 7 * 86_400_000, retrievalMode: "full_text" as const };
    })
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score || left.title.localeCompare(right.title) || left.id.localeCompare(right.id));
}
