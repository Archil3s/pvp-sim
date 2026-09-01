function nativeSet(textarea: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
  setter?.call(textarea, value);
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
  textarea.dispatchEvent(new Event('change', { bubbles: true }));
}

function textAreaByLabel(root: Element, label: string): HTMLTextAreaElement | null {
  return Array.from(root.querySelectorAll('label')).find(
    (item) => item.querySelector('span')?.textContent?.trim() === label,
  )?.querySelector('textarea') ?? null;
}

function combine(...values: Array<string | undefined>) {
  return values.map((value) => value?.trim() ?? '').filter(Boolean).join('\n\n');
}

function editableField(heading: string, value: string, onCommit: (value: string) => void) {
  const section = document.createElement('section');
  section.className = 'exact-template-field';
  const title = document.createElement('div');
  title.className = 'exact-template-field-title';
  title.textContent = heading;
  const textarea = document.createElement('textarea');
  textarea.value = value;
  textarea.rows = heading.startsWith('Main topic') ? 5 : 3;
  textarea.setAttribute('aria-label', heading);
  textarea.addEventListener('change', () => onCommit(textarea.value));
  section.append(title, textarea);
  return section;
}

function staticSection(heading: string, value = '') {
  const section = document.createElement('section');
  section.className = 'exact-template-static-section';
  const title = document.createElement('div');
  title.className = 'exact-template-static-title';
  title.textContent = heading;
  section.append(title);
  if (value) {
    const body = document.createElement('div');
    body.className = 'exact-template-static-body';
    body.textContent = value;
    section.append(body);
  }
  return section;
}

