// @ts-expect-error Vitest executes this focused stylesheet check in Node; the app tsconfig does not include Node declarations.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { filterScheduledJobsForDate, localDateKey, nextScheduledAtForRunDays } from "./automationScheduler";

const appCss = readFileSync(new URL("../App.css", import.meta.url), "utf8");
const appSource = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
const expandedViewsSource = readFileSync(new URL("../ExpandedViews.tsx", import.meta.url), "utf8");

describe("planner viewport layout", () => {
  it("keeps the content area bounded and page content normally scrollable", () => {
    expect(appCss).toMatch(/\.app-shell\s*\{[^}]*height:\s*100vh/);
    expect(appCss).toMatch(/\.content-area\s*\{[^}]*display:\s*flex/);
    expect(appCss).toMatch(/\.content-area\s*\{[^}]*flex-direction:\s*column/);
    expect(appCss).toMatch(/\.content-area\s*\{[^}]*min-height:\s*0/);
    expect(appCss).toMatch(/\.page-content\s*\{[^}]*flex:\s*1/);
    expect(appCss).toMatch(/\.page-content\s*\{[^}]*min-height:\s*0/);
    expect(appCss).toMatch(/\.page-content\s*\{[^}]*overflow-y:\s*auto/);
    expect(appSource).toMatch(/pageContentRef\.current\?\.scrollTo/);
  });

  it("caps Dashboard recent content at seven rows while keeping the bounded table scroll", () => {
    expect(appSource).toMatch(/filteredDrafts\.map\(\(draft\)/);
    expect(appCss).toMatch(/\.lower-grid \.table-panel \.content-table\s*\{[^}]*max-height:\s*470px[^}]*overflow-y:\s*auto/);
  });

  it("uses a compact Facebook target picker and exposes per-scope Cron actions", () => {
    expect(expandedViewsSource).toMatch(/planner-target-trigger/);
    expect(expandedViewsSource).toMatch(/Facebook Page results/);
    expect(expandedViewsSource).toMatch(/Set daily Cron/);
    expect(appSource).not.toMatch(/pinnedAssetIds/);
  });

  it("isolates focused planner controls and source-only test collection", () => {
    expect(appCss).toMatch(/\.planner-modal \.composer-foot > button:disabled/);
    expect(appCss).toMatch(/cursor:\s*not-allowed/);
    expect(expandedViewsSource).toContain("reviewOnlyAutomationPlanGuard");
    expect(expandedViewsSource).toContain("validateAutomationPlan(plannerValidationPlan, strategyCatalog)");
    expect(expandedViewsSource).toContain("Matrix updated — review plan");
    expect(readFileSync(new URL("../../vite.config.ts", import.meta.url), "utf8")).toMatch(/\*\*\/\.worktrees\/\*\*/);
  });

  it("filters Calendar jobs by the selected date and skips excluded run days", () => {
    const jobs = [
      { id: "a", scheduledAt: "2026-08-24T02:00:00.000Z" },
      { id: "b", scheduledAt: "2026-08-25T02:00:00.000Z" },
    ];
    expect(filterScheduledJobsForDate(jobs, "2026-08-24")).toEqual([jobs[0]]);
    expect(filterScheduledJobsForDate(jobs, "2026-08-26")).toEqual([]);
    expect(nextScheduledAtForRunDays(new Date("2026-08-24T08:00:00.000Z"), "09:00", "UTC", [2]).toISOString()).toBe("2026-08-25T09:00:00.000Z");
  });

  it("keeps Dashboard midnight cells on the operator local date", () => {
    expect(localDateKey(new Date("2026-08-30T00:00:00+07:00"))).toBe("2026-08-30");
  });
});
