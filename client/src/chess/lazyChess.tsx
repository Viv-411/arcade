import { Component, lazy, Suspense, type ComponentType, type ReactNode } from "react";

/**
 * Lazy loading for the chess routes — the ONLY code-split routes in the app.
 * Chess pulls in chess.js + react-chessboard (~145 kB), which nobody playing
 * the other five games should have to download.
 *
 * Splitting a route is not free, though, and this module handles the three
 * ways it can go wrong:
 *
 * 1. STALE CHUNKS. Asset filenames are content-hashed, so a tab left open
 *    across a redeploy asks for a chunk URL that no longer exists on the
 *    server. Without handling, tapping Chess would reject forever and leave a
 *    dead screen. We retry once, then reload the page (guarded so it can never
 *    become a reload loop), then finally show a real error with a way out.
 * 2. A VISIBLE LOADING FLASH. All three chess pages share one Suspense
 *    boundary and one chunk, and `preloadChess()` lets the app start fetching
 *    on intent (hovering the Home card) rather than on navigation.
 * 3. A BLANK SCREEN ON FAILURE. An error boundary renders an actual message
 *    and a retry button instead of an empty page.
 */

const RELOAD_GUARD_KEY = "arcade:chess-chunk-reloaded";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Loader<T> = () => Promise<{ default: T }>;

/** One retry, then a single guarded reload, then give up loudly. */
function resilient<T extends ComponentType<any>>(load: Loader<T>): Loader<T> {
  return async () => {
    try {
      const mod = await load();
      sessionStorage.removeItem(RELOAD_GUARD_KEY);
      return mod;
    } catch {
      // A transient network blip is the common case — just try again.
      try {
        await new Promise((r) => setTimeout(r, 400));
        const mod = await load();
        sessionStorage.removeItem(RELOAD_GUARD_KEY);
        return mod;
      } catch (err) {
        // Two failures usually means the chunk is genuinely gone (redeploy).
        // A fresh page load fetches the new asset manifest and fixes it — but
        // only ever once, so a truly missing chunk can't loop forever.
        if (!sessionStorage.getItem(RELOAD_GUARD_KEY)) {
          sessionStorage.setItem(RELOAD_GUARD_KEY, "1");
          window.location.reload();
          // Never resolves; the reload takes over before React sees this.
          return new Promise<{ default: T }>(() => {});
        }
        throw err;
      }
    }
  };
}

const loadChoice = resilient(() => import("../pages/ChessChoicePage"));
const loadOnline = resilient(() => import("../pages/ChessOnlinePage"));
const loadLocal = resilient(() => import("../pages/ChessLocalPage"));

export const ChessChoicePage = lazy(loadChoice);
export const ChessOnlinePage = lazy(loadOnline);
export const ChessLocalPage = lazy(loadLocal);

/**
 * Start fetching the chess chunk before it is needed — called when someone
 * hovers/touches the Chess card on Home, so by the time they have actually
 * tapped through, the board is usually already there. Safe to call repeatedly:
 * the module registry dedupes, and failures are ignored (navigation will
 * surface them properly through the error boundary).
 */
let preloaded = false;
export function preloadChess(): void {
  if (preloaded) return;
  preloaded = true;
  void loadChoice().catch(() => {
    preloaded = false;
  });
  void loadOnline().catch(() => {
    preloaded = false;
  });
}

function ChessLoading() {
  return (
    <div className="page">
      <div className="panel chess-loading">
        <div className="spinner" />
        <p>Loading the board…</p>
      </div>
    </div>
  );
}

interface BoundaryState {
  failed: boolean;
}

class ChessErrorBoundary extends Component<{ children: ReactNode }, BoundaryState> {
  state: BoundaryState = { failed: false };

  static getDerivedStateFromError(): BoundaryState {
    return { failed: true };
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="page">
        <div className="panel chess-loading">
          <h2>Couldn't load Chess</h2>
          <p className="hint">
            The game's files failed to download. This usually means the site was
            updated while your tab was open.
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

/** One boundary for the whole chess route group — no re-flash between pages. */
export function ChessRouteFrame({ children }: { children: ReactNode }) {
  return (
    <ChessErrorBoundary>
      <Suspense fallback={<ChessLoading />}>{children}</Suspense>
    </ChessErrorBoundary>
  );
}
