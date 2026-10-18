import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import QueueList from '../../src/features/queue/QueueList';
import '@testing-library/jest-dom/vitest';

afterEach(() => {
  cleanup();
});

const own = {
  songId: 's1', videoId: 'dQw4w9WgXcQ', title: 'My Song', channelTitle: null, thumbnailUrl: null,
  durationSeconds: null, status: 'queued', position: 1, memberId: 'me', addedBy: 'Me', voteCount: 0,
};
const other = { ...own, songId: 's2', title: 'Their Song', position: 2, memberId: 'them', addedBy: 'Them' };

describe('queue removal', () => {
  it('offers remove only where the caller may remove', () => {
    render(createElement(QueueList, {
      queue: [own, other],
      onRemove: () => {},
      canRemove: (song) => song.memberId === 'me',
    }));

    expect(screen.getByRole('button', { name: /remove my song/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /remove their song/i })).toBeNull();
  });

  it('reports the removed song', async () => {
    const removed: string[] = [];
    render(createElement(QueueList, {
      queue: [own],
      onRemove: (songId) => removed.push(songId),
    }));

    fireEvent.click(screen.getByRole('button', { name: /remove my song/i }));

    await waitFor(() => {
      expect(removed).toEqual(['s1']);
    });
  });

  it('disables removal while guests are locked', () => {
    render(createElement(QueueList, {
      queue: [own],
      onRemove: () => {},
      removingDisabled: true,
    }));

    expect(screen.getByRole('button', { name: /remove my song/i })).toBeDisabled();
  });
});
