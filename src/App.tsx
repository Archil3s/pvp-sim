import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';

type SupervisorState = {
  status?: string;
  phase?: string;
  cycle?: number;
  agent?: number;
  model?: string;
  modelStatus?: string;
  build?: string;
  verification?: string;
  lastEvent?: string;
  started?: string;
  updated?: string;
  agentStartedAt?: string;
  agentRuntimeSeconds?: number;
  dashboardStatus?: string;
};

type GitState = {
  branch?: string;
  head?: string;
  latestCommit?: string;
  status?: string;
  changedFiles?: string[];
  diffStat?: string;
  pushState?: string;
};

type ModelState = {
  id: string;
  status?: string;
  detail?: string;
  lastChecked?: string;
  cooldownUntil?: string;
};

type Telemetry = {
  sentAt?: string;
  supervisor?: SupervisorState;
  git?: GitState;
  progress?: string;
  handoff?: string;
  logTail?: string[];
  verificationTail?: string[];
  models?: ModelState[];
};

type Snapshot = {
  sessionId: string;
  createdAt?: string;
  lastSeen?: string;
  online?: boolean;
  telemetry?: Telemetry | null;
};

type Tab = 'live' | 'progress' | 'handoff' | 'git' | 'models' | 'verify';

function queryValue(name: string): string {
  return new URLSearchParams(window.location.search).get(name)?.trim() ?? '';
}

