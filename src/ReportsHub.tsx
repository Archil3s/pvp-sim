import { useEffect, useMemo, useState } from 'react';
import { fetchWorkspace, loadCredentials, openTemporaryWorkspace } from './api';
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

type Tab = 'overview' | 'notes' | 'invoice';

const PERIOD_DAYS = 14;
const FIRST_INVOICE_NUMBER = 5;

function addDays(date: Date, days: number) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days, 12);
}

function calendarDaysBetween(start: Date, end: Date) {
  const a = Date.UTC(start.getFullYear(), start.getMonth(), start.getDate());
  const b = Date.UTC(end.getFullYear(), end.getMonth(), end.getDate());
  return Math.round((b - a) / 86_400_000);
}

function fortnightStart(date: Date, anchorText: string) {
  const anchor = new Date(anchorText + 'T12:00:00');
  const normalized = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12);
  const offset = Math.floor(calendarDaysBetween(anchor, normalized) / PERIOD_DAYS);
  return addDays(anchor, offset * PERIOD_DAYS);
}

function invoiceNumberFor(start: Date, anchorText: string) {
  const anchor = fortnightStart(new Date(anchorText + 'T12:00:00'), anchorText);
  return FIRST_INVOICE_NUMBER + Math.floor(calendarDaysBetween(anchor, start) / PERIOD_DAYS);
}

function money(value: number) {
  return new Intl.NumberFormat('en-NZ', { style: 'currency', currency: 'NZD' }).format(value || 0);
}

function totals(entries: WorkEntry[], hourlyRate: number, fuelRate: number) {
  const billableHours = entries.reduce((sum, entry) => sum + entryBillableHours(entry), 0);
  const kilometres = entries.reduce((sum, entry) => sum + entryKilometres(entry), 0);
  const earnings = entries.reduce((sum, entry) => sum + entryEarnings(entry, hourlyRate), 0);
  const travel = entries.reduce((sum, entry) => sum + entryTravelReimbursement(entry, fuelRate), 0);
  return { billableHours, kilometres, earnings, travel, total: earnings + travel };
}

