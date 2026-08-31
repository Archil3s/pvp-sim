export type Mode = 'work';

export type Section =
  | 'home'
  | 'quick'
  | 'entries'
  | 'calendar'
  | 'payPeriod'
  | 'actions';

export type EntryTypeKey =
  | 'homeVisit'
  | 'professionalContact'
  | 'phoneCall'
  | 'videoCall'
  | 'emailClient'
  | 'emailProfessional'
  | 'adminEducationResources'
  | 'textNote';

export type TextContactDirection = 'received' | 'sent' | 'exchange';

export interface EntryTypeDefinition {
  key: EntryTypeKey;
  label: string;
  shortLabel: string;
  icon: string;
  workOnly: boolean;
  requiresClient: boolean;
  optionalClient: boolean;
}

export const ENTRY_TYPES: EntryTypeDefinition[] = [
  {
    key: 'homeVisit',
    label: 'Home Visit',
    shortLabel: 'Home visit',
    icon: '⌂',
    workOnly: false,
    requiresClient: true,
    optionalClient: false,
  },
  {
    key: 'professionalContact',
    label: 'Professional Contact',
    shortLabel: 'Professional',
    icon: '↔',
    workOnly: false,
    requiresClient: true,
    optionalClient: false,
  },
  {
    key: 'phoneCall',
    label: 'Phone Call',
    shortLabel: 'Phone',
    icon: '☎',
    workOnly: false,
    requiresClient: true,
    optionalClient: false,
  },
  {
    key: 'videoCall',
    label: 'Video Call',
    shortLabel: 'Video',
    icon: '▣',
    workOnly: true,
    requiresClient: true,
    optionalClient: false,
  },
  {
    key: 'emailClient',
    label: 'Email Client',
    shortLabel: 'Client email',
    icon: '@',
    workOnly: true,
    requiresClient: true,
    optionalClient: false,
  },
  {
    key: 'emailProfessional',
    label: 'Email Professional',
    shortLabel: 'Professional email',
    icon: '✉',
    workOnly: true,
    requiresClient: false,
    optionalClient: false,
  },
  {
    key: 'adminEducationResources',
    label: 'Admin / Education / Resources',
    shortLabel: 'Admin / resources',
    icon: '▤',
    workOnly: true,
    requiresClient: false,
    optionalClient: true,
  },
  {
    key: 'textNote',
    label: 'Text Note',
    shortLabel: 'Text',
    icon: '☵',
    workOnly: false,
    requiresClient: true,
    optionalClient: false,
  },
];

export interface Client {
  id: string;
  name: string;
  mode: Mode;
  createdAt: string;
}

export interface NextAction {
  id: string;
  text: string;
  createdAt: string;
  completedAt: string | null;
}

export interface WorkEntry {
  id: string;
  mode: Mode;
  clientId: string | null;
  client: string;
  type: EntryTypeKey;
  date: string;
  startTime: string;
  minutes: number;
  notes: string[];
  supportNoteBreakdown: string;
  nextActions: NextAction[];
  googleCalendarEntered: boolean;
  importantText: boolean;
  textContactDirection: TextContactDirection;
  textReplyNeeded: boolean;
  odometerStart: number | null;
  odometerEnd: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface GeneralAction {
  id: string;
  mode: Mode;
  title: string;
  scope: 'client' | 'knowledgeGap';
  client: string | null;
  createdAt: string;
  completedAt: string | null;
  updatedAt: string;
}

export interface WorkspaceState {
  workspaceId: string;
  createdAt: string;
  authenticatorEnabled: boolean;
  accountEmail: string;
  recoveryEmailEnabled: boolean;
  clients: Client[];
  entries: WorkEntry[];
  actions: GeneralAction[];
}

export interface WorkspaceCredentials {
  workspaceId: string;
  sessionToken: string;
}

export interface WorkspaceSetupChallenge {
  workspaceId: string;
  totpSecret: string;
  otpauthUri: string;
}

export interface EmailRecoveryChallenge {
  workspaceId: string;
  recoveryToken: string;
  totpSecret: string;
  otpauthUri: string;
}

export interface EntryDraft {
  mode: Mode;
  client: string;
  type: EntryTypeKey;
  date: string;
  startTime: string;
  minutes: number;
  notes: string[];
  supportNoteBreakdown: string;
  nextAction: string;
  importantText: boolean;
  textContactDirection: TextContactDirection;
  textReplyNeeded: boolean;
  odometerStart: number | null;
  odometerEnd: number | null;
}

export function entryType(key: EntryTypeKey): EntryTypeDefinition {
  return ENTRY_TYPES.find((item) => item.key === key) ?? ENTRY_TYPES[0];
}

export function entryTypesForMode(_mode: Mode): EntryTypeDefinition[] {
  return ENTRY_TYPES;
}

export function localDateValue(date = new Date()): string {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

export function localTimeValue(date = new Date()): string {
  return [date.getHours(), date.getMinutes()]
    .map((value) => String(value).padStart(2, '0'))
    .join(':');
}

export function entryKilometres(entry: WorkEntry): number {
  if (entry.type !== 'homeVisit') return 0;
  if (entry.odometerStart == null || entry.odometerEnd == null) return 0;
  return Math.max(0, entry.odometerEnd - entry.odometerStart);
}

export function formatHours(minutes: number): string {
  const hours = Math.max(0, minutes) / 60;
  return hours.toFixed(hours >= 10 ? 1 : 2);
}

export function formatDate(date: string): string {
  const parsed = new Date(date + 'T12:00:00');
  if (Number.isNaN(parsed.getTime())) return date;
  return parsed.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: parsed.getFullYear() === new Date().getFullYear() ? undefined : 'numeric',
  });
}

export function modeLabel(_mode: Mode): string {
  return 'Work';
}
