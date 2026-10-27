import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { UpNextList } from '../../src/features/queue/QueueRows';
import type { QueueEntry } from '../../src/features/rooms/useRoomData';
import '@testing-library/jest-dom/vitest';

const song: QueueEntry = {
  songId: 's1',
  videoId: 'dQw4w9WgXcQ',
  title: 'Afterglow',
  channelTitle: null,
  thumbnailUrl: null,
  durationSeconds: null,
  status: 'queued',
  position: 1,
  memberId: 'm1',
  addedBy: 'Ana',
  voteCount: 2,
};

describe('the vote control against the server it is talking to', () => {
  it('renders an unpressed vote when the read predates the viewer flag', () => {
    // A build deployed before migration 0039 receives rows with no
    // votedByViewer key. The control must read as "not voted" rather than
    // crash or show a filled state nobody can explain -- that is what makes
    // the migration and the build safe in either order.
    render(<UpNextList queue={[song]} variant="guest" onVote={() => undefined} />);

    const button = screen.getByRole('button', { name: /second afterglow, 2 votes/i });
    expect(button).toHaveAttribute('aria-pressed', 'false');
    expect(button).toBeEnabled();
  });

  it('fills the vote when the read says this viewer voted', () => {
    render(
      <UpNextList
        queue={[{ ...song, votedByViewer: true }]}
        variant="guest"
        onVote={() => undefined}
      />,
    );

    const button = screen.getByRole('button', { name: /take back your vote for afterglow/i });
    expect(button).toHaveAttribute('aria-pressed', 'true');
  });
});
