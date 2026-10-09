import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { activateUserProfile, preferredStartupProfileId, startupUserProfileId } from "./lib/profileDomain";
import { invoke, isElectronRuntime, setProfileRuntimeIdentity } from "./lib/nativeRuntime";

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("SIGNALFLOW_ROOT_MISSING");

const root = ReactDOM.createRoot(rootElement);
const app = <React.StrictMode><App /></React.StrictMode>;

function startupMessage(message: string) {
  const code = message.match(/^[A-Z][A-Z0-9_]{2,80}$/)?.[0] ?? "PROFILE_RUNTIME_NOT_READY";
  const detail = code === "PROFILE_MIGRATION_CLOSE_SIGNALFLOW" || code === "PROFILE_LEGACY_WRITER_UNVERIFIABLE"
    ? "Đóng phiên bản SignalFlow cũ đang giữ cổng rồi thử lại. Dữ liệu nguồn vẫn được giữ nguyên."
    : ["PROFILE_MIGRATION_SOURCE_INVALID", "PROFILE_MIGRATION_FOREIGN_KEY_INVALID", "PROFILE_MIGRATION_RECORD_COUNT_MISMATCH", "PROFILE_MIGRATION_PUBLISH_FAILED"].includes(code)
      ? "Dữ liệu nguồn được giữ nguyên; migration chưa được chấp nhận. Hãy đóng writer cũ và thử lại sau khi kiểm tra file nguồn."
      : code === "PROFILE_MIGRATION_DESTINATION_EXISTS_UNVERIFIED" || code === "PROFILE_MIGRATION_PROOF_INVALID"
        ? "Đích đã có dữ liệu chưa xác minh. SignalFlow không ghi đè; cần khôi phục hoặc kiểm tra bản dữ liệu đích trước khi mở hồ sơ."
        : code === "PROFILE_LEGACY_SOURCE_AMBIGUOUS"
          ? "Có nhiều nguồn dữ liệu cũ được cấu hình. Hãy giữ một nguồn legacy đã xác định rõ rồi thử lại."
          : "Runtime của hồ sơ chưa xác nhận đúng danh tính. Dữ liệu chưa được tải vào giao diện.";
  return <main role="alert" style={{ minHeight: "100vh", display: "grid", placeContent: "center", gap: 12, padding: 32, color: "#243047", background: "#f6f8fb", fontFamily: "system-ui, sans-serif" }}>
    <h1 style={{ margin: 0 }}>SignalFlow chưa mở hồ sơ</h1>
    <p style={{ maxWidth: 520, margin: 0 }}>{detail}</p>
    <code>{code}</code>
    <button type="button" onClick={() => window.location.reload()}>Thử khởi động lại</button>
  </main>;
}

async function bootstrap() {
  if (!isElectronRuntime()) {
    root.render(app);
    return;
  }

  const rendererProfileId = startupUserProfileId();
  root.render(<main role="status" style={{ minHeight: "100vh", display: "grid", placeContent: "center", color: "#243047", background: "#f6f8fb", fontFamily: "system-ui, sans-serif" }}>Đang đọc hồ sơ đã lưu…</main>);
  try {
    const nativeSelection = await invoke<{ profileId?: string | null; profileRevision?: number }>("profile_selection");
    const profileId = nativeSelection.profileId ? preferredStartupProfileId(nativeSelection.profileId) : rendererProfileId;
    root.render(<main role="status" style={{ minHeight: "100vh", display: "grid", placeContent: "center", color: "#243047", background: "#f6f8fb", fontFamily: "system-ui, sans-serif" }}>Đang xác minh runtime cho hồ sơ {profileId}…</main>);
    const activation = await activateUserProfile(profileId, () => invoke("profile_activate", { profileId }));
    setProfileRuntimeIdentity({ profileId: activation.profileId, runtimeId: activation.runtimeId, profileRevision: activation.profileRevision ?? nativeSelection.profileRevision ?? 0 });
    root.render(app);
  } catch (error) {
    root.render(startupMessage(error instanceof Error ? error.message : "PROFILE_RUNTIME_NOT_READY"));
  }
}

void bootstrap();
