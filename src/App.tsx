import {
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import QRCode from 'qrcode';

import {
  beginAuthenticatorEnrollment,
  clearCredentials,
  confirmAuthenticatorEnrollment,
  confirmWorkspaceTotp,
  createEntry,
  createGeneralAction,
  createWorkspace,
  deleteEntry,
  fetchWorkspace,
  loadCredentials,
  loadKnownWorkspaceId,
  loginWithTotp,
  NMRNL_ACCOUNT_EMAIL,
  rememberWorkspaceId,
  requestRecoveryEmail,
  saveCredentials,
  confirmRecoveryAuthenticator,
  setGeneralActionCompleted,
  setVisitActionCompleted,
  verifyRecoveryEmailCode,
} from './api';
import {
  ENTRY_TYPES,
  entryKilometres,
  entryType,
  entryTypesForMode,
  formatDate,
  formatHours,
  localDateValue,
  localTimeValue,
  modeLabel,
  type EmailRecoveryChallenge,
  type EntryDraft,
  type EntryTypeKey,
  type GeneralAction,
  type Mode,
  type Section,
  type TextContactDirection,
  type WorkEntry,
  type WorkspaceCredentials,
  type WorkspaceSetupChallenge,
  type WorkspaceState,
} from './model';

const MODE_OPTIONS: Array<{ key: Mode; label: string }> = [
  { key: 'work', label: 'Work' },
  { key: 'casework', label: 'Casework' },
  { key: 'paye', label: 'PAYE' },
];

function todayStart(): number {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
}

function StatCard({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail?: string;
}) {
  return (
    <article className="stat-card">
      <span>{label}</span>
      <strong>{value}</strong>
      {detail && <small>{detail}</small>}
    </article>
  );
}

function Panel({
  title,
  subtitle,
  action,
  children,
  className = '',
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={'panel ' + className}>
      <div className="panel-heading">
        <div>
          <h2>{title}</h2>
          {subtitle && <p>{subtitle}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function RecoveryAccess({
  initialWorkspaceId,
  onCancel,
  onRecovered,
}: {
  initialWorkspaceId: string;
  onCancel: () => void;
  onRecovered: (credentials: WorkspaceCredentials, state: WorkspaceState) => void;
}) {
  const [workspaceId, setWorkspaceId] = useState(initialWorkspaceId);
  const [stage, setStage] = useState<'request' | 'email-code' | 'authenticator'>('request');
  const [emailCode, setEmailCode] = useState('');
  const [authCode, setAuthCode] = useState('');
  const [challenge, setChallenge] = useState<EmailRecoveryChallenge | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    if (!challenge) {
      setQrDataUrl('');
      return;
    }

    QRCode.toDataURL(challenge.otpauthUri, {
      width: 260,
      margin: 1,
      errorCorrectionLevel: 'M',
    })
      .then((value) => {
        if (active) setQrDataUrl(value);
      })
      .catch(() => {
        if (active) setError('Could not render the replacement Authenticator QR.');
      });

    return () => {
      active = false;
    };
  }, [challenge]);

  const sendCode = async () => {
    const id = workspaceId.trim().toLowerCase();
    if (id.length !== 16) {
      setError('Enter the 16-character Workspace ID first.');
      return;
    }

    setBusy(true);
    setError('');
    try {
      await requestRecoveryEmail(id);
      rememberWorkspaceId(id);
      setWorkspaceId(id);
      setStage('email-code');
      setEmailCode('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not send recovery email.');
    } finally {
      setBusy(false);
    }
  };

  const verifyEmail = async (event: FormEvent) => {
    event.preventDefault();
    if (emailCode.length !== 6) return;

    setBusy(true);
    setError('');
    try {
      const next = await verifyRecoveryEmailCode(workspaceId, emailCode);
      setChallenge(next);
      setAuthCode('');
      setStage('authenticator');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Recovery code rejected.');
      setEmailCode('');
    } finally {
      setBusy(false);
    }
  };

  const confirmAuthenticator = async (event: FormEvent) => {
    event.preventDefault();
    if (!challenge || authCode.length !== 6) return;

    setBusy(true);
    setError('');
    try {
      const result = await confirmRecoveryAuthenticator(
        workspaceId,
        challenge.recoveryToken,
        authCode,
      );
      rememberWorkspaceId(workspaceId);
      saveCredentials(result.credentials);
      onRecovered(result.credentials, result.state);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Authenticator code rejected.');
      setAuthCode('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="setup-shell">
      <section className="setup-card authenticator-card recovery-card">
        <button type="button" className="recovery-back" onClick={onCancel}>
          ← Back to sign in
        </button>

        <div className="code-login-brand">
          <div className="brand-mark">N</div>
          <div>
            <div className="eyebrow">ACCOUNT RECOVERY</div>
            <h1>
              {stage === 'request'
                ? 'Recover NMRNL'
                : stage === 'email-code'
                  ? 'Check your email'
                  : 'Set up a new Authenticator'}
            </h1>
          </div>
        </div>

        {error && <div className="error-banner">{error}</div>}

        {stage === 'request' && (
          <div className="recovery-stack">
            <p className="setup-lead">
              Recovery is locked to the only approved NMRNL account.
            </p>

            <div className="locked-email-card">
              <span className="locked-email-icon">✉</span>
              <span>
                <small>Recovery & account email</small>
                <strong>{NMRNL_ACCOUNT_EMAIL}</strong>
              </span>
              <b>ONLY ACCOUNT</b>
            </div>

            <label className="workspace-login-field">
              Workspace ID
              <input
                value={workspaceId}
                onChange={(event) => setWorkspaceId(event.target.value)}
                placeholder="16-character workspace ID"
                autoComplete="username"
                autoFocus={!workspaceId}
              />
            </label>

            <button
              type="button"
              className="primary big"
              onClick={() => void sendCode()}
              disabled={busy || workspaceId.trim().length !== 16}
            >
              {busy ? 'Sending…' : 'Email recovery code'}
            </button>

            <p className="privacy-note">
              NMRNL will not send recovery codes to any other email address.
            </p>
          </div>
        )}

        {stage === 'email-code' && (
          <form className="recovery-stack" onSubmit={verifyEmail}>
            <p className="setup-lead">
              Enter the 6-digit recovery code sent to <b>{NMRNL_ACCOUNT_EMAIL}</b>.
              It expires after 10 minutes.
            </p>

            <label className="code-prompt">
              <span>Email recovery code</span>
              <input
                className="totp-input login-code"
                value={emailCode}
                onChange={(event) =>
                  setEmailCode(event.target.value.replace(/\D/g, '').slice(0, 6))
                }
                placeholder="000000"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                autoFocus
              />
            </label>

            <button
              className="primary big"
              disabled={busy || emailCode.length !== 6}
            >
              {busy ? 'Checking…' : 'Verify recovery code'}
            </button>

            <button
              type="button"
              className="switch-workspace-button"
              onClick={() => void sendCode()}
              disabled={busy}
            >
              Send another code
            </button>
          </form>
        )}

        {stage === 'authenticator' && challenge && (
          <form className="recovery-stack" onSubmit={confirmAuthenticator}>
            <p className="setup-lead">
              Email ownership is confirmed. Scan this new QR in Google Authenticator.
              Your previous Authenticator setup will stop working after this step.
            </p>

            <div className="qr-shell">
              {qrDataUrl ? (
                <img src={qrDataUrl} alt="Replacement NMRNL Authenticator QR code" />
              ) : (
                <div className="qr-loading">Building QR…</div>
              )}
            </div>

            <details className="manual-secret">
              <summary>Can’t scan the QR?</summary>
              <code>{challenge.totpSecret}</code>
            </details>

            <label className="code-prompt">
              <span>New Authenticator code</span>
              <input
                className="totp-input login-code"
                value={authCode}
                onChange={(event) =>
                  setAuthCode(event.target.value.replace(/\D/g, '').slice(0, 6))
                }
                placeholder="000000"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                autoFocus
              />
            </label>

            <button
              className="primary big"
              disabled={busy || authCode.length !== 6}
            >
              {busy ? 'Securing account…' : 'Replace Authenticator & open NMRNL'}
            </button>
          </form>
        )}
      </section>
    </main>
  );
}

function WorkspaceSetup({
  onConnected,
}: {
  onConnected: (credentials: WorkspaceCredentials, state: WorkspaceState) => void;
}) {
  const rememberedWorkspaceId = loadKnownWorkspaceId();
  const [workspaceId, setWorkspaceId] = useState(rememberedWorkspaceId);
  const [showWorkspaceField, setShowWorkspaceField] = useState(
    !rememberedWorkspaceId,
  );
  const [code, setCode] = useState('');
  const [challenge, setChallenge] = useState<WorkspaceSetupChallenge | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [recovery, setRecovery] = useState(false);
  const [busy, setBusy] = useState<'create' | 'verify' | 'login' | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    if (!challenge) {
      setQrDataUrl('');
      return;
    }

    QRCode.toDataURL(challenge.otpauthUri, {
      width: 260,
      margin: 1,
      errorCorrectionLevel: 'M',
    })
      .then((value) => {
        if (active) setQrDataUrl(value);
      })
      .catch(() => {
        if (active) setError('Could not render the Authenticator QR code.');
      });

    return () => {
      active = false;
    };
  }, [challenge]);

  const updateCode = (value: string) => {
    setCode(value.replace(/\D/g, '').slice(0, 6));
  };

  const create = async () => {
    setBusy('create');
    setError('');
    try {
      const nextChallenge = await createWorkspace();
      rememberWorkspaceId(nextChallenge.workspaceId);
      setWorkspaceId(nextChallenge.workspaceId);
      setShowWorkspaceField(false);
      setChallenge(nextChallenge);
      setCode('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not create workspace.');
    } finally {
      setBusy(null);
    }
  };

  const verifySetup = async (event: FormEvent) => {
    event.preventDefault();
    if (!challenge || code.length !== 6) return;

    setBusy('verify');
    setError('');
    try {
      const result = await confirmWorkspaceTotp(challenge.workspaceId, code);
      saveCredentials(result.credentials);
      onConnected(result.credentials, result.state);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Authenticator code rejected.');
    } finally {
      setBusy(null);
    }
  };

  const connect = async (event: FormEvent) => {
    event.preventDefault();
    const id = workspaceId.trim().toLowerCase();
    if (!id || code.length !== 6) return;

    setBusy('login');
    setError('');
    try {
      const result = await loginWithTotp(id, code);
      rememberWorkspaceId(id);
      saveCredentials(result.credentials);
      onConnected(result.credentials, result.state);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Authenticator code rejected.');
      setCode('');
    } finally {
      setBusy(null);
    }
  };

  if (recovery) {
    return (
      <RecoveryAccess
        initialWorkspaceId={workspaceId || rememberedWorkspaceId}
        onCancel={() => {
          setRecovery(false);
          setError('');
        }}
        onRecovered={onConnected}
      />
    );
  }

  if (challenge) {
    return (
      <main className="setup-shell">
        <section className="setup-card authenticator-card">
          <div className="auth-header">
            <div className="brand-mark">N</div>
            <div>
              <div className="eyebrow">GOOGLE AUTHENTICATOR SETUP</div>
              <h1>Scan to secure NMRNL</h1>
              <p className="setup-lead">
                Open Google Authenticator, tap <b>+</b>, choose <b>Scan a QR code</b>,
                then enter the 6-digit code it generates.
              </p>
            </div>
          </div>

          <div className="locked-email-card setup-account">
            <span className="locked-email-icon">✉</span>
            <span>
              <small>Only approved account</small>
              <strong>{NMRNL_ACCOUNT_EMAIL}</strong>
            </span>
            <b>LOCKED</b>
          </div>

          {error && <div className="error-banner">{error}</div>}

          <div className="qr-shell">
            {qrDataUrl ? (
              <img src={qrDataUrl} alt="NMRNL Google Authenticator QR code" />
            ) : (
              <div className="qr-loading">Building QR…</div>
            )}
          </div>

          <div className="setup-identity">
            <span>Workspace ID</span>
            <code>{challenge.workspaceId}</code>
          </div>

          <details className="manual-secret">
            <summary>Can’t scan the QR?</summary>
            <p>Choose “Enter a setup key” in Google Authenticator and use:</p>
            <code>{challenge.totpSecret}</code>
          </details>

          <form className="totp-form" onSubmit={verifySetup}>
            <label>
              6-digit Authenticator code
              <input
                className="totp-input"
                value={code}
                onChange={(event) => updateCode(event.target.value)}
                placeholder="000000"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                autoFocus
              />
            </label>
            <button
              className="primary big"
              disabled={busy !== null || code.length !== 6}
            >
              {busy === 'verify' ? 'Verifying…' : 'Verify and open NMRNL'}
            </button>
          </form>
        </section>
      </main>
    );
  }

  const hasRememberedWorkspace = Boolean(
    rememberedWorkspaceId && !showWorkspaceField,
  );

  return (
    <main className="setup-shell">
      <section className="setup-card code-login-card">
        <div className="code-login-brand">
          <div className="brand-mark">N</div>
          <div>
            <div className="eyebrow">GOOGLE AUTHENTICATOR</div>
            <h1>{hasRememberedWorkspace ? 'Enter your code' : 'Sign in to NMRNL'}</h1>
          </div>
        </div>

        <div className="account-access-line">
          <span>Account</span>
          <strong>{NMRNL_ACCOUNT_EMAIL}</strong>
          <b>ONLY</b>
        </div>

        <p className="setup-lead code-login-lead">
          {hasRememberedWorkspace
            ? 'Open Google Authenticator and enter the current 6-digit NMRNL code.'
            : 'Enter your Workspace ID once, then use the current 6-digit code from Google Authenticator.'}
        </p>

        {error && <div className="error-banner">{error}</div>}

        <form className="code-login-form" onSubmit={connect}>
          {showWorkspaceField ? (
            <label className="workspace-login-field">
              Workspace ID
              <input
                value={workspaceId}
                onChange={(event) => setWorkspaceId(event.target.value)}
                placeholder="16-character workspace ID"
                autoComplete="username"
                autoFocus={!rememberedWorkspaceId}
              />
            </label>
          ) : (
            <div className="remembered-workspace">
              <span className="remembered-check">✓</span>
              <span>
                <strong>NMRNL workspace saved</strong>
                <small>{workspaceId.slice(0, 4)}••••••••{workspaceId.slice(-4)}</small>
              </span>
            </div>
          )}

          <label className="code-prompt">
            <span>Authenticator code</span>
            <input
              className="totp-input login-code"
              value={code}
              onChange={(event) => updateCode(event.target.value)}
              placeholder="000000"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              autoFocus={hasRememberedWorkspace}
              aria-label="6-digit Google Authenticator code"
            />
          </label>

          <button
            className="primary big open-nmrnl"
            disabled={
              busy !== null ||
              code.length !== 6 ||
              workspaceId.trim().length !== 16
            }
          >
            {busy === 'login' ? 'Checking code…' : 'Open NMRNL'}
          </button>
        </form>

        <button
          type="button"
          className="email-recovery-button"
          onClick={() => {
            setRecovery(true);
            setCode('');
            setError('');
          }}
        >
          <span>✉</span>
          <span>
            <strong>Can’t access Google Authenticator?</strong>
            <small>Recover with {NMRNL_ACCOUNT_EMAIL}</small>
          </span>
        </button>

        {rememberedWorkspaceId && (
          <button
            type="button"
            className="switch-workspace-button"
            onClick={() => {
              setShowWorkspaceField((value) => !value);
              setCode('');
              setError('');
            }}
          >
            {showWorkspaceField ? 'Use saved workspace' : 'Use a different workspace'}
          </button>
        )}

        <div className="setup-divider"><span>new workspace</span></div>

        <button
          className="secondary big create-secondary"
          type="button"
          onClick={create}
          disabled={busy !== null}
        >
          {busy === 'create' ? 'Creating…' : 'Create private workspace'}
        </button>
      </section>
    </main>
  );
}

function HomeScreen({
  state,
  mode,
  go,
}: {
  state: WorkspaceState;
  mode: Mode;
  go: (section: Section) => void;
}) {
  const entries = state.entries.filter((entry) => entry.mode === mode);
  const actions = state.actions.filter((action) => action.mode === mode);
  const recentEntries = [...entries]
    .sort((left, right) =>
      (right.date + right.startTime).localeCompare(left.date + left.startTime),
    )
    .slice(0, 6);

  const minutes = entries.reduce((total, entry) => total + entry.minutes, 0);
  const kilometres = entries.reduce(
    (total, entry) => total + entryKilometres(entry),
    0,
  );
  const visitActions = entries.flatMap((entry) =>
    entry.nextActions.filter((action) => !action.completedAt),
  ).length;
  const generalActions = actions.filter((action) => !action.completedAt).length;

  const lastSevenDays = entries.filter((entry) => {
    const time = new Date(entry.date + 'T12:00:00').getTime();
    return time >= todayStart() - 6 * 86_400_000;
  }).length;

  return (
    <div className="page-stack">
      <section className="hero-card">
        <div>
          <div className="eyebrow">{modeLabel(mode).toUpperCase()} WORKSPACE</div>
          <h2>Everything important, without the paperwork sprawl.</h2>
          <p>
            Capture work quickly, keep support-note detail attached to the record,
            and surface follow-ups before they get lost.
          </p>
        </div>
        <button className="primary hero-action" onClick={() => go('quick')}>
          + Quick entry
        </button>
      </section>

      <div className="stat-grid">
        <StatCard label="Entries" value={String(entries.length)} detail={lastSevenDays + ' in last 7 days'} />
        <StatCard label="Hours" value={formatHours(minutes)} detail="recorded time" />
        <StatCard label="Open actions" value={String(visitActions + generalActions)} detail={visitActions + ' from visits'} />
        <StatCard label="Travel" value={kilometres.toFixed(1) + ' km'} detail="home visits" />
      </div>

      <div className="dashboard-grid">
        <Panel
          title="Recent entries"
          subtitle="Latest recorded activity"
          action={
            <button className="text-button" onClick={() => go('entries')}>
              View all
            </button>
          }
        >
          {recentEntries.length === 0 ? (
            <EmptyState
              title="No entries yet"
              detail="Your first Quick Entry will appear here."
              action={<button className="primary" onClick={() => go('quick')}>Create entry</button>}
            />
          ) : (
            <div className="compact-list">
              {recentEntries.map((entry) => (
                <EntryRow key={entry.id} entry={entry} />
              ))}
            </div>
          )}
        </Panel>

        <Panel
          title="Action queue"
          subtitle="Outstanding follow-ups"
          action={
            <button className="text-button" onClick={() => go('actions')}>
              Open actions
            </button>
          }
        >
          <div className="action-summary">
            <div>
              <strong>{visitActions}</strong>
              <span>Visit actions</span>
            </div>
            <div>
              <strong>{generalActions}</strong>
              <span>Other actions</span>
            </div>
          </div>
          <div className="mini-callout">
            <span className="mini-callout-icon">✓</span>
            <div>
              <strong>Keep the next step visible</strong>
              <p>Add a follow-up while creating an entry and it lands in Actions automatically.</p>
            </div>
          </div>
        </Panel>
      </div>
    </div>
  );
}

function EmptyState({
  title,
  detail,
  action,
}: {
  title: string;
  detail: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <div className="empty-icon">＋</div>
      <strong>{title}</strong>
      <p>{detail}</p>
      {action}
    </div>
  );
}

function EntryRow({ entry }: { entry: WorkEntry }) {
  const definition = entryType(entry.type);
  return (
    <div className="entry-row">
      <div className="entry-icon">{definition.icon}</div>
      <div className="entry-row-main">
        <strong>{entry.client}</strong>
        <span>{definition.label} · {formatDate(entry.date)} · {entry.startTime}</span>
      </div>
      <div className="entry-row-time">{entry.minutes}m</div>
    </div>
  );
}

function QuickEntryScreen({
  mode,
  state,
  credentials,
  onState,
  go,
}: {
  mode: Mode;
  state: WorkspaceState;
  credentials: WorkspaceCredentials;
  onState: (state: WorkspaceState) => void;
  go: (section: Section) => void;
}) {
  const allowedTypes = entryTypesForMode(mode);
  const [type, setType] = useState<EntryTypeKey>(allowedTypes[0].key);
  const [client, setClient] = useState('');
  const [date, setDate] = useState(localDateValue());
  const [startTime, setStartTime] = useState(localTimeValue());
  const [minutes, setMinutes] = useState(60);
  const [notes, setNotes] = useState('');
  const [supportNote, setSupportNote] = useState('');
  const [nextAction, setNextAction] = useState('');
  const [importantText, setImportantText] = useState(false);
  const [direction, setDirection] = useState<TextContactDirection>('received');
  const [replyNeeded, setReplyNeeded] = useState(false);
  const [odometerStart, setOdometerStart] = useState('');
  const [odometerEnd, setOdometerEnd] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!allowedTypes.some((item) => item.key === type)) {
      setType(allowedTypes[0].key);
    }
  }, [mode, type, allowedTypes]);

  const definition = entryType(type);
  const clientNames = useMemo(
    () =>
      state.clients
        .filter((item) => item.mode === mode)
        .map((item) => item.name)
        .sort((left, right) => left.localeCompare(right)),
    [state.clients, mode],
  );

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setError('');

    if (definition.requiresClient && !client.trim()) {
      setError('Choose or enter a client before saving.');
      return;
    }

    const fallbackClient =
      type === 'emailProfessional'
        ? 'Professional email'
        : type === 'adminEducationResources'
          ? 'Admin / Education / Resources'
          : 'Unknown Client';

    const draft: EntryDraft = {
      mode,
      client: client.trim() || fallbackClient,
      type,
      date,
      startTime,
      minutes,
      notes: notes
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean),
      supportNoteBreakdown: supportNote.trim(),
      nextAction: nextAction.trim(),
      importantText,
      textContactDirection: direction,
      textReplyNeeded: replyNeeded,
      odometerStart:
        type === 'homeVisit' && odometerStart.trim()
          ? Number(odometerStart)
          : null,
      odometerEnd:
        type === 'homeVisit' && odometerEnd.trim() ? Number(odometerEnd) : null,
    };

    setSaving(true);
    try {
      const next = await createEntry(credentials, draft);
      onState(next);
      setNotes('');
      setSupportNote('');
      setNextAction('');
      setImportantText(false);
      setReplyNeeded(false);
      setOdometerStart('');
      setOdometerEnd('');
      go('entries');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not save entry.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="page-stack" onSubmit={save}>
      <section className="page-title">
        <div>
          <div className="eyebrow">FAST CAPTURE</div>
          <h2>Quick Entry</h2>
          <p>Record the contact first. Add only the detail that matters.</p>
        </div>
        <button className="primary" disabled={saving}>
          {saving ? 'Saving…' : 'Save entry'}
        </button>
      </section>

      {error && <div className="error-banner">{error}</div>}

      <Panel title="Entry type" subtitle="Choose what happened">
        <div className="type-grid">
          {allowedTypes.map((item) => (
            <button
              type="button"
              key={item.key}
              className={'type-tile ' + (item.key === type ? 'active' : '')}
              onClick={() => setType(item.key)}
            >
              <span>{item.icon}</span>
              <strong>{item.shortLabel}</strong>
            </button>
          ))}
        </div>
      </Panel>

      <Panel title="Who and when">
        <div className="form-grid four">
          <label className="field wide">
            <span>
              Client
              {!definition.requiresClient && (
                <small>{definition.optionalClient ? ' optional' : ' not required'}</small>
              )}
            </span>
            <input
              list="nmrnl-clients"
              value={client}
              onChange={(event) => setClient(event.target.value)}
              placeholder={
                definition.requiresClient ? 'Client name' : 'Optional client tag'
              }
            />
            <datalist id="nmrnl-clients">
              {clientNames.map((name) => <option value={name} key={name} />)}
            </datalist>
          </label>
          <label className="field">
            <span>Date</span>
            <input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
          </label>
          <label className="field">
            <span>Start</span>
            <input type="time" value={startTime} onChange={(event) => setStartTime(event.target.value)} />
          </label>
          <label className="field">
            <span>Minutes</span>
            <input
              type="number"
              min="0"
              max="1440"
              value={minutes}
              onChange={(event) => setMinutes(Number(event.target.value))}
            />
          </label>
        </div>
      </Panel>

      {type === 'homeVisit' && (
        <Panel title="Travel" subtitle="Odometer is used to calculate kilometres">
          <div className="form-grid two">
            <label className="field">
              <span>Odometer start</span>
              <input
                inputMode="decimal"
                value={odometerStart}
                onChange={(event) => setOdometerStart(event.target.value)}
                placeholder="e.g. 84520.3"
              />
            </label>
            <label className="field">
              <span>Odometer end</span>
              <input
                inputMode="decimal"
                value={odometerEnd}
                onChange={(event) => setOdometerEnd(event.target.value)}
                placeholder="e.g. 84534.8"
              />
            </label>
          </div>
        </Panel>
      )}

      {type === 'textNote' && (
        <Panel title="Text contact">
          <div className="form-grid two">
            <label className="field">
              <span>Direction</span>
              <select
                value={direction}
                onChange={(event) =>
                  setDirection(event.target.value as TextContactDirection)
                }
              >
                <option value="received">Received</option>
                <option value="sent">Sent</option>
                <option value="exchange">Exchange</option>
              </select>
            </label>
            <label className="check-card">
              <input
                type="checkbox"
                checked={replyNeeded}
                onChange={(event) => setReplyNeeded(event.target.checked)}
              />
              <span>
                <strong>Reply needed</strong>
                <small>Keep this text visible for follow-up.</small>
              </span>
            </label>
          </div>
        </Panel>
      )}

      <Panel title="Record">
        <div className="form-grid two note-grid">
          <label className="field">
            <span>Notes</span>
            <textarea
              rows={7}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="One point per line. Keep it factual and concise."
            />
          </label>
          <label className="field">
            <span>Support note breakdown</span>
            <textarea
              rows={7}
              value={supportNote}
              onChange={(event) => setSupportNote(event.target.value)}
              placeholder={
                'Attendance\n\nWhat happened\n\nWork/task completed\n\nSupport given\n\nIssue/problem\n\nOutcome\n\nNext step\n\nAnything to follow up\n\nReferrals'
              }
            />
          </label>
        </div>
      </Panel>

      <Panel title="Follow-up" subtitle="Optional — appears automatically in Actions">
        <div className="form-grid two">
          <label className="field">
            <span>Next action</span>
            <input
              value={nextAction}
              onChange={(event) => setNextAction(event.target.value)}
              placeholder="e.g. Call client Thursday about tenancy referral"
            />
          </label>
          <label className="check-card">
            <input
              type="checkbox"
              checked={importantText}
              onChange={(event) => setImportantText(event.target.checked)}
            />
            <span>
              <strong>Mark important</strong>
              <small>Useful for significant written contact.</small>
            </span>
          </label>
        </div>
      </Panel>

      <div className="mobile-save">
        <button className="primary big" disabled={saving}>
          {saving ? 'Saving…' : 'Save entry'}
        </button>
      </div>
    </form>
  );
}

