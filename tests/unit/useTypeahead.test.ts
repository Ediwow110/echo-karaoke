import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useTypeahead } from '../../src/features/queue/useTypeahead';

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('typeahead', () => {
  it('waits for the typing pause before asking the source', async () => {
    const source = vi.fn().mockResolvedValue(['abba songs']);
    const { result } = renderHook(() => useTypeahead(source, 250));

    act(() => {
      result.current.setQuery('abb');
    });

    expect(source).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(250);
    });

    expect(source).toHaveBeenCalledTimes(1);
    expect(source).toHaveBeenCalledWith('abb');
    expect(result.current.suggestions).toEqual(['abba songs']);
  });

  it('collapses fast typing into a single request for the last term', async () => {
    const source = vi.fn().mockResolvedValue([]);
    const { result } = renderHook(() => useTypeahead(source, 250));

    act(() => { result.current.setQuery('a'); });
    await act(async () => { vi.advanceTimersByTime(100); });
    act(() => { result.current.setQuery('ab'); });
    await act(async () => { vi.advanceTimersByTime(100); });
    act(() => { result.current.setQuery('abb'); });
    await act(async () => { vi.advanceTimersByTime(250); });

    expect(source).toHaveBeenCalledTimes(1);
    expect(source).toHaveBeenCalledWith('abb');
  });

  it('does not ask for very short terms', async () => {
    const source = vi.fn().mockResolvedValue([]);
    const { result } = renderHook(() => useTypeahead(source, 250));

    act(() => { result.current.setQuery('a'); });
    await act(async () => { vi.advanceTimersByTime(500); });

    expect(source).not.toHaveBeenCalled();
    expect(result.current.suggestions).toEqual([]);
  });

  it('clears suggestions when the query is emptied', async () => {
    const source = vi.fn().mockResolvedValue(['abba songs']);
    const { result } = renderHook(() => useTypeahead(source, 250));

    act(() => { result.current.setQuery('abb'); });
    await act(async () => { vi.advanceTimersByTime(250); });
    expect(result.current.suggestions).toHaveLength(1);

    act(() => { result.current.setQuery(''); });
    await act(async () => { vi.advanceTimersByTime(250); });

    expect(result.current.suggestions).toEqual([]);
  });

  it('keeps the last results when the source fails', async () => {
    const source = vi.fn()
      .mockResolvedValueOnce(['good'])
      .mockRejectedValueOnce(new Error('offline'));
    const { result } = renderHook(() => useTypeahead(source, 250));

    act(() => { result.current.setQuery('abb'); });
    await act(async () => { vi.advanceTimersByTime(250); });
    expect(result.current.suggestions).toEqual(['good']);

    act(() => { result.current.setQuery('abba'); });
    await act(async () => { vi.advanceTimersByTime(250); });

    expect(result.current.suggestions).toEqual(['good']);
  });
});
