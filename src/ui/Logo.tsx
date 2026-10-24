export type LogoProps = {
  size?: 'sm' | 'md' | 'lg';
  withWordmark?: boolean;
  className?: string;
};

const sizes = {
  sm: { wordmark: 'text-[1.7rem]', bars: 'h-6 gap-[3px]', bar: 'w-[3px]' },
  md: { wordmark: 'text-[2.05rem]', bars: 'h-8 gap-[4px]', bar: 'w-[3.5px]' },
  lg: { wordmark: 'text-[2.4rem]', bars: 'h-10 gap-[4px]', bar: 'w-[4px]' },
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
            className={['logo-bar rounded-full bg-signal', scale.bar].join(' ')}
            style={{ height, animationDelay: index * -0.22 + 's' }}
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
