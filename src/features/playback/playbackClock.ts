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
  const elapsed = (nowMs - updated) / 1000;
  // A phone clock can be minutes off. Do not turn that skew into a wild
  // progress position; a plausible report age advances the bar, anything else
  // holds the server's last position until the next poll.
  if (!Number.isFinite(elapsed) || elapsed < 0 || elapsed > 60) {
    return base;
  }
  return base + elapsed;
}
