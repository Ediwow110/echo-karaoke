import { useEffect, useState } from 'react';
import { estimatePosition, type PlaybackWireState } from './playbackClock';

export function usePlaybackProgress(playback: PlaybackWireState | undefined): number {
  const [seconds, setSeconds] = useState(() => estimatePosition(playback));

  useEffect(() => {
    setSeconds(estimatePosition(playback));
    if (playback?.isPlaying !== true) {
      return;
    }
    const timer = window.setInterval(() => {
      setSeconds(estimatePosition(playback));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [playback]);

  return seconds;
}