function elapsed(seconds?: number): string {
  if (!seconds || seconds < 0) return '0m';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function shortSha(value?: string): string {
  return value ? value.slice(0, 8) : '—';
}

function statusTone(value?: string): string {
  const text = (value ?? '').toUpperCase();
  if (text.includes('PASS') || text.includes('COMPLETE') || text.includes('WORKING') || text.includes('ACTIVE')) return 'good';
  if (text.includes('FAIL') || text.includes('ERROR') || text.includes('BLOCK') || text.includes('STOP')) return 'bad';
  if (text.includes('WAIT') || text.includes('RECONNECT') || text.includes('ROUT') || text.includes('VERIFY')) return 'warn';
  return 'neutral';
}

function MarkdownText({ value, empty }: { value?: string; empty: string }) {
  return <pre className="document-view">{value?.trim() || empty}</pre>;
}

export function App() {
  const initialSession = queryValue('session');
  const initialViewToken = queryValue('view');
  const [sessionId, setSessionId] = useState(initialSession);
  const [viewToken, setViewToken] = useState(initialViewToken);
  const [draftSession, setDraftSession] = useState(initialSession);
  const [draftToken, setDraftToken] = useState(initialViewToken);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [connection, setConnection] = useState<'idle' | 'connecting' | 'live' | 'polling' | 'error'>('idle');
  const [error, setError] = useState('');
  const [tab, setTab] = useState<Tab>('live');
  const [filter, setFilter] = useState('');
  const [autoScroll, setAutoScroll] = useState(true);
  const terminalRef = useRef<HTMLDivElement>(null);

  const telemetry = snapshot?.telemetry ?? null;
  const state = telemetry?.supervisor ?? {};
  const git = telemetry?.git ?? {};
  const online = Boolean(snapshot?.online);

  const filteredLog = useMemo(() => {
    const lines = telemetry?.logTail ?? [];
    const needle = filter.trim().toLowerCase();
    if (!needle) return lines;
    return lines.filter((line) => line.toLowerCase().includes(needle));
  }, [telemetry?.logTail, filter]);

  useEffect(() => {
    if (!autoScroll || tab !== 'live') return;
    const node = terminalRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [filteredLog, autoScroll, tab]);

  useEffect(() => {
    if (!sessionId || !viewToken) {
      setConnection('idle');
      return;
    }

    let closed = false;
    let socket: WebSocket | null = null;
    let pollTimer: number | undefined;
    let reconnectTimer: number | undefined;

    const applySnapshot = (next: Snapshot) => {
      if (closed) return;
      setSnapshot(next);
      setError('');
    };

    const poll = async () => {
      if (closed) return;
      try {
        const response = await fetch(`/api/session/${encodeURIComponent(sessionId)}`, {
          cache: 'no-store',
          headers: { Authorization: `Bearer ${viewToken}` },
        });
        if (!response.ok) throw new Error(response.status === 401 ? 'Viewer key rejected' : `HTTP ${response.status}`);
        applySnapshot((await response.json()) as Snapshot);
        if (!socket || socket.readyState !== WebSocket.OPEN) setConnection('polling');
      } catch (reason) {
        setConnection('error');
        setError(reason instanceof Error ? reason.message : 'Unable to reach dashboard session');
      }
    };

    const connectSocket = () => {
      if (closed) return;
      setConnection('connecting');
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const url = `${protocol}//${window.location.host}/api/session/${encodeURIComponent(sessionId)}/ws?view=${encodeURIComponent(viewToken)}`;
      socket = new WebSocket(url);
      socket.addEventListener('open', () => {
        if (!closed) setConnection('live');
      });
      socket.addEventListener('message', (event) => {
        try {
          applySnapshot(JSON.parse(String(event.data)) as Snapshot);
          setConnection('live');
        } catch {
          // Ignore malformed frames and keep the existing snapshot.
        }
      });
      socket.addEventListener('close', () => {
        if (closed) return;
        setConnection('polling');
        reconnectTimer = window.setTimeout(connectSocket, 2500);
      });
      socket.addEventListener('error', () => socket?.close());
    };

    void poll();
    connectSocket();
    pollTimer = window.setInterval(poll, 5000);

    return () => {
      closed = true;
      socket?.close();
      if (pollTimer) window.clearInterval(pollTimer);
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
    };
  }, [sessionId, viewToken]);

  const openSession = (event: FormEvent) => {
    event.preventDefault();
    const session = draftSession.trim();
    const token = draftToken.trim();
    if (!session || !token) return;
    const url = new URL(window.location.href);
    url.searchParams.set('session', session);
    url.searchParams.set('view', token);
    window.history.replaceState({}, '', url);
    setSnapshot(null);
    setSessionId(session);
    setViewToken(token);
  };

  if (!sessionId || !viewToken) {
    return (
      <main className="landing-shell">
        <section className="landing-card">
          <div className="eyebrow">CODEX SUPERVISOR</div>
          <h1>Live agent control room</h1>
          <p className="lead">This page replaces the old PvP simulator. The Windows supervisor creates a private viewer link and streams Codex activity here while it works.</p>
          <div className="landing-grid">
            <div className="feature"><strong>Live</strong><span>Agent, model, current phase, commands and output.</span></div>
            <div className="feature"><strong>Durable</strong><span>Progress, handoff, Git state and verification survive model failover.</span></div>
            <div className="feature"><strong>Private link</strong><span>Session and viewer keys are required to read a stream.</span></div>
          </div>
          <form className="join-form" onSubmit={openSession}>
            <label>Session ID<input value={draftSession} onChange={(e) => setDraftSession(e.target.value)} placeholder="e.g. 8bd42ce9f81a" /></label>
            <label>Viewer key<input value={draftToken} onChange={(e) => setDraftToken(e.target.value)} placeholder="paste viewer key" /></label>
            <button type="submit">Open session</button>
          </form>
          <p className="hint">Normally you do not need to enter these manually. Click <b>Connect Cloud Dashboard</b> in the supervisor EXE and it opens the correct private link.</p>
        </section>
      </main>
    );
  }

  const cards = [
    ['Supervisor', state.status || (online ? 'ONLINE' : 'WAITING')],
    ['Agent', state.agent ? `#${state.agent} · cycle ${state.cycle ?? '—'}` : '—'],
    ['Model', state.model || '—'],
    ['Agent runtime', elapsed(state.agentRuntimeSeconds)],
    ['Build', state.build || 'Not run'],
    ['Git', git.pushState || git.status || '—'],
  ];

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <div className="eyebrow">DD SKILLER · CODEX SUPERVISOR</div>
          <h1>Agent control room</h1>
          <div className="phase-line"><span className={`live-dot ${online ? 'on' : ''}`} />{state.phase || 'Waiting for telemetry'}</div>
        </div>
        <div className="connection-block">
          <span className={`connection-pill ${connection}`}>{connection === 'live' ? 'LIVE' : connection.toUpperCase()}</span>
          <span className="session-label">session {sessionId}</span>
        </div>
      </header>

      {error && <div className="error-banner">{error}</div>}

      <section className="status-grid">
        {cards.map(([label, value]) => (
          <article className="status-card" key={label}>
            <span>{label}</span>
            <strong className={statusTone(value)}>{value}</strong>
          </article>
        ))}
      </section>

      <section className="focus-strip">
        <div><span>Current event</span><strong>{state.lastEvent || 'Waiting for supervisor activity…'}</strong></div>
        <div><span>HEAD</span><strong>{shortSha(git.head)}</strong></div>
        <div><span>Verification</span><strong className={statusTone(state.verification)}>{state.verification || 'Not run'}</strong></div>
        <div><span>Last seen</span><strong>{snapshot?.lastSeen ? new Date(snapshot.lastSeen).toLocaleTimeString() : '—'}</strong></div>
      </section>

      <nav className="tabs" aria-label="Dashboard views">
        {([
          ['live', 'Live activity'],
          ['progress', 'Progress'],
          ['handoff', 'Handoff'],
          ['git', 'Git & files'],
          ['models', 'Models'],
          ['verify', 'Verification'],
        ] as [Tab, string][]).map(([id, label]) => (
          <button key={id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>{label}</button>
        ))}
      </nav>

      <section className="workspace">
        {tab === 'live' && (
          <div className="live-layout">
            <aside className="activity-rail">
              <h2>Now</h2>
              <dl>
                <div><dt>Phase</dt><dd>{state.phase || '—'}</dd></div>
                <div><dt>Model state</dt><dd className={statusTone(state.modelStatus)}>{state.modelStatus || '—'}</dd></div>
                <div><dt>Build</dt><dd className={statusTone(state.build)}>{state.build || '—'}</dd></div>
                <div><dt>Branch</dt><dd>{git.branch || '—'}</dd></div>
                <div><dt>Commit</dt><dd>{git.latestCommit || shortSha(git.head)}</dd></div>
              </dl>
              <h2>Changed files</h2>
              <div className="file-list compact">
                {(git.changedFiles?.length ? git.changedFiles : ['No uncommitted file changes reported']).map((file) => <code key={file}>{file}</code>)}
              </div>
            </aside>
            <div className="terminal-panel">
              <div className="terminal-toolbar">
                <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter live output" />
                <label><input type="checkbox" checked={autoScroll} onChange={(e) => setAutoScroll(e.target.checked)} /> Auto-scroll</label>
                <span>{filteredLog.length} lines</span>
              </div>
              <div className="terminal" ref={terminalRef}>
                {filteredLog.length ? filteredLog.map((line, index) => <div className="terminal-line" key={`${index}-${line.slice(0, 20)}`}>{line}</div>) : <div className="terminal-empty">Waiting for Codex output…</div>}
              </div>
            </div>
          </div>
        )}

        {tab === 'progress' && <MarkdownText value={telemetry?.progress} empty="CODEX_PROGRESS.md has not been streamed yet." />}
        {tab === 'handoff' && <MarkdownText value={telemetry?.handoff} empty="CODEX_HANDOFF.md has not been streamed yet." />}

        {tab === 'git' && (
          <div className="two-column">
            <article className="panel"><h2>Repository</h2><dl className="details"><div><dt>Branch</dt><dd>{git.branch || '—'}</dd></div><div><dt>HEAD</dt><dd><code>{git.head || '—'}</code></dd></div><div><dt>Latest commit</dt><dd>{git.latestCommit || '—'}</dd></div><div><dt>Push state</dt><dd className={statusTone(git.pushState)}>{git.pushState || '—'}</dd></div><div><dt>Status</dt><dd>{git.status || '—'}</dd></div></dl></article>
            <article className="panel"><h2>Working tree</h2><div className="file-list">{(git.changedFiles?.length ? git.changedFiles : ['Clean']).map((file) => <code key={file}>{file}</code>)}</div><h3>Diff summary</h3><pre className="mini-pre">{git.diffStat || 'No diff summary'}</pre></article>
          </div>
        )}

        {tab === 'models' && (
          <div className="model-table-wrap">
            <table className="model-table"><thead><tr><th>Model</th><th>Status</th><th>Detail</th><th>Last checked</th></tr></thead><tbody>
              {(telemetry?.models ?? []).map((model) => <tr key={model.id}><td><code>{model.id}</code></td><td><span className={`tiny-pill ${statusTone(model.status)}`}>{model.status || '—'}</span></td><td>{model.detail || '—'}</td><td>{model.lastChecked ? new Date(model.lastChecked).toLocaleTimeString() : '—'}</td></tr>)}
              {!telemetry?.models?.length && <tr><td colSpan={4}>No model telemetry yet.</td></tr>}
            </tbody></table>
          </div>
        )}

        {tab === 'verify' && <pre className="document-view verification">{telemetry?.verificationTail?.join('\n') || 'No verification output yet.'}</pre>}
      </section>

      <footer><span>Private viewer link · do not share the session URL</span><span>{telemetry?.sentAt ? `telemetry ${new Date(telemetry.sentAt).toLocaleTimeString()}` : 'waiting'}</span></footer>
    </main>
  );
}
