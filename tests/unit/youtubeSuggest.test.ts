import { describe, expect, it } from 'vitest';
import { MAX_SUGGESTIONS, parseSuggestions } from '../../supabase/functions/_shared/youtube';

describe('youtube suggestions', () => {
  it('reads the suggestion list from the autocomplete payload', () => {
    const payload = ['abba', ['abba songs', 'abba karaoke', 'abba medley'], [], {}];
    expect(parseSuggestions(payload)).toEqual(['abba songs', 'abba karaoke', 'abba medley']);
  });

  it('caps the list', () => {
    const many = Array.from({ length: 30 }, (_, i) => 'song ' + i);
    expect(parseSuggestions(['x', many])).toHaveLength(MAX_SUGGESTIONS);
  });

  it('drops blanks, non strings and duplicates', () => {
    const payload = ['x', ['Song', '  ', 'Song', 42, null, 'Other']];
    expect(parseSuggestions(payload)).toEqual(['Song', 'Other']);
  });

  it('returns an empty list for malformed payloads', () => {
    expect(parseSuggestions(null)).toEqual([]);
    expect(parseSuggestions('nope')).toEqual([]);
    expect(parseSuggestions([])).toEqual([]);
    expect(parseSuggestions(['only-query'])).toEqual([]);
    expect(parseSuggestions(['x', 'not-an-array'])).toEqual([]);
  });
});
