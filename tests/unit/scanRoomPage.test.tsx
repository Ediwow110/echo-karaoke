import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import ScanRoomPage from '../../src/features/scan/ScanRoomPage';
import '@testing-library/jest-dom/vitest';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function mockCamera(result: 'granted' | 'denied'): void {
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: {
      getUserMedia: result === 'granted'
        ? async () => ({ getTracks: () => [{ stop: () => undefined }] })
        : async () => { throw new Error('Permission denied'); },
    },
  });
}

function renderScan() {
  return render(
    createElement(
      MemoryRouter,
      { initialEntries: ['/scan'] },
      createElement(
        Routes,
        { children: createElement(Route, { path: '/scan', element: createElement(ScanRoomPage) }) },
      ),
    ),
  );
}

describe('scan room screen', () => {
  it('asks the camera for a view and shows a viewfinder', async () => {
    mockCamera('granted');
    renderScan();
    expect(await screen.findByText(/point at the code on the host screen/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /back/i })).toBeInTheDocument();
  });

  it('explains a blocked camera and offers the typed code', async () => {
    mockCamera('denied');
    renderScan();
    expect(await screen.findByText(/the camera is not available/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /type the code/i })).toBeInTheDocument();
  });
});
