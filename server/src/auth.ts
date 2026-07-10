import type { RequestHandler } from "express";
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Supabase user id when a valid access token was sent; null otherwise. */
      userId?: string | null;
    }
  }
}

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

function subOf(payload: JWTPayload): string | null {
  return typeof payload.sub === "string" && payload.sub.length > 0 ? payload.sub : null;
}

/**
 * Verify a Supabase access token and return the user id, or null.
 *
 * Two verification paths, matching Supabase's two JWT modes:
 * - New projects use asymmetric JWT signing keys: verified against the
 *   project's public JWKS endpoint (`SUPABASE_URL`/auth/v1/.well-known/
 *   jwks.json) — no secret required on our side.
 * - Legacy projects sign HS256 with a shared secret: set SUPABASE_JWT_SECRET
 *   and it is tried first.
 *
 * Auth is always OPTIONAL: anonymous players are first-class, so verification
 * failures never reject a request/socket — they just leave it anonymous.
 */
export async function verifySupabaseToken(token: unknown): Promise<string | null> {
  if (typeof token !== "string" || token.length === 0) return null;
  const secret = process.env.SUPABASE_JWT_SECRET;
  if (secret) {
    try {
      const { payload } = await jwtVerify(token, new TextEncoder().encode(secret), {
        algorithms: ["HS256"],
      });
      return subOf(payload);
    } catch {
      /* fall through to JWKS */
    }
  }
  const url = process.env.SUPABASE_URL;
  if (url) {
    try {
      jwks ??= createRemoteJWKSet(new URL("/auth/v1/.well-known/jwks.json", url));
      const { payload } = await jwtVerify(token, jwks);
      return subOf(payload);
    } catch {
      return null;
    }
  }
  return null;
}

/** Express middleware: attaches req.userId from a Bearer token, if present. */
export const optionalAuth: RequestHandler = (req, _res, next) => {
  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : undefined;
  void verifySupabaseToken(token).then((userId) => {
    req.userId = userId;
    next();
  });
};

/**
 * Socket.IO handshake middleware: reads `auth.token` from the client's
 * connection options and attaches socket.data.userId. Absent or invalid
 * token = anonymous, still allowed.
 */
export function socketOptionalAuth(
  socket: { handshake: { auth: Record<string, unknown> }; data: { userId?: string | null } },
  next: (err?: Error) => void,
): void {
  void verifySupabaseToken(socket.handshake.auth?.token).then((userId) => {
    socket.data.userId = userId;
    next();
  });
}
