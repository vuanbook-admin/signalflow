# Google Drive media hosting boundary

## Setup

- Use one Google account dedicated to media hosting and one Drive folder shared as "Anyone with the link can view".
- SignalFlow opens Drive in a real Chrome window launched and controlled by SignalFlow, using the persistent profile `SignalFlow/account-profiles/drive`. The UI reads only scalar status from the visible Drive page; it never copies cookies, passwords or tokens and never touches the user's normal Chrome profile.

## Native transfer contract

The Electron native boundary now exposes three explicit commands. All three use the SignalFlow-managed persistent Chromium Drive profile and visible CDP/DOM interaction. They do not use ordinary Chrome, direct authenticated HTTP fetches, Drive API credentials, cookie extraction or token extraction.

| Command | Inputs | Result and safety boundary |
|---|---|---|
| `drive_download_asset` | `workspaceId`, Drive `providerFileId`, safe destination `filename`, optional visible metadata `mimeType` and `modifiedAt` | Downloads through the visible Drive UI into an app-owned staging directory, using a separate browser-level CDP websocket from `/json/version`. The native boundary configures `Browser.setDownloadBehavior` for the default browser context with `eventsEnabled: true`, correlates `Browser.downloadWillBegin` and `Browser.downloadProgress`, copies only into the app-owned workspace media directory, computes SHA-256 from actual bytes, and returns a scalar local-media result. It never returns a public URL. |
| `drive_upload_asset` | `workspaceId`, an app-owned absolute `localAssetPath`, and safe desired `filename` | Opens the visible Drive upload flow, attaches the app-owned file with `DOM.setFileInputFiles`, waits for a visible uploaded file ID, and returns `providerFileId`, `shareUrl`, normalized URL, and truthful public-share status. The SignalFlow upload action immediately follows with the explicit `drive_make_public` flow for generated media; the native upload primitive itself remains permission-neutral. |
| `drive_make_public` | `workspaceId` and Drive `providerFileId` | Explicitly opens the visible Share dialog, selects the visible “Anyone with the link” option, confirms the visible completion state, and returns `publicUrlVerified: true` only after that confirmation. Generated-media uploads invoke this command automatically; it remains separately callable for existing Drive assets. |

Example download result:

```json
{
  "providerFileId": "1AbC_-x",
  "name": "cover.png",
  "mimeType": "image/png",
  "localAssetPath": "/.../SignalFlow/media/brand-1/cover.png",
  "bytes": 248193,
  "sha256": "<64 lowercase hex characters computed from the downloaded bytes>",
  "modifiedAt": "2026-08-23T00:00:00.000Z",
  "analysisStatus": "verified_bytes",
  "visualFingerprint": "<16 lowercase hex characters from decoded image pixels>",
  "duplicateStatus": "unknown",
  "publicReachability": "not_applicable"
}
```

Example upload result when Drive sharing remains restricted:

```json
{
  "providerFileId": "1AbC_-x",
  "name": "cover.png",
  "shareUrl": "https://drive.google.com/file/d/1AbC_-x/view",
  "normalizedUrl": "https://drive.google.com/uc?export=download&id=1AbC_-x",
  "publicUrlVerified": false,
  "publicReachability": "needs_public_share"
}
```

A download returns `DRIVE_DOWNLOAD_NOT_STARTED` when the visible click produces no `Browser.downloadWillBegin` event, `DRIVE_DOWNLOAD_FAILED` when the correlated progress event is cancelled/interrupted or completes without a safe app-owned file, and `DRIVE_DOWNLOAD_TIMEOUT` only when a download has started but does not complete before the bounded timeout. The implementation never fabricates a local path, checksum, or completion result.

An upload result may report `publicUrlVerified: true` and `publicReachability: "confirmed"` only when the visible Drive page confirms public access. The upload primitive does not silently alter General access; SignalFlow's generated-media action invokes the separate, visible `drive_make_public` command immediately after upload and keeps the asset blocked if that confirmation fails.

## Browser-level download evidence

The Drive page websocket is used only for visible DOM inspection and trusted `Input.dispatchMouseEvent` events. The browser websocket is obtained from the local Chromium `/json/version` endpoint and is used only for browser-scoped download configuration and download lifecycle events. `Browser.setDownloadBehavior` omits `browserContextId` intentionally, which selects Chromium's default browser context for the managed profile; no page-scoped `Browser.setDownloadBehavior` call or legacy `Page.setDownloadBehavior` fallback is used.

