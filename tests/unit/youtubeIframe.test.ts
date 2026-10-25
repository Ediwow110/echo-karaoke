import { beforeEach, describe, expect, it } from 'vitest';
import { youtubePlayerFactory } from '../../src/features/playback/youtubeIframe';

type FakeOptions = {
  events: {
    onReady: () => void;
    onStateChange: (event: { data: number }) => void;
    onError: (event: { data: number }) => void;
  };
};

const loaded: Array<{ videoId: string; startSeconds?: number }> = [];
const calls: string[] = [];
let options: FakeOptions | null = null;
let currentState = -1;
let volume = 100;
let reportedCurrentTime = 42;
let reportedDuration = 210;
let swapped: HTMLElement | null = null;

class FakePlayer {
  constructor(element: HTMLElement, given: Record<string, unknown>) {
    options = given as unknown as FakeOptions;
    // The real IFrame API replaces the element it is handed with its own
    // iframe. Modelling that here is the only way this suite can catch a caller
    // that passes React a node the API then removes from under it.
    const frame = document.createElement('iframe');
    frame.setAttribute('data-fake-youtube', 'true');
    element.replaceWith(frame);
    swapped = frame;
  }
  loadVideoById(input: { videoId: string; startSeconds?: number }) { loaded.push(input); }
  playVideo() { calls.push('play'); }
  pauseVideo() { calls.push('pause'); }
  seekTo(seconds: number) { calls.push('seek:' + seconds); }
  getCurrentTime() { return reportedCurrentTime; }
  getDuration() { return reportedDuration; }
  getPlayerState() { return currentState; }
  setVolume(next: number) { volume = next; calls.push('volume:' + next); }
  getVolume() { return volume; }
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
  volume = 100;
  reportedCurrentTime = 42;
  reportedDuration = 210;
  swapped = null;
});

function ready(): void {
  options?.events.onReady();
}

function state(data: number): void {
  currentState = data;
  options?.events.onStateChange({ data });
}

describe('the YouTube player factory', () => {
  it('keeps the caller’s container attached when the API swaps its own node', async () => {
    // HostPlayer hands this factory a div React rendered. The API replaces the
    // element it receives, so a factory that forwards that element detaches a
    // node React still owns — the host screen then dies on any route change away
    // from the player with "NotFoundError: insertBefore".
    const parent = document.createElement('div');
    const container = document.createElement('div');
    parent.appendChild(container);

    youtubePlayerFactory(container, { onEnded: () => undefined });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(swapped, 'the fake stopped replacing nodes, so this test proves nothing').not.toBeNull();
    expect(container.parentNode).toBe(parent);
    expect(parent.contains(swapped)).toBe(true);
  });

  it('holds a song that arrives before the player is ready', async () => {
    const handle = youtubePlayerFactory(document.createElement('div'), { onEnded: () => undefined });

    handle.load('dQw4w9WgXcQ', 12);
    handle.play();

    expect(loaded).toEqual([]);
    expect(calls).toEqual([]);

    await new Promise((resolve) => setTimeout(resolve, 0));
    ready();

    expect(loaded).toEqual([{ videoId: 'dQw4w9WgXcQ', startSeconds: 12 }]);
    expect(calls).toContain('play');
  });

  it('sanitizes non-finite player times and seeks', async () => {
    reportedCurrentTime = Number.NaN;
    reportedDuration = Number.NaN;
    const handle = youtubePlayerFactory(document.createElement('div'), { onEnded: () => undefined });

    await new Promise((resolve) => setTimeout(resolve, 0));
    ready();

    expect(handle.getCurrentTime()).toBe(0);
    expect(handle.getDuration()).toBe(0);
    handle.seekTo(Number.NaN);
    handle.seekTo(-5);
    expect(calls).not.toContain('seek:NaN');
    expect(calls).toContain('seek:0');
  });

  it('reports the state and duration the player hands over', async () => {
    const handle = youtubePlayerFactory(document.createElement('div'), { onEnded: () => undefined });

    await new Promise((resolve) => setTimeout(resolve, 0));
    ready();
    state(3);

    expect(handle.getState()).toBe(3);
    expect(handle.getCurrentTime()).toBe(42);
    expect(handle.getDuration()).toBe(210);
  });

  it('calls back when a song ends', async () => {
    let ended = 0;
    const handle = youtubePlayerFactory(document.createElement('div'), { onEnded: () => { ended += 1; } });

    await new Promise((resolve) => setTimeout(resolve, 0));
    ready();
    state(0);

    expect(ended).toBe(1);
    expect(handle.getState()).toBe(0);
  });

  it('seeks and controls volume through the handle', async () => {
    const handle = youtubePlayerFactory(document.createElement('div'), { onEnded: () => undefined });

    await new Promise((resolve) => setTimeout(resolve, 0));
    ready();
    handle.seekTo(30);
    handle.setVolume(55);

    expect(calls).toContain('seek:30');
    expect(calls).toContain('volume:55');
    expect(handle.getVolume()).toBe(55);
  });

  it('reports playback errors', async () => {
    let code = 0;
    youtubePlayerFactory(document.createElement('div'), {
      onEnded: () => undefined,
      onError: (next) => { code = next; },
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    options?.events.onError({ data: 150 });

    expect(code).toBe(150);
  });

  it('stops the player when it is destroyed', async () => {
    const handle = youtubePlayerFactory(document.createElement('div'), { onEnded: () => undefined });

    await new Promise((resolve) => setTimeout(resolve, 0));
    ready();
    handle.destroy();

    expect(calls).toContain('destroy');
  });
});
