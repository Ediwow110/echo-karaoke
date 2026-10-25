export type LogoProps = {
  size?: 'sm' | 'md';
  withWordmark?: boolean;
  className?: string;
  /**
   * Extra classes for the wordmark only, for headers where the brand competes
   * with actions for the same few pixels on a phone.
   */
  wordmarkClassName?: string;
};

// Each wordmark scales with the viewport but never below the size that still
// reads as the brand, and never above the size used on a wide screen.
const sizes = {
  sm: { wordmark: 'text-[clamp(1.05rem,4.4vw,1.7rem)]', bars: 'h-6 gap-[3px]', bar: 'w-[3px]' },
  md: { wordmark: 'text-[clamp(1.2rem,5vw,2.05rem)]', bars: 'h-8 gap-[4px]', bar: 'w-[3.5px]' },
};

const barHeights = ['50%', '100%', '72%', '38%'];

export default function Logo({ size = 'md', withWordmark = true, className = '', wordmarkClassName = '' }: LogoProps) {
  const scale = sizes[size];
  return (
    <span className={['inline-flex items-center gap-2', className].join(' ')} aria-label="kara-echo">
      <span aria-hidden="true" className={['flex shrink-0 items-center', scale.bars].join(' ')}>
        {barHeights.map((height, index) => (
          <span
            key={index}
            className={['logo-bar rounded-full bg-signal', scale.bar].join(' ')}
            style={{ height, animationDelay: index * -0.22 + 's' }}
          />
        ))}
      </span>
      {withWordmark ? (
        <span className={[
          'whitespace-nowrap font-display font-bold tracking-[-0.035em] text-ink',
          scale.wordmark,
          wordmarkClassName,
        ].join(' ')}>
          kara-echo
        </span>
      ) : null}
    </span>
  );
}
