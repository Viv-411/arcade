import type { RequestHandler } from "express";
import jwt from "jsonwebtoken";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Supabase user id when a valid access token was sent; null otherwise. */
      userId?: string | null;
    }
  }
}

/**
 * Verify a Supabase access token (HS256, signed with the project's JWT
 * secret) and return the user id, or null for missing/invalid tokens or when
 * SUPABASE_JWT_SECRET is unset. Auth is always OPTIONAL: anonymous players
 * are first-class, so verification failures never reject a request/socket —
 * they just leave it anonymous.
 */
export function verifySupabaseToken(token: unknown): string | null {
  const secret = process.env.SUPABASE_JWT_SECRET;
  if (!secret || typeof token !== "string" || token.length === 0) return null;
  try {
    const payload = jwt.verify(token, secret, { algorithms: ["HS256"] });
    if (typeof payload === "object" && typeof payload.sub === "string") {
      return payload.sub;
    }
    return null;
  } catch {
    return null;
  }
}

/** Express middleware: attaches req.userId from a Bearer token, if present. */
export const optionalAuth: RequestHandler = (req, _res, next) => {
  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : undefined;
  req.userId = verifySupabaseToken(token);
  next();
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
  socket.data.userId = verifySupabaseToken(socket.handshake.auth?.token);
  next();
}
