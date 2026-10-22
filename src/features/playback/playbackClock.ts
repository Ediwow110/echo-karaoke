export type PlaybackWireState = {
  positionSeconds: number;
  isPlaying: boolean;
  updatedAt: string | null;
};

// Guests poll every few seconds. Between polls the clock runs locally so the
// progress bar does not jump backward each time a response arrives.
export function estimatePosition(playback: PlaybackWireState | undefined, nowMs = Date.now()): number {
  if (playback === undefined) {
    return 0;
  }
  const base = Math.max(0, playback.positionSeconds);
  if (!playback.isPlaying || playback.updatedAt === null) {
    return base;
  }
  const updated = Date.parse(playback.updatedAt);
  if (!Number.isFinite(updated)) {
    return base;
  }
  const elapsed = Math.max(0, (nowMs - updated) / 1000);
  return base + elapsed;
}
