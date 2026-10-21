import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { PlayIcon } from '@phosphor-icons/react';
import { Button, Chip, Field, IconButton, Panel, QueueRow, RosterRow, TransportButton } from '../../src/ui';
import '@testing-library/jest-dom/vitest';

afterEach(() => {
  cleanup();
});

const song = {
  songId: 's1',
  title: 'Dancing Queen',
  channelTitle: 'ABBA',
  thumbnailUrl: null,
  position: 1,
  addedBy: 'Ana',
  voteCount: 3,
};

describe('ui primitives', () => {
  it('pairs an icon with the label of a button', () => {
    render(createElement(Button, { icon: createElement(PlayIcon, { 'aria-hidden': true }), size: 'md' }, 'Start a room'));
    const button = screen.getByRole('button', { name: 'Start a room' });
    expect(button).toBeInTheDocument();
    expect(button.querySelector('svg')).toBeInTheDocument();
  });

  it('gives an icon only button an accessible name and a tooltip', () => {
    render(createElement(IconButton, { icon: createElement(PlayIcon, { 'aria-hidden': true }), label: 'Play' }));
    const button = screen.getByRole('button', { name: 'Play' });
    expect(button).toBeInTheDocument();
    expect(button.closest('.tooltip')).toHaveAttribute('data-tooltip', 'Play');
  });

  it('keeps the label of a field above the input and the error below it', () => {
    render(createElement(Field, { id: 'name', label: 'Host name', error: 'That name is taken.' }));
    expect(screen.getByLabelText('Host name')).toBeInTheDocument();
    expect(screen.getByText('That name is taken.')).toBeInTheDocument();
  });

  it('marks an invalid field for assistive technology', () => {
    render(createElement(Field, { id: 'code', label: 'Room code', error: 'That code is wrong.' }));
    expect(screen.getByLabelText('Room code')).toHaveAttribute('aria-invalid', 'true');
  });

  it('renders a panel title with its icon', () => {
    render(createElement(Panel, { title: 'Up next', icon: createElement(PlayIcon, { 'aria-hidden': true }), children: 'body' }));
    expect(screen.getByRole('heading', { name: /up next/i })).toBeInTheDocument();
  });

  it('shows the title and the attribution of a queue row', () => {
    render(createElement(QueueRow, { song }));
    expect(screen.getByText('Dancing Queen')).toBeInTheDocument();
    expect(screen.getByText(/added by Ana/i)).toBeInTheDocument();
    expect(screen.getByLabelText('3 votes')).toBeInTheDocument();
  });

  it('offers a vote control when voting is wired up', () => {
    render(createElement(QueueRow, { song, onVote: () => {} }));
    expect(screen.getByRole('button', { name: /vote for dancing queen/i })).toBeInTheDocument();
  });

  it('shows the presence of a participant and marks the host', () => {
    render(createElement(RosterRow, { name: 'Ana', online: true, isHost: true }));
    expect(screen.getByText('Ana')).toBeInTheDocument();
    expect(screen.getByText('Host')).toBeInTheDocument();
  });

  it('gives a transport button an accessible name', () => {
    render(createElement(TransportButton, { icon: createElement(PlayIcon, { 'aria-hidden': true }), label: 'Play', onClick: () => {} }));
    expect(screen.getByRole('button', { name: 'Play' })).toBeInTheDocument();
  });

  it('renders a chip with its text', () => {
    render(createElement(Chip, null, 'ABCD EFGH'));
    expect(screen.getByText('ABCD EFGH')).toBeInTheDocument();
  });
});
