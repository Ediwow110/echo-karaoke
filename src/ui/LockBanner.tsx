import { LockKeyIcon } from '@phosphor-icons/react';

export type LockBannerProps = {
  text: string;
};

export default function LockBanner({ text }: LockBannerProps) {
  return (
    <p role="status" className="flex items-center gap-2 border-t border-line bg-surface-2 px-4 py-2.5 text-[0.8125rem] text-ink-2 sm:px-6">
      <LockKeyIcon size={18} weight="duotone" className="shrink-0 text-signal" aria-hidden="true" />
      {text}
    </p>
  );
}
