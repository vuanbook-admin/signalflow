import { describe, expect, it } from "vitest";
import { contentActionItems, contentActionLabel } from "./contentActions";

describe("content actions", () => {
  it("shows review actions for a draft", () => {
    expect(contentActionItems("Needs review")).toEqual(["approve", "regenerate_copy", "delete"]);
  });

  it("shows schedule actions for a scheduled draft", () => {
    expect(contentActionItems("Scheduled")).toEqual(["publish_now", "reschedule", "cancel_schedule"]);
  });

  it("does not expose destructive actions for a published post", () => {
    expect(contentActionItems("Published")).toEqual([]);
  });

  it("keeps labels explicit", () => {
    expect(contentActionLabel("regenerate_copy")).toBe("Làm lại phần chữ");
    expect(contentActionLabel("publish_now")).toBe("Xuất bản ngay");
  });
});
