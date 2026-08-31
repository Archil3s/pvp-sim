import { entryType, type WorkEntry } from './model';

export const STRUCTURED_SUPPORT_NOTE_TEMPLATE = [
  'Attendance',
  '',
  'What happened',
  '',
  'Work/task completed',
  '',
  'Support given',
  '',
  'Issue/problem',
  '',
  'Outcome',
  '',
  'Next step',
  '',
  'Anything to follow up',
  '',
  'Referrals',
].join('\n');

export const REFERRALS_TEMPLATE = [
  'Referrals',
  '',
  'Police / emergency services:',
  'GP / crisis team:',
  'Sexual harm services:',
  'WINZ / housing / legal / counselling:',
  '',
  'Referral status: made / discussed / declined / pending',
  'Consent given:',
  'Information shared:',
  'Follow-up needed:',
].join('\n');

export const SAFETY_CONCERNS_TEMPLATE = [
  'Safety Concerns',
  '',
  'Sexual harm survivor safety concerns:',
  'Mental health concerns:',
  'Immediate risk identified:',
  'Protective actions discussed:',
  'Escalation / referral needed:',
  'Follow-up timeframe:',
].join('\n');

const CANONICAL_HEADINGS = [
  'Attendance',
  'What happened',
  'Work/task completed',
  'Support given',
  'Issue/problem',
  'Outcome',
  'Next step',
  'Anything to follow up',
  'Referrals',
] as const;

export type StructuredSupportHeading = (typeof CANONICAL_HEADINGS)[number];

const HEADING_ALIASES = new Map<string, StructuredSupportHeading>([
  ['attendance', 'Attendance'],
  ['what happened', 'What happened'],
  ['main topic', 'What happened'],
  ['main topics', 'What happened'],
  ['main topic(s)', 'What happened'],
  ['work/task completed', 'Work/task completed'],
  ['work task completed', 'Work/task completed'],
  ['support given', 'Support given'],
  ['overall impression', 'Support given'],
  ['issue/problem', 'Issue/problem'],
  ['issue / problem', 'Issue/problem'],
  ['issue problem', 'Issue/problem'],
  ['safety concerns', 'Issue/problem'],
  ['outcome', 'Outcome'],
  ['outcomes', 'Outcome'],
  ['outcome(s)', 'Outcome'],
  ['next step', 'Next step'],
  ['next action', 'Next step'],
  ['next actions', 'Next step'],
  ['next action(s)', 'Next step'],
  ['anything to follow up', 'Anything to follow up'],
  ['referrals', 'Referrals'],
]);

