export function acceptFinalPlaylistResponse(value: unknown): boolean {
  return !(value && typeof value === "object" && (value as { provisional?: unknown }).provisional === true);
}

export function playlistPrimeResponseDisposition(phase: string): "progress" | "final" {
  return phase === "preparing" || phase === "ready" ? "progress" : "final";
}
