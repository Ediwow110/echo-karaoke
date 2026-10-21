import { beforeEach, describe, expect, it } from 'vitest';
import { youtubePlayerFactory } from '../../src/features/playback/youtubeIframe';

type FakeOptions = {
  events: { onReady: () => void; onStateChange: (event: { data: number }) => void };
};

const loaded: string[] = [];
const calls: string[] = [];
let options: FakeOptions | null = null;
let currentState = -1;

class FakePlayer {
  constructor(_element: HTMLElement, given: Record<string, unknown>) {
    options = given as unknown as FakeOptions;
  }
  loadVideoById(videoId: string) { loaded.push(videoId); }
  playVideo() { calls.push('play'); }
  pauseVideo() { calls.push('pause'); }
  getCurrentTime() { return 42; }
  getPlayerState() { return currentState; }
  destroy() { calls.push('destroy'); }
}

// The player factory keeps the loaded YouTube api for the life of the page,
// so the fake is installed once for the whole file.
(window as unknown as { YT: unknown }).YT = {
  Player: FakePlayer,
  PlayerState: { ENDED: 0 },
};

beforeEach(() => {
  loaded.length = 0;
  calls.length = 0;
  options = null;
  currentState = -1;
});

function ready(): void {
  options?.events.onReady();
}

function state(data: number): void {
  currentState = data;
  options?.events.onStateChange({ data });
}

describe('the YouTube player factory', () => {
  it('holds a song that arrives before the player is ready', async () => {
    const handle = youtubePlayerFactory(document.createElement('div'), () => {});

    handle.load('dQw4w9WgXcQ');
    handle.play();

    expect(loaded).toEqual([]);
    expect(calls).toEqual([]);

    await new Promise((resolve) => setTimeout(resolve, 0));
    ready();

    expect(loaded).toEqual(['dQw4w9WgXcQ']);
    expect(calls).toContain('play');
  });

  it('reports the state the player hands over', async () => {
    const handle = youtubePlayerFactory(document.createElement('div'), () => {});

    await new Promise((resolve) => setTimeout(resolve, 0));
    ready();
    state(3);

    expect(handle.getState()).toBe(3);
    expect(handle.getCurrentTime()).toBe(42);
  });

  it('calls back when a song ends', async () => {
    let ended = 0;
    const handle = youtubePlayerFactory(document.createElement('div'), () => { ended += 1; });

    await new Promise((resolve) => setTimeout(resolve, 0));
    ready();
    state(0);

    expect(ended).toBe(1);
    expect(handle.getState()).toBe(0);
  });

  it('stops the player when it is destroyed', async () => {
    const handle = youtubePlayerFactory(document.createElement('div'), () => {});

    await new Promise((resolve) => setTimeout(resolve, 0));
    ready();
    handle.destroy();

    expect(calls).toContain('destroy');
  });
});
