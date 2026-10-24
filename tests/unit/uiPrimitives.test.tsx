import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { PlayIcon } from '@phosphor-icons/react';
import { Button, Chip, Field, IconButton, Toggle, TransportButton } from '../../src/ui';
import '@testing-library/jest-dom/vitest';

afterEach(() => {
  cleanup();
});

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

  it('gives a transport button an accessible name', () => {
    render(createElement(TransportButton, { icon: createElement(PlayIcon, { 'aria-hidden': true }), label: 'Play', onClick: () => {} }));
    expect(screen.getByRole('button', { name: 'Play' })).toBeInTheDocument();
  });

  it('renders a chip with its text', () => {
    render(createElement(Chip, null, 'ABCD EFGH'));
    expect(screen.getByText('ABCD EFGH')).toBeInTheDocument();
  });

  it('exposes permissions as a labelled switch', () => {
    const changes: boolean[] = [];
    render(createElement(Toggle, {
      checked: false,
      onChange: (next: boolean) => changes.push(next),
      label: 'Guests can add songs',
      description: 'Let everyone add to the queue.',
    }));

    const toggle = screen.getByRole('switch', { name: 'Guests can add songs' });
    expect(toggle).not.toBeChecked();
    fireEvent.click(toggle);
    expect(changes).toEqual([true]);
  });
});
