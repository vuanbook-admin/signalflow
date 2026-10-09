export type ComposerMediaRole = "publish" | "reference";
export type ComposerMediaSelection = { assetId: string | number; order: number; role: ComposerMediaRole };
export const COMPOSER_MEDIA_LIMIT = 6;

function inOrder(manifest: ComposerMediaSelection[]): ComposerMediaSelection[] {
  return manifest.map((item, order) => ({ ...item, order, role: order === 0 ? "publish" : "reference" }));
}

function indexOfAsset(manifest: ComposerMediaSelection[], assetId: string | number): number {
  return manifest.findIndex((item) => String(item.assetId) === String(assetId));
}

export function toggleComposerMediaSelection(manifest: ComposerMediaSelection[], assetId: string | number) {
  const index = indexOfAsset(manifest, assetId);
  if (index >= 0) {
    return { manifest: inOrder(manifest.filter((_, itemIndex) => itemIndex !== index)), limitReached: false };
  }
  if (manifest.length >= COMPOSER_MEDIA_LIMIT) return { manifest: inOrder(manifest), limitReached: true };
  return { manifest: inOrder([...manifest, { assetId, order: manifest.length, role: "reference" }]), limitReached: false };
}

export function moveComposerMediaSelection(manifest: ComposerMediaSelection[], assetId: string | number, direction: -1 | 1) {
  const index = indexOfAsset(manifest, assetId);
  const nextIndex = index + direction;
  if (index < 0 || nextIndex < 0 || nextIndex >= manifest.length) return inOrder(manifest);
  const next = [...manifest];
  [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
  return inOrder(next);
}

export function setComposerMediaRole(manifest: ComposerMediaSelection[], assetId: string | number, role: ComposerMediaRole) {
  const index = indexOfAsset(manifest, assetId);
  if (index < 0) return inOrder(manifest);
  const next = [...manifest];
  if (role === "publish" && index > 0) next.unshift(...next.splice(index, 1));
  if (role === "reference" && index === 0 && next.length > 1) [next[0], next[1]] = [next[1], next[0]];
  return inOrder(next);
}
