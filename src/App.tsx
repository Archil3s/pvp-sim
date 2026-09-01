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
  cancelActiveVisit,
  clearCredentials,
  confirmAuthenticatorEnrollment,
  confirmWorkspaceTotp,
  createEntry,
  createGeneralAction,
  createWorkspace,
  deleteEntry,
  fetchAccountWorkspace,
  fetchWorkspace,
  finishActiveVisit,
  loadCredentials,
  loadKnownWorkspaceId,
  loginWithTotp,
  openTemporaryWorkspace,
  rememberWorkspaceId,
  resolveEntryAdmin,
  saveCredentials,
  confirmRecoveryAuthenticator,
  setEntryCalendarEntered,
  setGeneralActionCompleted,
  startActiveVisit,
  updateDriveSetup,
  updateDriveSupportNoteMeta,
  updateInvoiceDriveMeta,
  updateInvoiceStatus,
  updateWorkSettings,
  setVisitActionCompleted,
  updateEntry,
  updateSupportNote,
  updateActiveVisit,
} from './api';
import {
  ENTRY_TYPES,
  entryBillableHours,
  entryBillableMinutes,
  entryEarnings,
  entryKilometres,
  entryTravelReimbursement,
  entryType,
  entryTypesForMode,
  formatDate,
  formatHours,
  localDateValue,
  localTimeValue,
  type ActiveVisit,
  type EmailRecoveryChallenge,
  type EntryDraft,
  type EntryTypeKey,
  type GeneralAction,
  type InvoiceStatus,
  type Mode,
  type Section,
  type SupportNoteStatus,
  type TextContactDirection,
  type WorkEntry,
  type WorkspaceCredentials,
  type WorkspaceSetupChallenge,
  type WorkspaceState,
} from './model';
import {
  syncInvoicePeriodToDrive,
  syncSupportNoteToDrive,
} from './googleDrive';
import {
  GOLD_STANDARD_LIMITS,
  STRUCTURED_SUPPORT_NOTE_TEMPLATE,
  goldStandardTemplateContent,
  goldStandardTemplatePlainText,
  insertSupportNoteTemplate,
  ensureStructuredSupportNote,
  parseStructuredSupportNote,
  updateStructuredSupportSection,
  supportNoteHasEnteredContent,
} from './supportNoteTemplate';

const TEMPORARY_LOGIN_BYPASS = true;

function todayStart(): number {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
}

const SUPPORT_NOTE_TEMPLATE = STRUCTURED_SUPPORT_NOTE_TEMPLATE;

const SUPPORT_NOTE_HEADINGS = new Set([
  'attendance',
  'what happened',
  'work/task completed',
  'support given',
  'issue/problem',
  'outcome',
  'next step',
  'anything to follow up',
  'referrals',
]);

const SUPPORT_NOTE_STATUS_OPTIONS: Array<{
  key: SupportNoteStatus;
  label: string;
}> = [
  { key: 'incomplete', label: 'Incomplete' },
  { key: 'inProgress', label: 'In Progress' },
  { key: 'finished', label: 'Finished' },
  { key: 'submitted', label: 'Submitted' },
];

function supportNoteStatus(entry: WorkEntry): SupportNoteStatus {
  if (
    entry.supportNoteStatus === 'incomplete' ||
    entry.supportNoteStatus === 'inProgress' ||
    entry.supportNoteStatus === 'finished' ||
    entry.supportNoteStatus === 'submitted'
  ) {
    return entry.supportNoteStatus;
  }
  return hasSupportNoteContent(entry.supportNoteBreakdown)
    ? 'inProgress'
    : 'incomplete';
}

function supportNoteStatusLabel(status: SupportNoteStatus): string {
  return (
    SUPPORT_NOTE_STATUS_OPTIONS.find((item) => item.key === status)?.label ||
    'Incomplete'
  );
}

function hasSupportNoteContent(noteText: string): boolean {
  return supportNoteHasEnteredContent(noteText);
}

