import JSZip from 'jszip';
import { goldStandardTemplateContent } from './supportNoteTemplate';
import type { WorkEntry } from './model';

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

function populateTemplate(xml: string, entry: WorkEntry) {
  const bodyOpen = '<w:body>';
  const bodyClose = '</w:body>';
  const bodyStart = xml.indexOf(bodyOpen);
  const bodyEnd = xml.lastIndexOf(bodyClose);
  if (bodyStart < 0 || bodyEnd <= bodyStart) throw new Error('Support-note template body is missing.');

  const prefix = xml.slice(0, bodyStart + bodyOpen.length);
  const body = xml.slice(bodyStart + bodyOpen.length, bodyEnd);
  const paragraphs = [...body.matchAll(/<w:p(?:\s|>)[\s\S]*?<\/w:p>/g)].map((match) => match[0]);
  const sectionProperties = [...body.matchAll(/<w:sectPr[\s\S]*?<\/w:sectPr>/g)].at(-1)?.[0] ?? '';
  if (paragraphs.length < 19) throw new Error('Support-note template layout has changed.');

  const content = goldStandardTemplateContent(entry, entry.supportNotePersonName?.trim() || entry.client, entry.supportNoteBreakdown);
  const populated = paragraphs.slice(0, 19);
  populated[7] = replaceTemplateParagraphText(paragraphs[7], `Name of client. ${content.clientName}`);
  populated[8] = replaceTemplateParagraphText(paragraphs[8], `Date: ${content.date}`);
  populated[10] = replaceTemplateParagraphText(paragraphs[10], content.interactionDetails);
  populated[12] = replaceTemplateParagraphText(paragraphs[12], content.mainTopics);
  populated[14] = replaceTemplateParagraphText(paragraphs[14], content.outcomes);
  populated[16] = replaceTemplateParagraphText(paragraphs[16], content.overallImpression);
  populated[18] = replaceTemplateParagraphText(paragraphs[18], content.nextActions);

  return `${prefix}${populated.join('')}${sectionProperties}${bodyClose}</w:document>`;
}

function safeFilePart(value: string) {
  return value.trim().replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '') || 'note';
}

export async function buildSupportNoteDocx(entry: WorkEntry) {
  const response = await fetch('/support-note-template.docx', { cache: 'no-store' });
  if (!response.ok) throw new Error('Gold-standard support-note template could not be loaded.');

  const zip = await JSZip.loadAsync(await response.arrayBuffer());
  const documentFile = zip.file('word/document.xml');
  if (!documentFile) throw new Error('Gold-standard support-note template is missing document.xml.');
  zip.file('word/document.xml', populateTemplate(await documentFile.async('string'), entry));

  return zip.generateAsync({
    type: 'blob',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    compression: 'DEFLATE',
  });
}

export async function downloadSupportNoteDocx(entry: WorkEntry) {
  const blob = await buildSupportNoteDocx(entry);
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${safeFilePart(entry.date)}_${safeFilePart(entry.supportNotePersonName?.trim() || entry.client)}_support-note.docx`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
