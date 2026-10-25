import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeftIcon } from '@phosphor-icons/react/dist/csr/ArrowLeft';
import { KeyboardIcon } from '@phosphor-icons/react/dist/csr/Keyboard';
import { QrCodeIcon } from '@phosphor-icons/react/dist/csr/QrCode';
import jsQR from 'jsqr';
import { roomCodeFromScan } from './roomCodeFromScan';
import { Logo } from '../../ui';

type CameraState = 'starting' | 'scanning' | 'blocked' | 'unsupported';

const SCAN_INTERVAL_MS = 120;

/**
 * The phone camera reads the room code from the host screen and sends the
 * guest straight to the join page, where a name gives them the remote.
 */
export default function ScanRoomPage() {
  const navigate = useNavigate();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [camera, setCamera] = useState<CameraState>('starting');
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (navigator.mediaDevices?.getUserMedia === undefined) {
      setCamera('unsupported');
      return;
    }

    let cancelled = false;
    let stream: MediaStream | null = null;
    let timer = 0;

    async function start(): Promise<void> {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
          audio: false,
        });
      } catch {
        if (!cancelled) {
          setCamera('blocked');
        }
        return;
      }

      if (cancelled) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      const video = videoRef.current;
      if (video === null) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      video.srcObject = stream;
      try {
        await video.play();
      } catch {
        // Permission to open the camera does not guarantee the browser will
        // start the preview. Don't leave tracks running behind a dead scanner.
        stream.getTracks().forEach((track) => track.stop());
        video.srcObject = null;
        if (!cancelled) setCamera('blocked');
        return;
      }
      if (cancelled) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      setCamera('scanning');

      const canvas = canvasRef.current;
      const context = canvas?.getContext('2d', { willReadFrequently: true }) ?? null;

      const scan = (): void => {
        if (cancelled) {
          return;
        }
        if (video.readyState === video.HAVE_ENOUGH_DATA && video.videoWidth > 0 && context !== null && canvas !== null) {
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          context.drawImage(video, 0, 0, canvas.width, canvas.height);
          const image = context.getImageData(0, 0, canvas.width, canvas.height);
          const decoded = jsQR(image.data, image.width, image.height, { inversionAttempts: 'dontInvert' });
          if (decoded !== null) {
            const code = roomCodeFromScan(decoded.data);
            if (code !== null) {
              navigate('/join/' + code);
              return;
            }
            setMessage('That code is not a kara-echo room.');
          }
        }
        timer = window.setTimeout(scan, SCAN_INTERVAL_MS);
      };

      timer = window.setTimeout(scan, SCAN_INTERVAL_MS);
    }

    void start();

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, [navigate]);

  const blocked = camera === 'blocked' || camera === 'unsupported';

  return (
    <main className="relative min-h-dvh overflow-hidden bg-graphite-deep text-ink">
      <video
        ref={videoRef}
        className="absolute inset-0 h-full w-full object-cover"
        playsInline
        muted
        aria-label="Camera preview"
      />
      <canvas ref={canvasRef} className="hidden" aria-hidden="true" />

      <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(16,13,24,0.85),rgba(16,13,24,0.2)_38%,rgba(16,13,24,0.95))]" aria-hidden="true" />

      <header className="relative z-10 flex items-center justify-between px-4 py-4 sm:px-6">
        <Link to="/" aria-label="kara-echo home">
          <Logo size="sm" />
        </Link>
        <Link
          to="/join"
          className="inline-flex items-center gap-2 rounded-media border border-line bg-graphite/80 px-3 py-2 text-[0.75rem] font-semibold text-ink backdrop-blur transition-colors hover:border-line-strong"
        >
          <ArrowLeftIcon size={15} weight="bold" aria-hidden="true" />
          Type a code
        </Link>
      </header>

      <div className="page-enter relative z-10 flex min-h-[76dvh] flex-col items-center justify-center px-5 text-center">
        <p className="eyebrow text-gold">Phone remote</p>
        <h1 className="mt-2 font-display text-[2.3rem] font-bold leading-[1.03] tracking-[-0.04em]">Scan the room QR.</h1>
        <p className="mt-2 max-w-[30ch] text-[0.8125rem] leading-[1.6] text-ink-2">
          Point the camera at the code on the host screen. You will add your name next.
        </p>

        <div className="relative mt-7 grid size-[62vmin] max-h-[20rem] max-w-[20rem] place-items-center">
          <span className="absolute inset-0 rounded-[1.4rem] border border-signal/40 bg-graphite-deep/20 backdrop-blur-[1px]" aria-hidden="true" />
          <span className="absolute -left-1.5 -top-1.5 size-9 rounded-tl-xl border-l-2 border-t-2 border-signal" aria-hidden="true" />
          <span className="absolute -right-1.5 -top-1.5 size-9 rounded-tr-xl border-r-2 border-t-2 border-signal" aria-hidden="true" />
          <span className="absolute -bottom-1.5 -left-1.5 size-9 rounded-bl-xl border-b-2 border-l-2 border-signal" aria-hidden="true" />
          <span className="absolute -bottom-1.5 -right-1.5 size-9 rounded-br-xl border-b-2 border-r-2 border-signal" aria-hidden="true" />
          <QrCodeIcon size={54} weight="duotone" className={camera === 'scanning' ? 'text-signal/40' : 'text-signal/75 animate-presence-pulse'} aria-hidden="true" />
        </div>

        {blocked ? (
          <div className="mt-7 w-full max-w-[26rem] rounded-panel border border-line bg-graphite/90 p-5 text-left backdrop-blur">
            <p className="font-display text-[1.25rem] font-bold tracking-[-0.02em]">The camera is not available.</p>
            <p className="mt-2 text-[0.8125rem] leading-[1.6] text-ink-2">
              Allow camera access for this site, or type the sixteen character code the host can read out.
            </p>
            <Link
              to="/join"
              className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-media border border-line bg-surface-2 px-4 text-[0.75rem] font-semibold text-ink transition-colors hover:bg-surface-3"
            >
              <KeyboardIcon size={16} weight="duotone" aria-hidden="true" />
              Type the code instead
            </Link>
          </div>
        ) : (
          <p className="mt-7 max-w-[24rem] text-[0.75rem] text-ink-2">
            {camera === 'starting' ? 'Starting the camera…' : 'Point at the code on the host screen.'}
          </p>
        )}

        {message === null ? null : (
          <p role="status" className="mt-4 rounded-media border border-danger/30 bg-danger-soft/50 px-3 py-2 text-[0.8125rem] text-danger">
            {message}
          </p>
        )}
      </div>
    </main>
  );
}