function GoldStandardNoteTemplateEditor({
  entry,
  personName,
  noteText,
  onChange,
  disabled = false,
}: {
  entry: WorkEntry;
  personName: string;
  noteText: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const structured = ensureStructuredSupportNote(noteText);
  const sections = parseStructuredSupportNote(structured);
  const content = goldStandardTemplateContent(entry, personName, structured);
  const counts = content.wordCounts;

  const update = (
    heading:
      | 'Attendance'
      | 'What happened'
      | 'Work/task completed'
      | 'Support given'
      | 'Issue/problem'
      | 'Outcome'
      | 'Next step'
      | 'Anything to follow up'
      | 'Referrals',
    value: string,
  ) => {
    onChange(updateStructuredSupportSection(structured, heading, value));
  };

  return (
    <div className="gold-template-editor">
      <div className="gold-template-paper">
        <div className="gold-template-title">
          <h3>Template for reporting of interactions with survivors.</h3>
          <p>
            This template is aimed at providing information in a format that
            meets the requirements of the Ministry of Social Development.
          </p>
        </div>

        <div className="gold-template-meta">
          <div>
            <span>Geographical area.</span>
            <strong>Blenheim</strong>
          </div>
          <div>
            <span>Name of client.</span>
            <strong>{personName.trim() || entry.client}</strong>
          </div>
          <div>
            <span>Date:</span>
            <strong>{content.date}</strong>
          </div>
        </div>

        <section className="gold-template-section">
          <div className="gold-template-section-head">
            <h4>Date/time/length of interaction</h4>
            <small>Auto-filled from the Work entry</small>
          </div>
          <div className="gold-template-auto">
            {entryType(entry.type).label} · {entry.startTime} · {entry.minutes} minutes
          </div>
          <label>
            <span>Attendance</span>
            <textarea
              rows={3}
              value={sections.Attendance}
              onChange={(event) => update('Attendance', event.target.value)}
              disabled={disabled}
              placeholder="Who was present / attendance detail"
            />
          </label>
        </section>

        <section className="gold-template-section">
          <div className="gold-template-section-head">
            <h4>Main topic(s)</h4>
            <small className={counts.mainTopics > GOLD_STANDARD_LIMITS.mainTopics ? 'over' : ''}>
              {counts.mainTopics}/{GOLD_STANDARD_LIMITS.mainTopics} words
            </small>
          </div>
          <label>
            <span>What happened</span>
            <textarea
              rows={5}
              value={sections['What happened']}
              onChange={(event) => update('What happened', event.target.value)}
              disabled={disabled}
              placeholder="What happened during the interaction?"
            />
          </label>
          <label>
            <span>Work/task completed</span>
            <textarea
              rows={4}
              value={sections['Work/task completed']}
              onChange={(event) =>
                update('Work/task completed', event.target.value)
              }
              disabled={disabled}
              placeholder="What work or practical task was completed?"
            />
          </label>
        </section>

        <section className="gold-template-section">
          <div className="gold-template-section-head">
            <h4>Outcome(s)</h4>
            <small className={counts.outcomes > GOLD_STANDARD_LIMITS.outcomes ? 'over' : ''}>
              {counts.outcomes}/{GOLD_STANDARD_LIMITS.outcomes} words
            </small>
          </div>
          <label>
            <span>Outcome</span>
            <textarea
              rows={4}
              value={sections.Outcome}
              onChange={(event) => update('Outcome', event.target.value)}
              disabled={disabled}
              placeholder="What was the result or outcome?"
            />
          </label>
        </section>

        <section className="gold-template-section">
          <div className="gold-template-section-head">
            <h4>Overall impression</h4>
            <small
              className={
                counts.overallImpression >
                GOLD_STANDARD_LIMITS.overallImpression
                  ? 'over'
                  : ''
              }
            >
              {counts.overallImpression}/
              {GOLD_STANDARD_LIMITS.overallImpression} words
            </small>
          </div>
          <label>
            <span>Support given</span>
            <textarea
              rows={4}
              value={sections['Support given']}
              onChange={(event) => update('Support given', event.target.value)}
              disabled={disabled}
              placeholder="What support was provided?"
            />
          </label>
          <label>
            <span>Issue/problem</span>
            <textarea
              rows={4}
              value={sections['Issue/problem']}
              onChange={(event) => update('Issue/problem', event.target.value)}
              disabled={disabled}
              placeholder="Issues, barriers, concerns or risks"
            />
          </label>
        </section>

        <section className="gold-template-section">
          <div className="gold-template-section-head">
            <h4>Next actions</h4>
            <small className={counts.nextActions > GOLD_STANDARD_LIMITS.nextActions ? 'over' : ''}>
              {counts.nextActions}/{GOLD_STANDARD_LIMITS.nextActions} words
            </small>
          </div>
          <label>
            <span>Next step</span>
            <textarea
              rows={4}
              value={sections['Next step']}
              onChange={(event) => update('Next step', event.target.value)}
              disabled={disabled}
              placeholder="What happens next?"
            />
          </label>
          <label>
            <span>Anything to follow up</span>
            <textarea
              rows={3}
              value={sections['Anything to follow up']}
              onChange={(event) =>
                update('Anything to follow up', event.target.value)
              }
              disabled={disabled}
              placeholder="Anything that needs follow-up"
            />
          </label>
          <label>
            <span>Referrals</span>
            <textarea
              rows={4}
              value={sections.Referrals}
              onChange={(event) => update('Referrals', event.target.value)}
              disabled={disabled}
              placeholder="Referrals made, discussed, declined or pending"
            />
          </label>
        </section>
      </div>
    </div>
  );
}

function SupportNoteTemplateTools({
  entry,
  personName,
  noteText,
  onChange,
}: {
  entry: WorkEntry;
  personName: string;
  noteText: string;
  onChange: (value: string) => void;
}) {
  const content = goldStandardTemplateContent(entry, personName, noteText);
  const counts = content.wordCounts;
  const [copyLabel, setCopyLabel] = useState('Copy formatted report');

  const copyReport = async () => {
    try {
      await navigator.clipboard.writeText(
        goldStandardTemplatePlainText(entry, personName, noteText),
      );
      setCopyLabel('Copied');
      window.setTimeout(() => setCopyLabel('Copy formatted report'), 1400);
    } catch {
      setCopyLabel('Copy failed');
      window.setTimeout(() => setCopyLabel('Copy formatted report'), 1400);
    }
  };

  const countRows = [
    ['Main topic(s)', counts.mainTopics, GOLD_STANDARD_LIMITS.mainTopics],
    ['Outcome(s)', counts.outcomes, GOLD_STANDARD_LIMITS.outcomes],
    [
      'Overall impression',
      counts.overallImpression,
      GOLD_STANDARD_LIMITS.overallImpression,
    ],
    ['Next actions', counts.nextActions, GOLD_STANDARD_LIMITS.nextActions],
  ] as const;

  return (
    <div className="template-tools">
      <div className="template-tools-heading">
        <div>
          <strong>Gold-standard Work template</strong>
          <small>
            Uses the same reporting structure as TEMPLATE.docx from the original app.
          </small>
        </div>
        <span>MSD format</span>
      </div>

      <div className="template-preset-row">
        <button
          type="button"
          className="secondary compact"
          onClick={() => onChange(insertSupportNoteTemplate(noteText, 'structured'))}
        >
          Structured note
        </button>
        <button
          type="button"
          className="secondary compact"
          onClick={() => onChange(insertSupportNoteTemplate(noteText, 'referrals'))}
        >
          + Referrals
        </button>
        <button
          type="button"
          className="secondary compact"
          onClick={() => onChange(insertSupportNoteTemplate(noteText, 'safety'))}
        >
          + Safety concerns
        </button>
      </div>

      <div className="template-word-grid">
        {countRows.map(([label, count, limit]) => {
          const over = count > limit;
          const width = Math.min(100, (count / limit) * 100);
          return (
            <div className={over ? 'template-count over' : 'template-count'} key={label}>
              <div>
                <span>{label}</span>
                <b>{count}/{limit} words</b>
              </div>
              <div className="template-count-track">
                <i style={{ width: width + '%' }} />
              </div>
            </div>
          );
        })}
      </div>

      <details className="template-preview">
        <summary>Preview reporting template</summary>
        <div className="template-preview-sheet">
          <h3>Template for reporting of interactions with survivors.</h3>
          <p>
            This template is aimed at providing information in a format that meets
            the requirements of the Ministry of Social Development.
          </p>
          <dl>
            <div><dt>Geographical area.</dt><dd>Blenheim</dd></div>
            <div><dt>Name of client.</dt><dd>{content.clientName}</dd></div>
            <div><dt>Date:</dt><dd>{content.date}</dd></div>
          </dl>
          <section>
            <h4>Date/time/length of interaction</h4>
            <pre>{content.interactionDetails}</pre>
          </section>
          <section>
            <h4>Main topic(s) <small>max. 200 words</small></h4>
            <pre>{content.mainTopics || '—'}</pre>
          </section>
          <section>
            <h4>Outcome(s) <small>max. 100 words</small></h4>
            <pre>{content.outcomes || '—'}</pre>
          </section>
          <section>
            <h4>Overall impression <small>max. 150 words</small></h4>
            <pre>{content.overallImpression || '—'}</pre>
          </section>
          <section>
            <h4>Next actions <small>max. 150 words</small></h4>
            <pre>{content.nextActions || '—'}</pre>
          </section>
          <button type="button" className="secondary compact" onClick={() => void copyReport()}>
            {copyLabel}
          </button>
        </div>
      </details>
    </div>
  );
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
            <div className="eyebrow">NMRNL ACCOUNT RECOVERY</div>
            <h1>{challenge ? 'Set up a new Authenticator' : 'Recover NMRNL'}</h1>
          </div>
        </div>

        {error && <div className="error-banner">{error}</div>}

        {!challenge ? (
          <div className="recovery-stack">
            <p className="setup-lead">
              Your NMRNL workspace is attached to your private account. Cloudflare
              Access has already verified the email before this screen loads.
            </p>

            <div className="locked-email-card">
              <span className="locked-email-icon">✓</span>
              <span>
                <small>Workspace owner</small>
                <strong>Private NMRNL account</strong>
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
              No Workspace ID is needed. Your NMRNL account resolves the same
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
            : 'Could not load the NMRNL workspace.',
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
              <h1>Secure your NMRNL workspace</h1>
              <p className="setup-lead">
                This workspace is attached to your private NMRNL account.
                Scan the QR, then enter the generated 6-digit code.
              </p>
            </div>
          </div>

          <div className="locked-email-card setup-account">
            <span className="locked-email-icon">✓</span>
            <span>
              <small>Workspace owner</small>
              <strong>Private NMRNL account</strong>
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
            <div className="eyebrow">NMRNL ACCOUNT</div>
            <h1>{workspaceExists ? 'Sign in to NMRNL' : 'Set up NMRNL'}</h1>
          </div>
        </div>

        <div className="account-access-line">
          <span>Workspace owner</span>
          <strong>Private NMRNL account</strong>
          <b>SYNCED</b>
        </div>

        <p className="setup-lead code-login-lead">
          {accountLoading
            ? 'Finding your NMRNL workspace…'
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
                <small>Recover the workspace through your NMRNL account</small>
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
            {busy === 'create' ? 'Creating…' : 'Create NMRNL workspace'}
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
  const [shareMessage, setShareMessage] = useState('');
  const entries = state.entries.filter((entry) => entry.mode === mode);
  const actions = state.actions.filter((action) => action.mode === mode);
  const sortedEntries = [...entries].sort((left, right) =>
    (right.date + right.startTime).localeCompare(left.date + left.startTime),
  );
  const lastEntry = sortedEntries[0] || null;
  const recentEntries = sortedEntries.slice(0, 5);

  const todayKey = localDateValue();
  const todayEntries = entries.filter((entry) => entry.date === todayKey);
  const todayHours = todayEntries.reduce(
    (sum, entry) => sum + entryBillableHours(entry),
    0,
  );
  const todayEarnings = todayEntries.reduce(
    (sum, entry) => sum + entryEarnings(entry, state.settings.hourlyRate),
    0,
  );
  const todayKm = todayEntries.reduce(
    (sum, entry) => sum + entryKilometres(entry),
    0,
  );

  const periodStart = fortnightStartFor(
    new Date(),
    state.settings.payPeriodAnchorDate,
  );
  const periodEnd = addCalendarDays(periodStart, 13);
  const periodStartKey = localDateValue(periodStart);
  const periodEndKey = localDateValue(periodEnd);
  const periodEntries = entries.filter(
    (entry) => entry.date >= periodStartKey && entry.date <= periodEndKey,
  );
  const periodHours = periodEntries.reduce(
    (sum, entry) => sum + entryBillableHours(entry),
    0,
  );
  const periodEarnings = periodEntries.reduce(
    (sum, entry) => sum + entryEarnings(entry, state.settings.hourlyRate),
    0,
  );
  const periodKm = periodEntries.reduce(
    (sum, entry) => sum + entryKilometres(entry),
    0,
  );
  const periodMissingNotes = periodEntries.filter(
    (entry) => !hasSupportNoteContent(entry.supportNoteBreakdown),
  ).length;
  const periodCalendarGaps = periodEntries.filter(
    (entry) => !entry.googleCalendarEntered,
  ).length;

  const visitActions = entries.flatMap((entry) =>
    entry.nextActions.filter((action) => !action.completedAt),
  ).length;
  const generalActions = actions.filter((action) => !action.completedAt).length;

  const now = new Date();
  const monthEntries = entries.filter((entry) => {
    const parsed = new Date(entry.date + 'T12:00:00');
    return (
      parsed.getFullYear() === now.getFullYear() &&
      parsed.getMonth() === now.getMonth()
    );
  });
  const monthHours = monthEntries.reduce(
    (sum, entry) => sum + entryBillableHours(entry),
    0,
  );
  const monthEarnings = monthEntries.reduce(
    (sum, entry) => sum + entryEarnings(entry, state.settings.hourlyRate),
    0,
  );
  const monthKm = monthEntries.reduce(
    (sum, entry) => sum + entryKilometres(entry),
    0,
  );
  const monthMissingNotes = monthEntries.filter(
    (entry) => !hasSupportNoteContent(entry.supportNoteBreakdown),
  ).length;
  const monthOpenEntryActions = monthEntries.reduce(
    (sum, entry) =>
      sum + entry.nextActions.filter((action) => !action.completedAt).length,
    0,
  );
  const monthLabel = now.toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric',
  });

  const monthByType = ENTRY_TYPES.map((definition) => ({
    ...definition,
    count: monthEntries.filter((entry) => entry.type === definition.key).length,
  })).filter((item) => item.count > 0);

  const shareMonthSummary = async () => {
    const typeLines = monthByType.length
      ? monthByType.map((item) => item.label + ': ' + item.count).join('\n')
      : 'No Work entries yet';

    const summary = [
      'Work totals - ' + monthLabel,
      'Total entries: ' + monthEntries.length,
      'Billable hours: ' + monthHours.toFixed(2),
      'Earnings: ' + money(monthEarnings),
      'Travel: ' + monthKm.toFixed(1) + ' km',
      '',
      'Contact type totals',
      typeLines,
      '',
      'Notes to finish: ' + monthMissingNotes,
      'Open actions: ' + (monthOpenEntryActions + generalActions),
    ].join('\n');

    setShareMessage('');

    try {
      if (navigator.share) {
        await navigator.share({
          title: 'NMRNL Work totals - ' + monthLabel,
          text: summary,
        });
        setShareMessage('Work summary shared.');
        return;
      }

      await navigator.clipboard.writeText(summary);
      setShareMessage('Work summary copied.');
    } catch (reason) {
      if (
        reason instanceof DOMException &&
        reason.name === 'AbortError'
      ) {
        return;
      }
      setShareMessage('Could not share the Work summary.');
    }
  };

  return (
    <div className="page-stack">
      <section className="hero-card work-home-hero">
        <div>
          <div className="eyebrow">WORK</div>
          <h2>
            {state.activeVisit
              ? 'Your visit is running.'
              : todayEntries.length
                ? 'Today is underway.'
                : 'Ready for the next visit.'}
          </h2>
          <p>
            {state.activeVisit
              ? state.activeVisit.client +
                ' · ' +
                entryType(state.activeVisit.type).label +
                ' · started ' +
                state.activeVisit.startTime
              : 'Start a timed visit, review today, and keep admin from building up.'}
          </p>
        </div>
        <button className="primary hero-action" onClick={() => go('quick')}>
          {state.activeVisit ? 'Open visit' : '▶ Start / Finish Visit'}
        </button>
      </section>

      {state.activeVisit && (
        <button className="active-visit-home" onClick={() => go('quick')}>
          <span className="active-visit-pulse" />
          <span>
            <strong>Visit running · {state.activeVisit.client}</strong>
            <small>
              {entryType(state.activeVisit.type).label} · started {state.activeVisit.startTime}
            </small>
          </span>
          <b>Open →</b>
        </button>
      )}

      <Panel
        title="Data Security"
        subtitle="Single-worker NMRNL protection status"
        className={state.security.productionReady ? 'security-panel ready' : 'security-panel'}
      >
        <div className="security-status-grid">
          <div>
            <span>Application encryption</span>
            <strong>
              {state.security.applicationEncryption ? 'AES-GCM active' : 'Not configured'}
            </strong>
          </div>
          <div>
            <span>Login wall</span>
            <strong>
              {state.security.temporaryLoginBypass ? 'Bypassed for development' : 'Protected'}
            </strong>
          </div>
          <div>
            <span>Real client data</span>
            <strong>
              {state.security.productionReady ? 'Ready' : 'Do not use yet'}
            </strong>
          </div>
        </div>
      </Panel>

      <Panel title="Today" subtitle={formatDate(todayKey)}>
        <div className="stat-grid compact-stats dashboard-period-stats">
          <StatCard label="Entries" value={String(todayEntries.length)} />
          <StatCard label="Billable hours" value={todayHours.toFixed(2)} />
          <StatCard label="Earned" value={money(todayEarnings)} />
          <StatCard label="KM" value={todayKm.toFixed(1)} />
        </div>
      </Panel>

      <Panel
        title="Current Fortnight"
        subtitle={formatDate(periodStartKey) + ' – ' + formatDate(periodEndKey)}
        action={
          <button className="text-button" onClick={() => go('payPeriod')}>
            Open pay period
          </button>
        }
      >
        <div className="stat-grid compact-stats dashboard-period-stats">
          <StatCard label="Entries" value={String(periodEntries.length)} />
          <StatCard label="Billable hours" value={periodHours.toFixed(2)} />
          <StatCard label="Earned" value={money(periodEarnings)} />
          <StatCard label="KM" value={periodKm.toFixed(1)} />
        </div>
        <div className="dashboard-health-strip">
          <button
            className={periodMissingNotes ? 'needs-attention' : 'all-clear'}
            onClick={() => go(periodMissingNotes ? 'notes' : 'adminReview')}
          >
            <span>Support notes</span>
            <strong>
              {periodMissingNotes
                ? periodMissingNotes + ' to finish'
                : 'All complete'}
            </strong>
          </button>
          <button
            className={periodCalendarGaps ? 'needs-attention' : 'all-clear'}
            onClick={() => go('calendar')}
          >
            <span>Calendar</span>
            <strong>
              {periodCalendarGaps
                ? periodCalendarGaps + ' to enter'
                : 'All entered'}
            </strong>
          </button>
          <button
            className={visitActions + generalActions ? 'needs-attention' : 'all-clear'}
            onClick={() => go('actions')}
          >
            <span>Actions</span>
            <strong>
              {visitActions + generalActions
                ? visitActions + generalActions + ' open'
                : 'All clear'}
            </strong>
          </button>
        </div>
      </Panel>

      <Panel title="Quick Actions">
        <div className="dashboard-quick-actions">
          <button className="primary" onClick={() => go('quick')}>
            <span>▶</span>
            <strong>{state.activeVisit ? 'Open Active Visit' : 'Start / Finish Visit'}</strong>
          </button>
          <button className="secondary" onClick={() => go('notes')}>
            <span>▧</span>
            <strong>Create Note</strong>
          </button>
          <button className="secondary" onClick={() => go('adminReview')}>
            <span>◎</span>
            <strong>Admin Review</strong>
          </button>
          <button className="secondary" onClick={() => go('payPeriod')}>
            <span>◫</span>
            <strong>View Pay Period</strong>
          </button>
          <button className="secondary" onClick={() => go('entries')}>
            <span>▤</span>
            <strong>View Entries</strong>
          </button>
        </div>
      </Panel>

      <div className="dashboard-grid dashboard-main-grid">
        <Panel
          title="Last Entry"
          action={
            lastEntry ? (
              <button className="text-button" onClick={() => go('entries')}>
                Open entries
              </button>
            ) : undefined
          }
        >
          {lastEntry == null ? (
            <EmptyState
              title="No entries yet"
              detail="Start your first Work visit and it will appear here."
              action={
                <button className="primary" onClick={() => go('quick')}>
                  Start visit
                </button>
              }
            />
          ) : (
            <div className="last-entry-card">
              <div className="last-entry-icon">{entryType(lastEntry.type).icon}</div>
              <div className="last-entry-main">
                <strong>{lastEntry.client}</strong>
                <span>
                  {entryType(lastEntry.type).label} · {formatDate(lastEntry.date)} · {lastEntry.minutes} min
                </span>
                <div className="last-entry-chips">
                  <b>{entryBillableHours(lastEntry).toFixed(2)} billable h</b>
                  <b>{money(entryEarnings(lastEntry, state.settings.hourlyRate))}</b>
                  {lastEntry.type === 'homeVisit' && (
                    <b>{entryKilometres(lastEntry).toFixed(1)} km</b>
                  )}
                </div>
              </div>
            </div>
          )}
        </Panel>

        <Panel
          title="Work Admin"
          subtitle="What still needs your attention"
          action={
            <button className="text-button" onClick={() => go('adminReview')}>
              Review all
            </button>
          }
        >
          <div className="dashboard-admin-list">
            <button onClick={() => go('notes')}>
              <span>Support notes</span>
              <strong>{periodMissingNotes}</strong>
            </button>
            <button onClick={() => go('calendar')}>
              <span>Calendar gaps</span>
              <strong>{periodCalendarGaps}</strong>
            </button>
            <button onClick={() => go('actions')}>
              <span>Open actions</span>
              <strong>{visitActions + generalActions}</strong>
            </button>
            <button onClick={() => go('payPeriod')}>
              <span>Google Drive</span>
              <strong>{state.drive.rootFolderId ? 'Ready' : 'Set up'}</strong>
            </button>
          </div>
        </Panel>
      </div>

      <Panel
        title={'This Month · ' + monthLabel}
        subtitle="Work totals and contact mix"
        action={
          <button className="text-button" onClick={() => void shareMonthSummary()}>
            Share summary
          </button>
        }
      >
        {shareMessage && (
          <div className="dashboard-share-message">{shareMessage}</div>
        )}
        <div className="stat-grid compact-stats dashboard-period-stats">
          <StatCard label="Entries" value={String(monthEntries.length)} />
          <StatCard label="Billable hours" value={monthHours.toFixed(2)} />
          <StatCard label="Earned" value={money(monthEarnings)} />
          <StatCard label="KM" value={monthKm.toFixed(1)} />
        </div>

        <div className="month-contact-grid">
          {monthByType.length === 0 ? (
            <span className="muted-inline">No Work entries this month yet.</span>
          ) : (
            monthByType.map((item) => (
              <div key={item.key}>
                <span>{item.icon}</span>
                <strong>{item.count}</strong>
                <small>{item.shortLabel}</small>
              </div>
            ))
          )}
        </div>

        <div className="month-admin-summary">
          <span>
            <small>Notes to finish</small>
            <strong>{monthMissingNotes}</strong>
          </span>
          <span>
            <small>Open actions</small>
            <strong>{monthOpenEntryActions + generalActions}</strong>
          </span>
        </div>
      </Panel>

      <Panel
        title="Recent Work"
        subtitle="Latest recorded activity"
        action={
          <button className="text-button" onClick={() => go('entries')}>
            View all
          </button>
        }
      >
        {recentEntries.length === 0 ? (
          <EmptyState
            title="Nothing recorded yet"
            detail="Your recent Work entries will appear here."
          />
        ) : (
          <div className="compact-list">
            {recentEntries.map((entry) => (
              <EntryRow key={entry.id} entry={entry} />
            ))}
          </div>
        )}
      </Panel>

      <Panel title="Work review" subtitle="Finish admin, then see the fortnight at a glance">
        <div className="home-work-tools">
          <button className="secondary" onClick={() => go('adminReview')}>
            <span>◎</span>
            <strong>Admin Review</strong>
            <small>Replies, calendar gaps, notes and follow-ups</small>
          </button>
          <button className="secondary" onClick={() => go('charts')}>
            <span>▥</span>
            <strong>Charts & Insights</strong>
            <small>Hours, earnings, travel and workflow health</small>
          </button>
        </div>
      </Panel>
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

function visitLines(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function elapsedVisitMinutes(startedAt: string, end = Date.now()): number {
  const start = Date.parse(startedAt);
  if (!Number.isFinite(start)) return 0;
  const seconds = Math.max(0, Math.floor((end - start) / 1000));
  if (seconds <= 0) return 0;
  return Math.max(1, Math.min(1440, Math.ceil(seconds / 60)));
}

function elapsedVisitText(startedAt: string, end = Date.now()): string {
  const minutes = elapsedVisitMinutes(startedAt, end);
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return hours > 0 ? hours + 'h ' + remainder + 'm' : minutes + 'm';
}

function supportNoteFromVisitNotes(notes: string[]): string {
  return [
    'Attendance',
    '',
    'What happened',
    notes.join('\n'),
    '',
    'Work/task completed',
    '',
    'Support given',
    '',
    'Issue/problem',
    '',
    'Outcome',
    '',
    'Next step',
    '',
    'Anything to follow up',
    '',
    'Referrals',
  ].join('\n').trim();
}

function textNoteBreakdown(
  direction: TextContactDirection,
  summary: string,
  nextActions: string,
  replyNeeded: boolean,
): string {
  return [
    'Contact direction',
    direction,
    '',
    'Contact summary',
    summary.trim(),
    '',
    'Reply needed',
    replyNeeded ? 'Reply or follow-up needed' : 'No full reply needed',
    '',
    'Next action(s)',
    nextActions.trim(),
  ].join('\n').trim();
}

function FinishActiveVisitModal({
  activeVisit,
  notesText,
  finishOdometer,
  credentials,
  onState,
  onSaved,
  onClose,
}: {
  activeVisit: ActiveVisit;
  notesText: string;
  finishOdometer: string;
  credentials: WorkspaceCredentials;
  onState: (state: WorkspaceState) => void;
  onSaved: (entry: WorkEntry) => void;
  onClose: () => void;
}) {
  const isText = activeVisit.type === 'textNote';
  const [supportNote, setSupportNote] = useState(
    ensureStructuredSupportNote(
      activeVisit.supportNoteDraft.trim() ||
        supportNoteFromVisitNotes(visitLines(notesText)),
    ),
  );
  const [summary, setSummary] = useState(
    activeVisit.textSummaryDraft.trim() || visitLines(notesText).join('\n'),
  );
  const [nextActions, setNextActions] = useState(
    activeVisit.textNextActionsDraft,
  );
  const [direction, setDirection] = useState<TextContactDirection>(
    activeVisit.textContactDirectionDraft || 'received',
  );
  const [replyNeeded, setReplyNeeded] = useState(
    activeVisit.textReplyNeededDraft,
  );
  const [importantText, setImportantText] = useState(
    activeVisit.textImportantDraft,
  );
  const [saving, setSaving] = useState('');
  const [error, setError] = useState('');

  const saveDraft = async () => {
    setSaving('draft');
    setError('');
    try {
      const next = await updateActiveVisit(
        credentials,
        isText
          ? {
              notes: visitLines(notesText),
              textSummaryDraft: summary,
              textNextActionsDraft: nextActions,
              textContactDirectionDraft: direction,
              textReplyNeededDraft: replyNeeded,
              textImportantDraft: importantText,
            }
          : {
              notes: visitLines(notesText),
              supportNoteDraft: supportNote,
            },
      );
      onState(next);
      onClose();
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : 'Could not save the visit close-out draft.',
      );
    } finally {
      setSaving('');
    }
  };

  const finish = async () => {
    const odometerEnd =
      activeVisit.type === 'homeVisit' && finishOdometer.trim()
        ? Number(finishOdometer)
        : null;

    if (
      odometerEnd != null &&
      (!Number.isFinite(odometerEnd) ||
        (activeVisit.odometerStart != null &&
          odometerEnd < activeVisit.odometerStart))
    ) {
      setError('Finish odometer must be a valid reading higher than the start.');
      return;
    }

    const breakdown = isText
      ? textNoteBreakdown(direction, summary, nextActions, replyNeeded)
      : supportNote.trim();

    setSaving('finish');
    setError('');
    try {
      const result = await finishActiveVisit(credentials, {
        finishedAt: new Date().toISOString(),
        odometerEnd,
        notes: visitLines(notesText),
        supportNoteBreakdown: breakdown,
        importantText: isText ? importantText : false,
        textContactDirection: isText ? direction : 'received',
        textReplyNeeded: isText ? replyNeeded : false,
      });
      onState(result.state);
      onSaved(result.entry);
      onClose();
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : 'Could not finish the visit.',
      );
    } finally {
      setSaving('');
    }
  };

  return (
    <div className="modal-backdrop visit-closeout-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="visit-closeout-modal"
        aria-label="Finish active visit"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="support-note-header">
          <div>
            <div className="eyebrow">FINISH VISIT</div>
            <h2>{activeVisit.client}</h2>
            <p>
              {entryType(activeVisit.type).label} · {elapsedVisitText(activeVisit.startedAt)}
            </p>
          </div>
          <button type="button" className="icon-button" onClick={onClose}>×</button>
        </div>

        {error && <div className="error-banner">{error}</div>}

        {isText ? (
          <>
            <label className="field">
              <span>Contact summary</span>
              <textarea
                rows={7}
                value={summary}
                onChange={(event) => setSummary(event.target.value)}
                placeholder="What was discussed or exchanged?"
              />
            </label>
            <label className="field">
              <span>Next action(s)</span>
              <textarea
                rows={4}
                value={nextActions}
                onChange={(event) => setNextActions(event.target.value)}
                placeholder="One action per line"
              />
            </label>
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
                <span><strong>Reply needed</strong><small>Keep this in Admin Review.</small></span>
              </label>
            </div>
            <label className="check-card visit-important">
              <input
                type="checkbox"
                checked={importantText}
                onChange={(event) => setImportantText(event.target.checked)}
              />
              <span><strong>Mark important</strong><small>Flag significant written contact.</small></span>
            </label>
          </>
        ) : (
          <>
            <SupportNoteTemplateTools
              entry={{
                ...activeVisit,
                id: activeVisit.id,
                mode: 'work',
                clientId: null,
                minutes: elapsedVisitMinutes(activeVisit.startedAt),
                notes: activeVisit.notes,
                supportNoteBreakdown: supportNote,
                nextActions: [],
                googleCalendarEntered: false,
                importantText: false,
                textContactDirection: 'received',
                textReplyNeeded: false,
                odometerEnd: null,
                createdAt: activeVisit.startedAt,
                updatedAt: activeVisit.updatedAt,
              }}
              personName={activeVisit.client}
              noteText={supportNote}
              onChange={setSupportNote}
            />
            <GoldStandardNoteTemplateEditor
              entry={{
                ...activeVisit,
                id: activeVisit.id,
                mode: 'work',
                clientId: null,
                minutes: elapsedVisitMinutes(activeVisit.startedAt),
                notes: activeVisit.notes,
                supportNoteBreakdown: supportNote,
                nextActions: [],
                googleCalendarEntered: false,
                importantText: false,
                textContactDirection: 'received',
                textReplyNeeded: false,
                odometerEnd: null,
                createdAt: activeVisit.startedAt,
                updatedAt: activeVisit.updatedAt,
              }}
              personName={activeVisit.client}
              noteText={supportNote}
              onChange={setSupportNote}
            />
          </>
        )}

        <div className="visit-closeout-summary">
          <div><span>Started</span><strong>{formatDate(activeVisit.date)} · {activeVisit.startTime}</strong></div>
          <div><span>Duration</span><strong>{elapsedVisitText(activeVisit.startedAt)}</strong></div>
          {activeVisit.type === 'homeVisit' && (
            <div>
              <span>Odometer</span>
              <strong>
                {activeVisit.odometerStart == null ? 'Not set' : activeVisit.odometerStart.toFixed(1)}
                {' → '}
                {finishOdometer.trim() || '—'}
              </strong>
            </div>
          )}
        </div>

        <div className="visit-closeout-actions">
          <button
            type="button"
            className="secondary"
            disabled={Boolean(saving)}
            onClick={() => void saveDraft()}
          >
            {saving === 'draft' ? 'Saving…' : 'Save Draft & Return'}
          </button>
          <button
            type="button"
            className="primary"
            disabled={Boolean(saving)}
            onClick={() => void finish()}
          >
            {saving === 'finish' ? 'Finishing…' : 'Finish Visit & Save'}
          </button>
        </div>
      </section>
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
  const [captureMode, setCaptureMode] = useState<'timed' | 'manual'>('timed');
  const [type, setType] = useState<EntryTypeKey>(allowedTypes[0].key);
  const [client, setClient] = useState('');
  const [date, setDate] = useState(localDateValue());
  const [startTime, setStartTime] = useState(localTimeValue());
  const [minutes, setMinutes] = useState(60);
  const [notes, setNotes] = useState('');
  const [supportNote, setSupportNote] = useState(SUPPORT_NOTE_TEMPLATE);
  const [nextAction, setNextAction] = useState('');
  const [importantText, setImportantText] = useState(false);
  const [direction, setDirection] = useState<TextContactDirection>('received');
  const [replyNeeded, setReplyNeeded] = useState(false);
  const [odometerStart, setOdometerStart] = useState('');
  const [odometerEnd, setOdometerEnd] = useState('');
  const [visitContext, setVisitContext] = useState('');
  const [activeNotes, setActiveNotes] = useState('');
  const [activeStartOdometer, setActiveStartOdometer] = useState('');
  const [activeFinishOdometer, setActiveFinishOdometer] = useState('');
  const [finishOpen, setFinishOpen] = useState(false);
  const [recentlySaved, setRecentlySaved] = useState<WorkEntry | null>(null);
  const [tick, setTick] = useState(Date.now());
  const [saving, setSaving] = useState(false);
  const [activeBusy, setActiveBusy] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const activeVisit = state.activeVisit;

  useEffect(() => {
    if (!allowedTypes.some((item) => item.key === type)) {
      setType(allowedTypes[0].key);
    }
  }, [mode, type, allowedTypes]);

  useEffect(() => {
    if (!activeVisit) return;
    setActiveNotes(activeVisit.notes.join('\n'));
    setActiveStartOdometer(
      activeVisit.odometerStart == null
        ? ''
        : String(activeVisit.odometerStart),
    );
    setActiveFinishOdometer('');
    setRecentlySaved(null);
  }, [activeVisit?.id]);

  useEffect(() => {
    if (!activeVisit) return;
    setTick(Date.now());
    const timer = window.setInterval(() => setTick(Date.now()), 15_000);
    return () => window.clearInterval(timer);
  }, [activeVisit?.id]);

  const definition = entryType(type);
  const clientNames = useMemo(
    () =>
      state.clients
        .filter((item) => item.mode === mode)
        .map((item) => item.name)
        .sort((left, right) => left.localeCompare(right)),
    [state.clients, mode],
  );

  const fallbackClient = () =>
    type === 'emailProfessional'
      ? 'Professional email'
      : type === 'adminEducationResources'
        ? 'Admin / Education / Resources'
        : 'Unknown Client';

  const startTimed = async () => {
    setError('');
    setMessage('');

    if (definition.requiresClient && !client.trim()) {
      setError('Choose or enter a client before starting.');
      return;
    }

    const selectedClient = client.trim() || fallbackClient();
    const now = new Date();
    const localStartTime = localTimeValue(now);
    const localStart = new Date(date + 'T' + localStartTime + ':00');

    if (Number.isNaN(localStart.getTime())) {
      setError('Choose a valid visit date.');
      return;
    }

    const startOdo =
      type === 'homeVisit' && odometerStart.trim()
        ? Number(odometerStart)
        : null;
    if (startOdo != null && !Number.isFinite(startOdo)) {
      setError('Starting odometer must be a valid number.');
      return;
    }

    setActiveBusy('start');
    try {
      const next = await startActiveVisit(credentials, {
        client: selectedClient,
        type,
        startedAt: localStart.toISOString(),
        date,
        startTime: localStartTime,
        odometerStart: startOdo,
        notes: visitLines(visitContext),
      });
      onState(next);
      setVisitContext('');
      setOdometerStart('');
      setMessage('Visit started and saved to your Work workspace.');
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : 'Could not start the visit.',
      );
    } finally {
      setActiveBusy('');
    }
  };

  const saveActiveDraft = async () => {
    if (!activeVisit) return;

    const startOdo =
      activeVisit.type === 'homeVisit' && activeStartOdometer.trim()
        ? Number(activeStartOdometer)
        : activeVisit.odometerStart;

    if (startOdo != null && !Number.isFinite(startOdo)) {
      setError('Starting odometer must be a valid number.');
      return;
    }

    setActiveBusy('draft');
    setError('');
    setMessage('');
    try {
      const next = await updateActiveVisit(credentials, {
        notes: visitLines(activeNotes),
        odometerStart: startOdo,
      });
      onState(next);
      setMessage('Active visit draft saved.');
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : 'Could not save the active visit draft.',
      );
    } finally {
      setActiveBusy('');
    }
  };

  const cancelVisit = async () => {
    if (!activeVisit) return;
    if (
      !window.confirm(
        'Cancel the active visit for ' +
          activeVisit.client +
          '? No Work entry will be created.',
      )
    ) {
      return;
    }

    setActiveBusy('cancel');
    setError('');
    try {
      onState(await cancelActiveVisit(credentials));
      setMessage('Active visit cancelled.');
      setActiveNotes('');
      setActiveStartOdometer('');
      setActiveFinishOdometer('');
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : 'Could not cancel the visit.',
      );
    } finally {
      setActiveBusy('');
    }
  };

  const saveManual = async (event: FormEvent) => {
    event.preventDefault();
    setError('');

    if (definition.requiresClient && !client.trim()) {
      setError('Choose or enter a client before saving.');
      return;
    }

    const draft: EntryDraft = {
      mode,
      client: client.trim() || fallbackClient(),
      type,
      date,
      startTime,
      minutes,
      notes: visitLines(notes),
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

  if (recentlySaved && !activeVisit) {
    return (
      <div className="page-stack">
        <section className="visit-saved-hero">
          <div className="visit-saved-check">✓</div>
          <div>
            <div className="eyebrow">WORK SAVED</div>
            <h2>Visit saved</h2>
            <p>
              {recentlySaved.client} · {entryType(recentlySaved.type).label} · {recentlySaved.minutes} min
            </p>
          </div>
        </section>

        <Panel title="Saved summary">
          <div className="visit-summary-grid">
            <div><span>Client</span><strong>{recentlySaved.client}</strong></div>
            <div><span>Date</span><strong>{formatDate(recentlySaved.date)}</strong></div>
            <div><span>Minutes</span><strong>{recentlySaved.minutes} min</strong></div>
            <div><span>Billable</span><strong>{entryBillableHours(recentlySaved).toFixed(2)} h</strong></div>
            <div><span>KM</span><strong>{entryKilometres(recentlySaved).toFixed(1)}</strong></div>
            <div><span>Earned</span><strong>{money(entryEarnings(recentlySaved, state.settings.hourlyRate))}</strong></div>
          </div>
        </Panel>

        <div className="visit-saved-actions">
          <button
            className="secondary"
            onClick={async () => {
              const popup = window.open(
                googleCalendarDraftUrl(recentlySaved),
                '_blank',
                'noopener,noreferrer',
              );
              if (!popup) {
                setError('Calendar was blocked. Allow pop-ups for NMRNL and try again.');
                return;
              }
              onState(
                await setEntryCalendarEntered(
                  credentials,
                  recentlySaved.id,
                  true,
                ),
              );
            }}
          >
            ▦ Create Calendar Event
          </button>
          <button className="secondary" onClick={() => go('notes')}>Create Support Note</button>
          <button className="secondary" onClick={() => go('entries')}>Open Entries</button>
          <button
            className="primary"
            onClick={() => {
              setRecentlySaved(null);
              setCaptureMode('timed');
              setDate(localDateValue());
            }}
          >
            + Start New Visit
          </button>
        </div>

        {error && <div className="error-banner">{error}</div>}
      </div>
    );
  }

  if (activeVisit) {
    const elapsedMinutes = elapsedVisitMinutes(activeVisit.startedAt, tick);
    const estimated = (elapsedMinutes / 60) * state.settings.hourlyRate;

    return (
      <div className="page-stack active-visit-page">
        <section className="active-visit-hero">
          <span className="active-visit-live"><i /> LIVE VISIT</span>
          <strong className="active-visit-time">
            {elapsedVisitText(activeVisit.startedAt, tick)}
          </strong>
          <h2>{activeVisit.client}</h2>
          <p>
            {entryType(activeVisit.type).label} · started {formatDate(activeVisit.date)} at {activeVisit.startTime}
          </p>
          <div className="active-visit-hero-stats">
            <span><small>Elapsed</small><b>{elapsedMinutes} min</b></span>
            <span><small>Estimated</small><b>{money(estimated)}</b></span>
            <span><small>Draft</small><b>Cloud saved</b></span>
          </div>
        </section>

        {error && <div className="error-banner">{error}</div>}
        {message && <div className="success-banner">{message}</div>}

        {activeVisit.type === 'homeVisit' && (
          <Panel title="Travel" subtitle="You can add the starting odometer after the timer has begun">
            <div className="form-grid two">
              <label className="field">
                <span>Starting odometer</span>
                <input
                  inputMode="decimal"
                  value={activeStartOdometer}
                  onChange={(event) => setActiveStartOdometer(event.target.value)}
                  placeholder="Optional"
                />
              </label>
              <label className="field">
                <span>Finishing odometer</span>
                <input
                  inputMode="decimal"
                  value={activeFinishOdometer}
                  onChange={(event) => setActiveFinishOdometer(event.target.value)}
                  placeholder="Add when visit finishes"
                />
              </label>
            </div>
          </Panel>
        )}

        <Panel title="Visit Context" subtitle="Keep notes while the visit is running">
          <label className="field">
            <span>Draft notes</span>
            <textarea
              rows={9}
              value={activeNotes}
              onChange={(event) => setActiveNotes(event.target.value)}
              placeholder="Add topics, observations, agencies or brief factual notes — one per line."
            />
          </label>
          <div className="active-draft-row">
            <button
              type="button"
              className="secondary"
              disabled={Boolean(activeBusy)}
              onClick={() => void saveActiveDraft()}
            >
              {activeBusy === 'draft' ? 'Saving…' : 'Save Draft Notes'}
            </button>
            <small>The running visit itself is already stored in the cloud.</small>
          </div>
        </Panel>

        <div className="active-visit-bottom-actions">
          <button
            type="button"
            className="active-cancel"
            disabled={Boolean(activeBusy)}
            onClick={() => void cancelVisit()}
          >
            Cancel
          </button>
          <button
            type="button"
            className="primary big"
            disabled={Boolean(activeBusy)}
            onClick={() => setFinishOpen(true)}
          >
            ■ Finish Visit & Save
          </button>
        </div>

        {finishOpen && (
          <FinishActiveVisitModal
            activeVisit={activeVisit}
            notesText={activeNotes}
            finishOdometer={activeFinishOdometer}
            credentials={credentials}
            onState={onState}
            onSaved={(entry) => {
              setRecentlySaved(entry);
              setActiveNotes('');
              setActiveStartOdometer('');
              setActiveFinishOdometer('');
            }}
            onClose={() => setFinishOpen(false)}
          />
        )}
      </div>
    );
  }

  if (captureMode === 'timed') {
    return (
      <div className="page-stack">
        <section className="page-title">
          <div>
            <div className="eyebrow">LIVE WORK CAPTURE</div>
            <h2>Start visit</h2>
            <p>Choose who and what. NMRNL times the visit until you finish it.</p>
          </div>
        </section>

        {error && <div className="error-banner">{error}</div>}
        {message && <div className="success-banner">{message}</div>}

        <div className="visit-mode-switch">
          <button className="active" type="button">Timed Visit</button>
          <button type="button" onClick={() => setCaptureMode('manual')}>Manual Entry</button>
        </div>

        <Panel title="1. Client">
          <label className="field">
            <span>
              Client
              {!definition.requiresClient && (
                <small>{definition.optionalClient ? ' optional' : ' not required'}</small>
              )}
            </span>
            <input
              list="nmrnl-timed-clients"
              value={client}
              onChange={(event) => setClient(event.target.value)}
              placeholder={definition.requiresClient ? 'Client name' : 'Optional client tag'}
            />
            <datalist id="nmrnl-timed-clients">
              {clientNames.map((name) => <option value={name} key={name} />)}
            </datalist>
          </label>
        </Panel>

        <Panel title="2. Support Type">
          <div className="type-grid">
            {allowedTypes.map((item) => (
              <button
                type="button"
                key={item.key}
                className={'type-tile ' + (item.key === type ? 'active' : '')}
                onClick={() => {
                  setType(item.key);
                  if (item.key !== 'homeVisit') setOdometerStart('');
                }}
              >
                <span>{item.icon}</span>
                <strong>{item.shortLabel}</strong>
              </button>
            ))}
          </div>
        </Panel>

        <Panel title="3. Visit Date">
          <div className="visit-date-controls">
            <label className="field">
              <span>Selected date</span>
              <input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
            </label>
            <button type="button" className="secondary compact" onClick={() => setDate(localDateValue())}>Today</button>
            <button
              type="button"
              className="secondary compact"
              onClick={() => {
                const selected = new Date(date + 'T12:00:00');
                selected.setDate(selected.getDate() - 1);
                setDate(localDateValue(selected));
              }}
            >
              ← Previous Day
            </button>
          </div>
        </Panel>

        {type === 'homeVisit' && (
          <Panel title="4. Starting Odometer" subtitle="Optional — add it now or after the timer starts">
            <label className="field">
              <span>Starting odometer</span>
              <input
                inputMode="decimal"
                value={odometerStart}
                onChange={(event) => setOdometerStart(event.target.value)}
                placeholder="e.g. 84520.3"
              />
            </label>
          </Panel>
        )}

        <Panel title="Optional Visit Context">
          <label className="field">
            <span>Topics / context</span>
            <textarea
              rows={6}
              value={visitContext}
              onChange={(event) => setVisitContext(event.target.value)}
              placeholder="Optional topics or context — one per line. You can add more while the visit runs."
            />
          </label>
        </Panel>

        <button
          type="button"
          className="primary big timed-start-button"
          disabled={activeBusy === 'start'}
          onClick={() => void startTimed()}
        >
          {activeBusy === 'start'
            ? 'Starting…'
            : type === 'homeVisit'
              ? '▶ Start Visit'
              : '▶ Start Now'}
        </button>
      </div>
    );
  }

  return (
    <form className="page-stack" onSubmit={saveManual}>
      <section className="page-title">
        <div>
          <div className="eyebrow">FAST CAPTURE</div>
          <h2>Manual Entry</h2>
          <p>Record completed Work without running a live timer.</p>
        </div>
        <button className="primary" disabled={saving}>
          {saving ? 'Saving…' : 'Save entry'}
        </button>
      </section>

      {error && <div className="error-banner">{error}</div>}

      <div className="visit-mode-switch">
        <button type="button" onClick={() => setCaptureMode('timed')}>Timed Visit</button>
        <button className="active" type="button">Manual Entry</button>
      </div>

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
              placeholder={definition.requiresClient ? 'Client name' : 'Optional client tag'}
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
            <input type="number" min="1" max="1440" value={minutes} onChange={(event) => setMinutes(Number(event.target.value))} />
          </label>
        </div>
      </Panel>

      {type === 'homeVisit' && (
        <Panel title="Travel" subtitle="Odometer is used to calculate kilometres">
          <div className="form-grid two">
            <label className="field">
              <span>Odometer start</span>
              <input inputMode="decimal" value={odometerStart} onChange={(event) => setOdometerStart(event.target.value)} placeholder="e.g. 84520.3" />
            </label>
            <label className="field">
              <span>Odometer end</span>
              <input inputMode="decimal" value={odometerEnd} onChange={(event) => setOdometerEnd(event.target.value)} placeholder="e.g. 84534.8" />
            </label>
          </div>
        </Panel>
      )}

      {type === 'textNote' && (
        <Panel title="Text contact">
          <div className="form-grid two">
            <label className="field">
              <span>Direction</span>
              <select value={direction} onChange={(event) => setDirection(event.target.value as TextContactDirection)}>
                <option value="received">Received</option>
                <option value="sent">Sent</option>
                <option value="exchange">Exchange</option>
              </select>
            </label>
            <label className="check-card">
              <input type="checkbox" checked={replyNeeded} onChange={(event) => setReplyNeeded(event.target.checked)} />
              <span><strong>Reply needed</strong><small>Keep this text visible for follow-up.</small></span>
            </label>
          </div>
        </Panel>
      )}

      <Panel title="Record">
        <div className="form-grid two note-grid">
          <label className="field">
            <span>Notes</span>
            <textarea rows={7} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="One point per line. Keep it factual and concise." />
          </label>
          <div className="manual-template-column">
            <SupportNoteTemplateTools
              entry={{
                id: 'manual-preview',
                mode,
                clientId: null,
                client: client.trim() || fallbackClient(),
                type,
                date,
                startTime,
                minutes,
                notes: visitLines(notes),
                supportNoteBreakdown: supportNote,
                nextActions: [],
                googleCalendarEntered: false,
                importantText,
                textContactDirection: direction,
                textReplyNeeded: replyNeeded,
                odometerStart:
                  type === 'homeVisit' && odometerStart.trim()
                    ? Number(odometerStart)
                    : null,
                odometerEnd:
                  type === 'homeVisit' && odometerEnd.trim()
                    ? Number(odometerEnd)
                    : null,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              }}
              personName={client.trim() || fallbackClient()}
              noteText={supportNote}
              onChange={setSupportNote}
            />
            <GoldStandardNoteTemplateEditor
              entry={{
                id: 'manual-preview',
                mode,
                clientId: null,
                client: client.trim() || fallbackClient(),
                type,
                date,
                startTime,
                minutes,
                notes: visitLines(notes),
                supportNoteBreakdown: supportNote,
                nextActions: [],
                googleCalendarEntered: false,
                importantText,
                textContactDirection: direction,
                textReplyNeeded: replyNeeded,
                odometerStart:
                  type === 'homeVisit' && odometerStart.trim()
                    ? Number(odometerStart)
                    : null,
                odometerEnd:
                  type === 'homeVisit' && odometerEnd.trim()
                    ? Number(odometerEnd)
                    : null,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              }}
              personName={client.trim() || fallbackClient()}
              noteText={supportNote}
              onChange={setSupportNote}
            />
          </div>
        </div>
      </Panel>

      <Panel title="Follow-up" subtitle="Optional — appears automatically in Actions">
        <div className="form-grid two">
          <label className="field">
            <span>Next action</span>
            <input value={nextAction} onChange={(event) => setNextAction(event.target.value)} placeholder="e.g. Call client Thursday about tenancy referral" />
          </label>
          <label className="check-card">
            <input type="checkbox" checked={importantText} onChange={(event) => setImportantText(event.target.checked)} />
            <span><strong>Mark important</strong><small>Useful for significant written contact.</small></span>
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

function SupportNoteModal({
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
  const [personName, setPersonName] = useState(
    entry.supportNotePersonName?.trim() || entry.client,
  );
  const [noteText, setNoteText] = useState(
    ensureStructuredSupportNote(
      entry.supportNoteBreakdown.trim() || SUPPORT_NOTE_TEMPLATE,
    ),
  );
  const [editorMode, setEditorMode] = useState<'template' | 'raw'>('template');
  const [status, setStatus] = useState<SupportNoteStatus>(
    supportNoteStatus(entry),
  );
  const [saving, setSaving] = useState(false);
  const [driveBusy, setDriveBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const driveMeta = state.driveSupportNotes[entry.id];

  const saveNote = async (
    nextStatus = status,
    closeAfter = false,
  ) => {
    setSaving(true);
    setError('');
    setMessage('');

    try {
      const nextState = await updateSupportNote(credentials, entry.id, {
        personName: personName.trim() || entry.client,
        status: nextStatus,
        noteText: noteText.trim(),
      });
      onState(nextState);
      setStatus(nextStatus);
      setMessage('Support note saved in NMRNL.');
      if (closeAfter) onClose();
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : 'Could not save the support note.',
      );
    } finally {
      setSaving(false);
    }
  };

  const saveToDrive = async () => {
    if (!hasSupportNoteContent(noteText)) {
      setError('Add support-note content before saving it to Google Drive.');
      return;
    }

    setDriveBusy(true);
    setError('');
    setMessage('');

    try {
      let nextState = await updateSupportNote(credentials, entry.id, {
        personName: personName.trim() || entry.client,
        status,
        noteText: noteText.trim(),
      });

      const synced = await syncSupportNoteToDrive({
        entry,
        personName: personName.trim() || entry.client,
        status,
        noteText: noteText.trim(),
        payPeriodAnchorDate: nextState.settings.payPeriodAnchorDate,
        drive: nextState.drive,
        existingMeta: nextState.driveSupportNotes[entry.id],
      });

      nextState = await updateDriveSetup(credentials, synced.drive);
      nextState = await updateDriveSupportNoteMeta(
        credentials,
        entry.id,
        synced.meta,
      );
      onState(nextState);
      setMessage('Support note synced to Google Drive.');
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : 'Could not sync the support note to Google Drive.',
      );
    } finally {
      setDriveBusy(false);
    }
  };

  const changeStatus = async (nextStatus: SupportNoteStatus) => {
    setStatus(nextStatus);
    await saveNote(nextStatus, false);
  };

  return (
    <div className="modal-backdrop support-note-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="support-note-modal"
        onMouseDown={(event) => event.stopPropagation()}
        aria-label="Support note editor"
      >
        <div className="support-note-header">
          <div>
            <div className="eyebrow">SUPPORT NOTE</div>
            <h2>{entry.client}</h2>
            <p>{formatDate(entry.date)} · {entry.startTime} · {entryType(entry.type).label}</p>
          </div>
          <button type="button" className="icon-button" onClick={onClose}>×</button>
        </div>

        {error && <div className="error-banner">{error}</div>}
        {message && <div className="success-banner">{message}</div>}

        <label className="field">
          <span>Person name</span>
          <input
            value={personName}
            onChange={(event) => setPersonName(event.target.value)}
            disabled={saving}
          />
        </label>

        <div className="support-note-tools">
          <strong>Status</strong>
          <div className="support-note-statuses">
            {SUPPORT_NOTE_STATUS_OPTIONS.map((item) => (
              <button
                type="button"
                key={item.key}
                className={
                  'support-note-status status-' +
                  item.key +
                  (status === item.key ? ' active' : '')
                }
                onClick={() => void changeStatus(item.key)}
                disabled={saving}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>

        <div className="note-editor-switch">
          <button
            type="button"
            className={editorMode === 'template' ? 'active' : ''}
            onClick={() => setEditorMode('template')}
          >
            Template
          </button>
          <button
            type="button"
            className={editorMode === 'raw' ? 'active' : ''}
            onClick={() => setEditorMode('raw')}
          >
            Raw note
          </button>
        </div>

        <SupportNoteTemplateTools
          entry={entry}
          personName={personName}
          noteText={noteText}
          onChange={setNoteText}
        />

        {editorMode === 'template' ? (
          <GoldStandardNoteTemplateEditor
            entry={entry}
            personName={personName}
            noteText={noteText}
            onChange={setNoteText}
            disabled={saving}
          />
        ) : (
          <label className="field support-note-editor">
            <span>Support worker note</span>
            <textarea
              value={noteText}
              onChange={(event) =>
                setNoteText(
                  ensureStructuredSupportNote(event.target.value),
                )
              }
              disabled={saving}
              spellCheck
              rows={18}
            />
          </label>
        )}

        <div className="support-note-summary">
          <span>
            <strong>{supportNoteStatusLabel(status)}</strong>
            <small>
              {hasSupportNoteContent(noteText)
                ? 'Note content entered'
                : 'Structured template ready for completion'}
            </small>
          </span>
          {entry.supportNoteUpdatedAt && (
            <small>
              Last saved {new Date(entry.supportNoteUpdatedAt).toLocaleString()}
            </small>
          )}
        </div>

        <div className="support-note-drive">
          <div>
            <strong>Google Drive</strong>
            <small>
              {driveMeta
                ? 'This support note has a linked Google Doc.'
                : 'Creates a Google Doc inside the Work client / invoice-period folder.'}
            </small>
          </div>
          <div className="support-note-drive-actions">
            {driveMeta?.webViewLink && (
              <button
                type="button"
                className="secondary compact"
                onClick={() => window.open(driveMeta.webViewLink, '_blank', 'noopener,noreferrer')}
              >
                Open Drive Note
              </button>
            )}
            <button
              type="button"
              className="secondary compact"
              disabled={driveBusy || saving}
              onClick={() => void saveToDrive()}
            >
              {driveBusy
                ? 'Syncing…'
                : driveMeta
                  ? 'Re-sync to Drive'
                  : 'Save to Drive'}
            </button>
          </div>
        </div>

        <div className="support-note-actions">
          <button
            type="button"
            className="secondary"
            onClick={() => void saveNote(status, true)}
            disabled={saving}
          >
            {saving ? 'Saving…' : 'Save Draft & Return'}
          </button>
          <button
            type="button"
            className="primary"
            onClick={() => void saveNote(status, false)}
            disabled={saving}
          >
            {saving ? 'Saving…' : 'Save Note in App'}
          </button>
        </div>
      </section>
    </div>
  );
}

function calendarTitle(entry: WorkEntry): string {
  if (entry.importantText && entry.type === 'textNote') {
    return 'IMPORTANT TEXT ' + entry.client;
  }
  return entry.client + ' ' + entryType(entry.type).label;
}

function calendarDetails(entry: WorkEntry): string {
  const start = entryDateTime(entry);
  const end = new Date(start.getTime() + Math.max(1, entry.minutes) * 60_000);
  const lines = [
    entry.client +
      ' ' +
      entryType(entry.type).label +
      ' on ' +
      formatDate(entry.date) +
      ' from ' +
      entry.startTime +
      ' to ' +
      end.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) +
      ' for ' +
      entry.minutes +
      ' minutes.',
    '',
    'Visit duration: ' + entry.minutes + ' minutes',
  ];

  const kilometres = entryKilometres(entry);
  if (kilometres > 0) {
    lines.push('Kilometres travelled: ' + kilometres.toFixed(1) + ' km');
  }

  return lines.join('\n');
}

function googleCalendarDraftUrl(entry: WorkEntry): string {
  const start = entryDateTime(entry);
  const end = new Date(start.getTime() + Math.max(1, entry.minutes) * 60_000);

  const googleDate = (value: Date) =>
    value
      .toISOString()
      .replace(/[-:]/g, '')
      .replace(/\.\d{3}Z$/, 'Z');

  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: calendarTitle(entry),
    dates: googleDate(start) + '/' + googleDate(end),
    details: calendarDetails(entry),
    location: entry.client,
    trp: 'true',
  });

  return 'https://calendar.google.com/calendar/render?' + params.toString();
}

function CalendarScreen({
  state,
  credentials,
  onState,
}: {
  state: WorkspaceState;
  credentials: WorkspaceCredentials;
  onState: (state: WorkspaceState) => void;
}) {
  const workEntries = state.entries
    .filter((entry) => entry.mode === 'work')
    .sort((a, b) => entryDateTime(a).getTime() - entryDateTime(b).getTime());

  const [selectedDate, setSelectedDate] = useState(localDateValue());
  const [calendarBusyId, setCalendarBusyId] = useState('');
  const [calendarMessage, setCalendarMessage] = useState('');
  const [calendarError, setCalendarError] = useState('');
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
  const missingNotes = selected.filter((entry) => !hasSupportNoteContent(entry.supportNoteBreakdown)).length;
  const openActions = selected.reduce(
    (sum, entry) => sum + entry.nextActions.filter((action) => !action.completedAt).length,
    0,
  );
  const needsCalendar = selected.filter((entry) => !entry.googleCalendarEntered).length;

  const createCalendarDraft = async (entry: WorkEntry) => {
    setCalendarBusyId(entry.id);
    setCalendarMessage('');
    setCalendarError('');

    const popup = window.open(
      googleCalendarDraftUrl(entry),
      '_blank',
      'noopener,noreferrer',
    );

    if (!popup) {
      setCalendarBusyId('');
      setCalendarError(
        'Calendar could not open. Allow pop-ups for NMRNL and try again.',
      );
      return;
    }

    try {
      onState(await setEntryCalendarEntered(credentials, entry.id, true));
      setCalendarMessage(
        'Google Calendar draft opened for ' +
          entry.client +
          '. Review it and tap Save in Google Calendar.',
      );
    } catch (reason) {
      setCalendarError(
        reason instanceof Error
          ? reason.message
          : 'Calendar draft opened, but NMRNL could not mark the entry.',
      );
    } finally {
      setCalendarBusyId('');
    }
  };

  return (
    <div className="page-stack">
      <section className="page-title">
        <div>
          <div className="eyebrow">WORK PLANNER</div>
          <h2>Calendar</h2>
          <p>Plan work, open Google Calendar drafts, and see what still needs attention.</p>
        </div>
        <label className="calendar-date-jump">
          <span>Jump to date</span>
          <input type="date" value={selectedDate} onChange={(e) => setSelectedDate(e.target.value)} />
        </label>
      </section>

      <Panel title="14-day work view" subtitle="Red = missing note · Amber = follow-up · Purple = needs calendar · Orange = overlap">
        <div className="calendar-day-grid">
          {days.map((day) => {
            const entries = workEntries.filter((entry) => entry.date === day);
            const overlaps = entriesOverlap(entries);
            const missing = entries.some((entry) => !hasSupportNoteContent(entry.supportNoteBreakdown));
            const actions = entries.some((entry) => entry.nextActions.some((action) => !action.completedAt));
            const calendarGap = entries.some((entry) => !entry.googleCalendarEntered);
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
                  <i className={calendarGap ? 'calendar-gap' : ''} />
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
        <StatCard label="Needs calendar" value={String(needsCalendar)} />
        <StatCard label="Overlaps" value={String(overlapIds.size)} />
      </div>

      <Panel
        title="Google Calendar"
        subtitle="Each button opens a pre-filled private Google Calendar draft. Review it and tap Save in Google Calendar."
      >
        <div className="google-calendar-panel">
          <span className="google-calendar-mark">G</span>
          <div>
            <strong>Calendar export is ready</strong>
            <small>
              NMRNL tracks which work entries have had a calendar draft opened.
              Editing the client, time, duration, travel or importance resets the
              calendar status automatically.
            </small>
          </div>
        </div>
        {calendarError && <div className="error-banner calendar-message">{calendarError}</div>}
        {calendarMessage && <div className="success-banner calendar-message">{calendarMessage}</div>}
      </Panel>

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
                  <div className="calendar-entry-side">
                    <div className="calendar-entry-flags">
                      {!hasSupportNoteContent(entry.supportNoteBreakdown) && <b className="flag danger">Missing note</b>}
                      {entry.nextActions.some((action) => !action.completedAt) && <b className="flag warn">Follow-up</b>}
                      {!entry.googleCalendarEntered && <b className="flag calendar-gap">Needs calendar</b>}
                      {overlapIds.has(entry.id) && <b className="flag overlap">Overlap</b>}
                      {entry.googleCalendarEntered && <b className="flag ok">Calendar entered</b>}
                    </div>
                    <button
                      type="button"
                      className={entry.googleCalendarEntered ? 'secondary compact calendar-button entered' : 'primary compact calendar-button'}
                      onClick={() => void createCalendarDraft(entry)}
                      disabled={calendarBusyId === entry.id}
                    >
                      {calendarBusyId === entry.id
                        ? 'Opening…'
                        : entry.googleCalendarEntered
                          ? 'Open again'
                          : 'Create Calendar Event'}
                    </button>
                  </div>
                </div>
              ))}
          </div>
        )}
      </Panel>
    </div>
  );
}

const INVOICE_PERIOD_DAYS = 14;
const FIRST_INVOICE_NUMBER = 5;

function addCalendarDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days, 12);
}

function calendarDaysBetween(start: Date, end: Date): number {
  const startUtc = Date.UTC(start.getFullYear(), start.getMonth(), start.getDate());
  const endUtc = Date.UTC(end.getFullYear(), end.getMonth(), end.getDate());
  return Math.round((endUtc - startUtc) / 86_400_000);
}

function floorDivide(value: number, divisor: number): number {
  return Math.floor(value / divisor);
}

function fortnightStartFor(date: Date, anchorDate: string): Date {
  const anchor = new Date(anchorDate + 'T12:00:00');
  const normalized = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12);
  const daysSinceAnchor = calendarDaysBetween(anchor, normalized);
  const offset = floorDivide(daysSinceAnchor, INVOICE_PERIOD_DAYS);
  return addCalendarDays(anchor, offset * INVOICE_PERIOD_DAYS);
}

