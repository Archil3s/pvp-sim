import JSZip from 'jszip';
import { goldStandardTemplateContent, parseStructuredSupportNote } from './supportNoteTemplate';
import type { WorkEntry } from './model';

export type ExactSupportNoteInput = {
  client: string;
  date: string;
  interaction: string;
  mainTopics: string;
  outcomes: string;
  overallImpression: string;
  nextActions: string;
  referrals?: string;
  safetyConcerns?: string;
};

const ORIGINAL_TEMPLATE = 'https://raw.githubusercontent.com/Archil3s/support_worker_log/main/assets/templates/TEMPLATE.docx';

function escapeXml(value: string) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');
}
function runXml(value: string) {
  const lines = (value || ' ').replaceAll('\r\n', '\n').split('\n');
  return `<w:r>${lines.map((line, index) => `${index ? '<w:br/>' : ''}<w:t xml:space="preserve">${escapeXml(line || ' ')}</w:t>`).join('')}</w:r>`;
}
function replaceTemplateParagraphText(paragraph: string, value: string) {
  const opening = paragraph.match(/^<w:p(?:\s[^>]*)?>/)?.[0] ?? '<w:p>';
  const props = paragraph.match(/<w:pPr[\s\S]*?<\/w:pPr>/)?.[0] ?? '';
  return `${opening}${props}${runXml(value)}</w:p>`;
}
function populateExactTemplate(xml: string, input: ExactSupportNoteInput) {
  const bodyOpen = '<w:body>', bodyClose = '</w:body>';
  const bodyStart = xml.indexOf(bodyOpen), bodyEnd = xml.lastIndexOf(bodyClose);
  if (bodyStart < 0 || bodyEnd <= bodyStart) throw new Error('Support-note template body is missing.');
  const prefix = xml.slice(0, bodyStart + bodyOpen.length);
  const body = xml.slice(bodyStart + bodyOpen.length, bodyEnd);
  const paragraphs = [...body.matchAll(/<w:p(?:\s|>)[\s\S]*?<\/w:p>/g)].map((match) => match[0]);
  const sectionProperties = [...body.matchAll(/<w:sectPr[\s\S]*?<\/w:sectPr>/g)].at(-1)?.[0] ?? '';
  if (paragraphs.length < 19) throw new Error('Support-note template layout has changed.');
  const populated = [...paragraphs];
  populated[7] = replaceTemplateParagraphText(paragraphs[7], `Name of client: ${input.client}`);
  populated[8] = replaceTemplateParagraphText(paragraphs[8], `Date: ${input.date}`);
  populated[9] = replaceTemplateParagraphText(paragraphs[9], `Interaction: ${input.interaction}`);
  populated[11] = replaceTemplateParagraphText(paragraphs[11], input.mainTopics);
  populated[13] = replaceTemplateParagraphText(paragraphs[13], input.outcomes);
  populated[15] = replaceTemplateParagraphText(paragraphs[15], input.overallImpression);
  populated[17] = replaceTemplateParagraphText(paragraphs[17], input.nextActions);
  if (paragraphs[19] && input.referrals !== undefined) populated[19] = replaceTemplateParagraphText(paragraphs[19], input.referrals);
  if (paragraphs[22] && input.safetyConcerns) populated[22] = replaceTemplateParagraphText(paragraphs[22], input.safetyConcerns);
  return `${prefix}${populated.join('')}${sectionProperties}${bodyClose}</w:document>`;
}
function safeFilePart(value: string) {
  return value.trim().replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '') || 'note';
}
async function templateZip() {
  let response: Response | null = null;
  try { response = await fetch(ORIGINAL_TEMPLATE, { cache: 'no-store', mode: 'cors' }); } catch { response = null; }
  if (!response?.ok) response = await fetch('/support-note-template.docx', { cache: 'no-store' });
  if (!response.ok) throw new Error(`Support-note template could not be loaded (${response.status}).`);
  return JSZip.loadAsync(await response.arrayBuffer());
}
async function buildExactDocx(input: ExactSupportNoteInput) {
  const zip = await templateZip();
  const documentFile = zip.file('word/document.xml');
  if (!documentFile) throw new Error('Support-note template is missing word/document.xml.');
  zip.file('word/document.xml', populateExactTemplate(await documentFile.async('string'), input));
  return zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', compression: 'DEFLATE' });
}
function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = filename; anchor.style.display = 'none';
  document.body.appendChild(anchor); anchor.click(); anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 5000);
}
export async function downloadExactSupportNoteDocx(input: ExactSupportNoteInput) {
  triggerDownload(await buildExactDocx(input), `${safeFilePart(input.date)}_${safeFilePart(input.client)}_support-note.docx`);
}
export async function buildSupportNoteDocx(entry: WorkEntry) {
  const content = goldStandardTemplateContent(entry, entry.supportNotePersonName?.trim() || entry.client, entry.supportNoteBreakdown);
  const sections = parseStructuredSupportNote(entry.supportNoteBreakdown);
  return buildExactDocx({
    client: content.clientName,
    date: content.date,
    interaction: content.interactionDetails.replace(/^Interaction:\s*/i, ''),
    mainTopics: content.mainTopics,
    outcomes: content.outcomes,
    overallImpression: content.overallImpression,
    nextActions: content.nextActions,
    referrals: sections.Referrals,
    safetyConcerns: 'No safety concerns noted.',
  });
}
export async function downloadSupportNoteDocx(entry: WorkEntry) {
  triggerDownload(await buildSupportNoteDocx(entry), `${safeFilePart(entry.date)}_${safeFilePart(entry.supportNotePersonName?.trim() || entry.client)}_support-note.docx`);
}
