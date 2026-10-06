import type http from 'node:http';
import { describe, expect, it } from 'vitest';
import { LanGuard, cookieOf, isLoopback, newAccessCode, newSecret, normalizeCode, sessionValue } from '../src/lan.js';

const req = (o: { ip?: string; cookie?: string; host?: string; origin?: string } = {}) =>
  ({ socket: { remoteAddress: o.ip ?? '192.168.1.50' }, headers: { cookie: o.cookie, host: o.host ?? '192.168.1.10:4317', origin: o.origin } }) as unknown as http.IncomingMessage;
const guard = (enabled = true) => new LanGuard({ enabled, code: 'K7QM-2XVD-9PRT-HF4C', secret: newSecret() });

describe('LAN mode', () => {
  it('makes readable access codes: 16 characters in four groups, none of the confusing ones', () => {
    for (let i = 0; i < 50; i++) expect(newAccessCode()).toMatch(/^[A-HJ-NP-Z2-9]{4}(-[A-HJ-NP-Z2-9]{4}){3}$/);
    expect(new Set(Array.from({ length: 20 }, newAccessCode)).size).toBe(20);
    expect(normalizeCode(' k7qm 2xvd-9prt hf4c ')).toBe('K7QM2XVD9PRTHF4C');
  });

  it('this computer needs no login; other devices need the session; with LAN mode off nothing changes', () => {
    const g = guard();
    expect(isLoopback(req({ ip: '127.0.0.1' }))).toBe(true);
    expect(isLoopback(req({ ip: '::ffff:127.0.0.1' }))).toBe(true);
    expect(isLoopback(req({ ip: '192.168.1.10' }))).toBe(false); // even this computer's own LAN address counts as "another device"
    expect(g.authed(req({ ip: '127.0.0.1' }))).toBe(true);
    expect(g.authed(req())).toBe(false);
    expect(guard(false).authed(req())).toBe(true);

    const ok = g.login('192.168.1.50', 'k7qm-2xvd-9prt-hf4c'); // case and dashes do not matter
    expect(ok.ok).toBe(true);
    const cookie = (ok as { cookie: string }).cookie;
    expect(cookie).toMatch(/HttpOnly; SameSite=Lax/);
    const sent = cookie.split(';')[0];
    expect(g.authed(req({ cookie: sent }))).toBe(true);
    expect(g.authed(req({ cookie: 'pnp_session=forged' }))).toBe(false);
    expect(cookieOf(req({ cookie: `a=1; ${sent}; b=2` }))).toBe(sessionValue(g.state.secret, g.state.code));
  });

  it('a new code (and secret) logs every device out', () => {
    const g = guard();
    const sent = (g.login('x', g.state.code) as { cookie: string }).cookie.split(';')[0];
    expect(g.authed(req({ cookie: sent }))).toBe(true);
    g.state.code = newAccessCode();
    g.state.secret = newSecret();
    expect(g.authed(req({ cookie: sent }))).toBe(false);
  });

  it('locks a device out after five wrong codes, and lets the right one in again after the lockout', () => {
    const g = guard();
    for (let i = 0; i < 4; i++) expect(g.login('1.1.1.1', 'WRONG')).toEqual({ ok: false, locked: false });
    expect(g.login('1.1.1.1', 'WRONG')).toEqual({ ok: false, locked: true });
    expect(g.login('1.1.1.1', g.state.code)).toEqual({ ok: false, locked: true }); // even the right code is refused during the lockout
    expect(g.login('2.2.2.2', g.state.code).ok).toBe(true); // other devices are not affected
    (g as unknown as { fails: Map<string, { n: number; until: number }> }).fails.set('1.1.1.1', { n: 0, until: Date.now() - 1 });
    expect(g.login('1.1.1.1', g.state.code).ok).toBe(true);
  });

  it('other devices may only call the API from their own page', () => {
    const g = guard();
    expect(g.sameOrigin(req())).toBe(true); // no Origin header (a plain page load or script)
    expect(g.sameOrigin(req({ origin: 'http://192.168.1.10:4317' }))).toBe(true);
    expect(g.sameOrigin(req({ origin: 'http://evil.example' }))).toBe(false);
    expect(g.sameOrigin(req({ origin: 'null' }))).toBe(false);
  });
});
