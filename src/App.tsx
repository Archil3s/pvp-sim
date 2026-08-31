import {
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import QRCode from 'qrcode';

import {
  beginAccessRecovery,
  beginAuthenticatorEnrollment,
  clearCredentials,
  confirmAuthenticatorEnrollment,
  confirmWorkspaceTotp,
  createEntry,
  createGeneralAction,
  createWorkspace,
  deleteEntry,
  fetchAccountWorkspace,
  fetchWorkspace,
  loadCredentials,
  loadKnownWorkspaceId,
  loginWithTotp,
  NMRNL_ACCOUNT_EMAIL,
  openTemporaryWorkspace,
  rememberWorkspaceId,
  saveCredentials,
  confirmRecoveryAuthenticator,
  setGeneralActionCompleted,
  setVisitActionCompleted,
  updateEntry,
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

const TEMPORARY_LOGIN_BYPASS = true;

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
  workspaceId,
  onCancel,
  onRecovered,
}: {
  workspaceId: string;
  onCancel: () => void;
  onRecovered: (credentials: WorkspaceCredentials, state: WorkspaceState) => void;
}) {
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

  const startRecovery = async () => {
    if (!workspaceId) return;

    setBusy(true);
    setError('');
    try {
      const next = await beginAccessRecovery(workspaceId);
      setChallenge(next);
      setAuthCode('');
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : 'Could not start Authenticator recovery.',
      );
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
            <div className="eyebrow">MALEROOM ACCOUNT RECOVERY</div>
            <h1>{challenge ? 'Set up a new Authenticator' : 'Recover NMRNL'}</h1>
          </div>
        </div>

        {error && <div className="error-banner">{error}</div>}

        {!challenge ? (
          <div className="recovery-stack">
            <p className="setup-lead">
              Your NMRNL workspace is attached to the Maleroom account. Cloudflare
              Access has already verified the email before this screen loads.
            </p>

            <div className="locked-email-card">
              <span className="locked-email-icon">✓</span>
              <span>
                <small>Workspace owner</small>
                <strong>{NMRNL_ACCOUNT_EMAIL}</strong>
              </span>
              <b>SYNCED</b>
            </div>

            <button
              type="button"
              className="primary big"
              onClick={() => void startRecovery()}
              disabled={busy || !workspaceId}
            >
              {busy ? 'Preparing recovery…' : 'Replace Google Authenticator'}
            </button>

            <p className="privacy-note">
              No Workspace ID is needed. The Maleroom account resolves the same
              workspace on every device.
            </p>
          </div>
        ) : (
          <form className="recovery-stack" onSubmit={confirmAuthenticator}>
            <p className="setup-lead">
              Scan this replacement QR in Google Authenticator, then enter the new
              6-digit code.
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

            <button className="primary big" disabled={busy || authCode.length !== 6}>
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
  const [workspaceId, setWorkspaceId] = useState('');
  const [workspaceExists, setWorkspaceExists] = useState(false);
  const [authenticatorEnabled, setAuthenticatorEnabled] = useState(false);
  const [accountLoading, setAccountLoading] = useState(true);
  const [code, setCode] = useState('');
  const [challenge, setChallenge] = useState<WorkspaceSetupChallenge | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [recovery, setRecovery] = useState(false);
  const [busy, setBusy] = useState<'create' | 'verify' | 'login' | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;

    fetchAccountWorkspace()
      .then((account) => {
        if (!active) return;
        setWorkspaceId(account.workspaceId);
        setWorkspaceExists(account.exists);
        setAuthenticatorEnabled(account.authenticatorEnabled);
        if (account.workspaceId) rememberWorkspaceId(account.workspaceId);
      })
      .catch((reason) => {
        if (!active) return;
        setError(
          reason instanceof Error
            ? reason.message
            : 'Could not load the Maleroom workspace.',
        );
      })
      .finally(() => {
        if (active) setAccountLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

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
      setWorkspaceId(nextChallenge.workspaceId);
      setWorkspaceExists(true);
      rememberWorkspaceId(nextChallenge.workspaceId);
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
      setAuthenticatorEnabled(true);
      onConnected(result.credentials, result.state);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Authenticator code rejected.');
    } finally {
      setBusy(null);
    }
  };

  const connect = async (event: FormEvent) => {
    event.preventDefault();
    if (!workspaceId || code.length !== 6) return;

    setBusy('login');
    setError('');
    try {
      const result = await loginWithTotp(workspaceId, code);
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
        workspaceId={workspaceId}
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
              <h1>Secure your Maleroom workspace</h1>
              <p className="setup-lead">
                This workspace is permanently attached to {NMRNL_ACCOUNT_EMAIL}.
                Scan the QR, then enter the generated 6-digit code.
              </p>
            </div>
          </div>

          <div className="locked-email-card setup-account">
            <span className="locked-email-icon">✓</span>
            <span>
              <small>Workspace owner</small>
              <strong>{NMRNL_ACCOUNT_EMAIL}</strong>
            </span>
            <b>SYNCED</b>
          </div>

          {error && <div className="error-banner">{error}</div>}

          <div className="qr-shell">
            {qrDataUrl ? (
              <img src={qrDataUrl} alt="NMRNL Google Authenticator QR code" />
            ) : (
              <div className="qr-loading">Building QR…</div>
            )}
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

  return (
    <main className="setup-shell">
      <section className="setup-card code-login-card">
        <div className="code-login-brand">
          <div className="brand-mark">N</div>
          <div>
            <div className="eyebrow">MALEROOM ACCOUNT</div>
            <h1>{workspaceExists ? 'Sign in to NMRNL' : 'Set up NMRNL'}</h1>
          </div>
        </div>

        <div className="account-access-line">
          <span>Workspace owner</span>
          <strong>{NMRNL_ACCOUNT_EMAIL}</strong>
          <b>SYNCED</b>
        </div>

        <p className="setup-lead code-login-lead">
          {accountLoading
            ? 'Finding your Maleroom workspace…'
            : workspaceExists
              ? 'Your workspace is linked to this email. Enter the current 6-digit Google Authenticator code on any device.'
              : 'No workspace exists for this account yet. Create it once and it will be available on every device.'}
        </p>

        {error && <div className="error-banner">{error}</div>}

        {workspaceExists && authenticatorEnabled ? (
          <>
            <form className="code-login-form" onSubmit={connect}>
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
                  autoFocus
                  aria-label="6-digit Google Authenticator code"
                />
              </label>

              <button
                className="primary big open-nmrnl"
                disabled={busy !== null || code.length !== 6 || !workspaceId}
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
              <span>↻</span>
              <span>
                <strong>Can’t access Google Authenticator?</strong>
                <small>Recover the workspace through the Maleroom account</small>
              </span>
            </button>
          </>
        ) : !accountLoading ? (
          <button
            className="primary big"
            type="button"
            onClick={() => void create()}
            disabled={busy !== null}
          >
            {busy === 'create' ? 'Creating…' : 'Create Maleroom workspace'}
          </button>
        ) : null}
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

const EDIT_NOTE_OPTIONS = [
  'Wellbeing', 'Safety Plan', 'Distress Support', 'Daily Living', 'Appointment',
  'Transport', 'Advocacy', 'Crisis', 'Trauma Support', 'Boundaries',
  'Family/Tamariki', 'Community', 'Prof. Contact', 'No Contact', 'Cancelled',
  'No Show', 'Rescheduled', 'Client Rescheduled', 'Late Cancel', 'Cut Short',
  'Follow-up Needed',
];

function EditEntryModal({
  entry,
  state,
  credentials,
  onState,
  onClose,
}: {
  entry: WorkEntry;
  state: WorkspaceState;
  credentials: WorkspaceCredentials;
  onState: (state: WorkspaceState) => void;
  onClose: () => void;
}) {
  const [type, setType] = useState<EntryTypeKey>(entry.type);
  const [client, setClient] = useState(entry.client);
  const [date, setDate] = useState(entry.date);
  const [startTime, setStartTime] = useState(entry.startTime);
  const [minutes, setMinutes] = useState(entry.minutes);
  const [notes, setNotes] = useState(entry.notes.join('\n'));
  const [supportNote, setSupportNote] = useState(entry.supportNoteBreakdown);
  const [importantText, setImportantText] = useState(entry.importantText);
  const [direction, setDirection] = useState<TextContactDirection>(entry.textContactDirection);
  const [replyNeeded, setReplyNeeded] = useState(entry.textReplyNeeded);
  const [odometerStart, setOdometerStart] = useState(
    entry.odometerStart == null ? '' : String(entry.odometerStart),
  );
  const [odometerEnd, setOdometerEnd] = useState(
    entry.odometerEnd == null ? '' : String(entry.odometerEnd),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const definition = entryType(type);
  const clients = state.clients
    .filter((item) => item.mode === entry.mode)
    .map((item) => item.name)
    .sort((a, b) => a.localeCompare(b));

  const toggleNote = (note: string) => {
    const current = notes.split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
    setNotes(
      (current.includes(note)
        ? current.filter((item) => item !== note)
        : [...current, note]
      ).join('\n'),
    );
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setError('');

    if (definition.requiresClient && !client.trim()) {
      setError('Choose or enter a client before saving.');
      return;
    }

    const startOdo =
      type === 'homeVisit' && odometerStart.trim() ? Number(odometerStart) : null;
    const endOdo =
      type === 'homeVisit' && odometerEnd.trim() ? Number(odometerEnd) : null;

    if (
      startOdo != null &&
      endOdo != null &&
      Number.isFinite(startOdo) &&
      Number.isFinite(endOdo) &&
      endOdo < startOdo
    ) {
      setError('Finish odometer must be higher than start.');
      return;
    }

    const draft: EntryDraft = {
      mode: entry.mode,
      client:
        client.trim() ||
        (type === 'emailProfessional'
          ? 'Professional email'
          : type === 'adminEducationResources'
            ? 'Admin / Education / Resources'
            : entry.client),
      type,
      date,
      startTime,
      minutes: Math.max(1, Math.min(1440, Number(minutes) || 1)),
      notes: notes.split(/\r?\n/).map((item) => item.trim()).filter(Boolean),
      supportNoteBreakdown: supportNote.trim(),
      nextAction: '',
      importantText,
      textContactDirection: direction,
      textReplyNeeded: replyNeeded,
      odometerStart: startOdo != null && Number.isFinite(startOdo) ? startOdo : null,
      odometerEnd: endOdo != null && Number.isFinite(endOdo) ? endOdo : null,
    };

    setSaving(true);
    try {
      onState(await updateEntry(credentials, entry.id, draft));
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not update entry.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <form
        className="edit-entry-modal"
        onSubmit={save}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="edit-entry-header">
          <div>
            <div className="eyebrow">EDIT WORK ENTRY</div>
            <h2>{entry.client}</h2>
          </div>
          <button type="button" className="icon-button" onClick={onClose}>×</button>
        </div>

        {error && <div className="error-banner">{error}</div>}

        <div className="edit-entry-grid">
          <label className="field wide">
            <span>Client</span>
            <input list="edit-entry-clients" value={client} onChange={(e) => setClient(e.target.value)} />
            <datalist id="edit-entry-clients">
              {clients.map((name) => <option key={name} value={name} />)}
            </datalist>
          </label>
          <label className="field">
            <span>Type</span>
            <select value={type} onChange={(e) => setType(e.target.value as EntryTypeKey)}>
              {entryTypesForMode(entry.mode).map((item) => (
                <option key={item.key} value={item.key}>{item.label}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Date</span>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          <label className="field">
            <span>Start</span>
            <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
          </label>
          <label className="field">
            <span>Minutes</span>
            <input type="number" min="1" max="1440" value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} />
          </label>
        </div>

        {type === 'homeVisit' && (
          <div className="edit-entry-section">
            <strong>Travel</strong>
            <div className="form-grid two">
              <label className="field">
                <span>Start odometer</span>
                <input inputMode="decimal" value={odometerStart} onChange={(e) => setOdometerStart(e.target.value)} />
              </label>
              <label className="field">
                <span>Finish odometer</span>
                <input inputMode="decimal" value={odometerEnd} onChange={(e) => setOdometerEnd(e.target.value)} />
              </label>
            </div>
          </div>
        )}

        {type === 'textNote' && (
          <div className="edit-entry-section">
            <strong>Written contact</strong>
            <div className="form-grid two">
              <label className="field">
                <span>Direction</span>
                <select value={direction} onChange={(e) => setDirection(e.target.value as TextContactDirection)}>
                  <option value="received">Received</option>
                  <option value="sent">Sent</option>
                  <option value="exchange">Exchange</option>
                </select>
              </label>
              <label className="check-card">
                <input type="checkbox" checked={replyNeeded} onChange={(e) => setReplyNeeded(e.target.checked)} />
                <span><strong>Reply needed</strong><small>Keep visible for follow-up.</small></span>
              </label>
            </div>
          </div>
        )}

        <div className="edit-entry-section">
          <strong>Quick note tags</strong>
          <div className="tag-picker">
            {EDIT_NOTE_OPTIONS.map((note) => {
              const selected = notes.split(/\r?\n/).map((item) => item.trim()).includes(note);
              return (
                <button
                  type="button"
                  key={note}
                  className={selected ? 'selected' : ''}
                  onClick={() => toggleNote(note)}
                >
                  {note}
                </button>
              );
            })}
          </div>
        </div>

        <div className="form-grid two note-grid">
          <label className="field">
            <span>Notes</span>
            <textarea rows={6} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </label>
          <label className="field">
            <span>Support note breakdown</span>
            <textarea rows={6} value={supportNote} onChange={(e) => setSupportNote(e.target.value)} />
          </label>
        </div>

        <label className="check-card edit-important">
          <input type="checkbox" checked={importantText} onChange={(e) => setImportantText(e.target.checked)} />
          <span><strong>Mark important</strong><small>Highlight significant written contact.</small></span>
        </label>

        <div className="edit-entry-actions">
          <button type="button" className="secondary" onClick={onClose}>Cancel</button>
          <button className="primary" disabled={saving}>{saving ? 'Saving…' : 'Save changes'}</button>
        </div>
      </form>
    </div>
  );
}

function entryDateTime(entry: WorkEntry): Date {
  return new Date(entry.date + 'T' + entry.startTime + ':00');
}

function entriesOverlap(entries: WorkEntry[]): Set<string> {
  const result = new Set<string>();
  const sorted = [...entries].sort(
    (a, b) => entryDateTime(a).getTime() - entryDateTime(b).getTime(),
  );

  for (let index = 0; index < sorted.length; index += 1) {
    const current = sorted[index];
    const currentStart = entryDateTime(current).getTime();
    const currentEnd = currentStart + current.minutes * 60_000;

    for (let otherIndex = index + 1; otherIndex < sorted.length; otherIndex += 1) {
      const other = sorted[otherIndex];
      const otherStart = entryDateTime(other).getTime();
      if (otherStart >= currentEnd) break;
      const otherEnd = otherStart + other.minutes * 60_000;
      if (currentStart < otherEnd && otherStart < currentEnd) {
        result.add(current.id);
        result.add(other.id);
      }
    }
  }

  return result;
}

function CalendarScreen({ state }: { state: WorkspaceState }) {
  const workEntries = state.entries
    .filter((entry) => entry.mode === 'work')
    .sort((a, b) => entryDateTime(a).getTime() - entryDateTime(b).getTime());

  const [selectedDate, setSelectedDate] = useState(localDateValue());
  const selected = workEntries.filter((entry) => entry.date === selectedDate);
  const overlapIds = entriesOverlap(selected);

  const anchor = new Date(selectedDate + 'T12:00:00');
  const start = new Date(anchor);
  start.setDate(anchor.getDate() - 6);
  const days = Array.from({ length: 14 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    return localDateValue(date);
  });

  const selectedMinutes = selected.reduce((sum, entry) => sum + entry.minutes, 0);
  const selectedKm = selected.reduce((sum, entry) => sum + entryKilometres(entry), 0);
  const missingNotes = selected.filter((entry) => !entry.supportNoteBreakdown.trim()).length;
  const openActions = selected.reduce(
    (sum, entry) => sum + entry.nextActions.filter((action) => !action.completedAt).length,
    0,
  );

  return (
    <div className="page-stack">
      <section className="page-title">
        <div>
          <div className="eyebrow">WORK PLANNER</div>
          <h2>Calendar</h2>
          <p>See visits, overlaps, missing notes and follow-ups by day.</p>
        </div>
        <label className="calendar-date-jump">
          <span>Jump to date</span>
          <input type="date" value={selectedDate} onChange={(e) => setSelectedDate(e.target.value)} />
        </label>
      </section>

      <Panel title="14-day work view" subtitle="Red = missing support note · Amber = open action · Orange = overlap">
        <div className="calendar-day-grid">
          {days.map((day) => {
            const entries = workEntries.filter((entry) => entry.date === day);
            const overlaps = entriesOverlap(entries);
            const missing = entries.some((entry) => !entry.supportNoteBreakdown.trim());
            const actions = entries.some((entry) => entry.nextActions.some((action) => !action.completedAt));
            return (
              <button
                key={day}
                className={'calendar-day ' + (day === selectedDate ? 'selected' : '')}
                onClick={() => setSelectedDate(day)}
              >
                <small>{new Date(day + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'short' })}</small>
                <strong>{new Date(day + 'T12:00:00').getDate()}</strong>
                <span>{entries.length} entr{entries.length === 1 ? 'y' : 'ies'}</span>
                <div className="calendar-dots">
                  <i className={missing ? 'danger' : ''} />
                  <i className={actions ? 'warn' : ''} />
                  <i className={overlaps.size ? 'overlap' : ''} />
                </div>
              </button>
            );
          })}
        </div>
      </Panel>

      <div className="stat-grid compact-stats">
        <StatCard label="Entries" value={String(selected.length)} />
        <StatCard label="Hours" value={formatHours(selectedMinutes)} />
        <StatCard label="KM" value={selectedKm.toFixed(1)} />
        <StatCard label="Missing notes" value={String(missingNotes)} />
        <StatCard label="Open actions" value={String(openActions)} />
        <StatCard label="Overlaps" value={String(overlapIds.size)} />
      </div>

      <Panel title={formatDate(selectedDate)} subtitle="Work entries for the selected day">
        {selected.length === 0 ? (
          <EmptyState title="No work entries" detail="Choose another day or add an entry." />
        ) : (
          <div className="calendar-entry-list">
            {selected
              .sort((a, b) => a.startTime.localeCompare(b.startTime))
              .map((entry) => (
                <div className="calendar-entry-item" key={entry.id}>
                  <div>
                    <strong>{entry.startTime} · {entry.client}</strong>
                    <span>{entryType(entry.type).label} · {entry.minutes} min · {entryKilometres(entry).toFixed(1)} km</span>
                  </div>
                  <div className="calendar-entry-flags">
                    {!entry.supportNoteBreakdown.trim() && <b className="flag danger">Missing note</b>}
                    {entry.nextActions.some((action) => !action.completedAt) && <b className="flag warn">Follow-up</b>}
                    {overlapIds.has(entry.id) && <b className="flag overlap">Overlap</b>}
                    {entry.googleCalendarEntered && <b className="flag ok">Calendar entered</b>}
                  </div>
                </div>
              ))}
          </div>
        )}
      </Panel>
    </div>
  );
}

function fortnightStartFor(date: Date): Date {
  const anchor = new Date('2025-12-14T12:00:00');
  const dayMs = 86_400_000;
  const diff = Math.floor((date.getTime() - anchor.getTime()) / dayMs);
  const offset = ((diff % 14) + 14) % 14;
  const start = new Date(date);
  start.setDate(date.getDate() - offset);
  start.setHours(12, 0, 0, 0);
  return start;
}

function PayPeriodScreen({ state }: { state: WorkspaceState }) {
  const [offset, setOffset] = useState(0);
  const baseStart = fortnightStartFor(new Date());
  const start = new Date(baseStart);
  start.setDate(baseStart.getDate() + offset * 14);
  const end = new Date(start);
  end.setDate(start.getDate() + 13);
  const startKey = localDateValue(start);
  const endKey = localDateValue(end);

  const entries = state.entries
    .filter((entry) => entry.mode === 'work')
    .filter((entry) => entry.date >= startKey && entry.date <= endKey)
    .sort((a, b) => (a.date + a.startTime).localeCompare(b.date + b.startTime));

  const totalMinutes = entries.reduce((sum, entry) => sum + entry.minutes, 0);
  const totalKm = entries.reduce((sum, entry) => sum + entryKilometres(entry), 0);
  const clients = new Set(entries.map((entry) => entry.client)).size;
  const missingNotes = entries.filter((entry) => !entry.supportNoteBreakdown.trim()).length;
  const openActions = entries.reduce(
    (sum, entry) => sum + entry.nextActions.filter((action) => !action.completedAt).length,
    0,
  );

  const byDay = entries.reduce<Record<string, WorkEntry[]>>((groups, entry) => {
    (groups[entry.date] ||= []).push(entry);
    return groups;
  }, {});

  return (
    <div className="page-stack">
      <section className="page-title">
        <div>
          <div className="eyebrow">WORK TOTALS</div>
          <h2>Pay Period</h2>
          <p>Fortnight totals and daily work breakdown.</p>
        </div>
        <div className="period-controls">
          <button className="secondary compact" onClick={() => setOffset((value) => value - 1)}>← Previous</button>
          <button className="secondary compact" onClick={() => setOffset(0)}>Current</button>
          <button className="secondary compact" onClick={() => setOffset((value) => value + 1)}>Next →</button>
        </div>
      </section>

      <Panel title={`${formatDate(startKey)} – ${formatDate(endKey)}`} subtitle="Two-week work period">
        <div className="stat-grid compact-stats">
          <StatCard label="Entries" value={String(entries.length)} />
          <StatCard label="Hours" value={formatHours(totalMinutes)} />
          <StatCard label="KM" value={totalKm.toFixed(1)} />
          <StatCard label="Clients" value={String(clients)} />
          <StatCard label="Missing notes" value={String(missingNotes)} />
          <StatCard label="Open actions" value={String(openActions)} />
        </div>
      </Panel>

      <Panel title="Daily breakdown">
        {entries.length === 0 ? (
          <EmptyState title="No work recorded" detail="This fortnight has no Work mode entries." />
        ) : (
          <div className="pay-period-days">
            {Object.entries(byDay).map(([day, dayEntries]) => {
              const minutes = dayEntries.reduce((sum, entry) => sum + entry.minutes, 0);
              const km = dayEntries.reduce((sum, entry) => sum + entryKilometres(entry), 0);
              return (
                <div className="pay-period-day" key={day}>
                  <div className="pay-period-day-head">
                    <strong>{formatDate(day)}</strong>
                    <span>{formatHours(minutes)} h · {km.toFixed(1)} km · {dayEntries.length} entries</span>
                  </div>
                  {dayEntries.map((entry) => (
                    <div className="pay-period-entry" key={entry.id}>
                      <span>{entry.startTime}</span>
                      <strong>{entry.client}</strong>
                      <small>{entryType(entry.type).shortLabel} · {entry.minutes}m</small>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        )}
      </Panel>
    </div>
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
  const [editing, setEditing] = useState<WorkEntry | null>(null);
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
                  <div className="entry-card-actions">
                    <button
                      className="icon-button"
                      onClick={() => setEditing(entry)}
                      title="Edit entry"
                    >
                      ✎
                    </button>
                    <button
                      className="icon-button danger"
                      onClick={() => void remove(entry)}
                      disabled={busyId === entry.id}
                      title="Delete entry"
                    >
                      ×
                    </button>
                  </div>
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

      {editing && (
        <EditEntryModal
          entry={editing}
          state={state}
          credentials={credentials}
          onState={onState}
          onClose={() => setEditing(null)}
        />
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
          Cloudflare Access verifies this exact account before NMRNL loads. There is
          no in-app email sender and no option to add a second account.
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
  const [loading, setLoading] = useState<boolean>(
    Boolean(credentials) || TEMPORARY_LOGIN_BYPASS,
  );
  const [error, setError] = useState('');

  useEffect(() => {
    if (!TEMPORARY_LOGIN_BYPASS || credentials) return;

    let cancelled = false;
    setLoading(true);
    setError('');

    openTemporaryWorkspace()
      .then((result) => {
        if (cancelled) return;
        rememberWorkspaceId(result.credentials.workspaceId);
        setCredentials(result.credentials);
        setState(result.state);
      })
      .catch((reason) => {
        if (cancelled) return;
        setError(
          reason instanceof Error
            ? reason.message
            : 'Could not open the temporary NMRNL workspace.',
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [credentials]);

  useEffect(() => {
    if (!credentials) {
      if (!TEMPORARY_LOGIN_BYPASS) setLoading(false);
      return;
    }

    if (
      TEMPORARY_LOGIN_BYPASS &&
      credentials.sessionToken === 'temporary-login-bypass' &&
      state
    ) {
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
    if (TEMPORARY_LOGIN_BYPASS) {
      return (
        <main className="loading-shell">
          <div className="brand-mark">N</div>
          <strong>Opening Maleroom workspace…</strong>
          {error && <small>{error}</small>}
        </main>
      );
    }

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
    ...(mode === 'work'
      ? [
          { key: 'calendar' as Section, label: 'Calendar', icon: '▦' },
          { key: 'payPeriod' as Section, label: 'Pay Period', icon: '◫' },
        ]
      : []),
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
                onClick={() => {
                  setMode(option.key);
                  if (
                    option.key !== 'work' &&
                    (section === 'calendar' || section === 'payPeriod')
                  ) {
                    setSection('home');
                  }
                }}
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
          {section === 'calendar' && mode === 'work' && (
            <CalendarScreen state={state} />
          )}
          {section === 'payPeriod' && mode === 'work' && (
            <PayPeriodScreen state={state} />
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
          {navItems
            .filter((item) =>
              ['home', 'quick', 'entries', 'actions', 'workspace'].includes(item.key),
            )
            .map((item) => (
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
