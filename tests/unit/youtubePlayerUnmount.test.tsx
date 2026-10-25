import { useEffect, useRef } from 'react';
import { describe, expect, it } from 'vitest';
import { act, render } from '@testing-library/react';
import { youtubePlayerFactory } from '../../src/features/playback/youtubeIframe';

type FakeOptions = { events: { onReady: () => void } };
let options: FakeOptions | null = null;

class FakePlayer {
  constructor(element: HTMLElement, given: Record<string, unknown>) {
    options = given as unknown as FakeOptions;
    // What the real IFrame API does: the node it is handed stops existing.
    const frame = document.createElement('iframe');
    frame.setAttribute('src', 'about:blank');
    element.replaceWith(frame);
  }
  destroy(): void { /* the real API removes the iframe it owns */ }
  setVolume(): void { /* unused */ }
}

(window as unknown as { YT: unknown }).YT = { Player: FakePlayer, PlayerState: { ENDED: 0 } };

function HostScreen({ overlay }: { overlay: boolean }) {
  const frameRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = frameRef.current;
    if (node === null) return;
    const handle = youtubePlayerFactory(node, { onEnded: () => undefined });
    return () => handle.destroy();
  }, []);
  // The overlay must precede the frame: when it appears, React inserts it
  // *before* the frame node, which is the exact call that failed in production
  // once the API had replaced that node with its own iframe.
  return (
    <div>
      {overlay ? <span data-testid="overlay" /> : null}
      <div ref={frameRef} data-youtube-frame />
    </div>
  );
}

describe('updating a screen that hosted the player', () => {
  it('lets React insert siblings around the tree the API touched', async () => {
    const { rerender, getByTestId } = render(<HostScreen overlay={false} />);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    expect(options, 'the player was never constructed, so this proves nothing').not.toBeNull();

    let failure: unknown = null;
    try {
      act(() => { rerender(<HostScreen overlay />); });
    } catch (error) {
      failure = error;
    }
    expect(failure, String((failure as Error)?.message ?? '')).toBeNull();
    expect(getByTestId('overlay')).toBeTruthy();
  });
});
