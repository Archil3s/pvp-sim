import { useEffect, useMemo, useState } from 'react';
import {
  fetchWorkspace,
  loadCredentials,
  openTemporaryWorkspace,
  updateSupportNote,
} from './api';
import {
  entryType,
  formatDate,
  type SupportNoteStatus,
  type WorkEntry,
  type WorkspaceCredentials,
  type WorkspaceState,
} from './model';
import {
  ensureStructuredSupportNote,
  parseStructuredSupportNote,
  updateStructuredSupportSection,
} from './supportNoteTemplate';

const ATTENDANCE_OPTIONS = [
  'Client',
  'Support worker',
  'Social worker',
  'Social support worker',
  'Whanau / family',
  'Agency worker',
  'Peer support',
  'Supervisor / manager',
  'Other professional',
];

const SUPPORT_TAGS = [
  'Attendance support worker',
  '2-up visit',
  'Worked on goals',
  'Worked on housing diary',
  'Visited house viewings',
  'Potential pet',
  'Rubbish piling up',
  'Home messy',
];

const BLENHEIM_AGENCIES = [
  'Police / emergency services',
  'Fire and Emergency NZ',
  'Hato Hone St John',
  'Wairau Hospital / Emergency Department',
  'Marlborough Urgent Care',
  'Te Whatu Ora / Nelson Marlborough',
  'Marlborough PHO / Kimi Hauora Wairau',
  'Community Mental Health',
  'Mental Health Crisis Team',
  'Witherlea House / Adult Mental Health',
  'CAMHS',
  'Supporting Families Marlborough',
  'CARE Marlborough',
  'GP / medical centre',
  'Marlborough Sexual Violence Support Centre',
  'SASH Blenheim',
  "Marlborough Women's Refuge",
  'Victim Support',
  'Oranga Tamariki',
  'Barnardos Marlborough',
  'Birthright Marlborough',
  'Open Home Foundation Marlborough',
  'Wairau Youth and Family Trust',
  'Marlborough Youth Trust',
  'Youthline',
  'WINZ / MSD Blenheim',
  'Kainga Ora',
  'Housing First Blenheim',
  'Housing provider',
  'Marlborough District Council',
  'Te Piki Oranga',
  'Maataa Waka ki Te Tau Ihu Trust',
  'Marlborough Pacific Trust',
  'Marlborough Multicultural Centre',
  'MFR Voice',
  'Rainbow Marlborough / rainbow community support',
  'Salvation Army',
  "Crossroads / John's Kitchen",
  'Citizens Advice Bureau Marlborough',
  'Community Law Marlborough',
  'Presbyterian Support Marlborough / Family Works',
  'Access Community Health',
  'Age Concern Marlborough',
  'Tautoko Community Trust',
  'Maternal Wellbeing Marlborough',
  'ACC sensitive claims counselling',
  'Counselling service',
  'School / education',
  'Probation / Corrections',
  'Other local agency or service',
];

async function loadCloud(): Promise<{
  credentials: WorkspaceCredentials;
  state: WorkspaceState;
}> {
  const credentials = loadCredentials();
  if (credentials) return { credentials, state: await fetchWorkspace(credentials) };
  return openTemporaryWorkspace();
}

function status(entry: WorkEntry): SupportNoteStatus {
  return entry.supportNoteStatus || (entry.supportNoteBreakdown.trim() ? 'inProgress' : 'incomplete');
}

function appendUnique(current: string, value: string): string {
  const lines = current.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (!lines.some((line) => line.toLowerCase() === value.toLowerCase())) lines.push(value);
  return lines.join('\n');
}

