import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getFavoriteSongs,
  getLibrary,
  getRecent,
  isFavorite,
  rememberPlayed,
  rememberSongs,
  subscribeLibrary,
  toggleFavorite,
} from '../../src/features/library/libraryStore';

const song = {
  videoId: 'dQw4w9WgXcQ',
  title: 'Never Gonna Give You Up',
  channelTitle: 'Rick Astley',
  thumbnailUrl: null,
  durationSeconds: 213,
};

const other = {
  videoId: 'M7lc1UVf-VE',
  title: 'Embedded Player',
  channelTitle: 'Google for Developers',
  thumbnailUrl: null,
  durationSeconds: 1343,
};

beforeEach(() => {
  localStorage.clear();
});

describe('the local song library', () => {
  it('remembers a song once and keeps its metadata', () => {
    rememberSongs([song]);
    rememberSongs([song]);

    const library = getLibrary();
    expect(library).toHaveLength(1);
    expect(library[0]).toMatchObject({ videoId: song.videoId, title: song.title, channelTitle: song.channelTitle });
  });

  it('toggles a favorite and returns favorite songs only', () => {
    expect(isFavorite(song.videoId)).toBe(false);
    expect(toggleFavorite(song)).toBe(true);
    expect(isFavorite(song.videoId)).toBe(true);
    expect(getFavoriteSongs().map((entry) => entry.videoId)).toEqual([song.videoId]);

    expect(toggleFavorite(song)).toBe(false);
    expect(getFavoriteSongs()).toHaveLength(0);
  });

  it('puts the latest played song first and does not repeat it', () => {
    rememberPlayed([song]);
    rememberPlayed([other]);
    rememberPlayed([song]);

    const recent = getRecent();
    expect(recent.map((entry) => entry.videoId)).toEqual([song.videoId, other.videoId]);
    expect(recent[0].playedAt <= new Date().toISOString()).toBe(true);
  });

  it('notifies subscribers when the collection changes', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeLibrary(listener);
    rememberSongs([song]);
    toggleFavorite(song);

    expect(listener).toHaveBeenCalledTimes(3);
    unsubscribe();
    rememberSongs([other]);
    expect(listener).toHaveBeenCalledTimes(3);
  });

  it('ignores malformed stored data', () => {
    localStorage.setItem('karaoke.library', '{not json');
    localStorage.setItem('karaoke.favorites', '{"bad":true}');
    localStorage.setItem('karaoke.recent', 'null');

    expect(getLibrary()).toEqual([]);
    expect(getFavoriteSongs()).toEqual([]);
    expect(getRecent()).toEqual([]);
  });

  it('keeps the collection in memory when storage rejects writes', async () => {
    vi.resetModules();
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    const store = await import('../../src/features/library/libraryStore');

    store.rememberSongs([song]);
    expect(store.getLibrary().map((entry) => entry.videoId)).toEqual([song.videoId]);

    setItem.mockRestore();
  });
});
