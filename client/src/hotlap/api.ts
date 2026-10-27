/** Thin fetch wrappers for the Hotlap records API (contract: shared/hotlap/api.ts). */
import type {
  ApiError,
  LeaderboardResponse,
  MyRecordsResponse,
  ReplayResponse,
  SubmitRunRequest,
  SubmitRunResponse,
} from "@shared/hotlap/api";
import { getAccessToken } from "../auth/supabaseClient";

export class HotlapApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function call<T>(path: string, init: RequestInit = {}, auth = false): Promise<T> {
  const headers: Record<string, string> = { ...(init.headers as Record<string, string>) };
  const token = getAccessToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  else if (auth) throw new HotlapApiError(401, "Sign in to post your times.");
  let res: Response;
  try {
    res = await fetch(`/api/hotlap${path}`, { ...init, headers });
  } catch {
    throw new HotlapApiError(0, "Couldn't reach the server.");
  }
  if (!res.ok) {
    let msg = `Request failed (${res.status})`;
    try {
      msg = ((await res.json()) as ApiError).error || msg;
    } catch {
      /* non-JSON error */
    }
    throw new HotlapApiError(res.status, msg);
  }
  return (await res.json()) as T;
}

export const fetchLeaderboard = (trackId: string, limit = 50) =>
  call<LeaderboardResponse>(`/leaderboard/${encodeURIComponent(trackId)}?limit=${limit}`);

export const fetchReplay = (runId: string) => call<ReplayResponse>(`/replays/${encodeURIComponent(runId)}`);

export const fetchMyRecords = () => call<MyRecordsResponse>("/me", {}, true);

export const submitRun = (body: SubmitRunRequest) =>
  call<SubmitRunResponse>(
    "/runs",
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
    true,
  );
