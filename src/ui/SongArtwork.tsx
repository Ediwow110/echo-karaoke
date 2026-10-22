import { MusicNotesIcon } from '@phosphor-icons/react';

export type SongArtworkProps = {
  src: string | null | undefined;
  alt?: string;
  className?: string;
  iconSize?: number;
  rounded?: 'media' | 'panel' | 'none';
};

export default function SongArtwork({ src, alt = '', className = '', iconSize = 18, rounded = 'media' }: SongArtworkProps) {
  const radius = rounded === 'none' ? '' : rounded === 'panel' ? 'rounded-panel' : 'rounded-media';
  if (src === null || src === undefined || src.length === 0) {
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
