import { useEffect, useMemo, useState } from 'react';
import {
  fetchWorkspace,
  loadCredentials,
  openTemporaryWorkspace,
} from './api';
import {
  entryBillableHours,
  entryEarnings,
  entryKilometres,
  entryTravelReimbursement,
  entryType,
  formatDate,
  localDateValue,
  type WorkEntry,
  type WorkspaceState,
} from './model';
import { goldStandardTemplatePlainText } from './supportNoteTemplate';

type ReportTab = 'overview' | 'notes' | 'invoice';

const PERIOD_DAYS = 14;
const FIRST_INVOICE_NUMBER = 5;

function addDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days, 12);
}

function calendarDaysBetween(start: Date, end: Date): number {
  const a = Date.UTC(start.getFullYear(), start.getMonth(), start.getDate());
  const b = Date.UTC(end.getFullYear(), end.getMonth(), end.getDate());
  return Math.round((b - a) / 86_400_000);
}

function fortnightStart(date: Date, anchorText: string): Date {
  const anchor = new Date(anchorText + 'T12:00:00');
  const normalized = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12);
  const offset = Math.floor(calendarDaysBetween(anchor, normalized) / PERIOD_DAYS);
  return addDays(anchor, offset * PERIOD_DAYS);
}

function invoiceNumber(start: Date, anchorText: string): number {
  const anchor = fortnightStart(new Date(anchorText + 'T12:00:00'), anchorText);
  return FIRST_INVOICE_NUMBER + Math.floor(calendarDaysBetween(anchor, start) / PERIOD_DAYS);
}

function money(value: number): string {
  return new Intl.NumberFormat('en-NZ', {
    style: 'currency',
    currency: 'NZD',
  }).format(Number.isFinite(value) ? value : 0);
}

function totals(entries: WorkEntry[], hourlyRate: number, fuelRate: number) {
  const billableHours = entries.reduce((sum, entry) => sum + entryBillableHours(entry), 0);
  const kilometres = entries.reduce((sum, entry) => sum + entryKilometres(entry), 0);
  const earnings = entries.reduce((sum, entry) => sum + entryEarnings(entry, hourlyRate), 0);
  const travel = entries.reduce((sum, entry) => sum + entryTravelReimbursement(entry, fuelRate), 0);
  return { billableHours, kilometres, earnings, travel, total: earnings + travel };
}

