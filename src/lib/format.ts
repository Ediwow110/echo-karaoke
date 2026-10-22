export function formatTime(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds) || seconds < 0) {
    return '0:00';
  }
  const whole = Math.floor(seconds);
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const rest = whole % 60;
  if (hours > 0) {
    return hours + ':' + String(minutes).padStart(2, '0') + ':' + String(rest).padStart(2, '0');
  }
  return minutes + ':' + String(rest).padStart(2, '0');
}

export function formatTotalTime(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds) || seconds <= 0) {
    return '0m';
  }
  const minutes = Math.floor(seconds / 60);
  const rest = Math.floor(seconds % 60);
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    return hours + 'h ' + String(minutes % 60).padStart(2, '0') + 'm';
  }
  return rest > 0 && minutes < 10 ? minutes + 'm ' + rest + 's' : minutes + 'm';
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter((part) => part.length > 0);
  if (parts.length === 0) {
    return '?';
  }
  if (parts.length === 1) {
    return Array.from(parts[0]).slice(0, 2).join('').toUpperCase();
  }
  return (Array.from(parts[0])[0] + Array.from(parts[parts.length - 1])[0]).toUpperCase();
}

export function plural(count: number, one: string, many = one + 's'): string {
  return count === 1 ? one : many;
}

export function groupRoomCode(code: string): string {
  return code.replace(/(.{4})(?=.)/g, '$1 ');
}

export function songCountLabel(count: number): string {
  return count + ' ' + plural(count, 'song');
}

export function queueSummary(
  songs: { durationSeconds: number | null }[],
): string {
  const total = songs.reduce((sum, song) => sum + (song.durationSeconds ?? 0), 0);
  return songCountLabel(songs.length) + (total > 0 ? ' · ' + formatTotalTime(total) : '');
}