function invoiceKey(start: Date, end: Date): string {
  return localDateValue(start) + '_' + localDateValue(end);
}

function money(value: number): string {
  return new Intl.NumberFormat('en-NZ', {
    style: 'currency',
    currency: 'NZD',
  }).format(Number.isFinite(value) ? value : 0);
}

function invoiceStatusLabel(status: InvoiceStatus): string {
  if (status === 'submitted') return 'Submitted';
  if (status === 'paid') return 'Paid';
  return 'Not Submitted';
}

function invoiceNumberForStart(start: Date, anchorDate: string): number {
  const anchorRangeStart = fortnightStartFor(
    new Date(anchorDate + 'T12:00:00'),
    anchorDate,
  );
  return (
    FIRST_INVOICE_NUMBER +
    floorDivide(
      calendarDaysBetween(anchorRangeStart, start),
      INVOICE_PERIOD_DAYS,
    )
  );
}

function invoiceTotals(
  entries: WorkEntry[],
  hourlyRate: number,
  fuelRate: number,
) {
  const billableMinutes = entries.reduce(
    (sum, entry) => sum + entryBillableMinutes(entry),
    0,
  );
  const kilometres = entries.reduce(
    (sum, entry) => sum + entryKilometres(entry),
    0,
  );
  const earnings = entries.reduce(
    (sum, entry) => sum + entryEarnings(entry, hourlyRate),
    0,
  );
  const travel = entries.reduce(
    (sum, entry) => sum + entryTravelReimbursement(entry, fuelRate),
    0,
  );

  return {
    billableMinutes,
    kilometres,
    earnings,
    travel,
    total: earnings + travel,
  };
}