function formatDate(value: string) {
  const match = value.match(/(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})/);
  if (match) return `${match[1].padStart(2, '0')}/${match[2].padStart(2, '0')}/${match[3]}`;
  const iso = value.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[3]}/${iso[2]}/${iso[1]}`;
  return value;
}

function interactionType(value: string) {
  const clean = value.split('•')[0]?.trim() ?? value;
  return clean.replace(/\s*[·|]\s*.*$/, '').trim();
}

function safeFilePart(value: string) {
  return value.trim().replace(/[^a-z0-9_-]+/gi, '_').replace(/^_+|_+$/g, '') || 'client';
}

async function imageAsDataUrl(src: string) {
  try {
    const response = await fetch(src, { cache: 'force-cache' });
    if (!response.ok) return src;
    const blob = await response.blob();
    return await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result ?? src));
      reader.onerror = () => resolve(src);
      reader.readAsDataURL(blob);
    });
  } catch {
    return src;
  }
}

async function downloadNote(exact: HTMLElement, client: string, date: string) {
  const clone = exact.cloneNode(true) as HTMLElement;
  clone.querySelector('.exact-template-toolbar')?.remove();
  clone.querySelectorAll('textarea').forEach((textarea) => {
    const value = (textarea as HTMLTextAreaElement).value;
    const div = document.createElement('div');
    div.className = 'download-note-value';
    div.textContent = value;
    textarea.replaceWith(div);
  });

  const logo = clone.querySelector<HTMLImageElement>('.exact-template-logo');
  if (logo) logo.src = await imageAsDataUrl('/support-note-header.png');

  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Support note</title><style>
    body{font-family:Arial,Helvetica,sans-serif;color:#000;background:#fff;margin:42px 48px;font-size:12pt;line-height:1.35}
    .exact-template-top{display:grid;grid-template-columns:175px 1fr;align-items:center;column-gap:64px;margin-bottom:42px}
    .exact-template-logo{width:175px;height:auto}.exact-template-org-fallback{font-weight:700;font-size:11pt}
    .exact-template-title{white-space:pre-line;font-size:20pt;line-height:1.2;margin:0}.exact-template-intro{white-space:pre-line;margin:0 0 38px}
    .exact-template-details{margin-bottom:42px}.exact-template-details p{margin:0 0 8px}.exact-template-field{margin-bottom:27px}
    .exact-template-field-title{margin-bottom:8px}.download-note-value{min-height:36px;white-space:pre-wrap;margin-bottom:4px}
    .exact-template-static-section{margin-bottom:16px}.exact-template-static-title{font-weight:700;margin-bottom:8px}
  </style></head><body>${clone.innerHTML}</body></html>`;

  const blob = new Blob(['\ufeff', html], { type: 'application/msword' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  const iso = date.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  const fileDate = iso ? `${iso[3]}-${iso[2]}-${iso[1]}` : 'support-note';
  link.href = url;
  link.download = `${fileDate}_${safeFilePart(client)}_support_note.doc`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function enhancePaper(paper: HTMLElement) {
  if (paper.dataset.exactTemplate === 'true') return;

  const attendance = textAreaByLabel(paper, 'Attendance');
  const whatHappened = textAreaByLabel(paper, 'What happened');
  const workTask = textAreaByLabel(paper, 'Work/task completed');
  const outcome = textAreaByLabel(paper, 'Outcome');
  const supportGiven = textAreaByLabel(paper, 'Support given');
  const issueProblem = textAreaByLabel(paper, 'Issue/problem');
  const nextStep = textAreaByLabel(paper, 'Next step');
  const followUp = textAreaByLabel(paper, 'Anything to follow up');
  const referrals = textAreaByLabel(paper, 'Referrals');

  if (!whatHappened || !outcome || !supportGiven || !nextStep) return;

  paper.dataset.exactTemplate = 'true';
  paper.classList.add('exact-template-source');

  const meta = Array.from(paper.querySelectorAll('.gold-template-meta strong')).map(
    (item) => item.textContent?.trim() ?? '',
  );
  const originalInteraction = paper.querySelector('.gold-template-auto')?.textContent?.trim() ?? '';
  const client = meta[1] ?? '';
  const date = formatDate(meta[2] ?? '');
  const interaction = interactionType(originalInteraction);

  const exact = document.createElement('div');
  exact.className = 'exact-template-document';

  const toolbar = document.createElement('div');
  toolbar.className = 'exact-template-toolbar';
  const download = document.createElement('button');
  download.type = 'button';
  download.className = 'exact-template-download';
  download.textContent = 'Download note';
  download.addEventListener('click', () => void downloadNote(exact, client, date));
  toolbar.append(download);

  const top = document.createElement('div');
  top.className = 'exact-template-top';
  const brand = document.createElement('div');
  brand.className = 'exact-template-brand';
  const logo = document.createElement('img');
  logo.className = 'exact-template-logo';
  logo.src = '/support-note-header.png';
  logo.alt = 'Male Room and Tautoko Tāne Male Survivors Aotearoa';
  const fallback = document.createElement('div');
  fallback.className = 'exact-template-org-fallback';
  fallback.innerHTML = '<strong>male room</strong><br><strong>Tautoko Tāne</strong><br><span>Male Survivors Aotearoa</span>';
  logo.addEventListener('load', () => fallback.classList.add('is-hidden'));
  logo.addEventListener('error', () => fallback.classList.remove('is-hidden'));
  brand.append(logo, fallback);

  const title = document.createElement('h3');
  title.className = 'exact-template-title';
  title.textContent = 'Template for reporting of\ninteractions with survivors.';
  top.append(brand, title);

  const intro = document.createElement('p');
  intro.className = 'exact-template-intro';
  intro.textContent = 'This template is aimed at providing information in a format that meets the requirements of\nthe Ministry of Social Development.';

  const details = document.createElement('div');
  details.className = 'exact-template-details';
  details.innerHTML = `
    <p>Geographical area. Blenheim</p>
    <p><strong>Name of client:</strong> ${client}</p>
    <p><strong>Date: ${date}</strong></p>
    <p>Interaction: ${interaction}</p>
  `;

  exact.append(toolbar, top, intro, details);
  exact.append(
    editableField('Main topic(s)  (max. 200 words)', combine(whatHappened.value, workTask?.value), (value) => {
      nativeSet(whatHappened, value);
      if (workTask) nativeSet(workTask, '');
    }),
    editableField('Outcome(s)  (Max. 100 words)', outcome.value, (value) => nativeSet(outcome, value)),
    editableField('Overall impression (Max. 150 words)`', combine(supportGiven.value, issueProblem?.value), (value) => {
      nativeSet(supportGiven, value);
      if (issueProblem) nativeSet(issueProblem, '');
    }),
    editableField('Next actions  Max. 150 words)`', combine(nextStep.value, followUp?.value), (value) => {
      nativeSet(nextStep, value);
      if (followUp) nativeSet(followUp, '');
    }),
    editableField('Referrals', referrals?.value ?? '', (value) => {
      if (referrals) nativeSet(referrals, value);
    }),
    staticSection('Safety concerns for sexual harm survivors and mental health', 'No safety concerns noted.'),
  );

  if (attendance) attendance.dataset.exactTemplateHidden = 'true';
  paper.append(exact);
}

function enhanceAll() {
  document.querySelectorAll<HTMLElement>('.gold-template-paper').forEach(enhancePaper);
}

let queued = false;
const observer = new MutationObserver(() => {
  if (queued) return;
  queued = true;
  queueMicrotask(() => {
    queued = false;
    enhanceAll();
  });
});

export function installExactSupportTemplate() {
  enhanceAll();
  observer.observe(document.documentElement, { childList: true, subtree: true });
}
