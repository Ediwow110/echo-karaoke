import { Logo } from '../ui';

type Props = {
  hostName: string;
  roomName: string;
};

export default function WaitingRoom({ hostName, roomName }: Props) {
  return (
    <div className="min-h-dvh bg-graphite text-ink">
      <header className="border-b border-line px-4 py-4">
        <Logo size="sm" />
      </header>
      <main className="mx-auto flex w-full max-w-[30rem] flex-col items-start gap-4 px-4 py-10">
        <p className="eyebrow text-gold">Waiting at the door</p>
        <h1 className="font-display text-[1.9rem] font-bold leading-[1.05] tracking-[-0.03em]">
          {roomName}
        </h1>
        <p role="status" className="text-[0.9375rem] leading-[1.6] text-ink-2">
          {hostName} needs to let you in. This screen opens by itself once they do.
        </p>
      </main>
    </div>
  );
}