function openInvoicePrintView({
  invoiceNumber,
  startKey,
  endKey,
  entries,
  hourlyRate,
  fuelRate,
}: {
  invoiceNumber: number;
  startKey: string;
  endKey: string;
  entries: WorkEntry[];
  hourlyRate: number;
  fuelRate: number;
}) {
  const totals = invoiceTotals(entries, hourlyRate, fuelRate);
  const escapeHtml = (value: string) =>
    value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');

  const rows = entries
    .map(
      (entry) =>
        '<tr>' +
        '<td>' + escapeHtml(formatDate(entry.date)) + '</td>' +
        '<td>' + escapeHtml(entry.client) + '</td>' +
        '<td>' + escapeHtml(entryType(entry.type).label) + '</td>' +
        '<td>' + entryBillableHours(entry).toFixed(2) + '</td>' +
        '<td>' + entryKilometres(entry).toFixed(1) + '</td>' +
        '<td>' + money(
          entryEarnings(entry, hourlyRate) +
            entryTravelReimbursement(entry, fuelRate),
        ) + '</td>' +
        '</tr>',
    )
    .join('');

  const invoiceWindow = window.open('', '_blank');
  if (!invoiceWindow) return false;

  invoiceWindow.document.write(
    '<!doctype html><html><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>Invoice ' + invoiceNumber + '</title>' +
    '<style>' +
    'body{font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;margin:32px;color:#111}' +
    'h1{margin:0 0 4px}.muted{color:#666}.summary{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin:24px 0}' +
    '.box{border:1px solid #bbb;padding:12px}.box b{display:block;font-size:20px;margin-top:4px}' +
    'table{width:100%;border-collapse:collapse;font-size:12px}th,td{border:1px solid #bbb;padding:7px;text-align:left}' +
    '.total{margin-top:20px;text-align:right;font-size:22px;font-weight:800}' +
    '.note{margin-top:14px;color:#666;font-size:11px}@media print{button{display:none}body{margin:12mm}}' +
    '</style></head><body>' +
    '<h1>NMRNL Work Invoice ' + invoiceNumber + '</h1>' +
    '<div class="muted">' + escapeHtml(formatDate(startKey)) + ' – ' + escapeHtml(formatDate(endKey)) + '</div>' +
    '<div class="summary">' +
    '<div class="box">Billable hours<b>' + (totals.billableMinutes / 60).toFixed(2) + '</b>@ ' + money(hourlyRate) + '/hr</div>' +
    '<div class="box">Travel<b>' + totals.kilometres.toFixed(1) + ' km</b>@ ' + money(fuelRate) + '/km</div>' +
    '<div class="box">Invoice total<b>' + money(totals.total) + '</b></div>' +
    '</div>' +
    '<table><thead><tr><th>Date</th><th>Client</th><th>Work</th><th>Billable hrs</th><th>KM</th><th>Amount</th></tr></thead><tbody>' +
    rows +
    '</tbody></table>' +
    '<div class="total">Total: ' + money(totals.total) + '</div>' +
    '<div class="note">NMRNL Work invoice. Use the browser Share/Print menu to save or send as PDF.</div>' +
    '<script>setTimeout(function(){window.print()},350)<\/script>' +
    '</body></html>',
  );
  invoiceWindow.document.close();
  return true;
}

