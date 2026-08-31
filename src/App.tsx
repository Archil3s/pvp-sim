import {
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';

import {
  clearCredentials,
  createEntry,
  createGeneralAction,
  createWorkspace,
  deleteEntry,
  fetchWorkspace,
  loadCredentials,
  saveCredentials,
  setGeneralActionCompleted,
  setVisitActionCompleted,
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
  type EntryDraft,
  type EntryTypeKey,
  type GeneralAction,
  type Mode,
  type Section,
  type TextContactDirection,
  type WorkEntry,
  type WorkspaceCredentials,
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

function WorkspaceSetup({
  onConnected,
}: {
  onConnected: (credentials: WorkspaceCredentials, state: WorkspaceState) => void;
}) {
  const [workspaceId, setWorkspaceId] = useState('');
  const [ownerToken, setOwnerToken] = useState('');
  const [busy, setBusy] = useState<'create' | 'connect' | null>(null);
  const [error, setError] = useState('');

  const create = async () => {
    setBusy('create');
    setError('');
    try {
      const result = await createWorkspace();
      saveCredentials(result.credentials);
      onConnected(result.credentials, result.state);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not create workspace.');
    } finally {
      setBusy(null);
    }
  };

  const connect = async (event: FormEvent) => {
    event.preventDefault();
    const credentials = {
      workspaceId: workspaceId.trim(),
      ownerToken: ownerToken.trim(),
    };
    if (!credentials.workspaceId || !credentials.ownerToken) return;

    setBusy('connect');
    setError('');
    try {
      const state = await fetchWorkspace(credentials);
      saveCredentials(credentials);
      onConnected(credentials, state);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not open workspace.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <main className="setup-shell">
      <section className="setup-card">
        <div className="brand-mark">N</div>
        <div className="eyebrow">PRIVATE CLOUDFLARE WORKSPACE</div>
        <h1>NMRNL</h1>
        <p className="setup-lead">
          A web-first support work log for visits, contacts, case notes and follow-up
          actions.
        </p>

        {error && <div className="error-banner">{error}</div>}

        <button className="primary big" onClick={create} disabled={busy !== null}>
          {busy === 'create' ? 'Creating…' : 'Create private workspace'}
        </button>

        <div className="setup-divider"><span>or open an existing workspace</span></div>

        <form className="setup-form" onSubmit={connect}>
          <label>
            Workspace ID
            <input
              value={workspaceId}
              onChange={(event) => setWorkspaceId(event.target.value)}
              placeholder="16-character workspace ID"
              autoComplete="off"
            />
          </label>
          <label>
            Owner key
            <input
              value={ownerToken}
              onChange={(event) => setOwnerToken(event.target.value)}
              placeholder="Private owner key"
              type="password"
              autoComplete="off"
            />
          </label>
          <button className="secondary" disabled={busy !== null}>
            {busy === 'connect' ? 'Opening…' : 'Open workspace'}
          </button>
        </form>

        <p className="privacy-note">
          Your owner key is stored only in this browser. NMRNL requires it for every
          workspace request. Back it up from the Workspace screen after setup.
        </p>
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
  disconnect,
}: {
  credentials: WorkspaceCredentials;
  state: WorkspaceState;
  disconnect: () => void;
}) {
  const [showKey, setShowKey] = useState(false);
  const [copied, setCopied] = useState('');

  const copy = async (label: string, value: string) => {
    await navigator.clipboard.writeText(value);
    setCopied(label);
    window.setTimeout(() => setCopied(''), 1800);
  };

  return (
    <div className="page-stack">
      <section className="page-title">
        <div>
          <div className="eyebrow">PRIVATE WORKSPACE</div>
          <h2>Workspace</h2>
          <p>Back up these details before signing in on another device.</p>
        </div>
      </section>

      <Panel title="Workspace credentials" subtitle="Treat the owner key like a password">
        <div className="credential-list">
          <div>
            <span>Workspace ID</span>
            <code>{credentials.workspaceId}</code>
            <button className="secondary compact" onClick={() => void copy('id', credentials.workspaceId)}>
              {copied === 'id' ? 'Copied' : 'Copy'}
            </button>
          </div>
          <div>
            <span>Owner key</span>
            <code>{showKey ? credentials.ownerToken : '••••••••••••••••••••••••••••••••'}</code>
            <div className="credential-actions">
              <button className="secondary compact" onClick={() => setShowKey((value) => !value)}>
                {showKey ? 'Hide' : 'Show'}
              </button>
              <button className="secondary compact" onClick={() => void copy('key', credentials.ownerToken)}>
                {copied === 'key' ? 'Copied' : 'Copy'}
              </button>
            </div>
          </div>
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
            <strong>Disconnect workspace</strong>
            <p>This removes the workspace ID and owner key from this browser only. Cloud data is not deleted.</p>
          </div>
          <button className="danger-button" onClick={disconnect}>Disconnect</button>
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
          setError(
            reason instanceof Error
              ? reason.message
              : 'Could not open the saved NMRNL workspace.',
          );
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
              disconnect={() => {
                if (!window.confirm('Disconnect NMRNL from this browser? Make sure you backed up the owner key first.')) return;
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
