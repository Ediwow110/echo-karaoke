import { useEffect, useRef, useState } from 'react';

export const MIN_QUERY_LENGTH = 2;
export const DEFAULT_DEBOUNCE_MS = 250;

export type TypeaheadState = {
  query: string;
  setQuery: (value: string) => void;
  suggestions: string[];
  loading: boolean;
};

// Asks the source for suggestions once typing pauses, so the list keeps up
// with what the singer is typing without a request per keystroke.
export function useTypeahead(
  source: (query: string) => Promise<string[]>,
  debounceMs: number = DEFAULT_DEBOUNCE_MS,
): TypeaheadState {
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const sourceRef = useRef(source);
  const requestId = useRef(0);

  useEffect(() => {
    sourceRef.current = source;
  }, [source]);

  useEffect(() => {
    const trimmed = query.trim();

    if (trimmed.length < MIN_QUERY_LENGTH) {
      setSuggestions([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    const current = requestId.current + 1;
    requestId.current = current;

    const timer = setTimeout(() => {
      void sourceRef.current(trimmed)
        .then((next) => {
          if (requestId.current !== current) return;
          setSuggestions(next);
        })
        .catch(() => {
          // Keep the previous list; a failed lookup should not wipe the input.
        })
        .finally(() => {
          if (requestId.current === current) setLoading(false);
        });
    }, debounceMs);

    return () => {
      clearTimeout(timer);
    };
  }, [query, debounceMs]);

  return { query, setQuery, suggestions, loading };
}