function supportNoteEntered(entry: WorkEntry): boolean {
  const value = entry.supportNoteBreakdown.trim();
  if (!value) return false;
  const headings = new Set([
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
  return value
    .split(/\r?\n/)
    .some((line) => line.trim() && !headings.has(line.trim().replace(/:$/, '').toLowerCase()));
}

async function loadCloudState(): Promise<WorkspaceState> {
  const credentials = loadCredentials();
  if (credentials) return fetchWorkspace(credentials);
  return (await openTemporaryWorkspace()).state;
}

function safeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function printDocument(title: string, body: string, extraCss = ''): void {
  const popup = window.open('', '_blank', 'noopener,noreferrer');
  if (!popup) throw new Error('The report window was blocked. Allow pop-ups for NMRNL and try again.');
  popup.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${safeHtml(title)}</title><meta name="viewport" content="width=device-width,initial-scale=1"><style>
    *{box-sizing:border-box} body{margin:0;background:#eef0f4;color:#111;font-family:Arial,Helvetica,sans-serif} .paper{width:min(210mm,100%);min-height:297mm;margin:18px auto;background:#fff;padding:14mm;box-shadow:0 8px 30px rgba(0,0,0,.12)}
    h1,h2,h3,p{margin-top:0} .actions{position:sticky;top:0;padding:10px;background:#111827;color:white;text-align:center}.actions button{padding:10px 16px;border:0;border-radius:8px;font-weight:700}.pre{white-space:pre-wrap;line-height:1.45;font-size:12px}
    ${extraCss}
    @media print{body{background:#fff}.actions{display:none}.paper{box-shadow:none;margin:0;width:auto;min-height:auto;padding:10mm}@page{size:A4;margin:0}}
  </style></head><body><div class="actions"><button onclick="window.print()">Print / Save PDF</button></div><main class="paper">${body}</main></body></html>`);
  popup.document.close();
}

function printSupportNote(entry: WorkEntry): void {
  const text = goldStandardTemplatePlainText(
    entry,
    entry.supportNotePersonName?.trim() || entry.client,
    entry.supportNoteBreakdown,
  );
  printDocument(
    `${entry.client} - ${entry.date} - Support Note`,
    `<div class="pre">${safeHtml(text)}</div>`,
  );
}

function printInvoice(input: {
  number: number;
  startKey: string;
  endKey: string;
  entries: WorkEntry[];
  hourlyRate: number;
  fuelRate: number;
}): void {
  const summary = totals(input.entries, input.hourlyRate, input.fuelRate);
  const blankRows = Array.from({ length: 14 }, () => '<tr><td>&nbsp;</td><td></td><td></td><td></td></tr>').join('');
  const body = `
    <section class="invoice-head">
      <div class="invoice-from"><strong>NMRNL Work</strong><span>Peer support services</span></div>
      <div class="invoice-title"><h1>INVOICE</h1><strong>INVOICE ${input.number}</strong><span>DATE: ${safeHtml(input.startKey)} - ${safeHtml(input.endKey)}</span></div>
    </section>
    <section class="invoice-to"><div><strong>TO:</strong><span>Service provider / funder</span></div><div><strong>FOR:</strong><span>Peer Support services</span></div></section>
    <table class="invoice-table"><thead><tr><th>DESCRIPTION</th><th>HOURS</th><th>RATE</th><th>AMOUNT</th></tr></thead><tbody>
      <tr><td>Peer support hours</td><td>${summary.billableHours.toFixed(2)}</td><td>${money(input.hourlyRate)}</td><td>${money(summary.earnings)}</td></tr>
      <tr><td>Travel kms</td><td>${summary.kilometres.toFixed(1)}</td><td>${money(input.fuelRate)}</td><td>${money(summary.travel)}</td></tr>
      ${blankRows}
      <tr class="total"><td></td><td></td><td>TOTAL</td><td>${money(summary.total)}</td></tr>
    </tbody></table>
    <section class="invoice-detail"><h3>Work detail</h3>${input.entries.map((entry) => `<div><span>${safeHtml(entry.date)} · ${safeHtml(entry.startTime)}</span><strong>${safeHtml(entry.client)}</strong><span>${safeHtml(entryType(entry.type).label)} · ${entry.minutes} min · ${entryBillableHours(entry).toFixed(2)} billable h${entryKilometres(entry) ? ` · ${entryKilometres(entry).toFixed(1)} km` : ''}</span></div>`).join('')}</section>`;
  printDocument(
    `Invoice ${input.number}`,
    body,
    `.invoice-head,.invoice-to{display:grid;grid-template-columns:1fr 1fr;border:1px solid #777}.invoice-head>div,.invoice-to>div{padding:10px;min-height:72px;display:flex;flex-direction:column;gap:5px}.invoice-head>div+div,.invoice-to>div+div{border-left:1px solid #777}.invoice-title{text-align:right}.invoice-title h1{font-size:28px;color:#555;margin-bottom:18px}.invoice-table{width:100%;border-collapse:collapse;margin-top:16px;font-size:11px}.invoice-table th,.invoice-table td{border:1px solid #111;padding:5px 7px;height:24px}.invoice-table th{text-align:center}.invoice-table th:first-child,.invoice-table td:first-child{width:57%;text-align:left}.invoice-table .total{font-weight:800}.invoice-detail{margin-top:18px}.invoice-detail>div{display:grid;grid-template-columns:110px 1fr 1.5fr;gap:10px;border-bottom:1px solid #ddd;padding:6px 0;font-size:10px}.invoice-from span,.invoice-title span,.invoice-to span{font-size:11px}`,
  );
}

function shareText(title: string, text: string): Promise<void> {
  if (navigator.share) return navigator.share({ title, text }).then(() => undefined);
  return navigator.clipboard.writeText(text);
}

export function ReportsHub() {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<ReportTab>('overview');
  const [state, setState] = useState<WorkspaceState | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [periodOffset, setPeriodOffset] = useState(0);
  const [noteSearch, setNoteSearch] = useState('');
  const [message, setMessage] = useState('');

  const refresh = async () => {
    setLoading(true);
    setError('');
    try {
      setState(await loadCloudState());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not load Cloudflare Work data.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) void refresh();
  }, [open]);

  const reportData = useMemo(() => {
    if (!state) return null;
    const workEntries = state.entries.filter((entry) => entry.mode === 'work');
    const base = fortnightStart(new Date(), state.settings.payPeriodAnchorDate);
    const start = addDays(base, periodOffset * PERIOD_DAYS);
    const end = addDays(start, 13);
    const startKey = localDateValue(start);
    const endKey = localDateValue(end);
    const periodEntries = workEntries
      .filter((entry) => entry.date >= startKey && entry.date <= endKey)
      .sort((a, b) => (a.date + a.startTime).localeCompare(b.date + b.startTime));
    const now = new Date();
    const monthEntries = workEntries.filter((entry) => {
      const date = new Date(entry.date + 'T12:00:00');
      return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth();
    });
    return {
      workEntries,
      periodEntries,
      monthEntries,
      startKey,
      endKey,
      invoiceNumber: invoiceNumber(start, state.settings.payPeriodAnchorDate),
      periodTotals: totals(periodEntries, state.settings.hourlyRate, state.settings.fuelRate),
      monthTotals: totals(monthEntries, state.settings.hourlyRate, state.settings.fuelRate),
    };
  }, [state, periodOffset]);

  const visibleNotes = useMemo(() => {
    if (!reportData) return [];
    const query = noteSearch.trim().toLowerCase();
    return reportData.workEntries
      .filter(supportNoteEntered)
      .filter((entry) => !query || `${entry.client} ${entry.date} ${entryType(entry.type).label}`.toLowerCase().includes(query))
      .sort((a, b) => (b.date + b.startTime).localeCompare(a.date + a.startTime));
  }, [reportData, noteSearch]);

  const sharePeriod = async () => {
    if (!reportData || !state) return;
    const t = reportData.periodTotals;
    const text = [
      `NMRNL Work report · ${reportData.startKey} to ${reportData.endKey}`,
      `Entries: ${reportData.periodEntries.length}`,
      `Billable hours: ${t.billableHours.toFixed(2)}`,
      `Earnings: ${money(t.earnings)}`,
      `Travel: ${t.kilometres.toFixed(1)} km (${money(t.travel)})`,
      `Total: ${money(t.total)}`,
      `Support notes completed: ${reportData.periodEntries.filter(supportNoteEntered).length}/${reportData.periodEntries.length}`,
    ].join('\n');
    await shareText('NMRNL Work report', text);
    setMessage(navigator.share ? 'Report shared.' : 'Report copied.');
  };

  return (
    <>
      <button className="reports-launcher" type="button" onClick={() => setOpen(true)} aria-label="Open Work reports">
        <span>▥</span><strong>Reports</strong>
      </button>

      {open && (
        <div className="reports-overlay" role="dialog" aria-modal="true" aria-label="Work reports">
          <div className="reports-shell">
            <header className="reports-header">
              <div><span>WORK · CLOUDFLARE DATA</span><h2>Reports</h2><p>Build support-note, work-period and invoice reports directly from the cloud workspace.</p></div>
              <button type="button" onClick={() => setOpen(false)} aria-label="Close reports">×</button>
            </header>

            <nav className="reports-tabs">
              <button className={tab === 'overview' ? 'active' : ''} onClick={() => setTab('overview')}>Overview</button>
              <button className={tab === 'notes' ? 'active' : ''} onClick={() => setTab('notes')}>Support notes</button>
              <button className={tab === 'invoice' ? 'active' : ''} onClick={() => setTab('invoice')}>Invoice</button>
            </nav>

            {error && <div className="reports-error">{error}</div>}
            {message && <div className="reports-success">{message}</div>}
            {loading && !state ? <div className="reports-loading">Loading Cloudflare workspace…</div> : null}

            {state && reportData && tab === 'overview' && (
              <div className="reports-page">
                <section className="reports-period-head">
                  <div><span>Selected fortnight</span><strong>{formatDate(reportData.startKey)} – {formatDate(reportData.endKey)}</strong></div>
                  <div><button onClick={() => setPeriodOffset((v) => v - 1)}>←</button><button onClick={() => setPeriodOffset(0)}>Current</button><button onClick={() => setPeriodOffset((v) => v + 1)}>→</button></div>
                </section>
                <div className="reports-stat-grid">
                  <article><span>Entries</span><strong>{reportData.periodEntries.length}</strong></article>
                  <article><span>Billable hours</span><strong>{reportData.periodTotals.billableHours.toFixed(2)}</strong></article>
                  <article><span>Earnings</span><strong>{money(reportData.periodTotals.earnings)}</strong></article>
                  <article><span>Travel</span><strong>{reportData.periodTotals.kilometres.toFixed(1)} km</strong></article>
                  <article><span>Invoice total</span><strong>{money(reportData.periodTotals.total)}</strong></article>
                  <article><span>Notes complete</span><strong>{reportData.periodEntries.filter(supportNoteEntered).length}/{reportData.periodEntries.length}</strong></article>
                </div>
                <section className="reports-card"><div className="reports-card-head"><div><span>Fortnight report</span><h3>Work activity</h3></div><button onClick={() => void sharePeriod()}>Share / Copy</button></div>
                  <div className="reports-entry-list">{reportData.periodEntries.map((entry) => <div key={entry.id}><span>{formatDate(entry.date)} · {entry.startTime}</span><strong>{entry.client}</strong><small>{entryType(entry.type).label} · {entry.minutes}m · {entryBillableHours(entry).toFixed(2)} billable h</small><b>{money(entryEarnings(entry, state.settings.hourlyRate) + entryTravelReimbursement(entry, state.settings.fuelRate))}</b></div>)}</div>
                </section>
                <section className="reports-card"><div className="reports-card-head"><div><span>This month</span><h3>{new Date().toLocaleDateString(undefined,{month:'long',year:'numeric'})}</h3></div></div>
                  <div className="reports-stat-grid small"><article><span>Entries</span><strong>{reportData.monthEntries.length}</strong></article><article><span>Hours</span><strong>{reportData.monthTotals.billableHours.toFixed(2)}</strong></article><article><span>Earned</span><strong>{money(reportData.monthTotals.earnings)}</strong></article><article><span>KM</span><strong>{reportData.monthTotals.kilometres.toFixed(1)}</strong></article></div>
                </section>
              </div>
            )}

            {state && reportData && tab === 'notes' && (
              <div className="reports-page">
                <section className="reports-card"><div className="reports-card-head"><div><span>MSD reporting template</span><h3>Support-note reports</h3></div><strong>{visibleNotes.length} ready</strong></div>
                  <input className="reports-search" value={noteSearch} onChange={(e) => setNoteSearch(e.target.value)} placeholder="Search client, date or type…" />
                  <div className="reports-note-list">{visibleNotes.length ? visibleNotes.map((entry) => <article key={entry.id}><div><span>{formatDate(entry.date)} · {entry.startTime}</span><h4>{entry.client}</h4><p>{entryType(entry.type).label} · {entry.minutes} minutes · {entry.supportNoteStatus || 'in progress'}</p></div><button onClick={() => printSupportNote(entry)}>Open report / PDF</button></article>) : <p className="reports-empty">No completed support-note content matches this search.</p>}</div>
                </section>
              </div>
            )}

            {state && reportData && tab === 'invoice' && (
              <div className="reports-page">
                <section className="reports-period-head"><div><span>Invoice period</span><strong>Invoice {reportData.invoiceNumber} · {formatDate(reportData.startKey)} – {formatDate(reportData.endKey)}</strong></div><div><button onClick={() => setPeriodOffset((v) => v - 1)}>←</button><button onClick={() => setPeriodOffset(0)}>Current</button><button onClick={() => setPeriodOffset((v) => v + 1)}>→</button></div></section>
                <section className="reports-card invoice-preview-card">
                  <div className="invoice-preview-head"><div><strong>NMRNL Work</strong><span>Peer support services</span></div><div><h3>INVOICE</h3><strong>INVOICE {reportData.invoiceNumber}</strong><span>{reportData.startKey} - {reportData.endKey}</span></div></div>
                  <div className="invoice-preview-to"><div><strong>TO:</strong><span>Service provider / funder</span></div><div><strong>FOR:</strong><span>Peer Support services</span></div></div>
                  <div className="invoice-preview-table"><div className="head"><b>DESCRIPTION</b><b>HOURS</b><b>RATE</b><b>AMOUNT</b></div><div><span>Peer support hours</span><span>{reportData.periodTotals.billableHours.toFixed(2)}</span><span>{money(state.settings.hourlyRate)}</span><span>{money(reportData.periodTotals.earnings)}</span></div><div><span>Travel kms</span><span>{reportData.periodTotals.kilometres.toFixed(1)}</span><span>{money(state.settings.fuelRate)}</span><span>{money(reportData.periodTotals.travel)}</span></div><div className="total"><span></span><span></span><b>TOTAL</b><b>{money(reportData.periodTotals.total)}</b></div></div>
                  <button className="reports-primary" disabled={!reportData.periodEntries.length} onClick={() => printInvoice({ number: reportData.invoiceNumber, startKey: reportData.startKey, endKey: reportData.endKey, entries: reportData.periodEntries, hourlyRate: state.settings.hourlyRate, fuelRate: state.settings.fuelRate })}>Build Invoice / Print / Save PDF</button>
                  <p className="reports-hint">Uses the original invoice structure: invoice number, fortnight date range, peer-support hours, travel kilometres, rates and total. It now builds from Cloudflare workspace data rather than Google Drive.</p>
                </section>
              </div>
            )}

            <footer className="reports-footer"><span>{state ? 'Cloud workspace loaded' : 'Cloud workspace not loaded'}</span><button onClick={() => void refresh()} disabled={loading}>{loading ? 'Refreshing…' : 'Refresh cloud data'}</button></footer>
          </div>
        </div>
      )}
    </>
  );
}