export function SupportContextHub() {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<WorkspaceState | null>(null);
  const [credentials, setCredentials] = useState<WorkspaceCredentials | null>(null);
  const [selectedId, setSelectedId] = useState('');
  const [agencySearch, setAgencySearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const refresh = async () => {
    setBusy(true);
    setError('');
    try {
      const loaded = await loadCloud();
      setCredentials(loaded.credentials);
      setState(loaded.state);
      const entries = loaded.state.entries
        .filter((entry) => entry.mode === 'work')
        .sort((a, b) => (b.date + b.startTime).localeCompare(a.date + a.startTime));
      if (!selectedId && entries[0]) setSelectedId(entries[0].id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not load Work entries.');
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (open) void refresh();
  }, [open]);

  const entries = useMemo(
    () =>
      (state?.entries || [])
        .filter((entry) => entry.mode === 'work')
        .sort((a, b) => (b.date + b.startTime).localeCompare(a.date + a.startTime)),
    [state],
  );
  const selected = entries.find((entry) => entry.id === selectedId) || entries[0] || null;
  const agencies = BLENHEIM_AGENCIES.filter((agency) =>
    agency.toLowerCase().includes(agencySearch.trim().toLowerCase()),
  );

  const saveSection = async (
    heading: 'Attendance' | 'What happened' | 'Referrals',
    value: string,
  ) => {
    if (!selected || !credentials) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const structured = ensureStructuredSupportNote(selected.supportNoteBreakdown);
      const sections = parseStructuredSupportNote(structured);
      const nextValue = appendUnique(sections[heading], value);
      const noteText = updateStructuredSupportSection(structured, heading, nextValue);
      const next = await updateSupportNote(credentials, selected.id, {
        personName: selected.supportNotePersonName?.trim() || selected.client,
        status: status(selected) === 'incomplete' ? 'inProgress' : status(selected),
        noteText,
      });
      setState(next);
      setMessage(`Added “${value}” to ${heading}.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not update support note.');
    } finally {
      setBusy(false);
    }
  };

  return <>
    <button className="context-launcher" type="button" onClick={() => setOpen(true)}>
      <span>＋</span><strong>Note context</strong>
    </button>
    {open && <div className="context-overlay" role="dialog" aria-modal="true">
      <div className="context-shell">
        <header>
          <div><span>PORTED FROM SUPPORT WORKER LOG</span><h2>Quick note context</h2><p>Add attendance, common visit context and Blenheim referrals without retyping them.</p></div>
          <button onClick={() => setOpen(false)}>×</button>
        </header>
        {error && <div className="context-error">{error}</div>}
        {message && <div className="context-success">{message}</div>}
        <main>
          <label className="context-entry-select"><span>Work entry</span><select value={selected?.id || ''} onChange={(event) => setSelectedId(event.target.value)}>{entries.map((entry) => <option key={entry.id} value={entry.id}>{formatDate(entry.date)} · {entry.startTime} · {entry.client} · {entryType(entry.type).shortLabel}</option>)}</select></label>
          {!selected ? <p className="context-empty">No Work entries yet.</p> : <>
            <section><div className="context-section-head"><div><span>Attendance</span><h3>Who was present?</h3></div></div><div className="context-chip-grid">{ATTENDANCE_OPTIONS.map((item) => <button disabled={busy} key={item} onClick={() => void saveSection('Attendance', item)}>{item}</button>)}</div></section>
            <section><div className="context-section-head"><div><span>Common context</span><h3>Visit tags</h3></div></div><div className="context-chip-grid">{SUPPORT_TAGS.map((item) => <button disabled={busy} key={item} onClick={() => void saveSection('What happened', item)}>{item}</button>)}</div></section>
            <section><div className="context-section-head"><div><span>Blenheim</span><h3>Agency / referral</h3></div></div><input value={agencySearch} onChange={(event) => setAgencySearch(event.target.value)} placeholder="Search local agency…"/><div className="context-agency-list">{agencies.map((agency) => <button disabled={busy} key={agency} onClick={() => void saveSection('Referrals', agency)}>{agency}</button>)}</div></section>
          </>}
        </main>
        <footer><span>{selected ? `${selected.client} · ${status(selected)}` : 'No entry selected'}</span><button disabled={busy} onClick={() => void refresh()}>{busy ? 'Saving…' : 'Refresh cloud data'}</button></footer>
      </div>
    </div>}
  </>;
}
