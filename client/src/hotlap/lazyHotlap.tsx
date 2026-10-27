import { Component, lazy, Suspense, type ComponentType, type ReactNode } from "react";

/**
 * Lazy loading for the Hotlap routes. Hotlap pulls in three.js (~600 kB),
 * which nobody playing the party games should download. Same resilience
 * strategy as chess/lazyChess.tsx: retry once, then one session-guarded
 * reload (stale chunks after a redeploy), then a real error screen.
 *
 * Do NOT add a manualChunks entry for this split — Vite would then
 * modulepreload it from index.html for every visitor (see CLAUDE.md).
 */
const RELOAD_GUARD_KEY = "arcade:hotlap-chunk-reloaded";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Loader<T> = () => Promise<{ default: T }>;

function resilient<T extends ComponentType<any>>(load: Loader<T>): Loader<T> {
  return async () => {
    try {
      const mod = await load();
      sessionStorage.removeItem(RELOAD_GUARD_KEY);
      return mod;
    } catch {
      try {
        await new Promise((r) => setTimeout(r, 400));
        const mod = await load();
        sessionStorage.removeItem(RELOAD_GUARD_KEY);
        return mod;
      } catch (err) {
        if (!sessionStorage.getItem(RELOAD_GUARD_KEY)) {
          sessionStorage.setItem(RELOAD_GUARD_KEY, "1");
          window.location.reload();
          return new Promise<{ default: T }>(() => {});
        }
        throw err;
      }
    }
  };
}

const loadHub = resilient(() => import("../pages/HotlapHubPage"));
const loadPlay = resilient(() => import("../pages/HotlapPlayPage"));

export const HotlapHubPage = lazy(loadHub);
export const HotlapPlayPage = lazy(loadPlay);

let preloaded = false;
/** Start fetching on intent (hovering the Home card). Safe to call repeatedly. */
export function preloadHotlap(): void {
  if (preloaded) return;
  preloaded = true;
  void loadHub().catch(() => {
    preloaded = false;
  });
}

function HotlapLoading() {
  return (
    <div className="page">
      <div className="panel chess-loading">
        <div className="spinner" />
        <p>Warming up the engine…</p>
      </div>
    </div>
  );
}

class HotlapErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="page">
        <div className="panel chess-loading">
          <h2>Couldn't load Hotlap</h2>
          <p className="hint">
            The game's files failed to download. This usually means the site was updated while
            your tab was open.
          </p>
          <button
            className="btn primary"
            onClick={() => {
              sessionStorage.removeItem(RELOAD_GUARD_KEY);
              window.location.reload();
            }}
          >
            Reload the page
          </button>
        </div>
      </div>
    );
  }
}

export function HotlapRouteFrame({ children }: { children: ReactNode }) {
  return (
    <HotlapErrorBoundary>
      <Suspense fallback={<HotlapLoading />}>{children}</Suspense>
    </HotlapErrorBoundary>
  );
}