function normalizedHeading(value: string): string {
  return value
    .replace(/\*/g, '')
    .replace(/:$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function headingForLine(value: string): StructuredSupportHeading | null {
  return HEADING_ALIASES.get(normalizedHeading(value)) || null;
}

export function parseStructuredSupportNote(
  noteText: string,
): Record<StructuredSupportHeading, string> {
  const sections = Object.fromEntries(
    CANONICAL_HEADINGS.map((heading) => [heading, '']),
  ) as Record<StructuredSupportHeading, string>;

  let current: StructuredSupportHeading | null = null;
  const buffers = Object.fromEntries(
    CANONICAL_HEADINGS.map((heading) => [heading, [] as string[]]),
  ) as Record<StructuredSupportHeading, string[]>;

  for (const rawLine of noteText.replace(/\r\n/g, '\n').split('\n')) {
    const heading = headingForLine(rawLine);
    if (heading) {
      current = heading;
      continue;
    }

    if (current) buffers[current].push(rawLine);
  }

  for (const heading of CANONICAL_HEADINGS) {
    sections[heading] = buffers[heading]
      .join('\n')
      .replace(/^\s+|\s+$/g, '')
      .replace(/\n{3,}/g, '\n\n');
  }

  return sections;
}

function groupedField(
  sections: Record<StructuredSupportHeading, string>,
  headings: StructuredSupportHeading[],
): string {
  return headings
    .map((heading) => {
      const body = sections[heading].trim();
      return heading + '\n' + body;
    })
    .join('\n\n')
    .trim();
}

function groupedBodies(
  sections: Record<StructuredSupportHeading, string>,
  headings: StructuredSupportHeading[],
): string {
  return headings
    .map((heading) => sections[heading].trim())
    .filter(Boolean)
    .join('\n\n')
    .trim();
}

function formatTemplateDate(dateText: string): string {
  const date = new Date(dateText + 'T12:00:00');
  if (Number.isNaN(date.getTime())) return dateText;
  return new Intl.DateTimeFormat('en-NZ', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(date);
}

export function countWords(value: string): number {
  const matches = value.trim().match(/\b[\p{L}\p{N}][\p{L}\p{N}'’/-]*\b/gu);
  return matches?.length || 0;
}

export type GoldStandardTemplateContent = {
  clientName: string;
  date: string;
  interactionDetails: string;
  mainTopics: string;
  outcomes: string;
  overallImpression: string;
  nextActions: string;
  wordCounts: {
    mainTopics: number;
    outcomes: number;
    overallImpression: number;
    nextActions: number;
  };
};

export function goldStandardTemplateContent(
  entry: Pick<WorkEntry, 'client' | 'date' | 'startTime' | 'minutes' | 'type'>,
  personName: string,
  noteText: string,
): GoldStandardTemplateContent {
  const sections = parseStructuredSupportNote(noteText);
  const attendance = sections.Attendance.trim();
  const mainBodies = groupedBodies(sections, [
    'What happened',
    'Work/task completed',
  ]);
  const outcomeBodies = groupedBodies(sections, ['Outcome']);
  const impressionBodies = groupedBodies(sections, [
    'Support given',
    'Issue/problem',
  ]);
  const actionBodies = groupedBodies(sections, [
    'Next step',
    'Anything to follow up',
    'Referrals',
  ]);

  return {
    clientName: personName.trim() || entry.client,
    date: formatTemplateDate(entry.date),
    interactionDetails: [
      entryType(entry.type).label +
        '; ' +
        entry.startTime +
        '; ' +
        Math.max(0, Math.round(entry.minutes || 0)) +
        ' minutes.',
      'Attendance\n' + attendance,
    ].join('\n'),
    mainTopics: groupedField(sections, [
      'What happened',
      'Work/task completed',
    ]),
    outcomes: groupedField(sections, ['Outcome']),
    overallImpression: groupedField(sections, [
      'Support given',
      'Issue/problem',
    ]),
    nextActions: groupedField(sections, [
      'Next step',
      'Anything to follow up',
      'Referrals',
    ]),
    wordCounts: {
      mainTopics: countWords(mainBodies),
      outcomes: countWords(outcomeBodies),
      overallImpression: countWords(impressionBodies),
      nextActions: countWords(actionBodies),
    },
  };
}

export function goldStandardTemplatePlainText(
  entry: Pick<WorkEntry, 'client' | 'date' | 'startTime' | 'minutes' | 'type'>,
  personName: string,
  noteText: string,
): string {
  const content = goldStandardTemplateContent(entry, personName, noteText);

  return [
    'Template for reporting of interactions with survivors.',
    '',
    'This template is aimed at providing information in a format that meets the requirements of the Ministry of Social Development.',
    '',
    'Geographical area. Blenheim',
    'Name of client. ' + content.clientName,
    'Date: ' + content.date,
    'Date/time/length of interaction. Also record calls and texts, just time spent on each, no need for non important calls and texts. Record travel time.',
    content.interactionDetails,
    '',
    'Main topic(s)  (max. 200 words)',
    content.mainTopics,
    '',
    'Outcome(s)  (Max. 100 words)',
    content.outcomes,
    '',
    'Overall impression (Max. 150 words)',
    content.overallImpression,
    '',
    'Next actions  Max. 150 words',
    content.nextActions,
  ].join('\n').trim();
}

function hasRecognizedHeading(noteText: string): boolean {
  return noteText
    .replace(/\r\n/g, '\n')
    .split('\n')
    .some((line) => Boolean(headingForLine(line)));
}

export function ensureStructuredSupportNote(noteText: string): string {
  const trimmed = noteText.trim();
  if (!trimmed) return STRUCTURED_SUPPORT_NOTE_TEMPLATE;
  if (hasRecognizedHeading(trimmed)) return trimmed;

  const sections = parseStructuredSupportNote(STRUCTURED_SUPPORT_NOTE_TEMPLATE);
  sections['What happened'] = trimmed;

  return buildStructuredSupportNote(sections);
}

export function buildStructuredSupportNote(
  sections: Record<StructuredSupportHeading, string>,
): string {
  return CANONICAL_HEADINGS.map((heading) => {
    const body = sections[heading].trim();
    return body ? heading + '\n' + body : heading;
  }).join('\n\n');
}

export function updateStructuredSupportSection(
  noteText: string,
  heading: StructuredSupportHeading,
  value: string,
): string {
  const sections = parseStructuredSupportNote(
    ensureStructuredSupportNote(noteText),
  );
  sections[heading] = value;
  return buildStructuredSupportNote(sections);
}

export function insertSupportNoteTemplate(
  noteText: string,
  template: 'structured' | 'referrals' | 'safety',
): string {
  if (template === 'structured') return ensureStructuredSupportNote(noteText);

  const base = ensureStructuredSupportNote(noteText);
  const marker = template === 'referrals' ? 'Referral status:' : 'Immediate risk identified:';
  if (base.includes(marker)) return base;

  if (template === 'referrals') {
    const sections = parseStructuredSupportNote(base);
    const detail = REFERRALS_TEMPLATE.split('\n').slice(2).join('\n').trim();
    const existing = sections.Referrals.trim();
    sections.Referrals = [existing, detail].filter(Boolean).join('\n\n');

    return buildStructuredSupportNote(sections);
  }

  const sections = parseStructuredSupportNote(base);
  const detail = SAFETY_CONCERNS_TEMPLATE.split('\n').slice(2).join('\n').trim();
  const existing = sections['Issue/problem'].trim();
  sections['Issue/problem'] = [
    existing,
    'Safety Concerns',
    detail,
  ]
    .filter(Boolean)
    .join('\n\n');

  return CANONICAL_HEADINGS.map((heading) => {
    const body = sections[heading].trim();
    return body ? heading + '\n' + body : heading;
  }).join('\n\n');
}

export function supportNoteHasEnteredContent(noteText: string): boolean {
  if (!noteText.trim()) return false;
  const sections = parseStructuredSupportNote(noteText);
  const placeholderLines = new Set([
    'safety concerns',
    'referral status: made / discussed / declined / pending',
  ]);

  return Object.values(sections).some((body) =>
    body.split(/\r?\n/).some((line) => {
      const trimmed = line.trim();
      if (!trimmed) return false;
      if (placeholderLines.has(trimmed.toLowerCase())) return false;
      if (/^[^:]{2,}:\s*$/.test(trimmed)) return false;
      return true;
    }),
  );
}

export const GOLD_STANDARD_LIMITS = {
  mainTopics: 200,
  outcomes: 100,
  overallImpression: 150,
  nextActions: 150,
} as const;
