import { Component, type ErrorInfo, type ReactNode } from 'react';

type Props = { children: ReactNode };
type State = { failed: boolean };

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('ECHO could not render this screen', error.name, info.componentStack);
  }

  render() {
    if (this.state.failed) {
      return (
        <main className="grid min-h-dvh place-items-center bg-graphite px-4 text-ink">
          <div className="w-full max-w-[30rem] rounded-panel border border-line bg-surface p-6">
            <h1 className="font-display text-[1.9rem] font-bold tracking-[-0.02em]">This screen stopped.</h1>
            <p role="alert" className="mt-3 text-[0.8125rem] leading-[1.6] text-ink-2">
              The room data is safe. Reload to reconnect to the host screen.
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="mt-5 inline-flex min-h-11 items-center rounded-media bg-signal-fill px-4 text-[0.8125rem] font-semibold text-signal-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
            >
              Reload ECHO
            </button>
          </div>
        </main>
      );
    }
    return this.props.children;
  }
}