function EntriesScreen({
  state,
  mode,
  credentials,
  onState,
}: {
  state: WorkspaceState;
  mode: Mode;
  credentials: WorkspaceCredentials;
  onState: (state: WorkspaceState) => void;
}) {
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | EntryTypeKey>('all');
  const [busyId, setBusyId] = useState('');
  const [error, setError] = useState('');

  const entries = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return state.entries
      .filter((entry) => entry.mode === mode)
      .filter((entry) => typeFilter === 'all' || entry.type === typeFilter)
      .filter((entry) => {
        if (!needle) return true;
        return (
          entry.client.toLowerCase().includes(needle) ||
          entryType(entry.type).label.toLowerCase().includes(needle) ||
          entry.notes.some((note) => note.toLowerCase().includes(needle)) ||
          entry.supportNoteBreakdown.toLowerCase().includes(needle)
        );
      })
      .sort((left, right) =>
        (right.date + right.startTime).localeCompare(left.date + left.startTime),
      );
  }, [state.entries, mode, search, typeFilter]);

  const allModeEntries = state.entries.filter((entry) => entry.mode === mode);
  const totalMinutes = entries.reduce((sum, entry) => sum + entry.minutes, 0);
  const km = entries.reduce((sum, entry) => sum + entryKilometres(entry), 0);

  const remove = async (entry: WorkEntry) => {
    if (!window.confirm('Delete this ' + entryType(entry.type).label + ' entry for ' + entry.client + '?')) {
      return;
    }
    setBusyId(entry.id);
    setError('');
    try {
      onState(await deleteEntry(credentials, entry.id));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not delete entry.');
    } finally {
      setBusyId('');
    }
  };

  return (
    <div className="page-stack">
      <section className="page-title">
        <div>
          <div className="eyebrow">RECORDS</div>
          <h2>Entries</h2>
          <p>Search visits, contacts and case notes from one place.</p>
        </div>
      </section>

      {error && <div className="error-banner">{error}</div>}

      <Panel title="Filter entries">
        <div className="filter-row">
          <input
            className="search-input"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search client, type or note…"
          />
          <select
            value={typeFilter}
            onChange={(event) =>
              setTypeFilter(event.target.value as 'all' | EntryTypeKey)
            }
          >
            <option value="all">All entry types</option>
            {entryTypesForMode(mode).map((item) => (
              <option value={item.key} key={item.key}>
                {item.label}
              </option>
            ))}
          </select>
        </div>
      </Panel>

      <div className="stat-grid compact-stats">
        <StatCard label="Showing" value={entries.length + '/' + allModeEntries.length} />
        <StatCard label="Hours" value={formatHours(totalMinutes)} />
        <StatCard label="KM" value={km.toFixed(1)} />
        <StatCard
          label="Follow-ups"
          value={String(
            entries.reduce(
              (sum, entry) =>
                sum + entry.nextActions.filter((action) => !action.completedAt).length,
              0,
            ),
          )}
        />
      </div>

      {entries.length === 0 ? (
        <Panel title="Results">
          <EmptyState
            title={allModeEntries.length ? 'No matching entries' : 'No entries yet'}
            detail={
              allModeEntries.length
                ? 'Try clearing your filters.'
                : 'Use Quick Entry to record your first activity.'
            }
          />
        </Panel>
      ) : (
        <div className="entry-card-list">
          {entries.map((entry) => {
            const definition = entryType(entry.type);
            const openActions = entry.nextActions.filter((action) => !action.completedAt);
            return (
              <article className="entry-card" key={entry.id}>
                <div className="entry-card-top">
                  <div className="entry-card-icon">{definition.icon}</div>
                  <div className="entry-card-title">
                    <div className="entry-meta-line">
                      <span>{definition.label}</span>
                      {entry.importantText && <b className="important-pill">Important</b>}
                    </div>
                    <h3>{entry.client}</h3>
                    <p>{formatDate(entry.date)} · {entry.startTime} · {entry.minutes} min</p>
                  </div>
                  <button
                    className="icon-button danger"
                    onClick={() => void remove(entry)}
                    disabled={busyId === entry.id}
                    title="Delete entry"
                  >
                    ×
                  </button>
                </div>

                {(entry.notes.length > 0 || entry.supportNoteBreakdown) && (
                  <div className="entry-content-grid">
                    {entry.notes.length > 0 && (
                      <div className="entry-note-block">
                        <span>Notes</span>
                        <ul>
                          {entry.notes.map((note, index) => <li key={index}>{note}</li>)}
                        </ul>
                      </div>
                    )}
                    {entry.supportNoteBreakdown && (
                      <div className="entry-note-block">
                        <span>Support note</span>
                        <pre>{entry.supportNoteBreakdown}</pre>
                      </div>
                    )}
                  </div>
                )}

                <div className="entry-card-footer">
                  <span>{entryKilometres(entry).toFixed(1)} km</span>
                  <span>{openActions.length} open follow-up{openActions.length === 1 ? '' : 's'}</span>
                  {entry.type === 'textNote' && (
                    <span>{entry.textContactDirection}{entry.textReplyNeeded ? ' · reply needed' : ''}</span>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ActionsScreen({
  state,
  mode,
  credentials,
  onState,
}: {
  state: WorkspaceState;
  mode: Mode;
  credentials: WorkspaceCredentials;
  onState: (state: WorkspaceState) => void;
}) {
  const [tab, setTab] = useState<'visit' | 'other'>('visit');
  const [title, setTitle] = useState('');
  const [client, setClient] = useState('');
  const [scope, setScope] = useState<GeneralAction['scope']>('client');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  const visitActions = state.entries
    .filter((entry) => entry.mode === mode)
    .flatMap((entry) =>
      entry.nextActions.map((action) => ({ entry, action })),
    )
    .sort((left, right) => right.action.createdAt.localeCompare(left.action.createdAt));

  const otherActions = state.actions
    .filter((action) => action.mode === mode)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));

  const openVisitCount = visitActions.filter((item) => !item.action.completedAt).length;
  const openOtherCount = otherActions.filter((action) => !action.completedAt).length;
  const completedCount =
    visitActions.filter((item) => item.action.completedAt).length +
    otherActions.filter((action) => action.completedAt).length;

  const clientNames = state.clients
    .filter((item) => item.mode === mode)
    .map((item) => item.name)
    .sort((left, right) => left.localeCompare(right));

  const addAction = async (event: FormEvent) => {
    event.preventDefault();
    if (!title.trim()) return;
    setBusy('new');
    setError('');
    try {
      const next = await createGeneralAction(credentials, {
        mode,
        title: title.trim(),
        scope,
        client: client.trim() || null,
      });
      onState(next);
      setTitle('');
      setClient('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not add action.');
    } finally {
      setBusy('');
    }
  };

  const toggleVisit = async (
    entryId: string,
    actionId: string,
    completed: boolean,
  ) => {
    const key = 'visit:' + actionId;
    setBusy(key);
    setError('');
    try {
      onState(
        await setVisitActionCompleted(credentials, entryId, actionId, completed),
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not update action.');
    } finally {
      setBusy('');
    }
  };

  const toggleOther = async (actionId: string, completed: boolean) => {
    const key = 'other:' + actionId;
    setBusy(key);
    setError('');
    try {
      onState(await setGeneralActionCompleted(credentials, actionId, completed));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not update action.');
    } finally {
      setBusy('');
    }
  };

  return (
    <div className="page-stack">
      <section className="actions-hero">
        <div className="actions-hero-icon">✓</div>
        <div>
          <div className="eyebrow">FOLLOW-UP</div>
          <h2>Actions workspace</h2>
          <p>Keep visit follow-ups and other tasks in one place.</p>
        </div>
        <div className="action-badges">
          <span className="badge amber">{openVisitCount} Visit</span>
          <span className="badge blue">{openOtherCount} Other open</span>
          <span className="badge green">{completedCount} Completed</span>
        </div>
      </section>

      {error && <div className="error-banner">{error}</div>}

      <div className="segmented">
        <button className={tab === 'visit' ? 'active' : ''} onClick={() => setTab('visit')}>
          Visit actions
        </button>
        <button className={tab === 'other' ? 'active' : ''} onClick={() => setTab('other')}>
          Other actions
        </button>
      </div>

      {tab === 'visit' ? (
        <Panel title="Visit follow-ups" subtitle="Created from Quick Entry">
          {visitActions.length === 0 ? (
            <EmptyState title="No visit actions" detail="Add a Next action while recording an entry." />
          ) : (
            <div className="task-list">
              {visitActions.map(({ entry, action }) => {
                const key = 'visit:' + action.id;
                return (
                  <label className={'task-row ' + (action.completedAt ? 'done' : '')} key={action.id}>
                    <input
                      type="checkbox"
                      checked={Boolean(action.completedAt)}
                      disabled={busy === key}
                      onChange={(event) =>
                        void toggleVisit(entry.id, action.id, event.target.checked)
                      }
                    />
                    <span className="task-copy">
                      <strong>{action.text}</strong>
                      <small>{entry.client} · {formatDate(entry.date)} · {entryType(entry.type).label}</small>
                    </span>
                  </label>
                );
              })}
            </div>
          )}
        </Panel>
      ) : (
        <>
          <Panel title="Add other action" subtitle="Client task or knowledge gap">
            <form className="action-form" onSubmit={addAction}>
              <input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="What needs doing?"
              />
              <select
                value={scope}
                onChange={(event) => setScope(event.target.value as GeneralAction['scope'])}
              >
                <option value="client">Client</option>
                <option value="knowledgeGap">Knowledge gap</option>
              </select>
              <input
                list="nmrnl-action-clients"
                value={client}
                onChange={(event) => setClient(event.target.value)}
                placeholder="Client (optional)"
              />
              <datalist id="nmrnl-action-clients">
                {clientNames.map((name) => <option value={name} key={name} />)}
              </datalist>
              <button className="primary" disabled={busy === 'new'}>
                {busy === 'new' ? 'Adding…' : 'Add action'}
              </button>
            </form>
          </Panel>

          <Panel title="Other actions">
            {otherActions.length === 0 ? (
              <EmptyState title="No other actions" detail="Add a client task or something you need to learn/check." />
            ) : (
              <div className="task-list">
                {otherActions.map((action) => {
                  const key = 'other:' + action.id;
                  return (
                    <label className={'task-row ' + (action.completedAt ? 'done' : '')} key={action.id}>
                      <input
                        type="checkbox"
                        checked={Boolean(action.completedAt)}
                        disabled={busy === key}
                        onChange={(event) =>
                          void toggleOther(action.id, event.target.checked)
                        }
                      />
                      <span className="task-copy">
                        <strong>{action.title}</strong>
                        <small>
                          {action.scope === 'knowledgeGap' ? 'Knowledge gap' : action.client || 'Client action'}
                        </small>
                      </span>
                    </label>
                  );
                })}
              </div>
            )}
          </Panel>
        </>
      )}
    </div>
  );
}

function WorkspaceScreen({
  credentials,
  state,
  onState,
  onCredentials,
  disconnect,
}: {
  credentials: WorkspaceCredentials;
  state: WorkspaceState;
  onState: (state: WorkspaceState) => void;
  onCredentials: (credentials: WorkspaceCredentials) => void;
  disconnect: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [challenge, setChallenge] = useState<WorkspaceSetupChallenge | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    if (!challenge) {
      setQrDataUrl('');
      return;
    }

    QRCode.toDataURL(challenge.otpauthUri, {
      width: 240,
      margin: 1,
      errorCorrectionLevel: 'M',
    })
      .then((value) => {
        if (active) setQrDataUrl(value);
      })
      .catch(() => {
        if (active) setError('Could not render the Authenticator QR code.');
      });

    return () => {
      active = false;
    };
  }, [challenge]);

  const copyId = async () => {
    await navigator.clipboard.writeText(credentials.workspaceId);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };

  const startEnrollment = async () => {
    setBusy(true);
    setError('');
    try {
      const next = await beginAuthenticatorEnrollment(credentials);
      setChallenge(next);
      setCode('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not start Authenticator setup.');
    } finally {
      setBusy(false);
    }
  };

  const confirmEnrollment = async (event: FormEvent) => {
    event.preventDefault();
    if (code.length !== 6) return;

    setBusy(true);
    setError('');
    try {
      const result = await confirmAuthenticatorEnrollment(credentials, code);
      saveCredentials(result.credentials);
      onCredentials(result.credentials);
      onState(result.state);
      setChallenge(null);
      setCode('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Authenticator code rejected.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page-stack">
      <section className="page-title">
        <div>
          <div className="eyebrow">PRIVATE WORKSPACE</div>
          <h2>Workspace</h2>
          <p>Authentication and cloud workspace details.</p>
        </div>
      </section>

      {error && <div className="error-banner">{error}</div>}

      <Panel title="Account & recovery email" subtitle="Email access is restricted to one account">
        <div className="locked-email-card workspace-email-card">
          <span className="locked-email-icon">✉</span>
          <span>
            <small>Only approved NMRNL account</small>
            <strong>{state.accountEmail || NMRNL_ACCOUNT_EMAIL}</strong>
          </span>
          <b>{state.recoveryEmailEnabled ? 'RECOVERY ON' : 'LOCKED'}</b>
        </div>
        <p className="panel-footnote">
          Authenticator recovery codes can only be sent to this address. There is no
          option to add a second account or change the recovery destination in NMRNL.
        </p>
      </Panel>

      <Panel
        title="Google Authenticator"
        subtitle={
          state.authenticatorEnabled
            ? 'Required when signing in on a new browser'
            : 'One-time security upgrade available'
        }
      >
        {state.authenticatorEnabled ? (
          <div className="auth-status-card enabled">
            <div className="auth-status-icon">✓</div>
            <div>
              <strong>Authenticator enabled</strong>
              <p>
                NMRNL accepts a fresh 6-digit Google Authenticator code to create
                a temporary browser session.
              </p>
            </div>
          </div>
        ) : challenge ? (
          <div className="legacy-enrolment">
            <div className="qr-shell small">
              {qrDataUrl ? (
                <img src={qrDataUrl} alt="NMRNL Google Authenticator QR code" />
              ) : (
                <div className="qr-loading">Building QR…</div>
              )}
            </div>
            <div className="legacy-enrolment-copy">
              <h3>Scan this QR</h3>
              <p>
                In Google Authenticator tap <b>+</b> → <b>Scan a QR code</b>.
                Then verify the first 6-digit code below.
              </p>
              <details className="manual-secret">
                <summary>Manual setup key</summary>
                <code>{challenge.totpSecret}</code>
              </details>
              <form className="totp-form inline" onSubmit={confirmEnrollment}>
                <input
                  className="totp-input"
                  value={code}
                  onChange={(event) =>
                    setCode(event.target.value.replace(/\D/g, '').slice(0, 6))
                  }
                  placeholder="000000"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                />
                <button className="primary" disabled={busy || code.length !== 6}>
                  {busy ? 'Verifying…' : 'Enable Authenticator'}
                </button>
              </form>
            </div>
          </div>
        ) : (
          <div className="auth-status-card legacy">
            <div className="auth-status-icon">!</div>
            <div>
              <strong>Legacy owner-key workspace</strong>
              <p>
                Upgrade this workspace without losing entries. After the QR is
                verified, the old owner-key login is disabled.
              </p>
              <button className="primary" onClick={() => void startEnrollment()} disabled={busy}>
                {busy ? 'Starting…' : 'Enable Google Authenticator'}
              </button>
            </div>
          </div>
        )}
      </Panel>

      <Panel title="Workspace ID" subtitle="Use this with your Authenticator code on another device">
        <div className="workspace-id-row">
          <code>{credentials.workspaceId}</code>
          <button className="secondary compact" onClick={() => void copyId()}>
            {copied ? 'Copied' : 'Copy ID'}
          </button>
        </div>
      </Panel>

      <Panel title="Workspace data">
        <div className="stat-grid compact-stats">
          <StatCard label="Clients" value={String(state.clients.length)} />
          <StatCard label="Entries" value={String(state.entries.length)} />
          <StatCard label="Actions" value={String(state.actions.length)} />
          <StatCard label="Created" value={formatDate(state.createdAt.slice(0, 10))} />
        </div>
      </Panel>

      <Panel title="This browser">
        <div className="danger-zone">
          <div>
            <strong>{state.authenticatorEnabled ? 'Sign out' : 'Upgrade before signing out'}</strong>
            <p>
              {state.authenticatorEnabled
                ? 'Ends this browser session. Your cloud data and Google Authenticator enrollment stay in place.'
                : 'Complete the Google Authenticator QR setup above first so you can sign back in safely.'}
            </p>
          </div>
          <button
            className="danger-button"
            onClick={disconnect}
            disabled={!state.authenticatorEnabled}
          >
            Sign out
          </button>
        </div>
      </Panel>
    </div>
  );
}

export function App() {
  const [credentials, setCredentials] = useState<WorkspaceCredentials | null>(
    () => loadCredentials(),
  );
  const [state, setState] = useState<WorkspaceState | null>(null);
  const [mode, setMode] = useState<Mode>('work');
  const [section, setSection] = useState<Section>('home');
  const [loading, setLoading] = useState(Boolean(credentials));
  const [error, setError] = useState('');

  useEffect(() => {
    if (!credentials) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError('');

    fetchWorkspace(credentials)
      .then((next) => {
        if (!cancelled) setState(next);
      })
      .catch((reason) => {
        if (!cancelled) {
          const message =
            reason instanceof Error
              ? reason.message
              : 'Could not open the saved NMRNL workspace.';

          if (
            message.toLowerCase().includes('session expired') ||
            message.toLowerCase().includes('sign in with a new authenticator code')
          ) {
            clearCredentials();
            setState(null);
            setCredentials(null);
            setError('');
            return;
          }

          setError(message);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [credentials]);

  if (!credentials) {
    return (
      <WorkspaceSetup
        onConnected={(nextCredentials, nextState) => {
          setCredentials(nextCredentials);
          setState(nextState);
          setSection('home');
        }}
      />
    );
  }

  if (loading && !state) {
    return (
      <main className="loading-shell">
        <div className="brand-mark">N</div>
        <strong>Opening NMRNL…</strong>
      </main>
    );
  }

  if (!state) {
    return (
      <main className="setup-shell">
        <section className="setup-card">
          <div className="brand-mark">N</div>
          <h1>Workspace unavailable</h1>
          <p className="setup-lead">{error || 'NMRNL could not load this workspace.'}</p>
          <button
            className="secondary"
            onClick={() => {
              clearCredentials();
              setCredentials(null);
              setError('');
            }}
          >
            Use another workspace
          </button>
        </section>
      </main>
    );
  }

  const navItems: Array<{ key: Section; label: string; icon: string }> = [
    { key: 'home', label: 'Home', icon: '⌂' },
    { key: 'quick', label: 'Quick Entry', icon: '+' },
    { key: 'entries', label: 'Entries', icon: '▤' },
    { key: 'actions', label: 'Actions', icon: '✓' },
    { key: 'workspace', label: 'Workspace', icon: '⚙' },
  ];

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <button className="brand" onClick={() => setSection('home')}>
          <span className="brand-mark small">N</span>
          <span>
            <strong>NMRNL</strong>
            <small>Support workspace</small>
          </span>
        </button>

        <nav className="side-nav">
          {navItems.map((item) => (
            <button
              key={item.key}
              className={section === item.key ? 'active' : ''}
              onClick={() => setSection(item.key)}
            >
              <span>{item.icon}</span>
              {item.label}
            </button>
          ))}
        </nav>

        <div className="sidebar-footer">
          <span>Private workspace</span>
          <code>{credentials.workspaceId.slice(0, 8)}…</code>
        </div>
      </aside>

      <section className="main-column">
        <header className="topbar">
          <div className="mobile-brand">
            <span className="brand-mark tiny">N</span>
            <strong>NMRNL</strong>
          </div>

          <div className="mode-switcher" aria-label="Workspace mode">
            {MODE_OPTIONS.map((option) => (
              <button
                key={option.key}
                className={mode === option.key ? 'active' : ''}
                onClick={() => setMode(option.key)}
              >
                {option.label}
              </button>
            ))}
          </div>

          <div className="sync-pill">
            <span />
            Cloud saved
          </div>
        </header>

        {error && <div className="global-error">{error}</div>}

        <div className="content">
          {section === 'home' && <HomeScreen state={state} mode={mode} go={setSection} />}
          {section === 'quick' && (
            <QuickEntryScreen
              state={state}
              mode={mode}
              credentials={credentials}
              onState={setState}
              go={setSection}
            />
          )}
          {section === 'entries' && (
            <EntriesScreen
              state={state}
              mode={mode}
              credentials={credentials}
              onState={setState}
            />
          )}
          {section === 'actions' && (
            <ActionsScreen
              state={state}
              mode={mode}
              credentials={credentials}
              onState={setState}
            />
          )}
          {section === 'workspace' && (
            <WorkspaceScreen
              state={state}
              credentials={credentials}
              onState={setState}
              onCredentials={setCredentials}
              disconnect={() => {
                if (!window.confirm('Sign out of NMRNL on this browser?')) return;
                clearCredentials();
                setCredentials(null);
                setState(null);
              }}
            />
          )}
        </div>

        <nav className="bottom-nav">
          {navItems.slice(0, 5).map((item) => (
            <button
              key={item.key}
              className={section === item.key ? 'active' : ''}
              onClick={() => setSection(item.key)}
            >
              <span>{item.icon}</span>
              <small>{item.label === 'Quick Entry' ? 'Quick' : item.label}</small>
            </button>
          ))}
        </nav>
      </section>
    </main>
  );
}