A `Browser.downloadWillBegin` event is required before a timeout can be classified as a post-start timeout. Progress events are matched by their download GUID, and a suggested filename mismatch is not accepted as the requested asset. Browser/page sockets are closed together when a managed session closes. This remains a visible managed-Chromium workflow and does not use direct authenticated fetches, cookies, session storage, or Drive APIs.

## Media analysis truthfulness

Every downloaded asset receives a SHA-256 computed from the actual local bytes. Exact duplicate checks compare two real SHA-256 values and do not use filenames, Drive IDs, FNV hashes or other metadata proxies. In an Electron main-process runtime where `nativeImage` is available, image files with an image MIME type or supported image extension are decoded, resized to a deterministic 8×8 bitmap, and converted to a 64-bit average hash represented as exactly 16 lowercase hexadecimal characters. The hash is derived only from decoded pixels, never from a filename, URL, metadata field, or raw SHA-256 value.

This automatic visual fingerprint is intentionally image-only. Videos remain `visualFingerprint: null` because this boundary does not decode video frames. If Electron/nativeImage is unavailable, image decoding fails, the decoded bitmap is invalid, or the asset is unknown media, the result remains `visualFingerprint: null` and `analysisStatus: "needs_review"`. In those cases the asset must not be treated as near-duplicate-free or planner-eligible solely because its checksum exists. Existing near-duplicate detection continues to use the canonical fingerprint Hamming-distance threshold.

The transfer boundary does not fabricate a public URL, public reachability, decoded visual fingerprint, or upload confirmation. A non-null fingerprint is emitted only after the native decoder returns a real 8×8 bitmap. Videos and unsupported or undecodable images remain review-blocked. A normalized Drive URL is a candidate URL, not proof that Meta, Instagram, TikTok or YouTube can fetch the file.

## MVP workflow

1. In SignalFlow, open **Settings → Chromium account sessions → Google Drive**. A Chrome window managed by SignalFlow opens with the isolated `drive` profile. Sign in there with your media-hosting Google account; SignalFlow may show only visible scalar status and does not read cookies, passwords, tokens or session storage.
2. To import an existing file, call `drive_download_asset` with a validated Drive file ID and safe filename. The result is stored under the app-owned `media/<workspaceId>/` directory and remains `needs_review` until the rest of the media review process verifies the asset.
3. To upload a local generated or customer-owned file, first ensure the path is inside SignalFlow's app-owned media or creative-assets directory, then call `drive_upload_asset`. The command will not accept arbitrary filesystem paths, symlinked paths, traversal, secret-shaped filenames, or credential-shaped identifiers.
4. If a public URL is required, either change Drive sharing manually or explicitly invoke `drive_make_public`. Never assume that upload alone makes the file public.
5. Store the returned scalar metadata in the canonical media record. Keep `publicUrlVerified` false until the visible confirmation exists and keep visual fingerprint status unresolved when decoded pixels or video frames were not actually analyzed.

## Production boundary

Google Drive is suitable for a controlled workflow, but it is **not a guaranteed CDN or provider reachability proof**: redirects, permission changes, quota, large-file confirmation pages, virus-scan interstitials and bandwidth limits can make provider fetches fail. SignalFlow does not test the normalized URL from an external/public context. Meta, Instagram, TikTok or YouTube may still reject a Drive URL because of redirects, permissions, quota or file-size limits.

The transfer code is intentionally Chromium/Electron-host specific. It depends on Chromium exposing `/json/version`, the browser CDP websocket, and `Browser.downloadWillBegin`/`Browser.downloadProgress`; if a Chromium build or embedding does not expose those events, the operation fails honestly rather than falling back to page-scoped download behavior.  Tauri currently routes account-browser commands to the Electron requirement rather than implementing a second authenticated browser surface. Future Windows support should retain the same scalar contracts while changing only browser binary discovery, profile roots and packaging.

To switch accounts, sign in to the SignalFlow-managed Drive window with that account and recreate the folder under it before registering production media. Do not import the external Chrome profile.
