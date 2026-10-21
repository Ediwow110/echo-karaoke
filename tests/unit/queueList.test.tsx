import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import QueueList from '../../src/features/queue/QueueList';
import '@testing-library/jest-dom/vitest';

afterEach(() => {
  cleanup();
});

const queue = [
  {
    songId: 's1',
    videoId: 'dQw4w9WgXcQ',
    title: 'First Song',
    channelTitle: 'Channel',
    thumbnailUrl: null,
    durationSeconds: null,
    status: 'queued',
    position: 1,
    memberId: 'm1',
    addedBy: 'Ana',
    voteCount: 3,
  },
  {
    songId: 's2',
    videoId: 'abc123XYZ_-',
    title: 'Second Song',
    channelTitle: null,
    thumbnailUrl: null,
    durationSeconds: null,
    status: 'queued',
    position: 2,
    memberId: 'm2',
    addedBy: 'Sam',
    voteCount: 0,
  },
];

describe('queue list', () => {
  it('shows positions, attribution and vote counts', () => {
    render(createElement(QueueList, { queue }));

    expect(screen.getByText('First Song')).toBeInTheDocument();
    expect(screen.getByText(/added by Ana/)).toBeInTheDocument();
    expect(screen.getByLabelText('3 votes')).toBeInTheDocument();
    expect(screen.getByLabelText('0 votes')).toBeInTheDocument();
  });

  it('offers a vote button when voting is wired up', async () => {
    const voted: string[] = [];
    render(createElement(QueueList, { queue, onVote: (songId) => voted.push(songId) }));

    fireEvent.click(screen.getByRole('button', { name: /vote for first song/i }));

    await waitFor(() => {
      expect(voted).toEqual(['s1']);
    });
  });

  it('disables voting while guests are locked', () => {
    render(createElement(QueueList, { queue, onVote: () => {}, votingDisabled: true }));

    expect(screen.getByRole('button', { name: /vote for first song/i })).toBeDisabled();
  });

  it('explains an empty queue', () => {
    render(createElement(QueueList, { queue: [] }));

    expect(screen.getByText(/no songs yet/i)).toBeInTheDocument();
  });
});
