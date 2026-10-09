fn main() {
    let attributes = tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "greet",
            "export_json",
            "secret_set",
            "secret_get",
            "secret_delete",
            "meta_discover_accounts",
            "meta_save_access_token",
            "meta_exchange_long_lived_token",
            "meta_publish_unpublished_page_post",
            "meta_publish_page_job",
            "meta_publish_page_photo_job",
            "meta_publish_instagram_job",
            "gemini_web_result",
            "gemini_web_open",
            "gemini_web_status",
            "gemini_web_complete",
            "chatgpt_web_open",
            "chatgpt_web_status",
            "chatgpt_web_complete",
        ]),
    );
    tauri_build::try_build(attributes).expect("failed to build Tauri ACL manifest");
}
