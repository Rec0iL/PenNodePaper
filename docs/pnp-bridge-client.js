// PenNodePaper bridge client — drop-in for any VTT (vanilla JS, no dependencies, works in browsers and Node 22+).
//
//   import { connectPnp } from './pnp-bridge-client.js';
//   const link = connectPnp({
//     url: 'ws://127.0.0.1:4317/bridge', token: '<pairing token>',
//     profile: { id: 'my-vtt', name: 'My VTT', version: '1.0', protocol: 1, push: { handout: { text: true, image: true } }, characters: { roles: [ /* sheet structure */ ] } },
//     // handlers return (or resolve to) result data, or throw an Error with a message the GM can read:
//     onPush: async (kind, payload) => { if (kind === 'handout') addHandout(payload); else throw new Error('not supported'); },
//     onRequest: async (what) => (what === 'tracks' ? listTracks() : what === 'party' ? listPartyAsUpf() : []),
//     onStatus: (s, info) => console.log('PenNodePaper link:', s, info),   // 'connecting' | 'connected' | 'closed'
//   });
//   link.reportParty([ /* UpfCharacter of every player, role "pc" */ ]);   // optional: tell PenNodePaper when the party changes (see "Party" in the spec)
//   link.close();
//
// Protocol: docs/vtt-bridge-spec.md. Reconnects with back-off until close() is called.

export const PROTOCOL = 1;

export function connectPnp({ url, token, profile, onPush, onRequest, onStatus = () => {}, WebSocketImpl = globalThis.WebSocket }) {
  let ws = null;
  let closed = false;
  let tries = 0;
  let timer = null;

  const send = (m) => ws && ws.readyState === 1 && ws.send(JSON.stringify(m));
  const sep = url.includes('?') ? '&' : '?';

  function open() {
    onStatus('connecting');
    ws = new WebSocketImpl(`${url}${sep}token=${encodeURIComponent(token)}`);
    ws.onopen = () => send({ t: 'hello', protocol: PROTOCOL, profile });
    ws.onmessage = async (e) => {
      let m;
      try { m = JSON.parse(e.data); } catch { return; }
      if (m.t === 'welcome') { tries = 0; onStatus('connected', { campaign: m.campaign }); return; }
      if (m.t !== 'push' && m.t !== 'request') return;
      try {
        const data = m.t === 'push' ? await onPush(m.kind, m.payload) : await onRequest(m.what);
        send({ t: 'result', id: m.id, ok: true, data });
      } catch (err) {
        send({ t: 'result', id: m.id, ok: false, error: err instanceof Error ? err.message : String(err) });
      }
    };
    ws.onclose = (e) => {
      ws = null;
      if (closed) return onStatus('closed');
      if (e.code === 1008) { closed = true; return onStatus('closed', { reason: e.reason }); } // protocol mismatch: don't retry
      onStatus('connecting', { retryInMs: Math.min(30000, 2000 * 2 ** tries) });
      timer = setTimeout(open, Math.min(30000, 2000 * 2 ** tries++));
    };
    ws.onerror = () => {};
  }

  open();
  return {
    /** Report the players' characters unasked (always the WHOLE party; players missing from the list are marked absent). */
    reportParty(characters) { send({ t: 'party', characters }); },
    close() { closed = true; clearTimeout(timer); ws && ws.close(); },
  };
}
