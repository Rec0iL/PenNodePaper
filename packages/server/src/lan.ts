import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type http from 'node:http';
import os from 'node:os';

// ---------------------------------------------------------------------------
// LAN mode: use PenNodePaper from another device on the home network (e.g. the laptop in the garden) while the server,
// the campaign files and the AI keep running on this computer.
//
// Off by default (the server then only listens on 127.0.0.1). When it is on:
//  * the server listens on all interfaces,
//  * everything that does NOT come from this very computer needs an access code, entered once on a login page; the
//    browser then keeps a signed session cookie,
//  * this computer itself needs no login, exactly as before,
//  * /mcp and /bridge keep their own secret token (they never use the cookie).
// ---------------------------------------------------------------------------

export const COOKIE = 'pnp_session';
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I, O, 0, 1: easy to read out and type
const MAX_FAILS = 5;
const LOCKOUT_MS = 5 * 60_000;

/** 16 characters in groups of four (~80 bits), e.g. K7QM-2XVD-9PRT-HF4C */
export function newAccessCode(): string {
  const bytes = randomBytes(16);
  const chars = Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]);
  return [0, 4, 8, 12].map((i) => chars.slice(i, i + 4).join('')).join('-');
}
export const newSecret = () => randomBytes(32).toString('hex');

/** Tolerant of how people type it: case, spaces, missing dashes. */
export const normalizeCode = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '');

export function sessionValue(secret: string, code: string): string {
  return createHmac('sha256', secret).update(`pnp-session:${normalizeCode(code)}`).digest('hex');
}

const safeEqual = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

export function cookieOf(req: http.IncomingMessage, name = COOKIE): string | undefined {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return undefined;
}

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
/** True only for a connection made from this computer itself (not via its LAN address). */
export const isLoopback = (req: http.IncomingMessage) => LOOPBACK.has(req.socket.remoteAddress ?? '');

export interface LanState {
  enabled: boolean;
  code: string;
  secret: string;
}

export class LanGuard {
  private fails = new Map<string, { n: number; until: number }>();
  constructor(public state: LanState) {}

  get enabled() {
    return this.state.enabled;
  }

  /** Is this request allowed to use the app? (this computer always is) */
  authed(req: http.IncomingMessage): boolean {
    if (!this.state.enabled || isLoopback(req)) return true;
    const c = cookieOf(req);
    return !!c && safeEqual(c, sessionValue(this.state.secret, this.state.code));
  }

  /** Same-origin check for requests from other devices (CSRF): the Origin, when sent, must be the host that was asked. */
  sameOrigin(req: http.IncomingMessage): boolean {
    const origin = req.headers.origin;
    if (!origin) return true;
    try {
      return new URL(origin).host === (req.headers.host ?? '');
    } catch {
      return false;
    }
  }

  /** Try a login. ok → the cookie to set; otherwise why not. */
  login(ip: string, code: string): { ok: true; cookie: string } | { ok: false; locked: boolean } {
    const now = Date.now();
    let f = this.fails.get(ip);
    if (f && f.until > now) return { ok: false, locked: true };
    if (f && f.until !== 0) f = undefined; // a lockout that has run out starts counting afresh
    if (safeEqual(normalizeCode(code), normalizeCode(this.state.code))) {
      this.fails.delete(ip);
      const v = sessionValue(this.state.secret, this.state.code);
      return { ok: true, cookie: `${COOKIE}=${v}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${30 * 24 * 3600}` };
    }
    const n = (f?.n ?? 0) + 1;
    this.fails.set(ip, n >= MAX_FAILS ? { n: 0, until: now + LOCKOUT_MS } : { n, until: 0 });
    return { ok: false, locked: n >= MAX_FAILS };
  }
}

/** Addresses another device can type, best guess first. */
export function lanUrls(port: number): string[] {
  const out: string[] = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const i of list ?? []) {
      if (i.family === 'IPv4' && !i.internal && !i.address.startsWith('169.254.')) out.push(`http://${i.address}:${port}`);
    }
  }
  const host = os.hostname();
  if (host) out.push(`http://${host}.local:${port}`);
  return out;
}

export function loginPage(opts: { error?: string; locked?: boolean } = {}): string {
  const msg = opts.locked ? 'Too many wrong codes. Try again in a few minutes.' : opts.error ? 'That code is not right.' : '';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>PenNodePaper</title>
<style>
  body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0f1117;color:#e6e8ee;font:15px system-ui,sans-serif}
  form{width:min(360px,90vw);display:grid;gap:12px;padding:26px;background:#171a23;border:1px solid #2a2f3d;border-radius:14px}
  h1{margin:0;font-size:18px} p{margin:0;color:#9aa1b2;font-size:13px;line-height:1.5}
  input{padding:12px;border-radius:8px;border:1px solid #2a2f3d;background:#0f1117;color:inherit;font:600 18px ui-monospace,monospace;letter-spacing:.08em;text-align:center;text-transform:uppercase}
  button{padding:11px;border-radius:8px;border:0;background:#7aa2ff;color:#0b0d12;font-weight:700;font-size:15px;cursor:pointer}
  .err{color:#ff7a7a}
</style></head><body>
<form method="post" action="/login">
  <h1>◈ PenNodePaper</h1>
  <p>This is a story workspace on another computer on your network. Enter its access code (it is shown on that computer: tray icon or Settings → LAN access).</p>
  <input name="code" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="XXXX-XXXX-XXXX-XXXX" autofocus>
  ${msg ? `<p class="err">${msg}</p>` : ''}
  <button>Open</button>
</form></body></html>`;
}
