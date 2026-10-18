import { createElement } from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import App from '../../src/app/App';
import '@testing-library/jest-dom/vitest';

describe('karaoke home screen', () => {
  it('offers clearly labeled room entry points', () => {
    render(createElement(App));

    expect(screen.getByRole('button', { name: /create room/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /join room/i })).toBeInTheDocument();
  });
});
