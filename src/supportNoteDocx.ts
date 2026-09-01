import JSZip from 'jszip';

export type ExactSupportNoteDocxData = {
  client: string;
  date: string;
  interaction: string;
  mainTopics: string;
  outcomes: string;
  overallImpression: string;
  nextActions: string;
  referrals: string;
  safetyConcerns?: string;
};

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function escapeXml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function runXml(value: string, bold = false) {
  const lines = value.replaceAll('\r\n', '\n').split('\n');
  const body = lines
    .map((line, index) => `${index ? '<w:br/>' : ''}<w:t xml:space="preserve">${escapeXml(line)}</w:t>`)
    .join('');
  return `<w:r>${bold ? '<w:rPr><w:b/><w:bCs/></w:rPr>' : ''}${body}</w:r>`;
}

function paragraphShell(paragraph: string) {
  const opening = paragraph.match(/^<w:p(?:\s[^>]*)?>/)?.[0] ?? '<w:p>';
  const props = paragraph.match(/<w:pPr[\s\S]*?<\/w:pPr>/)?.[0] ?? '';
  return { opening, props };
}

function replaceParagraph(paragraph: string, value: string, bold = false) {
  const { opening, props } = paragraphShell(paragraph);
  return `${opening}${props}${runXml(value, bold)}</w:p>`;
}

function replaceClientParagraph(paragraph: string, client: string) {
  const { opening, props } = paragraphShell(paragraph);
  return `${opening}${props}${runXml('Name of client: ', true)}${runXml(client)}</w:p>`;
}

function replaceDocumentParagraphs(xml: string, data: ExactSupportNoteDocxData) {
  const bodyStart = xml.indexOf('<w:body>');
  const bodyEnd = xml.lastIndexOf('</w:body>');
  if (bodyStart < 0 || bodyEnd < 0) throw new Error('Support-note template body is missing.');

  const prefix = xml.slice(0, bodyStart + '<w:body>'.length);
  const body = xml.slice(bodyStart + '<w:body>'.length, bodyEnd);
  const suffix = xml.slice(bodyEnd);
  const paragraphs = [...body.matchAll(/<w:p(?:\s|>)[\s\S]*?<\/w:p>/g)].map((match) => match[0]);
  if (paragraphs.length < 23) throw new Error('Support-note template layout has changed.');

  paragraphs[7] = replaceClientParagraph(paragraphs[7], data.client);
  paragraphs[8] = replaceParagraph(paragraphs[8], `Date: ${data.date}`, true);
  paragraphs[9] = replaceParagraph(paragraphs[9], `Interaction: ${data.interaction}`);
  paragraphs[12] = replaceParagraph(paragraphs[12], data.mainTopics);
  paragraphs[14] = replaceParagraph(paragraphs[14], data.outcomes);
  paragraphs[16] = replaceParagraph(paragraphs[16], data.overallImpression);
  paragraphs[18] = replaceParagraph(paragraphs[18], data.nextActions);
  paragraphs[20] = replaceParagraph(paragraphs[20], data.referrals);
  paragraphs[22] = replaceParagraph(
    paragraphs[22],
    data.safetyConcerns?.trim() || 'No safety concerns noted.',
  );

  let cursor = 0;
  let paragraphIndex = 0;
  const rebuiltBody = body.replace(/<w:p(?:\s|>)[\s\S]*?<\/w:p>/g, () => paragraphs[paragraphIndex++]);
  void cursor;
  return `${prefix}${rebuiltBody}${suffix}`;
}

function safeFilePart(value: string) {
  return value.trim().replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '') || 'note';
}

export async function downloadExactSupportNoteDocx(data: ExactSupportNoteDocxData) {
  const response = await fetch('/support-note-template.docx', { cache: 'no-store' });
  if (!response.ok) throw new Error('Exact support-note template could not be loaded.');

  const templateBytes = await response.arrayBuffer();
  const zip = await JSZip.loadAsync(templateBytes);
  const documentFile = zip.file('word/document.xml');
  if (!documentFile) throw new Error('Exact support-note template is missing document.xml.');

  const xml = await documentFile.async('string');
  zip.file('word/document.xml', replaceDocumentParagraphs(xml, data));

  const blob = await zip.generateAsync({
    type: 'blob',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    compression: 'DEFLATE',
  });

  const datePart = data.date.split('/').reverse().join('-');
  const fileName = `${safeFilePart(datePart)}_${safeFilePart(data.client)}.docx`;
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
