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

type Tab = 'monthly' | 'contacts' | 'notes' | 'invoice';
const PERIOD_DAYS = 14;
const FIRST_INVOICE_NUMBER = 5;

function addDays(date: Date, days: number) { return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days, 12); }
function calendarDaysBetween(start: Date, end: Date) {
  const a = Date.UTC(start.getFullYear(), start.getMonth(), start.getDate());
  const b = Date.UTC(end.getFullYear(), end.getMonth(), end.getDate());
  return Math.round((b - a) / 86_400_000);
}
function fortnightStart(date: Date, anchorText: string) {
  const anchor = new Date(anchorText + 'T12:00:00');
  const normalized = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12);
  return addDays(anchor, Math.floor(calendarDaysBetween(anchor, normalized) / PERIOD_DAYS) * PERIOD_DAYS);
}
function invoiceNumberFor(start: Date, anchorText: string) {
  const anchor = fortnightStart(new Date(anchorText + 'T12:00:00'), anchorText);
  return FIRST_INVOICE_NUMBER + Math.floor(calendarDaysBetween(anchor, start) / PERIOD_DAYS);
}
function money(value: number) { return `$${(Number.isFinite(value) ? value : 0).toFixed(2)}`; }
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
  const headings = new Set(['attendance','what happened','work/task completed','support given','issue/problem','outcome','next step','anything to follow up','referrals']);
  return value.split(/\r?\n/).some((line) => line.trim() && !headings.has(line.trim().replace(/:$/, '').toLowerCase()));
}
async function cloudState(): Promise<WorkspaceState> {
  const credentials = loadCredentials();
  if (credentials) return fetchWorkspace(credentials);
  return (await openTemporaryWorkspace()).state;
}
function esc(value: string) { return value.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;'); }
function supportTemplateHtml(entry: WorkEntry) {
  const text = goldStandardTemplatePlainText(entry, entry.supportNotePersonName?.trim() || entry.client, entry.supportNoteBreakdown);
  const lines = text.split('\n');
  const sections = ['Main topic(s)  (max. 200 words)','Outcome(s)  (Max. 100 words)','Overall impression (Max. 150 words)`','Next actions  Max. 150 words)`'];
  return `<div class="sw-note">${lines.map((line) => {
    const clean = line.trim();
    if (clean === 'Template for reporting of interactions with survivors.') return `<h1>${esc(line)}</h1>`;
    if (sections.includes(clean)) return `<h2>${esc(line)}</h2>`;
    if (clean.startsWith('This template is aimed')) return `<p class="intro">${esc(line)}</p>`;
    if (clean.startsWith('Geographical area.') || clean.startsWith('Name of client.') || clean.startsWith('Date:') || clean.startsWith('Date/time/length of interaction.')) return `<p class="meta">${esc(line)}</p>`;
    return clean ? `<p>${esc(line)}</p>` : '<div class="space"></div>';
  }).join('')}</div>`;
}
function supportTemplateCss() {
  return `.sw-note{font-family:Arial,Helvetica,sans-serif;color:#111}.sw-note h1{font-size:18px;margin:0 0 18px;font-weight:700}.sw-note .intro{font-size:11px;line-height:1.45;margin-bottom:20px}.sw-note .meta{font-size:11px;line-height:1.45;margin:5px 0}.sw-note h2{font-size:12px;margin:22px 0 8px;font-weight:700}.sw-note p{font-size:11px;line-height:1.45;margin:3px 0}.sw-note .space{height:7px}`;
}
function invoiceBody(input: {number:number;startKey:string;endKey:string;entries:WorkEntry[];hourlyRate:number;fuelRate:number}) {
  const t = totals(input.entries, input.hourlyRate, input.fuelRate);
  const start = new Date(input.startKey + 'T12:00:00');
  const end = new Date(input.endKey + 'T12:00:00');
  const originalDate = (d: Date) => `${d.getMonth()+1}/${d.getDate()}/${d.getFullYear()}`;
  const blanks = Array.from({length:14},()=>'<tr><td>&nbsp;</td><td></td><td></td><td></td></tr>').join('');
  return `<div class="sw-invoice"><section class="sw-head"><div><strong>Male Room</strong><small>[Fax Number]</small><span>J D DuToit</span><span>06-0603-0098537-00</span></div><div><h1>INVOICE</h1><strong>INVOICE ${input.number}</strong><small>DATE: ${originalDate(start)} - ${originalDate(end)}</small></div></section><section class="sw-to"><div><strong>TO:</strong><span>Male Room 2021 Trust</span></div><div><strong>FOR:</strong><span>Peer Support services</span></div></section><table><thead><tr><th>DESCRIPTION</th><th>HOURS</th><th>RATE</th><th>AMOUNT</th></tr></thead><tbody><tr><td>Peer support hours</td><td>${t.billableHours.toFixed(2)}</td><td>${money(input.hourlyRate)}</td><td>${money(t.earnings)}</td></tr><tr><td>Travel kms</td><td>${t.kilometres.toFixed(1)}</td><td>${money(input.fuelRate)}</td><td>${money(t.travel)}</td></tr>${blanks}<tr class="total"><td></td><td></td><td>TOTAL</td><td>${money(t.total)}</td></tr></tbody></table></div>`;
}
function invoiceCss() {
  return `.sw-invoice{font-family:Arial,Helvetica,sans-serif;color:#111}.sw-head{height:92px;display:grid;grid-template-columns:1fr 1fr;border:1px solid #999}.sw-head>div{padding:8px;display:flex;flex-direction:column}.sw-head>div+div{border-left:1px solid #999;text-align:right}.sw-head>div:first-child strong{font-size:13px}.sw-head small{font-size:8px}.sw-head>div:first-child small{margin-bottom:14px}.sw-head span{font-size:10px}.sw-head h1{font-size:22px;color:#555;margin:0 0 auto;border-bottom:1px solid #999;padding-bottom:7px}.sw-head>div:last-child strong{font-size:8px;margin-top:auto}.sw-to{height:82px;display:grid;grid-template-columns:1fr 1fr;border:1px solid #999;margin-top:14px}.sw-to>div{padding:8px;display:flex;flex-direction:column;font-size:8px}.sw-to>div+div{border-left:1px solid #999}.sw-invoice table{width:100%;border-collapse:collapse;margin-top:16px;font-size:8px}.sw-invoice th,.sw-invoice td{border:1px solid #111;padding:3px 7px;height:20px}.sw-invoice th{text-align:center}.sw-invoice th:first-child,.sw-invoice td:first-child{width:57%;text-align:left}.sw-invoice .total{font-weight:700}`;
}
function printPage(title:string, body:string, css='') {
  const popup=window.open('','_blank','noopener,noreferrer');
  if(!popup) throw new Error('Preview window blocked. Allow pop-ups for NMRNL and try again.');
  popup.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><meta name="viewport" content="width=device-width,initial-scale=1"><style>*{box-sizing:border-box}body{margin:0;background:#eef0f4;color:#111}.actions{position:sticky;top:0;background:#111827;padding:10px;text-align:center}.actions button{padding:10px 16px;border:0;border-radius:8px;font-weight:700}.paper{width:min(210mm,100%);min-height:297mm;margin:18px auto;background:#fff;padding:10mm;box-shadow:0 8px 30px #0002}${css}@media print{body{background:#fff}.actions{display:none}.paper{box-shadow:none;margin:0;width:auto;min-height:auto;padding:10mm}@page{size:A4;margin:0}}</style></head><body><div class="actions"><button onclick="window.print()">Print / Save PDF</button></div><main class="paper">${body}</main></body></html>`);
  popup.document.close();
}
function printNote(entry:WorkEntry){ printPage(`${entry.client} - ${entry.date} - Support Note`,supportTemplateHtml(entry),supportTemplateCss()); }
function printInvoice(input:{number:number;startKey:string;endKey:string;entries:WorkEntry[];hourlyRate:number;fuelRate:number}){ printPage(`Invoice ${input.number}`,invoiceBody(input),invoiceCss()); }

export function ReportsHub(){
  const [open,setOpen]=useState(false); const [tab,setTab]=useState<Tab>('monthly'); const [state,setState]=useState<WorkspaceState|null>(null); const [loading,setLoading]=useState(false); const [error,setError]=useState(''); const [offset,setOffset]=useState(0); const [monthOffset,setMonthOffset]=useState(0); const [search,setSearch]=useState(''); const [previewNote,setPreviewNote]=useState<WorkEntry|null>(null);
  const refresh=async()=>{setLoading(true);setError('');try{setState(await cloudState());}catch(reason){setError(reason instanceof Error?reason.message:'Could not load Cloudflare Work data.');}finally{setLoading(false);}};
  useEffect(()=>{if(open)void refresh();},[open]);
  const data=useMemo(()=>{if(!state)return null;const all=state.entries.filter(e=>e.mode==='work');const current=fortnightStart(new Date(),state.settings.payPeriodAnchorDate);const start=addDays(current,offset*PERIOD_DAYS);const end=addDays(start,13);const startKey=localDateValue(start);const endKey=localDateValue(end);const entries=all.filter(e=>e.date>=startKey&&e.date<=endKey).sort((a,b)=>(a.date+a.startTime).localeCompare(b.date+b.startTime));const now=new Date();const monthDate=new Date(now.getFullYear(),now.getMonth()+monthOffset,1,12);const monthKey=`${monthDate.getFullYear()}-${String(monthDate.getMonth()+1).padStart(2,'0')}`;const month=all.filter(e=>e.date.startsWith(monthKey)).sort((a,b)=>(a.date+a.startTime).localeCompare(b.date+b.startTime));return{all,entries,startKey,endKey,number:invoiceNumberFor(start,state.settings.payPeriodAnchorDate),totals:totals(entries,state.settings.hourlyRate,state.settings.fuelRate),month,monthDate,monthTotals:totals(month,state.settings.hourlyRate,state.settings.fuelRate)};},[state,offset,monthOffset]);
  const notes=useMemo(()=>{if(!data)return[];const q=search.trim().toLowerCase();return data.all.filter(hasNote).filter(e=>!q||`${e.client} ${e.date} ${entryType(e.type).label}`.toLowerCase().includes(q)).sort((a,b)=>(b.date+b.startTime).localeCompare(a.date+a.startTime));},[data,search]);
  return <><button className="reports-launcher" type="button" onClick={()=>setOpen(true)}><span>▥</span><strong>Reports</strong></button>{open&&<div className="reports-overlay" role="dialog" aria-modal="true"><div className="reports-shell"><header className="reports-header"><div><span>WORK · CLOUDFLARE DATA</span><h2>Reports</h2><p>Monthly contacts, support notes and invoices.</p></div><button type="button" onClick={()=>setOpen(false)}>×</button></header><nav className="reports-tabs"><button className={tab==='monthly'?'active':''} onClick={()=>setTab('monthly')}>Monthly</button><button className={tab==='contacts'?'active':''} onClick={()=>setTab('contacts')}>Contacts</button><button className={tab==='notes'?'active':''} onClick={()=>setTab('notes')}>Notes</button><button className={tab==='invoice'?'active':''} onClick={()=>setTab('invoice')}>Invoices</button></nav>{error&&<div className="reports-error">{error}</div>}{loading&&!state&&<div className="reports-loading">Loading Cloudflare workspace…</div>}
  {state&&data&&tab==='monthly'&&<div className="reports-page"><section className="reports-period-head"><div><span>Monthly breakdown</span><strong>{data.monthDate.toLocaleDateString(undefined,{month:'long',year:'numeric'})}</strong></div><div><button onClick={()=>setMonthOffset(v=>v-1)}>←</button><button onClick={()=>setMonthOffset(0)}>Current</button><button onClick={()=>setMonthOffset(v=>v+1)}>→</button></div></section><div className="reports-stat-grid"><article><span>Total contacts</span><strong>{data.month.length}</strong></article><article><span>Billable hours</span><strong>{data.monthTotals.billableHours.toFixed(2)}</strong></article><article><span>KM</span><strong>{data.monthTotals.kilometres.toFixed(1)}</strong></article><article><span>Earnings</span><strong>{money(data.monthTotals.earnings)}</strong></article><article><span>Travel</span><strong>{money(data.monthTotals.travel)}</strong></article><article><span>Notes complete</span><strong>{data.month.filter(hasNote).length}/{data.month.length}</strong></article></div></div>}
  {state&&data&&tab==='contacts'&&<div className="reports-page"><section className="reports-card"><div className="reports-card-head"><div><span>{data.monthDate.toLocaleDateString(undefined,{month:'long',year:'numeric'})}</span><h3>Contact list</h3></div><strong>{data.month.length} contacts</strong></div><div className="reports-entry-list">{data.month.map(e=><div key={e.id}><span>{formatDate(e.date)} · {e.startTime}</span><strong>{e.client}</strong><small>{entryType(e.type).label} · {e.minutes} min · {entryBillableHours(e).toFixed(2)} billable h · {entryKilometres(e).toFixed(1)} km · {e.supportNoteStatus||'Incomplete'}</small></div>)}</div></section></div>}
  {state&&data&&tab==='notes'&&<div className="reports-page"><section className="reports-card"><div className="reports-card-head"><div><span>Support Worker Log template</span><h3>Support note previews</h3></div><strong>{notes.length} ready</strong></div><input className="reports-search" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search client, date or type…"/><div className="reports-note-list">{notes.length?notes.map(e=><article key={e.id}><div><span>{formatDate(e.date)} · {e.startTime}</span><h4>{e.client}</h4><p>{entryType(e.type).label} · {e.minutes} minutes · {e.supportNoteStatus||'in progress'}</p></div><button onClick={()=>setPreviewNote(e)}>Preview note</button></article>):<p className="reports-empty">No support-note content matches this search.</p>}</div></section></div>}
  {state&&data&&tab==='invoice'&&<div className="reports-page"><section className="reports-period-head"><div><span>Invoice period</span><strong>Invoice {data.number} · {formatDate(data.startKey)} – {formatDate(data.endKey)}</strong></div><div><button onClick={()=>setOffset(v=>v-1)}>←</button><button onClick={()=>setOffset(0)}>Current</button><button onClick={()=>setOffset(v=>v+1)}>→</button></div></section><section className="reports-card"><div className="document-preview" dangerouslySetInnerHTML={{__html:invoiceBody({number:data.number,startKey:data.startKey,endKey:data.endKey,entries:data.entries,hourlyRate:state.settings.hourlyRate,fuelRate:state.settings.fuelRate})}}/><button className="reports-primary" disabled={!data.entries.length} onClick={()=>printInvoice({number:data.number,startKey:data.startKey,endKey:data.endKey,entries:data.entries,hourlyRate:state.settings.hourlyRate,fuelRate:state.settings.fuelRate})}>Open full invoice / Print / Save PDF</button><p className="reports-hint">Preview uses the same invoice structure, labels, rows and billing calculations as Support Worker Log.</p></section></div>}
  <footer className="reports-footer"><span>{state?'Cloud workspace loaded':'Cloud workspace not loaded'}</span><button onClick={()=>void refresh()} disabled={loading}>{loading?'Refreshing…':'Refresh cloud data'}</button></footer></div></div>}
  {previewNote&&<div className="reports-overlay preview-layer" role="dialog" aria-modal="true"><div className="reports-shell note-preview-shell"><header className="reports-header"><div><span>SUPPORT NOTE PREVIEW</span><h2>{previewNote.client}</h2><p>{formatDate(previewNote.date)} · {entryType(previewNote.type).label}</p></div><button onClick={()=>setPreviewNote(null)}>×</button></header><div className="reports-page"><div className="document-preview note-document-preview" dangerouslySetInnerHTML={{__html:supportTemplateHtml(previewNote)}}/><button className="reports-primary" onClick={()=>printNote(previewNote)}>Open full note / Print / Save PDF</button></div></div></div>}</>;
}
