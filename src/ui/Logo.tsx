export type LogoProps = {
  size?: 'sm' | 'md' | 'lg';
  withWordmark?: boolean;
  className?: string;
};

const sizes = {
  sm: { wordmark: 'text-[1.05rem]', bars: 'h-4 gap-[2px]', bar: 'w-[2px]' },
  md: { wordmark: 'text-[1.35rem]', bars: 'h-5 gap-[3px]', bar: 'w-[2.5px]' },
  lg: { wordmark: 'text-[1.6rem]', bars: 'h-6 gap-[3px]', bar: 'w-[3px]' },
};

const barHeights = ['50%', '100%', '72%', '38%'];

export default function Logo({ size = 'md', withWordmark = true, className = '' }: LogoProps) {
  const scale = sizes[size];
  return (
    <span className={['inline-flex items-center gap-2', className].join(' ')} aria-label="ECHO">
      <span aria-hidden="true" className={['flex items-center', scale.bars].join(' ')}>
        {barHeights.map((height, index) => (
          <span
            key={index}
            className={['rounded-full bg-signal', scale.bar].join(' ')}
            style={{ height }}
          />
        ))}
      </span>
      {withWordmark ? (
        <span className={['font-display font-bold tracking-[-0.035em] text-ink', scale.wordmark].join(' ')}>
          ECHO
        </span>
      ) : null}
    </span>
  );
}
