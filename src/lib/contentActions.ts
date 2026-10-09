export type ContentAction = "approve" | "regenerate_copy" | "delete" | "publish_now" | "reschedule" | "cancel_schedule";
export type ContentStatus = "Needs review" | "Scheduled" | "Published" | "Failed";

export function contentActionItems(status: ContentStatus): ContentAction[] {
  if (status === "Needs review") return ["approve", "regenerate_copy", "delete"];
  if (status === "Scheduled") return ["publish_now", "reschedule", "cancel_schedule"];
  return status === "Failed" ? ["regenerate_copy", "delete"] : [];
}

export function contentActionLabel(action: ContentAction): string {
  return {
    approve: "Duyệt",
    regenerate_copy: "Làm lại phần chữ",
    delete: "Xóa",
    publish_now: "Xuất bản ngay",
    reschedule: "Đổi lịch",
    cancel_schedule: "Hủy lên lịch",
  }[action];
}