function PayPeriodScreen({
  state,
  credentials,
  onState,
}: {
  state: WorkspaceState;
  credentials: WorkspaceCredentials;
  onState: (state: WorkspaceState) => void;
}) {
  const [offset, setOffset] = useState(0);
  const [moneyView, setMoneyView] = useState<'total' | 'owed'>('total');
  const [rateEditing, setRateEditing] = useState(false);
  const [hourlyRate, setHourlyRate] = useState(String(state.settings.hourlyRate));
  const [fuelRate, setFuelRate] = useState(String(state.settings.fuelRate));
  const [anchorDate, setAnchorDate] = useState(state.settings.payPeriodAnchorDate);
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    setHourlyRate(String(state.settings.hourlyRate));
    setFuelRate(String(state.settings.fuelRate));
    setAnchorDate(state.settings.payPeriodAnchorDate);
  }, [state.settings]);

  const baseStart = fortnightStartFor(new Date(), state.settings.payPeriodAnchorDate);
  const start = addCalendarDays(baseStart, offset * INVOICE_PERIOD_DAYS);
  const end = addCalendarDays(start, INVOICE_PERIOD_DAYS - 1);
  const startKey = localDateValue(start);
  const endKey = localDateValue(end);
  const selectedInvoiceKey = invoiceKey(start, end);
  const selectedStatus =
    state.invoiceStatuses[selectedInvoiceKey] || 'notSubmitted';
  const invoiceNumber = invoiceNumberForStart(
    start,
    state.settings.payPeriodAnchorDate,
  );

  const workEntries = state.entries
    .filter((entry) => entry.mode === 'work')
    .sort((a, b) => (a.date + a.startTime).localeCompare(b.date + b.startTime));
  const entries = workEntries.filter(
    (entry) => entry.date >= startKey && entry.date <= endKey,
  );

  const totals = invoiceTotals(
    entries,
    state.settings.hourlyRate,
    state.settings.fuelRate,
  );
  const clients = new Set(entries.map((entry) => entry.client)).size;
  const missingNotes = entries.filter(
    (entry) => !hasSupportNoteContent(entry.supportNoteBreakdown),
  ).length;
  const openActions = entries.reduce(
    (sum, entry) =>
      sum + entry.nextActions.filter((action) => !action.completedAt).length,
    0,
  );

  const rows = useMemo(() => {
    const anchor = new Date(state.settings.payPeriodAnchorDate + 'T12:00:00');
    const currentStart = fortnightStartFor(
      new Date(),
      state.settings.payPeriodAnchorDate,
    );
    let firstStart = anchor;

    if (workEntries.length) {
      const earliest = fortnightStartFor(
        new Date(workEntries[0].date + 'T12:00:00'),
        state.settings.payPeriodAnchorDate,
      );
      if (earliest < firstStart) firstStart = earliest;
    }

    const latestEntry = workEntries.length
      ? fortnightStartFor(
          new Date(workEntries[workEntries.length - 1].date + 'T12:00:00'),
          state.settings.payPeriodAnchorDate,
        )
      : currentStart;
    const lastStart =
      latestEntry > currentStart
        ? addCalendarDays(latestEntry, INVOICE_PERIOD_DAYS * 2)
        : addCalendarDays(currentStart, INVOICE_PERIOD_DAYS * 2);

    const result: Array<{
      start: Date;
      end: Date;
      startKey: string;
      endKey: string;
      key: string;
      invoiceNumber: number;
      entries: WorkEntry[];
      status: InvoiceStatus;
      totals: ReturnType<typeof invoiceTotals>;
    }> = [];

    for (
      let cursor = firstStart;
      cursor <= lastStart;
      cursor = addCalendarDays(cursor, INVOICE_PERIOD_DAYS)
    ) {
      const cursorEnd = addCalendarDays(cursor, INVOICE_PERIOD_DAYS - 1);
      const cursorStartKey = localDateValue(cursor);
      const cursorEndKey = localDateValue(cursorEnd);
      const key = invoiceKey(cursor, cursorEnd);
      const periodEntries = workEntries.filter(
        (entry) =>
          entry.date >= cursorStartKey && entry.date <= cursorEndKey,
      );

      result.push({
        start: cursor,
        end: cursorEnd,
        startKey: cursorStartKey,
        endKey: cursorEndKey,
        key,
        invoiceNumber: invoiceNumberForStart(
          cursor,
          state.settings.payPeriodAnchorDate,
        ),
        entries: periodEntries,
        status: state.invoiceStatuses[key] || 'notSubmitted',
        totals: invoiceTotals(
          periodEntries,
          state.settings.hourlyRate,
          state.settings.fuelRate,
        ),
      });
    }

    return result.reverse();
  }, [
    workEntries,
    state.invoiceStatuses,
    state.settings.hourlyRate,
    state.settings.fuelRate,
    state.settings.payPeriodAnchorDate,
  ]);

  const totalMoney = rows.reduce((sum, row) => sum + row.totals.total, 0);
  const owedMoney = rows
    .filter((row) => row.status === 'submitted')
    .reduce((sum, row) => sum + row.totals.total, 0);
  const paidMoney = rows
    .filter((row) => row.status === 'paid')
    .reduce((sum, row) => sum + row.totals.total, 0);

  const byDay = entries.reduce<Record<string, WorkEntry[]>>((groups, entry) => {
    (groups[entry.date] ||= []).push(entry);
    return groups;
  }, {});

  const saveRates = async () => {
    const parsedHourly = Number(hourlyRate);
    const parsedFuel = Number(fuelRate);
    if (!Number.isFinite(parsedHourly) || parsedHourly < 0) {
      setError('Hourly rate must be a valid number.');
      return;
    }
    if (!Number.isFinite(parsedFuel) || parsedFuel < 0) {
      setError('KM rate must be a valid number.');
      return;
    }

    setBusy('settings');
    setError('');
    setMessage('');
    try {
      onState(
        await updateWorkSettings(credentials, {
          hourlyRate: parsedHourly,
          fuelRate: parsedFuel,
          payPeriodAnchorDate: anchorDate,
          weeklyHoursGoal: state.settings.weeklyHoursGoal,
        }),
      );
      setRateEditing(false);
      setMessage('Work invoice rates saved.');
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : 'Could not save Work rates.',
      );
    } finally {
      setBusy('');
    }
  };

  const setStatus = async (status: InvoiceStatus) => {
    setBusy('status');
    setError('');
    setMessage('');
    try {
      onState(
        await updateInvoiceStatus(
          credentials,
          selectedInvoiceKey,
          status,
          totals.total,
        ),
      );
      setMessage('Invoice ' + invoiceNumber + ' marked ' + invoiceStatusLabel(status) + '.');
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : 'Could not update invoice status.',
      );
    } finally {
      setBusy('');
    }
  };

  const syncInvoiceDrive = async () => {
    if (!entries.length) return;

    setBusy('drive');
    setError('');
    setMessage('');

    try {
      const synced = await syncInvoicePeriodToDrive({
        invoiceKey: selectedInvoiceKey,
        invoiceNumber,
        startKey,
        endKey,
        entries,
        hourlyRate: state.settings.hourlyRate,
        fuelRate: state.settings.fuelRate,
        payPeriodAnchorDate: state.settings.payPeriodAnchorDate,
        drive: state.drive,
        existingInvoice: state.invoiceDriveFolders[selectedInvoiceKey],
        supportNoteMetas: state.driveSupportNotes,
      });

      let nextState = await updateDriveSetup(credentials, synced.drive);
      for (const entry of entries) {
        const meta = synced.supportNoteMetas[entry.id];
        if (!meta) continue;
        nextState = await updateDriveSupportNoteMeta(credentials, entry.id, meta);
      }
      nextState = await updateInvoiceDriveMeta(
        credentials,
        selectedInvoiceKey,
        synced.invoice,
      );
      onState(nextState);
      setMessage(
        'Invoice ' + invoiceNumber + ' Drive folder and support-note links are synced.',
      );
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : 'Could not sync this invoice period to Google Drive.',
      );
    } finally {
      setBusy('');
    }
  };

  const invoiceDriveMeta = state.invoiceDriveFolders[selectedInvoiceKey];

  const baseline = state.invoiceBaselines[selectedInvoiceKey];
  const delta =
    baseline == null || selectedStatus === 'notSubmitted'
      ? null
      : totals.total - baseline;

  return (
    <div className="page-stack">
      <section className="page-title">
        <div>
          <div className="eyebrow">WORK INVOICES</div>
          <h2>Pay Period</h2>
          <p>Two-week billable hours, earnings, travel and invoice tracking.</p>
        </div>
        <div className="period-controls">
          <button className="secondary compact" onClick={() => setOffset((value) => value - 1)}>← Previous</button>
          <button className="secondary compact" onClick={() => setOffset(0)}>Current</button>
          <button className="secondary compact" onClick={() => setOffset((value) => value + 1)}>Next →</button>
        </div>
      </section>

      {error && <div className="error-banner">{error}</div>}
      {message && <div className="success-banner">{message}</div>}

      <Panel
        title={'Invoice ' + invoiceNumber}
        subtitle={formatDate(startKey) + ' – ' + formatDate(endKey)}
        action={
          <button
            type="button"
            className="secondary compact"
            onClick={() => setRateEditing((value) => !value)}
          >
            {rateEditing ? 'Close rates' : 'Rates'}
          </button>
        }
      >
        {rateEditing && (
          <div className="invoice-rate-editor">
            <label className="field">
              <span>Hourly rate</span>
              <input
                inputMode="decimal"
                value={hourlyRate}
                onChange={(event) => setHourlyRate(event.target.value)}
              />
            </label>
            <label className="field">
              <span>Travel rate / KM</span>
              <input
                inputMode="decimal"
                value={fuelRate}
                onChange={(event) => setFuelRate(event.target.value)}
              />
            </label>
            <label className="field">
              <span>2-week anchor date</span>
              <input
                type="date"
                value={anchorDate}
                onChange={(event) => setAnchorDate(event.target.value)}
              />
            </label>
            <button
              type="button"
              className="primary compact"
              disabled={busy === 'settings'}
              onClick={() => void saveRates()}
            >
              {busy === 'settings' ? 'Saving…' : 'Save rates'}
            </button>
          </div>
        )}

        <div className="invoice-status-row">
          <div>
            <span>Invoice status</span>
            <strong className={'invoice-status-pill status-' + selectedStatus}>
              {invoiceStatusLabel(selectedStatus)}
            </strong>
          </div>
          <div className="invoice-status-buttons">
            {(['notSubmitted', 'submitted', 'paid'] as InvoiceStatus[]).map((status) => (
              <button
                type="button"
                key={status}
                className={
                  'invoice-status-button status-' +
                  status +
                  (selectedStatus === status ? ' active' : '')
                }
                disabled={busy === 'status'}
                onClick={() => void setStatus(status)}
              >
                {invoiceStatusLabel(status)}
              </button>
            ))}
          </div>
        </div>

        {baseline != null && selectedStatus !== 'notSubmitted' && (
          <div className="invoice-baseline">
            Marked {invoiceStatusLabel(selectedStatus).toLowerCase()} at {money(baseline)}
            {delta != null && Math.abs(delta) >= 0.01 && (
              <strong>
                Current change: {delta >= 0 ? '+' : '−'}{money(Math.abs(delta))}
              </strong>
            )}
          </div>
        )}

        <div className="stat-grid compact-stats invoice-stats">
          <StatCard label="Entries" value={String(entries.length)} />
          <StatCard label="Billable hours" value={(totals.billableMinutes / 60).toFixed(2)} detail="Includes note allowance" />
          <StatCard label="Earnings" value={money(totals.earnings)} detail={money(state.settings.hourlyRate) + '/hr'} />
          <StatCard label="KM" value={totals.kilometres.toFixed(1)} />
          <StatCard label="Travel $" value={money(totals.travel)} detail={money(state.settings.fuelRate) + '/km'} />
          <StatCard label="Invoice total" value={money(totals.total)} />
          <StatCard label="Clients" value={String(clients)} />
          <StatCard label="Missing notes" value={String(missingNotes)} />
          <StatCard label="Open actions" value={String(openActions)} />
        </div>

        <div className="invoice-actions">
          <button
            type="button"
            className="primary"
            disabled={!entries.length}
            onClick={() => {
              const opened = openInvoicePrintView({
                invoiceNumber,
                startKey,
                endKey,
                entries,
                hourlyRate: state.settings.hourlyRate,
                fuelRate: state.settings.fuelRate,
              });
              if (!opened) {
                setError('Invoice window was blocked. Allow pop-ups for NMRNL and try again.');
              }
            }}
          >
            Build Invoice / PDF
          </button>
          <button
            type="button"
            className="secondary"
            disabled={!entries.length || busy === 'drive'}
            onClick={() => void syncInvoiceDrive()}
          >
            {busy === 'drive'
              ? 'Syncing Drive…'
              : invoiceDriveMeta
                ? 'Re-sync Invoice to Drive'
                : 'Sync Invoice to Drive'}
          </button>
          {invoiceDriveMeta?.webViewLink && (
            <button
              type="button"
              className="secondary"
              onClick={() =>
                window.open(
                  invoiceDriveMeta.webViewLink,
                  '_blank',
                  'noopener,noreferrer',
                )
              }
            >
              Open Drive Folder
            </button>
          )}
        </div>
      </Panel>

      <Panel
        title="Google Drive"
        subtitle="Work notes are organised by client and invoice period. Invoice sync creates a summary document and links the period's support-note Google Docs."
      >
        <div className="drive-workflow-summary">
          <div className={'drive-status-dot ' + (state.drive.rootFolderId ? 'connected' : '')} />
          <div>
            <strong>{state.drive.rootFolderId ? 'Work Drive folders ready' : 'Connect Work Google Drive'}</strong>
            <small>
              {invoiceDriveMeta
                ? 'Invoice ' + invoiceNumber + ' was last synced ' + new Date(invoiceDriveMeta.updatedAt).toLocaleString()
                : 'Tap Sync Invoice to Drive above. Google will ask for Drive + Docs permission the first time.'}
            </small>
          </div>
        </div>
      </Panel>

      <Panel title="Invoice Money">
        <div className="invoice-money-tabs">
          <button
            className={moneyView === 'total' ? 'active' : ''}
            onClick={() => setMoneyView('total')}
          >
            Total Money
          </button>
          <button
            className={moneyView === 'owed' ? 'active' : ''}
            onClick={() => setMoneyView('owed')}
          >
            Money Owed
          </button>
        </div>
        <div className="invoice-money-value">
          {money(moneyView === 'total' ? totalMoney : owedMoney)}
        </div>
        <div className="invoice-money-chips">
          <span>Total {money(totalMoney)}</span>
          <span>Owed {money(owedMoney)}</span>
          <span>Paid {money(paidMoney)}</span>
        </div>
      </Panel>

      <Panel title={moneyView === 'owed' ? 'Submitted invoices still owed' : '2-week invoice periods'}>
        <div className="invoice-period-list">
          {rows
            .filter((row) => moneyView !== 'owed' || row.status === 'submitted')
            .map((row) => (
              <button
                type="button"
                key={row.key}
                className={'invoice-period-card ' + (row.key === selectedInvoiceKey ? 'selected' : '')}
                onClick={() => {
                  const diffDays = calendarDaysBetween(baseStart, row.start);
                  setOffset(floorDivide(diffDays, INVOICE_PERIOD_DAYS));
                }}
              >
                <span className="invoice-number">#{row.invoiceNumber}</span>
                <span className="invoice-period-main">
                  <strong>{formatDate(row.startKey)} – {formatDate(row.endKey)}</strong>
                  <small>
                    {row.entries.length} entries · {(row.totals.billableMinutes / 60).toFixed(2)} hrs · {row.totals.kilometres.toFixed(1)} km
                  </small>
                </span>
                <span className="invoice-period-money">
                  <strong>{money(row.totals.total)}</strong>
                  <small className={'status-' + row.status}>{invoiceStatusLabel(row.status)}</small>
                </span>
              </button>
            ))}
        </div>
      </Panel>

      <Panel title="Daily breakdown">
        {entries.length === 0 ? (
          <EmptyState title="No work recorded" detail="This invoice period has no Work entries." />
        ) : (
          <div className="pay-period-days">
            {Object.entries(byDay).map(([day, dayEntries]) => {
              const dayTotals = invoiceTotals(
                dayEntries,
                state.settings.hourlyRate,
                state.settings.fuelRate,
              );
              return (
                <div className="pay-period-day" key={day}>
                  <div className="pay-period-day-head">
                    <strong>{formatDate(day)}</strong>
                    <span>
                      {(dayTotals.billableMinutes / 60).toFixed(2)} h · {dayTotals.kilometres.toFixed(1)} km · {money(dayTotals.earnings + dayTotals.travel)}
                    </span>
                  </div>
                  {dayEntries.map((entry) => (
                    <div className="pay-period-entry invoice-entry-row" key={entry.id}>
                      <span>{entry.startTime}</span>
                      <strong>{entry.client}</strong>
                      <small>
                        {entryType(entry.type).shortLabel} · {entry.minutes}m visit · {entryBillableMinutes(entry)}m billable
                      </small>
                      <b>{money(
                        entryEarnings(entry, state.settings.hourlyRate) +
                          entryTravelReimbursement(entry, state.settings.fuelRate),
                      )}</b>
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


type DailyWorkPoint = {
  date: string;
  entries: number;
  billableHours: number;
  earnings: number;
  kilometres: number;
};

function workFortnightEntries(
  entries: WorkEntry[],
  start: Date,
): WorkEntry[] {
  const startKey = localDateValue(start);
  const endKey = localDateValue(addCalendarDays(start, 13));
  return entries.filter(
    (entry) =>
      entry.mode === 'work' &&
      entry.date >= startKey &&
      entry.date <= endKey,
  );
}

function dailyWorkPoints(
  entries: WorkEntry[],
  start: Date,
  hourlyRate: number,
): DailyWorkPoint[] {
  return Array.from({ length: 14 }, (_, index) => {
    const date = addCalendarDays(start, index);
    const key = localDateValue(date);
    const dayEntries = entries.filter((entry) => entry.date === key);

    return {
      date: key,
      entries: dayEntries.length,
      billableHours: dayEntries.reduce(
        (sum, entry) => sum + entryBillableHours(entry),
        0,
      ),
      earnings: dayEntries.reduce(
        (sum, entry) => sum + entryEarnings(entry, hourlyRate),
        0,
      ),
      kilometres: dayEntries.reduce(
        (sum, entry) => sum + entryKilometres(entry),
        0,
      ),
    };
  });
}

function percentage(done: number, total: number): number {
  if (total <= 0) return 100;
  return Math.max(0, Math.min(100, (done / total) * 100));
}

function TrendRow({
  label,
  current,
  delta,
  suffix = '',
  moneyDelta = false,
  whole = false,
}: {
  label: string;
  current: string;
  delta: number;
  suffix?: string;
  moneyDelta?: boolean;
  whole?: boolean;
}) {
  const positive = delta >= 0;
  const displayDelta = moneyDelta
    ? (positive ? '+' : '−') + money(Math.abs(delta))
    : (positive ? '+' : '−') +
      Math.abs(delta).toFixed(whole ? 0 : 1) +
      suffix;

  return (
    <div className="trend-row">
      <span>{label}</span>
      <strong>{current}</strong>
      <b className={positive ? 'positive' : 'negative'}>{displayDelta}</b>
    </div>
  );
}

function HealthBar({
  label,
  done,
  total,
  tone,
}: {
  label: string;
  done: number;
  total: number;
  tone: 'green' | 'purple' | 'amber';
}) {
  const progress = percentage(done, total);
  return (
    <div className="health-row">
      <div className="health-row-head">
        <strong>{label}</strong>
        <span>{Math.round(progress)}% · {done}/{total}</span>
      </div>
      <div className="health-track">
        <i className={tone} style={{ width: progress + '%' }} />
      </div>
    </div>
  );
}

function MiniBarChart({
  points,
  value,
  label,
}: {
  points: DailyWorkPoint[];
  value: (point: DailyWorkPoint) => number;
  label: string;
}) {
  const max = Math.max(1, ...points.map(value));
  return (
    <div className="mini-bar-chart" aria-label={label}>
      {points.map((point) => {
        const raw = value(point);
        const height = Math.max(raw > 0 ? 8 : 2, (raw / max) * 100);
        return (
          <div className="mini-bar-column" key={point.date} title={formatDate(point.date) + ': ' + raw.toFixed(2) + ' ' + label}>
            <div className="mini-bar-rail">
              <i style={{ height: height + '%' }} />
            </div>
            <small>{new Date(point.date + 'T12:00:00').getDate()}</small>
          </div>
        );
      })}
    </div>
  );
}

function CumulativeEarningsChart({
  points,
}: {
  points: DailyWorkPoint[];
}) {
  let running = 0;
  const cumulative = points.map((point) => {
    running += point.earnings;
    return running;
  });
  const max = Math.max(1, ...cumulative);
  const coords = cumulative.map((value, index) => {
    const x = points.length <= 1 ? 0 : (index / (points.length - 1)) * 100;
    const y = 92 - (value / max) * 82;
    return [x, y] as const;
  });
  const path = coords
    .map(([x, y], index) => (index === 0 ? 'M ' : 'L ') + x.toFixed(2) + ' ' + y.toFixed(2))
    .join(' ');

  return (
    <div className="earnings-chart">
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-label="Cumulative earnings">
        <path className="earnings-area" d={path + ' L 100 100 L 0 100 Z'} />
        <path className="earnings-line" d={path} />
      </svg>
      <div className="earnings-chart-footer">
        <span>{formatDate(points[0]?.date || localDateValue())}</span>
        <strong>{money(cumulative[cumulative.length - 1] || 0)}</strong>
        <span>{formatDate(points[points.length - 1]?.date || localDateValue())}</span>
      </div>
    </div>
  );
}

function BreakdownBars({
  rows,
}: {
  rows: Array<{ label: string; value: number; detail: string }>;
}) {
  const max = Math.max(1, ...rows.map((row) => row.value));
  if (!rows.length) {
    return <EmptyState title="No data yet" detail="This period has no Work entries." />;
  }

  return (
    <div className="breakdown-bars">
      {rows.map((row) => (
        <div className="breakdown-row" key={row.label}>
          <div>
            <strong>{row.label}</strong>
            <small>{row.detail}</small>
          </div>
          <div className="breakdown-track">
            <i style={{ width: Math.max(4, (row.value / max) * 100) + '%' }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function ChartsScreen({
  state,
  credentials,
  onState,
}: {
  state: WorkspaceState;
  credentials: WorkspaceCredentials;
  onState: (state: WorkspaceState) => void;
}) {
  const [offset, setOffset] = useState(0);
  const [goalEditing, setGoalEditing] = useState(false);
  const [goal, setGoal] = useState(String(state.settings.weeklyHoursGoal));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    setGoal(String(state.settings.weeklyHoursGoal));
  }, [state.settings.weeklyHoursGoal]);

  const baseStart = fortnightStartFor(
    new Date(),
    state.settings.payPeriodAnchorDate,
  );
  const start = addCalendarDays(baseStart, offset * 14);
  const end = addCalendarDays(start, 13);
  const previousStart = addCalendarDays(start, -14);
  const entries = workFortnightEntries(state.entries, start);
  const previous = workFortnightEntries(state.entries, previousStart);
  const points = dailyWorkPoints(entries, start, state.settings.hourlyRate);

  const billableHours = entries.reduce(
    (sum, entry) => sum + entryBillableHours(entry),
    0,
  );
  const previousHours = previous.reduce(
    (sum, entry) => sum + entryBillableHours(entry),
    0,
  );
  const earnings = entries.reduce(
    (sum, entry) => sum + entryEarnings(entry, state.settings.hourlyRate),
    0,
  );
  const previousEarnings = previous.reduce(
    (sum, entry) => sum + entryEarnings(entry, state.settings.hourlyRate),
    0,
  );
  const kilometres = entries.reduce(
    (sum, entry) => sum + entryKilometres(entry),
    0,
  );
  const previousKm = previous.reduce(
    (sum, entry) => sum + entryKilometres(entry),
    0,
  );
  const fuel = entries.reduce(
    (sum, entry) =>
      sum + entryTravelReimbursement(entry, state.settings.fuelRate),
    0,
  );
  const average = entries.length ? earnings / entries.length : 0;

  const noteReady = entries.filter((entry) =>
    hasSupportNoteContent(entry.supportNoteBreakdown),
  ).length;
  const calendarReady = entries.filter(
    (entry) => entry.googleCalendarEntered,
  ).length;
  const allActions = entries.flatMap((entry) => entry.nextActions);
  const completedActions = allActions.filter(
    (action) => Boolean(action.completedAt),
  ).length;

  const visitHours = entries.reduce(
    (sum, entry) => sum + Math.max(0, entry.minutes) / 60,
    0,
  );
  const noteHours = entries.reduce(
    (sum, entry) =>
      sum + Math.max(0, entryBillableMinutes(entry) - entry.minutes) / 60,
    0,
  );
  const totalTime = visitHours + noteHours;

  const weekOneHours = entries
    .filter((entry) => entry.date <= localDateValue(addCalendarDays(start, 6)))
    .reduce((sum, entry) => sum + entryBillableHours(entry), 0);
  const weekTwoHours = entries
    .filter((entry) => entry.date >= localDateValue(addCalendarDays(start, 7)))
    .reduce((sum, entry) => sum + entryBillableHours(entry), 0);

  const bestDay = [...points]
    .filter((point) => point.billableHours > 0)
    .sort((a, b) => b.billableHours - a.billableHours)[0];

  const clients = new Map<
    string,
    { hours: number; entries: number; earnings: number; kilometres: number }
  >();
  for (const entry of entries) {
    const current = clients.get(entry.client) || {
      hours: 0,
      entries: 0,
      earnings: 0,
      kilometres: 0,
    };
    current.hours += entryBillableHours(entry);
    current.entries += 1;
    current.earnings += entryEarnings(entry, state.settings.hourlyRate);
    current.kilometres += entryKilometres(entry);
    clients.set(entry.client, current);
  }
  const clientRows = [...clients.entries()]
    .map(([label, value]) => ({
      label,
      value: value.hours,
      detail:
        value.entries +
        ' entries · ' +
        value.hours.toFixed(2) +
        'h · ' +
        money(value.earnings),
    }))
    .sort((a, b) => b.value - a.value);

  const typeMap = new Map<string, number>();
  for (const entry of entries) {
    const label = entryType(entry.type).label;
    typeMap.set(label, (typeMap.get(label) || 0) + 1);
  }
  const typeRows = [...typeMap.entries()]
    .map(([label, value]) => ({
      label,
      value,
      detail: value + (value === 1 ? ' entry' : ' entries'),
    }))
    .sort((a, b) => b.value - a.value);

  const saveGoal = async () => {
    const parsed = Number(goal);
    if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 168) {
      setError('Weekly hours goal must be between 1 and 168.');
      return;
    }

    setBusy(true);
    setError('');
    setMessage('');
    try {
      onState(
        await updateWorkSettings(credentials, {
          hourlyRate: state.settings.hourlyRate,
          fuelRate: state.settings.fuelRate,
          payPeriodAnchorDate: state.settings.payPeriodAnchorDate,
          weeklyHoursGoal: parsed,
        }),
      );
      setGoalEditing(false);
      setMessage('Weekly Work goal saved.');
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : 'Could not save the weekly goal.',
      );
    } finally {
      setBusy(false);
    }
  };

  const goalValue = state.settings.weeklyHoursGoal || 10;
  const visitShare = totalTime > 0 ? (visitHours / totalTime) * 100 : 0;
  const noteShare = totalTime > 0 ? (noteHours / totalTime) * 100 : 0;

  return (
    <div className="page-stack">
      <section className="page-title">
        <div>
          <div className="eyebrow">WORK ANALYTICS</div>
          <h2>Charts & Insights</h2>
          <p>Fortnight trends, workflow health, client mix and billable time.</p>
        </div>
        <div className="period-controls">
          <button className="secondary compact" onClick={() => setOffset((value) => value - 1)}>← Previous</button>
          <button className="secondary compact" onClick={() => setOffset(0)}>Current</button>
          <button className="secondary compact" onClick={() => setOffset((value) => value + 1)}>Next →</button>
        </div>
      </section>

      {error && <div className="error-banner">{error}</div>}
      {message && <div className="success-banner">{message}</div>}

      <Panel
        title="Chart Period"
        subtitle={formatDate(localDateValue(start)) + ' – ' + formatDate(localDateValue(end))}
      >
        <div className="stat-grid compact-stats">
          <StatCard label="Entries" value={String(entries.length)} />
          <StatCard label="Hours" value={billableHours.toFixed(2)} />
          <StatCard label="Earned" value={money(earnings)} />
          <StatCard label="KM" value={kilometres.toFixed(1)} />
          <StatCard label="Fuel" value={money(fuel)} />
          <StatCard label="Avg / Entry" value={money(average)} />
        </div>
      </Panel>

      <div className="analytics-two-col">
        <Panel title="Trend vs Previous Fortnight">
          <div className="trend-list">
            <TrendRow label="Hours" current={billableHours.toFixed(2)} delta={billableHours - previousHours} suffix="h" />
            <TrendRow label="Earnings" current={money(earnings)} delta={earnings - previousEarnings} moneyDelta />
            <TrendRow label="Kilometres" current={kilometres.toFixed(1)} delta={kilometres - previousKm} suffix="km" />
            <TrendRow label="Visits" current={String(entries.length)} delta={entries.length - previous.length} whole />
          </div>
        </Panel>

        <Panel title="Workflow Health">
          <div className="health-list">
            <HealthBar label="Support notes ready" done={noteReady} total={entries.length} tone="green" />
            <HealthBar label="Calendar entered" done={calendarReady} total={entries.length} tone="purple" />
            <HealthBar label="Next actions complete" done={completedActions} total={allActions.length} tone="amber" />
          </div>
        </Panel>
      </div>

      <div className="analytics-two-col">
        <Panel title="Billable Time Mix">
          <div className="time-mix-stats">
            <div><span>Visit</span><strong>{visitHours.toFixed(2)}h</strong></div>
            <div><span>Notes</span><strong>{noteHours.toFixed(2)}h</strong></div>
          </div>
          <div className="mix-row">
            <span>Visit time</span><b>{Math.round(visitShare)}%</b>
            <div><i className="visit" style={{ width: visitShare + '%' }} /></div>
          </div>
          <div className="mix-row">
            <span>Note allowance</span><b>{Math.round(noteShare)}%</b>
            <div><i className="notes" style={{ width: noteShare + '%' }} /></div>
          </div>
        </Panel>

        <Panel
          title="Weekly Goal"
          action={
            <button className="text-button" onClick={() => setGoalEditing((value) => !value)}>
              {goalEditing ? 'Close' : 'Edit goal'}
            </button>
          }
        >
          {goalEditing && (
            <div className="goal-editor">
              <input inputMode="decimal" value={goal} onChange={(event) => setGoal(event.target.value)} />
              <button className="primary compact" disabled={busy} onClick={() => void saveGoal()}>
                {busy ? 'Saving…' : 'Save'}
              </button>
            </div>
          )}
          <div className="goal-block">
            <div><strong>Week 1</strong><span>{weekOneHours.toFixed(2)} / {goalValue.toFixed(1)}h</span></div>
            <div className="goal-track"><i style={{ width: Math.min(100, (weekOneHours / goalValue) * 100) + '%' }} /></div>
          </div>
          <div className="goal-block">
            <div><strong>Week 2</strong><span>{weekTwoHours.toFixed(2)} / {goalValue.toFixed(1)}h</span></div>
            <div className="goal-track"><i style={{ width: Math.min(100, (weekTwoHours / goalValue) * 100) + '%' }} /></div>
          </div>
        </Panel>
      </div>

      <Panel title="Fortnight Insights">
        <div className="insight-grid">
          <div><span>Best day</span><strong>{bestDay ? formatDate(bestDay.date) + ' · ' + bestDay.billableHours.toFixed(2) + 'h' : '—'}</strong></div>
          <div><span>Top client</span><strong>{clientRows[0] ? clientRows[0].label + ' · ' + clientRows[0].value.toFixed(2) + 'h' : '—'}</strong></div>
          <div><span>Average hours / entry</span><strong>{entries.length ? (billableHours / entries.length).toFixed(2) + 'h' : '0.00h'}</strong></div>
          <div><span>Fuel reimbursement</span><strong>{money(fuel)}</strong></div>
        </div>
      </Panel>

      {entries.length === 0 ? (
        <Panel title="Charts">
          <EmptyState title="No chart data" detail="Visual charts will populate after Work entries are saved in this period." />
        </Panel>
      ) : (
        <>
          <Panel title="Daily Activity Strip" subtitle="Each square represents one day in the selected fortnight">
            <div className="activity-strip">
              {points.map((point) => (
                <div className={'activity-day level-' + Math.min(4, point.entries)} key={point.date}>
                  <strong>{new Date(point.date + 'T12:00:00').getDate()}</strong>
                  <small>{point.entries}</small>
                </div>
              ))}
            </div>
          </Panel>

          <div className="analytics-two-col">
            <Panel title="Hours by Day"><MiniBarChart points={points} value={(point) => point.billableHours} label="hours" /></Panel>
            <Panel title="KM by Day"><MiniBarChart points={points} value={(point) => point.kilometres} label="km" /></Panel>
          </div>

          <Panel title="Cumulative Earnings"><CumulativeEarningsChart points={points} /></Panel>

          <div className="analytics-two-col">
            <Panel title="Client Hours"><BreakdownBars rows={clientRows} /></Panel>
            <Panel title="Entry Type Breakdown"><BreakdownBars rows={typeRows} /></Panel>
          </div>
        </>
      )}
    </div>
  );
}

function ReviewEntry({
  entry,
  actions,
}: {
  entry: WorkEntry;
  actions: ReactNode;
}) {
  const openActions = entry.nextActions.filter((action) => !action.completedAt).length;
  return (
    <div className="review-entry">
      <div className="review-entry-icon">{entryType(entry.type).icon}</div>
      <div className="review-entry-main">
        <strong>{entry.client}</strong>
        <span>{entryType(entry.type).label} · {formatDate(entry.date)} · {entry.startTime}</span>
        {entry.type === 'textNote' && (
          <small>
            {entry.textContactDirection} · {entry.importantText ? 'Important' : 'Not important'} · {entry.textReplyNeeded ? 'Reply needed' : 'No reply needed'}
          </small>
        )}
        {openActions > 0 && <small className="review-open-actions">{openActions} open action{openActions === 1 ? '' : 's'}</small>}
      </div>
      <div className="review-entry-actions">{actions}</div>
    </div>
  );
}

function ReviewSection({
  title,
  empty,
  entries,
  renderActions,
}: {
  title: string;
  empty: string;
  entries: WorkEntry[];
  renderActions: (entry: WorkEntry) => ReactNode;
}) {
  return (
    <Panel title={title}>
      {entries.length === 0 ? (
        <EmptyState title="All clear" detail={empty} />
      ) : (
        <div className="review-list">
          {entries.slice(0, 5).map((entry) => (
            <ReviewEntry key={entry.id} entry={entry} actions={renderActions(entry)} />
          ))}
          {entries.length > 5 && <div className="review-more">+{entries.length - 5} more</div>}
        </div>
      )}
    </Panel>
  );
}

function AdminReviewScreen({
  state,
  credentials,
  onState,
  go,
}: {
  state: WorkspaceState;
  credentials: WorkspaceCredentials;
  onState: (state: WorkspaceState) => void;
  go: (section: Section) => void;
}) {
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const entries = [...state.entries]
    .filter((entry) => entry.mode === 'work')
    .sort((a, b) => (b.date + b.startTime).localeCompare(a.date + a.startTime));
  const replyNeeded = entries.filter(
    (entry) => entry.type === 'textNote' && entry.textReplyNeeded,
  );
  const calendarGaps = entries.filter((entry) => !entry.googleCalendarEntered);
  const missingNotes = entries.filter(
    (entry) => !hasSupportNoteContent(entry.supportNoteBreakdown),
  );
  const openActions = entries.filter((entry) =>
    entry.nextActions.some((action) => !action.completedAt),
  );
  const recentCutoff = todayStart() - 6 * 86_400_000;
  const recentImportantTexts = entries.filter(
    (entry) =>
      entry.type === 'textNote' &&
      entry.importantText &&
      new Date(entry.date + 'T12:00:00').getTime() >= recentCutoff,
  );

  const resolveEntry = async (
    entry: WorkEntry,
    clearReplyNeeded: boolean,
  ) => {
    setBusy('resolve:' + entry.id);
    setError('');
    setMessage('');
    try {
      onState(
        await resolveEntryAdmin(credentials, entry.id, {
          completeActions: true,
          clearReplyNeeded,
        }),
      );
      setMessage('Admin item completed for ' + entry.client + '.');
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : 'Could not complete that admin item.',
      );
    } finally {
      setBusy('');
    }
  };

  const createEvent = async (entry: WorkEntry) => {
    setBusy('calendar:' + entry.id);
    setError('');
    setMessage('');

    const popup = window.open(
      googleCalendarDraftUrl(entry),
      '_blank',
      'noopener,noreferrer',
    );
    if (!popup) {
      setBusy('');
      setError('Google Calendar was blocked. Allow pop-ups for NMRNL and try again.');
      return;
    }

    try {
      onState(await setEntryCalendarEntered(credentials, entry.id, true));
      setMessage('Calendar draft opened for ' + entry.client + '.');
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : 'Calendar opened, but NMRNL could not update the entry.',
      );
    } finally {
      setBusy('');
    }
  };

  const openDrive = () => {
    if (!state.drive.rootFolderId) {
      go('payPeriod');
      return;
    }
    window.open(
      'https://drive.google.com/drive/folders/' + encodeURIComponent(state.drive.rootFolderId),
      '_blank',
      'noopener,noreferrer',
    );
  };

  return (
    <div className="page-stack">
      <section className="page-title">
        <div>
          <div className="eyebrow">FINISH WORK ADMIN</div>
          <h2>Admin Review</h2>
          <p>One place for replies, calendar gaps, unfinished notes and next actions.</p>
        </div>
      </section>

      {error && <div className="error-banner">{error}</div>}
      {message && <div className="success-banner">{message}</div>}

      <div className="stat-grid compact-stats">
        <StatCard label="Replies" value={String(replyNeeded.length)} />
        <StatCard label="Calendar" value={String(calendarGaps.length)} />
        <StatCard label="Notes" value={String(missingNotes.length)} />
        <StatCard label="Actions" value={String(openActions.length)} />
      </div>

      <Panel title="Finish Admin">
        <div className="finish-admin-grid">
          <button className="primary" onClick={() => go('quick')}>＋ Add Entry</button>
          <button className="secondary" onClick={() => go('entries')}>✎ Edit Entries</button>
          <button className="secondary" onClick={() => go('calendar')}>▦ Calendar</button>
          <button className="secondary" onClick={openDrive}>
            {state.drive.rootFolderId ? '◫ Open Drive' : '◫ Set up Drive'}
          </button>
        </div>
      </Panel>

      <ReviewSection
        title="Texts Needing Reply"
        empty="No written-contact replies waiting."
        entries={replyNeeded}
        renderActions={(entry) => (
          <>
            <button
              className="secondary compact"
              disabled={busy === 'resolve:' + entry.id}
              onClick={() => void resolveEntry(entry, true)}
            >
              ✓ Mark reply done
            </button>
            <button className="secondary compact" onClick={() => go('entries')}>Edit</button>
          </>
        )}
      />

      <ReviewSection
        title="Needs Calendar"
        empty="All saved entries are marked in calendar."
        entries={calendarGaps}
        renderActions={(entry) => (
          <>
            <button
              className="secondary compact"
              disabled={busy === 'calendar:' + entry.id}
              onClick={() => void createEvent(entry)}
            >
              ▦ Create event
            </button>
            <button className="secondary compact" onClick={() => go('calendar')}>Calendar</button>
          </>
        )}
      />

      <ReviewSection
        title="Missing Note Detail"
        empty="All entries have support-note detail."
        entries={missingNotes}
        renderActions={() => (
          <button className="secondary compact" onClick={() => go('notes')}>Create note</button>
        )}
      />

      <ReviewSection
        title="Open Next Actions"
        empty="No open next actions."
        entries={openActions}
        renderActions={(entry) => (
          <>
            <button
              className="secondary compact"
              disabled={busy === 'resolve:' + entry.id}
              onClick={() => void resolveEntry(entry, entry.type === 'textNote')}
            >
              ✓ Mark done
            </button>
            <button className="secondary compact" onClick={() => go('actions')}>Actions</button>
          </>
        )}
      />

      <ReviewSection
        title="Important Texts"
        empty="No important written contacts in the last 7 days."
        entries={recentImportantTexts}
        renderActions={() => (
          <button className="secondary compact" onClick={() => go('entries')}>Review</button>
        )}
      />
    </div>
  );
}

function NotesScreen({
  state,
  credentials,
  onState,
  go,
}: {
  state: WorkspaceState;
  credentials: WorkspaceCredentials;
  onState: (state: WorkspaceState) => void;
  go: (section: Section) => void;
}) {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<
    'all' | 'needsNote' | 'inProgress' | 'finished' | 'submitted'
  >('all');
  const [selected, setSelected] = useState<WorkEntry | null>(null);

  const workEntries = useMemo(
    () =>
      [...state.entries]
        .filter((entry) => entry.mode === 'work')
        .sort((left, right) =>
          (right.date + right.startTime).localeCompare(
            left.date + left.startTime,
          ),
        ),
    [state.entries],
  );

  const counts = {
    needsNote: workEntries.filter(
      (entry) => !hasSupportNoteContent(entry.supportNoteBreakdown),
    ).length,
    inProgress: workEntries.filter(
      (entry) => supportNoteStatus(entry) === 'inProgress',
    ).length,
    finished: workEntries.filter(
      (entry) => supportNoteStatus(entry) === 'finished',
    ).length,
    submitted: workEntries.filter(
      (entry) => supportNoteStatus(entry) === 'submitted',
    ).length,
  };

  const visibleEntries = useMemo(() => {
    const needle = search.trim().toLowerCase();

    return workEntries
      .filter((entry) => {
        const status = supportNoteStatus(entry);
        if (
          filter === 'needsNote' &&
          hasSupportNoteContent(entry.supportNoteBreakdown)
        ) {
          return false;
        }
        if (filter === 'inProgress' && status !== 'inProgress') return false;
        if (filter === 'finished' && status !== 'finished') return false;
        if (filter === 'submitted' && status !== 'submitted') return false;

        if (!needle) return true;
        return (
          entry.client.toLowerCase().includes(needle) ||
          entryType(entry.type).label.toLowerCase().includes(needle) ||
          entry.supportNoteBreakdown.toLowerCase().includes(needle)
        );
      })
      .sort((left, right) => {
        const leftMissing = hasSupportNoteContent(left.supportNoteBreakdown)
          ? 1
          : 0;
        const rightMissing = hasSupportNoteContent(right.supportNoteBreakdown)
          ? 1
          : 0;
        if (leftMissing !== rightMissing) return leftMissing - rightMissing;
        return (right.date + right.startTime).localeCompare(
          left.date + left.startTime,
        );
      });
  }, [workEntries, search, filter]);

  return (
    <div className="page-stack">
      <section className="page-title">
        <div>
          <div className="eyebrow">WORK NOTES</div>
          <h2>Create Support Note</h2>
          <p>
            Choose a Work entry, complete the gold-standard template, then save
            it in NMRNL or create the Google Doc.
          </p>
        </div>
        <button className="secondary" onClick={() => go('quick')}>
          + New Work Entry
        </button>
      </section>

      <div className="stat-grid compact-stats">
        <StatCard label="Need note" value={String(counts.needsNote)} />
        <StatCard label="In progress" value={String(counts.inProgress)} />
        <StatCard label="Finished" value={String(counts.finished)} />
        <StatCard label="Submitted" value={String(counts.submitted)} />
      </div>

      <Panel
        title="Choose the Work entry"
        subtitle="Entries needing a note are shown first."
      >
        <div className="note-create-filter">
          <input
            className="search-input"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search client or Work type…"
          />
          <div className="note-filter-tabs">
            {[
              ['all', 'All'],
              ['needsNote', 'Need note'],
              ['inProgress', 'In progress'],
              ['finished', 'Finished'],
              ['submitted', 'Submitted'],
            ].map(([key, label]) => (
              <button
                type="button"
                key={key}
                className={filter === key ? 'active' : ''}
                onClick={() =>
                  setFilter(
                    key as
                      | 'all'
                      | 'needsNote'
                      | 'inProgress'
                      | 'finished'
                      | 'submitted',
                  )
                }
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </Panel>

      {workEntries.length === 0 ? (
        <Panel title="Support notes">
          <EmptyState
            title="No Work entries yet"
            detail="Create or finish a Work entry first. The note template uses its client, date, time, type and duration automatically."
            action={
              <button className="primary" onClick={() => go('quick')}>
                Create Work entry
              </button>
            }
          />
        </Panel>
      ) : visibleEntries.length === 0 ? (
        <Panel title="Support notes">
          <EmptyState
            title="No matching notes"
            detail="Try another filter or search."
          />
        </Panel>
      ) : (
        <div className="note-create-list">
          {visibleEntries.map((entry) => {
            const status = supportNoteStatus(entry);
            const hasNote = hasSupportNoteContent(entry.supportNoteBreakdown);
            const driveMeta = state.driveSupportNotes[entry.id];

            return (
              <article className="note-create-card" key={entry.id}>
                <div className="note-create-icon">
                  {entryType(entry.type).icon}
                </div>
                <div className="note-create-main">
                  <div className="note-create-title">
                    <div>
                      <h3>{entry.client}</h3>
                      <p>
                        {entryType(entry.type).label} · {formatDate(entry.date)} ·{' '}
                        {entry.startTime} · {entry.minutes} min
                      </p>
                    </div>
                    <span
                      className={
                        'support-note-chip static status-' + status
                      }
                    >
                      {supportNoteStatusLabel(status)}
                    </span>
                  </div>

                  <div className="note-create-meta">
                    <span>
                      {hasNote ? '✓ Note content saved' : '○ Template ready'}
                    </span>
                    <span>
                      {driveMeta ? '✓ Google Doc linked' : '○ Not in Drive'}
                    </span>
                  </div>

                  {hasNote && (
                    <pre className="note-create-preview">
                      {entry.supportNoteBreakdown}
                    </pre>
                  )}

                  <div className="note-create-actions">
                    <button
                      type="button"
                      className={hasNote ? 'secondary' : 'primary'}
                      onClick={() => setSelected(entry)}
                    >
                      {hasNote ? 'Edit Note' : 'Create Note'}
                    </button>
                    {driveMeta?.webViewLink && (
                      <button
                        type="button"
                        className="secondary"
                        onClick={() =>
                          window.open(
                            driveMeta.webViewLink,
                            '_blank',
                            'noopener,noreferrer',
                          )
                        }
                      >
                        Open Google Doc
                      </button>
                    )}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {selected && (
        <SupportNoteModal
          entry={selected}
          state={state}
          credentials={credentials}
          onState={onState}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}

function EntriesScreen({
  state,
  mode,
  credentials,
  onState,
  go,
}: {
  state: WorkspaceState;
  mode: Mode;
  credentials: WorkspaceCredentials;
  onState: (state: WorkspaceState) => void;
  go: (section: Section) => void;
}) {
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | EntryTypeKey>('all');
  const [busyId, setBusyId] = useState('');
  const [editing, setEditing] = useState<WorkEntry | null>(null);
  const [supportNoteEntry, setSupportNoteEntry] = useState<WorkEntry | null>(null);
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
          <p>Search visits, contacts and Work notes from one place.</p>
        </div>
        <button className="primary" type="button" onClick={() => go('notes')}>
          Create Note
        </button>
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
                      className={'support-note-chip status-' + supportNoteStatus(entry)}
                      onClick={() => setSupportNoteEntry(entry)}
                      title="Open support note"
                      type="button"
                    >
                      ◫ {supportNoteStatusLabel(supportNoteStatus(entry))}
                    </button>
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
                        <span>
                          Support note · {supportNoteStatusLabel(supportNoteStatus(entry))}
                        </span>
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

      {supportNoteEntry && (
        <SupportNoteModal
          entry={supportNoteEntry}
          state={state}
          credentials={credentials}
          onState={onState}
          onClose={() => setSupportNoteEntry(null)}
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
            <strong>Private NMRNL account</strong>
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
  const mode: Mode = 'work';
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
          <strong>Opening NMRNL workspace…</strong>
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
    { key: 'notes', label: 'Notes', icon: '▧' },
    { key: 'calendar', label: 'Calendar', icon: '▦' },
    { key: 'payPeriod', label: 'Pay Period', icon: '◫' },
    { key: 'adminReview', label: 'Review', icon: '◎' },
    { key: 'charts', label: 'Charts', icon: '▥' },
    { key: 'actions', label: 'Actions', icon: '✓' },
  ];

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <button className="brand" onClick={() => setSection('home')}>
          <span className="brand-mark small">N</span>
          <span>
            <strong>NMRNL</strong>
            <small>Work</small>
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
          <span>Work mode</span>
          <strong>Cloud saved</strong>
        </div>
      </aside>

      <section className="main-column">
        <header className="topbar">
          <div className="mobile-brand">
            <span className="brand-mark tiny">N</span>
            <strong>NMRNL</strong>
          </div>

          <div className="mode-switcher" aria-label="Work mode">
            <button className="active" type="button" disabled>
              Work
            </button>
          </div>

          <button
            type="button"
            className={'sync-pill ' + (state.activeVisit ? 'visit-running' : '')}
            onClick={() => state.activeVisit && setSection('quick')}
          >
            <span />
            {state.activeVisit ? 'Visit running' : 'Cloud saved'}
          </button>
        </header>

        {error && <div className="global-error">{error}</div>}

        {!state.security.productionReady && (
          <div className="security-warning">
            <div className="security-warning-icon">!</div>
            <div>
              <strong>Development security mode</strong>
              <span>
                {state.security.temporaryLoginBypass &&
                  'Login protection is temporarily bypassed. '}
                {!state.security.applicationEncryption &&
                  'Application-level data encryption is not configured. '}
                Do not store real client information until both protections are enabled.
              </span>
            </div>
          </div>
        )}

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
              go={setSection}
            />
          )}
          {section === 'notes' && (
            <NotesScreen
              state={state}
              credentials={credentials}
              onState={setState}
              go={setSection}
            />
          )}
          {section === 'calendar' && (
            <CalendarScreen
              state={state}
              credentials={credentials}
              onState={setState}
            />
          )}
          {section === 'payPeriod' && (
            <PayPeriodScreen
              state={state}
              credentials={credentials}
              onState={setState}
            />
          )}
          {section === 'adminReview' && (
            <AdminReviewScreen
              state={state}
              credentials={credentials}
              onState={setState}
              go={setSection}
            />
          )}
          {section === 'charts' && (
            <ChartsScreen
              state={state}
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
        </div>

        <nav className="bottom-nav">
          {navItems.map((item) => (
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
