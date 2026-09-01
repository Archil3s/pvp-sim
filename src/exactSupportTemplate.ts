import { downloadExactSupportNoteDocx } from './supportNoteDocx';

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

function editableField(
  heading: string,
  value: string,
  onCommit: (value: string) => void,
  className = '',
) {
  const section = document.createElement('section');
  section.className = `exact-template-field ${className}`.trim();

  const title = document.createElement('div');
  title.className = 'exact-template-field-title';
  title.textContent = heading;

  const textarea = document.createElement('textarea');
  textarea.value = value;
  textarea.rows = 2;
  textarea.setAttribute('aria-label', heading);
  textarea.addEventListener('input', () => onCommit(textarea.value));

  section.append(title, textarea);
  return { section, textarea };
}

function staticSection(heading: string, value: string) {
  const section = document.createElement('section');
  section.className = 'exact-template-static-section';
  const title = document.createElement('div');
  title.className = 'exact-template-static-title';
  title.textContent = heading;
  const body = document.createElement('div');
  body.className = 'exact-template-static-body';
  body.textContent = value;
  section.append(title, body);
  return section;
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

  const top = document.createElement('div');
  top.className = 'exact-template-top';

  const logo = document.createElement('img');
  logo.className = 'exact-template-logo';
  logo.src = '/support-note-header.png';
  logo.alt = 'Male Room and Tautoko Tāne Male Survivors Aotearoa';

  const title = document.createElement('h3');
  title.className = 'exact-template-title';
  title.textContent = 'Template for reporting of interactions with survivors.';
  top.append(logo, title);

  const spacerOne = document.createElement('div');
  spacerOne.className = 'exact-template-blank exact-template-blank-two-lines';

  const intro = document.createElement('p');
  intro.className = 'exact-template-intro';
  intro.textContent =
    'This template is aimed at providing information in a format that meets the requirements of the Ministry of Social Development.';

  const spacerTwo = document.createElement('div');
  spacerTwo.className = 'exact-template-blank';

  const details = document.createElement('div');
  details.className = 'exact-template-details';
  details.innerHTML = `
    <p>Geographical area. Blenheim</p>
    <p><strong>Name of client:</strong> <span>${client}</span></p>
    <p><strong>Date: ${date}</strong></p>
    <p>Interaction: ${interaction}</p>
  `;

  const main = editableField(
    'Main topic(s)  (max. 200 words)',
    combine(whatHappened.value, workTask?.value),
    (value) => {
      nativeSet(whatHappened, value);
      if (workTask) nativeSet(workTask, '');
    },
    'exact-template-main',
  );

  const outcomes = editableField('Outcome(s)  (Max. 100 words)', outcome.value, (value) => {
    nativeSet(outcome, value);
  });

  const impression = editableField(
    'Overall impression (Max. 150 words)`',
    combine(supportGiven.value, issueProblem?.value),
    (value) => {
      nativeSet(supportGiven, value);
      if (issueProblem) nativeSet(issueProblem, '');
    },
  );

  const actions = editableField(
    'Next actions  Max. 150 words)`',
    combine(nextStep.value, followUp?.value),
    (value) => {
      nativeSet(nextStep, value);
      if (followUp) nativeSet(followUp, '');
    },
  );

  const referralField = editableField('Referrals', referrals?.value ?? '', (value) => {
    if (referrals) nativeSet(referrals, value);
  });

  exact.append(
    top,
    spacerOne,
    intro,
    spacerTwo,
    details,
    main.section,
    outcomes.section,
    impression.section,
    actions.section,
    referralField.section,
    staticSection(
      'Safety concerns for sexual harm survivors and mental health',
      'No safety concerns noted.',
    ),
  );

  const actionBar = document.createElement('div');
  actionBar.className = 'exact-template-actions';
  const download = document.createElement('button');
  download.type = 'button';
  download.className = 'exact-template-download';
  download.textContent = 'Download exact Word note';
  download.addEventListener('click', async () => {
    const original = download.textContent;
    download.disabled = true;
    download.textContent = 'Preparing Word note…';
    try {
      await downloadExactSupportNoteDocx({
        client,
        date,
        interaction,
        mainTopics: main.textarea.value,
        outcomes: outcomes.textarea.value,
        overallImpression: impression.textarea.value,
        nextActions: actions.textarea.value,
        referrals: referralField.textarea.value,
        safetyConcerns: 'No safety concerns noted.',
      });
      download.textContent = 'Downloaded';
    } catch (error) {
      console.error('Exact support-note download failed', error);
      download.textContent = 'Download failed';
    } finally {
      window.setTimeout(() => {
        download.disabled = false;
        download.textContent = original;
      }, 1600);
    }
  });
  actionBar.append(download);

  if (attendance) attendance.dataset.exactTemplateHidden = 'true';
  paper.before(actionBar);
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
