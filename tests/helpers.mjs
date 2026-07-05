import { io } from "socket.io-client";

export const PORT = Number(process.env.PORT) || 4123;

export function connect(namespace) {
  return io(`http://localhost:${PORT}${namespace}`, { transports: ["websocket"] });
}

export function emit(sock, ev, payload) {
  return new Promise((resolve, reject) => {
    sock.timeout(8000).emit(ev, payload, (err, res) => {
      if (err) return reject(new Error(`${ev}: no ack`));
      resolve(res);
    });
  });
}

/**
 * Resolve when `ev` fires with a payload matching `pred`.
 * IMPORTANT: register BEFORE triggering the action that emits the event —
 * e.g. gameOver fires synchronously after the final questionReveal.
 */
export function waitFor(sock, ev, pred = () => true, timeoutMs = 60000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout waiting for ${ev}`)), timeoutMs);
    const handler = (payload) => {
      if (pred(payload)) {
        clearTimeout(t);
        sock.off(ev, handler);
        resolve(payload);
      }
    };
    sock.on(ev, handler);
  });
}

export function assert(cond, msg) {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
  }
  console.log(`  ok: ${msg}`);
}

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export function globalTimeout(ms, label) {
  return setTimeout(() => {
    console.error(`FAIL: ${label} timed out after ${ms}ms`);
    process.exit(1);
  }, ms);
}