function hasNote(entry: WorkEntry) {
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

async function cloudState(): Promise<WorkspaceState> {
  const credentials = loadCredentials();
  if (credentials) return fetchWorkspace(credentials);
  return (await openTemporaryWorkspace()).state;
}

function esc(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function printPage(title: string, body: string, css = '') {
  const popup = window.open('', '_blank', 'noopener,noreferrer');
  if (!popup) throw new Error('Report window blocked. Allow pop-ups for NMRNL and try again.');
  popup.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><meta name="viewport" content="width=device-width,initial-scale=1"><style>
  *{box-sizing:border-box}body{margin:0;background:#eef0f4;font-family:Arial,Helvetica,sans-serif;color:#111}.actions{position:sticky;top:0;background:#111827;padding:10px;text-align:center}.actions button{padding:10px 16px;border:0;border-radius:8px;font-weight:700}.paper{width:min(210mm,100%);min-height:297mm;margin:18px auto;background:#fff;padding:14mm;box-shadow:0 8px 30px #0002}.pre{white-space:pre-wrap;line-height:1.45;font-size:12px}${css}@media print{body{background:#fff}.actions{display:none}.paper{box-shadow:none;margin:0;width:auto;min-height:auto;padding:10mm}@page{size:A4;margin:0}}</style></head><body><div class="actions"><button onclick="window.print()">Print / Save PDF</button></div><main class="paper">${body}</main></body></html>`);
  popup.document.close();
}

function printNote(entry: WorkEntry) {
  const text = goldStandardTemplatePlainText(
    entry,
    entry.supportNotePersonName?.trim() || entry.client,
    entry.supportNoteBreakdown,
  );
  printPage(`${entry.client} - ${entry.date} - Support Note`, `<div class="pre">${esc(text)}</div>`);
}

function printInvoice(input: {
  number: number;
  startKey: string;
  endKey: string;
  entries: WorkEntry[];
  hourlyRate: number;
  fuelRate: number;
}) {
  const t = totals(input.entries, input.hourlyRate, input.fuelRate);
  const blanks = Array.from({ length: 14 }, () => '<tr><td>&nbsp;</td><td></td><td></td><td></td></tr>').join('');
  const detail = input.entries.map((entry) => `<div><span>${esc(entry.date)} · ${esc(entry.startTime)}</span><strong>${esc(entry.client)}</strong><span>${esc(entryType(entry.type).label)} · ${entry.minutes} min · ${entryBillableHours(entry).toFixed(2)} billable h${entryKilometres(entry) ? ` · ${entryKilometres(entry).toFixed(1)} km` : ''}</span></div>`).join('');
  const body = `<section class="head"><div><strong>NMRNL Work</strong><span>Peer support services</span></div><div><h1>INVOICE</h1><strong>INVOICE ${input.number}</strong><span>DATE: ${esc(input.startKey)} - ${esc(input.endKey)}</span></div></section><section class="to"><div><strong>TO:</strong><span>Service provider / funder</span></div><div><strong>FOR:</strong><span>Peer Support services</span></div></section><table><thead><tr><th>DESCRIPTION</th><th>HOURS</th><th>RATE</th><th>AMOUNT</th></tr></thead><tbody><tr><td>Peer support hours</td><td>${t.billableHours.toFixed(2)}</td><td>${money(input.hourlyRate)}</td><td>${money(t.earnings)}</td></tr><tr><td>Travel kms</td><td>${t.kilometres.toFixed(1)}</td><td>${money(input.fuelRate)}</td><td>${money(t.travel)}</td></tr>${blanks}<tr class="total"><td></td><td></td><td>TOTAL</td><td>${money(t.total)}</td></tr></tbody></table><section class="detail"><h3>Work detail</h3>${detail}</section>`;
  printPage(
    `Invoice ${input.number}`,
    body,
    `.head,.to{display:grid;grid-template-columns:1fr 1fr;border:1px solid #777}.head>div,.to>div{padding:10px;min-height:72px;display:flex;flex-direction:column;gap:5px}.head>div+div,.to>div+div{border-left:1px solid #777}.head>div:last-child{text-align:right}.head h1{font-size:28px;color:#555;margin:0 0 18px}.head span,.to span{font-size:11px}table{width:100%;border-collapse:collapse;margin-top:16px;font-size:11px}th,td{border:1px solid #111;padding:5px 7px;height:24px}th{text-align:center}th:first-child,td:first-child{width:57%;text-align:left}.total{font-weight:800}.detail{margin-top:18px}.detail>div{display:grid;grid-template-columns:110px 1fr 1.5fr;gap:10px;border-bottom:1px solid #ddd;padding:6px 0;font-size:10px}`,
  );
}

async function shareReport(title: string, text: string) {
  const share = (navigator as Navigator & {
    share?: (data: { title?: string; text?: string }) => Promise<void>;
  }).share;
  if (typeof share === 'function') {
    await share.call(navigator, { title, text });
    return 'shared';
  }
  await navigator.clipboard.writeText(text);
  return 'copied';
}

export function ReportsHub() {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>('overview');
  const [state, setState] = useState<WorkspaceState | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [offset, setOffset] = useState(0);
  const [search, setSearch] = useState('');

  const refresh = async () => {
    setLoading(true);
    setError('');
    try {
      setState(await cloudState());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not load Cloudflare Work data.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) void refresh();
  }, [open]);

  const data = useMemo(() => {
    if (!state) return null;
    const all = state.entries.filter((entry) => entry.mode === 'work');
    const current = fortnightStart(new Date(), state.settings.payPeriodAnchorDate);
    const start = addDays(current, offset * PERIOD_DAYS);
    const end = addDays(start, 13);
    const startKey = localDateValue(start);
    const endKey = localDateValue(end);
    const entries = all.filter((entry) => entry.date >= startKey && entry.date <= endKey).sort((a, b) => (a.date + a.startTime).localeCompare(b.date + b.startTime));
    const now = new Date();
    const month = all.filter((entry) => {
      const date = new Date(entry.date + 'T12:00:00');
      return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth();
    });
    return {
      all,
      entries,
      month,
      startKey,
      endKey,
      number: invoiceNumberFor(start, state.settings.payPeriodAnchorDate),
      totals: totals(entries, state.settings.hourlyRate, state.settings.fuelRate),
      monthTotals: totals(month, state.settings.hourlyRate, state.settings.fuelRate),
    };
  }, [state, offset]);

  const notes = useMemo(() => {
    if (!data) return [];
    const q = search.trim().toLowerCase();
    return data.all.filter(hasNote).filter((entry) => !q || `${entry.client} ${entry.date} ${entryType(entry.type).label}`.toLowerCase().includes(q)).sort((a, b) => (b.date + b.startTime).localeCompare(a.date + a.startTime));
  }, [data, search]);

  const shareFortnight = async () => {
    if (!data) return;
    const text = [
      `NMRNL Work report · ${data.startKey} to ${data.endKey}`,
      `Entries: ${data.entries.length}`,
      `Billable hours: ${data.totals.billableHours.toFixed(2)}`,
      `Earnings: ${money(data.totals.earnings)}`,
      `Travel: ${data.totals.kilometres.toFixed(1)} km (${money(data.totals.travel)})`,
      `Total: ${money(data.totals.total)}`,
      `Support notes completed: ${data.entries.filter(hasNote).length}/${data.entries.length}`,
    ].join('\n');
    const result = await shareReport('NMRNL Work report', text);
    setMessage(result === 'shared' ? 'Report shared.' : 'Report copied.');
  };

  return <>
    <button className="reports-launcher" type="button" onClick={() => setOpen(true)}><span>▥</span><strong>Reports</strong></button>
    {open && <div className="reports-overlay" role="dialog" aria-modal="true">
      <div className="reports-shell">
        <header className="reports-header"><div><span>WORK · CLOUDFLARE DATA</span><h2>Reports</h2><p>Support-note, work-period and invoice reporting from the cloud workspace.</p></div><button type="button" onClick={() => setOpen(false)}>×</button></header>
        <nav className="reports-tabs"><button className={tab === 'overview' ? 'active' : ''} onClick={() => setTab('overview')}>Overview</button><button className={tab === 'notes' ? 'active' : ''} onClick={() => setTab('notes')}>Support notes</button><button className={tab === 'invoice' ? 'active' : ''} onClick={() => setTab('invoice')}>Invoice</button></nav>
        {error && <div className="reports-error">{error}</div>}{message && <div className="reports-success">{message}</div>}{loading && !state && <div className="reports-loading">Loading Cloudflare workspace…</div>}
        {state && data && tab === 'overview' && <div className="reports-page">
          <section className="reports-period-head"><div><span>Selected fortnight</span><strong>{formatDate(data.startKey)} – {formatDate(data.endKey)}</strong></div><div><button onClick={() => setOffset((v) => v - 1)}>←</button><button onClick={() => setOffset(0)}>Current</button><button onClick={() => setOffset((v) => v + 1)}>→</button></div></section>
          <div className="reports-stat-grid"><article><span>Entries</span><strong>{data.entries.length}</strong></article><article><span>Billable hours</span><strong>{data.totals.billableHours.toFixed(2)}</strong></article><article><span>Earnings</span><strong>{money(data.totals.earnings)}</strong></article><article><span>Travel</span><strong>{data.totals.kilometres.toFixed(1)} km</strong></article><article><span>Invoice total</span><strong>{money(data.totals.total)}</strong></article><article><span>Notes complete</span><strong>{data.entries.filter(hasNote).length}/{data.entries.length}</strong></article></div>
          <section className="reports-card"><div className="reports-card-head"><div><span>Fortnight report</span><h3>Work activity</h3></div><button onClick={() => void shareFortnight()}>Share / Copy</button></div><div className="reports-entry-list">{data.entries.map((entry) => <div key={entry.id}><span>{formatDate(entry.date)} · {entry.startTime}</span><strong>{entry.client}</strong><small>{entryType(entry.type).label} · {entry.minutes}m · {entryBillableHours(entry).toFixed(2)} billable h</small><b>{money(entryEarnings(entry, state.settings.hourlyRate) + entryTravelReimbursement(entry, state.settings.fuelRate))}</b></div>)}</div></section>
          <section className="reports-card"><div className="reports-card-head"><div><span>This month</span><h3>{new Date().toLocaleDateString(undefined,{month:'long',year:'numeric'})}</h3></div></div><div className="reports-stat-grid small"><article><span>Entries</span><strong>{data.month.length}</strong></article><article><span>Hours</span><strong>{data.monthTotals.billableHours.toFixed(2)}</strong></article><article><span>Earned</span><strong>{money(data.monthTotals.earnings)}</strong></article><article><span>KM</span><strong>{data.monthTotals.kilometres.toFixed(1)}</strong></article></div></section>
        </div>}
        {state && data && tab === 'notes' && <div className="reports-page"><section className="reports-card"><div className="reports-card-head"><div><span>MSD reporting template</span><h3>Support-note reports</h3></div><strong>{notes.length} ready</strong></div><input className="reports-search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search client, date or type…"/><div className="reports-note-list">{notes.length ? notes.map((entry) => <article key={entry.id}><div><span>{formatDate(entry.date)} · {entry.startTime}</span><h4>{entry.client}</h4><p>{entryType(entry.type).label} · {entry.minutes} minutes · {entry.supportNoteStatus || 'in progress'}</p></div><button onClick={() => printNote(entry)}>Open report / PDF</button></article>) : <p className="reports-empty">No completed support-note content matches this search.</p>}</div></section></div>}
        {state && data && tab === 'invoice' && <div className="reports-page"><section className="reports-period-head"><div><span>Invoice period</span><strong>Invoice {data.number} · {formatDate(data.startKey)} – {formatDate(data.endKey)}</strong></div><div><button onClick={() => setOffset((v) => v - 1)}>←</button><button onClick={() => setOffset(0)}>Current</button><button onClick={() => setOffset((v) => v + 1)}>→</button></div></section><section className="reports-card invoice-preview-card"><div className="invoice-preview-head"><div><strong>NMRNL Work</strong><span>Peer support services</span></div><div><h3>INVOICE</h3><strong>INVOICE {data.number}</strong><span>{data.startKey} - {data.endKey}</span></div></div><div className="invoice-preview-to"><div><strong>TO:</strong><span>Service provider / funder</span></div><div><strong>FOR:</strong><span>Peer Support services</span></div></div><div className="invoice-preview-table"><div className="head"><b>DESCRIPTION</b><b>HOURS</b><b>RATE</b><b>AMOUNT</b></div><div><span>Peer support hours</span><span>{data.totals.billableHours.toFixed(2)}</span><span>{money(state.settings.hourlyRate)}</span><span>{money(data.totals.earnings)}</span></div><div><span>Travel kms</span><span>{data.totals.kilometres.toFixed(1)}</span><span>{money(state.settings.fuelRate)}</span><span>{money(data.totals.travel)}</span></div><div className="total"><span></span><span></span><b>TOTAL</b><b>{money(data.totals.total)}</b></div></div><button className="reports-primary" disabled={!data.entries.length} onClick={() => printInvoice({number:data.number,startKey:data.startKey,endKey:data.endKey,entries:data.entries,hourlyRate:state.settings.hourlyRate,fuelRate:state.settings.fuelRate})}>Build Invoice / Print / Save PDF</button><p className="reports-hint">Original invoice structure, now generated from Cloudflare workspace data rather than Google Drive.</p></section></div>}
        <footer className="reports-footer"><span>{state ? 'Cloud workspace loaded' : 'Cloud workspace not loaded'}</span><button onClick={() => void refresh()} disabled={loading}>{loading ? 'Refreshing…' : 'Refresh cloud data'}</button></footer>
      </div>
    </div>}
  </>;
}
