const exactInstruction =
  'Date/time/length of interaction. Also record calls and texts, just time spent on each, no need for non important calls and texts. Record travel time.';

function nativeSet(textarea: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLTextAreaElement.prototype,
    'value',
  )?.set;
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
  return values
    .map((value) => value?.trim() ?? '')
    .filter(Boolean)
    .join('\n\n');
}

function field(
  heading: string,
  limit: string,
  value: string,
  onCommit: (value: string) => void,
) {
  const section = document.createElement('section');
  section.className = 'exact-template-field';

  const title = document.createElement('div');
  title.className = 'exact-template-field-title';
  const h4 = document.createElement('h4');
  h4.textContent = heading;
  const small = document.createElement('small');
  small.textContent = limit;
  title.append(h4, small);

  const textarea = document.createElement('textarea');
  textarea.value = value;
  textarea.rows = heading === 'Main topic(s)' ? 7 : 5;
  textarea.setAttribute('aria-label', `${heading} ${limit}`);
  textarea.addEventListener('change', () => onCommit(textarea.value));

  section.append(title, textarea);
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
  const interaction = paper.querySelector('.gold-template-auto')?.textContent?.trim() ?? '';

  const exact = document.createElement('div');
  exact.className = 'exact-template-document';

  const header = document.createElement('header');
  header.className = 'exact-template-header';
  const title = document.createElement('h3');
  title.textContent = 'Template for reporting of interactions with survivors.';
  const intro = document.createElement('p');
  intro.textContent =
    'This template is aimed at providing information in a format that meets the requirements of the Ministry of Social Development.';
  header.append(title, intro);

  const details = document.createElement('div');
  details.className = 'exact-template-details';
  details.innerHTML = `
    <p><strong>Geographical area.</strong> Blenheim</p>
    <p><strong>Name of client.</strong> ${meta[1] ?? ''}</p>
    <p><strong>Date:</strong> ${meta[2] ?? ''}</p>
    <p class="exact-template-instruction"><strong>${exactInstruction}</strong></p>
    <p class="exact-template-interaction"></p>
  `;
  const interactionLine = details.querySelector('.exact-template-interaction');
  if (interactionLine) interactionLine.textContent = interaction;

  exact.append(header, details);

  exact.append(
    field(
      'Main topic(s)',
      '(max. 200 words)',
      combine(whatHappened.value, workTask?.value),
      (value) => {
        nativeSet(whatHappened, value);
        if (workTask) nativeSet(workTask, '');
      },
    ),
    field('Outcome(s)', '(Max. 100 words)', outcome.value, (value) => {
      nativeSet(outcome, value);
    }),
    field(
      'Overall impression',
      '(Max. 150 words)',
      combine(supportGiven.value, issueProblem?.value),
      (value) => {
        nativeSet(supportGiven, value);
        if (issueProblem) nativeSet(issueProblem, '');
      },
    ),
    field(
      'Next actions',
      'Max. 150 words',
      combine(nextStep.value, followUp?.value, referrals?.value),
      (value) => {
        nativeSet(nextStep, value);
        if (followUp) nativeSet(followUp, '');
        if (referrals) nativeSet(referrals, '');
      },
    ),
  );

  if (attendance) attendance.dataset.exactTemplateHidden = 'true';

  paper.append(exact);
}

function enhanceAll() {
  document
    .querySelectorAll<HTMLElement>('.gold-template-paper')
    .forEach(enhancePaper);
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
