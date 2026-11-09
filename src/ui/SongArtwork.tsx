import { MusicNotesIcon } from '@phosphor-icons/react/dist/csr/MusicNotes';

// The CSP already blocks other hosts; refusing here keeps a poisoned API value
// from turning into a browser request at all.
function isAllowedArtwork(src: string): boolean {
  if (src.startsWith('/')) {
    // Browsers treat '\' as '/' in special URLs, so '/\host' is protocol-relative.
    return !src.startsWith('//') && !src.includes('\\');
  }
  let url: URL;
  try {
    url = new URL(src);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:') {
    return false;
  }
  const host = url.hostname;
  return host === 'img.youtube.com' || host === 'ytimg.com' || host.endsWith('.ytimg.com');
}

export type SongArtworkProps = {
  src: string | null | undefined;
  alt?: string;
  className?: string;
  iconSize?: number;
  rounded?: 'media' | 'panel' | 'none';
};

export default function SongArtwork({ src, alt = '', className = '', iconSize = 18, rounded = 'media' }: SongArtworkProps) {
  const radius = rounded === 'none' ? '' : rounded === 'panel' ? 'rounded-panel' : 'rounded-media';
  if (src === null || src === undefined || src.length === 0 || !isAllowedArtwork(src)) {
    return (
      <span
        aria-hidden="true"
        className={['grid shrink-0 place-items-center bg-surface-3 text-ink-3', radius, className].join(' ')}
      >
        <MusicNotesIcon size={iconSize} weight="duotone" />
      </span>
    );
  }
  return (
    <img
      src={src}
      alt={alt}
      className={['shrink-0 object-cover', radius, className].join(' ')}
      loading="lazy"
      decoding="async"
    />
  );
}
