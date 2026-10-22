import { initials } from '../lib/format';

const tones = [
  'bg-[#51433d] text-gold',
  'bg-[#2f2a45] text-signal',
  'bg-[#263a31] text-live',
  'bg-[#3a2c28] text-gold',
];

function toneFor(name: string): string {
  let hash = 0;
  for (const char of name) {
    hash = (hash * 31 + (char.codePointAt(0) ?? 0)) % tones.length;
  }
  return tones[Math.abs(hash) % tones.length];
}

export type AvatarProps = {
  name: string;
  size?: 'xs' | 'sm' | 'md' | 'lg';
  className?: string;
};

const sizes = {
  xs: 'size-6 text-[0.5rem]',
  sm: 'size-8 text-[0.625rem]',
  md: 'size-9 text-[0.6875rem]',
  lg: 'size-11 text-[0.8125rem]',
};

export default function Avatar({ name, size = 'sm', className = '' }: AvatarProps) {
  return (
    <span
      aria-hidden="true"
      className={[
        'grid shrink-0 place-items-center rounded-full font-semibold tracking-[0.02em]',
        toneFor(name),
        sizes[size],
        className,
      ].join(' ')}
    >
      {initials(name)}
    </span>
  );
}
