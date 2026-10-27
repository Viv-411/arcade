/**
 * Hotlap verified leaderboard: store + off-thread verifier + HTTP routes.
 * Mount the returned router at /api/hotlap (after optionalAuth).
 */
import { createHotlapRouter } from "./routes.js";
import { createHotlapStore } from "./store.js";
import { ReplayVerifier } from "./verifier.js";

export async function createHotlapApi(sqlitePath: string) {
  const store = await createHotlapStore(sqlitePath);
  const verifier = new ReplayVerifier();
  return createHotlapRouter(store, verifier);
}
