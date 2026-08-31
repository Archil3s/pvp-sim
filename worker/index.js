const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
};

function json(value, init = {}) {
  const headers = new Headers(init.headers || {});
  for (const [key, val] of Object.entries(JSON_HEADERS)) headers.set(key, val);
  return new Response(JSON.stringify(value), { ...init, headers });
}

function randomToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function hashToken(token) {
  const bytes = new TextEncoder().encode(token);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function bearer(request) {
  const header = request.headers.get('authorization') || '';
  return header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : '';
}

function safeSessionId(value) {
  return /^[a-z0-9]{12,40}$/i.test(value) ? value.toLowerCase() : '';
}

export class NmrnlStore {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.sockets = new Set();
  }

  async auth(request, kind) {
    const meta = await this.state.storage.get('meta');
    if (!meta) return false;
    const url = new URL(request.url);
    const supplied = kind === 'view' ? (bearer(request) || url.searchParams.get('view') || '') : bearer(request);
    if (!supplied) return false;
    const actual = await hashToken(supplied);
    return actual === meta[`${kind}TokenHash`];
  }

  async snapshot() {
    const [meta, telemetry] = await Promise.all([
      this.state.storage.get('meta'),
      this.state.storage.get('telemetry'),
    ]);
    const lastSeen = telemetry?.receivedAt || null;
    const online = lastSeen ? Date.now() - Date.parse(lastSeen) < 15000 : false;
    return {
      sessionId: meta?.sessionId || '',
      createdAt: meta?.createdAt || null,
      lastSeen,
      online,
      telemetry: telemetry?.payload || null,
    };
  }

  broadcast(payload) {
    const message = JSON.stringify(payload);
    for (const socket of this.sockets) {
      try {
        socket.send(message);
      } catch {
        try { socket.close(1011, 'send failed'); } catch {}
        this.sockets.delete(socket);
      }
    }
  }

  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname.endsWith('/init') && request.method === 'POST') {
      const existing = await this.state.storage.get('meta');
      if (existing) return json({ ok: true, existing: true });
      const sessionId = safeSessionId(request.headers.get('x-session-id') || '');
      const writeToken = request.headers.get('x-write-token') || '';
      const viewToken = request.headers.get('x-view-token') || '';
      if (!sessionId || !writeToken || !viewToken) return json({ error: 'invalid init' }, { status: 400 });
      await this.state.storage.put('meta', {
        sessionId,
        createdAt: new Date().toISOString(),
        writeTokenHash: await hashToken(writeToken),
        viewTokenHash: await hashToken(viewToken),
      });
      return json({ ok: true });
    }

    if (url.pathname.endsWith('/telemetry') && request.method === 'POST') {
      if (!(await this.auth(request, 'write'))) return json({ error: 'unauthorized' }, { status: 401 });
      let payload;
      try { payload = await request.json(); } catch { return json({ error: 'invalid json' }, { status: 400 }); }
      if (!payload || typeof payload !== 'object') return json({ error: 'invalid payload' }, { status: 400 });
      const record = { receivedAt: new Date().toISOString(), payload };
      await this.state.storage.put('telemetry', record);
      this.broadcast(await this.snapshot());
      return json({ ok: true, receivedAt: record.receivedAt });
    }

    if (url.pathname.endsWith('/ws')) {
      if (!(await this.auth(request, 'view'))) return new Response('Unauthorized', { status: 401 });
      if ((request.headers.get('upgrade') || '').toLowerCase() !== 'websocket') return new Response('Expected websocket', { status: 426 });
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      server.accept();
      this.sockets.add(server);
      server.addEventListener('close', () => this.sockets.delete(server));
      server.addEventListener('error', () => this.sockets.delete(server));
      try { server.send(JSON.stringify(await this.snapshot())); } catch {}
      return new Response(null, { status: 101, webSocket: client });
    }

    if (request.method === 'GET') {
      if (!(await this.auth(request, 'view'))) return json({ error: 'unauthorized' }, { status: 401 });
      return json(await this.snapshot());
    }

    return json({ error: 'method not allowed' }, { status: 405 });
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/api/health') {
      return json({ ok: true, service: 'nmrnl', now: new Date().toISOString() });
    }

    // Temporary compatibility path while the Support Worker Log workflows are ported.
    // The old supervisor API stays functional until its frontend is replaced.
    if (url.pathname === '/api/session' && request.method === 'POST') {
      const sessionId = crypto.randomUUID().replaceAll('-', '').slice(0, 16);
      const writeToken = randomToken();
      const viewToken = randomToken();
      const id = env.NMRNL_STORE.idFromName(sessionId);
      const stub = env.NMRNL_STORE.get(id);
      const initRequest = new Request(`${url.origin}/api/session/${sessionId}/init`, {
        method: 'POST',
        headers: {
          'x-session-id': sessionId,
          'x-write-token': writeToken,
          'x-view-token': viewToken,
        },
      });
      const initialized = await stub.fetch(initRequest);
      if (!initialized.ok) return json({ error: 'failed to initialize session' }, { status: 500 });
      return json({
        sessionId,
        writeToken,
        viewToken,
        viewerPath: `/?session=${encodeURIComponent(sessionId)}&view=${encodeURIComponent(viewToken)}`,
      }, { status: 201 });
    }

    const match = url.pathname.match(/^\/api\/session\/([a-z0-9]{12,40})(?:\/(telemetry|ws))?$/i);
    if (match) {
      const sessionId = safeSessionId(match[1]);
      const id = env.NMRNL_STORE.idFromName(sessionId);
      return env.NMRNL_STORE.get(id).fetch(request);
    }

    if (url.pathname.startsWith('/api/')) return json({ error: 'not found' }, { status: 404 });
    return env.ASSETS.fetch(request);
  },
};
