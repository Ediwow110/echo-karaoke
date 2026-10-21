import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeftIcon, KeyboardIcon, QrCodeIcon } from '@phosphor-icons/react';
import jsQR from 'jsqr';
import { roomCodeFromScan } from './roomCodeFromScan';

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
        return;
      }
      video.srcObject = stream;
      await Promise.resolve(video.play()).catch(() => undefined);
      if (cancelled) {
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
            setMessage('That code is not an Encore room.');
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
    <main className="relative min-h-dvh bg-graphite text-ink">
      <video
        ref={videoRef}
        className="absolute inset-0 h-full w-full object-cover"
        playsInline
        muted
        aria-label="Camera preview"
      />
      <canvas ref={canvasRef} className="hidden" aria-hidden="true" />

      <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(10,11,14,0.75),rgba(10,11,14,0.25)_35%,rgba(10,11,14,0.92))]" aria-hidden="true" />

      <header className="relative z-10 flex items-center justify-between px-4 py-4 sm:px-6">
        <Link
          to="/"
          className="inline-flex items-center gap-2 rounded-panel border border-line bg-graphite/80 px-3 py-2 text-[0.875rem] text-ink backdrop-blur transition-colors hover:border-line-strong"
        >
          <ArrowLeftIcon size={18} weight="bold" aria-hidden="true" />
          Back
        </Link>
        <p className="font-mono text-[0.6875rem] uppercase tracking-[0.18em] text-signal">Scan a room</p>
      </header>

      <div className="relative z-10 flex min-h-[70dvh] flex-col items-center justify-center px-4 text-center">
        <div className="relative grid size-[62vmin] max-h-[22rem] max-w-[22rem] place-items-center">
          <span className="absolute inset-0 rounded-panel border-2 border-signal/70" aria-hidden="true" />
          <span className="absolute -left-2 -top-2 size-8 rounded-tl-lg border-l-4 border-t-4 border-signal" aria-hidden="true" />
          <span className="absolute -right-2 -top-2 size-8 rounded-tr-lg border-r-4 border-t-4 border-signal" aria-hidden="true" />
          <span className="absolute -bottom-2 -left-2 size-8 rounded-bl-lg border-b-4 border-l-4 border-signal" aria-hidden="true" />
          <span className="absolute -bottom-2 -right-2 size-8 rounded-br-lg border-b-4 border-r-4 border-signal" aria-hidden="true" />
          <QrCodeIcon size={56} weight="duotone" className="text-signal/70" aria-hidden="true" />
        </div>

        {blocked ? (
          <div className="mt-8 max-w-[26rem] rounded-panel border border-line bg-graphite/85 p-5 backdrop-blur">
            <p className="font-display text-lg font-semibold">The camera is not available</p>
            <p className="mt-2 text-[0.875rem] leading-relaxed text-ink-2">
              Allow camera access for this site, or type the sixteen character code the host reads out.
            </p>
            <Link
              to="/"
              className="mt-4 inline-flex items-center gap-2 rounded-panel border border-line bg-surface-2 px-4 py-2.5 text-[0.875rem] font-semibold text-ink transition-colors hover:bg-surface-3"
            >
              <KeyboardIcon size={18} weight="duotone" aria-hidden="true" />
              Type the code instead
            </Link>
          </div>
        ) : (
          <p className="mt-8 max-w-[24rem] text-[0.9375rem] text-ink-2">
            Point at the code on the host screen.
          </p>
        )}

        {message === null ? null : (
          <p role="status" className="mt-4 rounded-media border-l-2 border-danger bg-danger/10 px-3 py-2 text-[0.875rem] text-danger">
            {message}
          </p>
        )}
      </div>
    </main>
  );
}
