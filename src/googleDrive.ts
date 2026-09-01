import {
  entryBillableHours,
  entryEarnings,
  entryKilometres,
  entryTravelReimbursement,
  entryType,
  formatDate,
  type DriveConnectionState,
  type DriveSupportNoteMeta,
  type InvoiceDriveMeta,
  type SupportNoteStatus,
  type WorkEntry,
} from './model';
import {
  STRUCTURED_SUPPORT_NOTE_TEMPLATE,
  goldStandardTemplatePlainText,
} from './supportNoteTemplate';

type GoogleTokenResponse = {
  access_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
};

type TokenClient = {
  requestAccessToken: (options?: { prompt?: string }) => void;
};

declare global {
  interface Window {
    google?: {
      accounts?: {
        oauth2?: {
          initTokenClient: (config: {
            client_id: string;
            scope: string;
            callback: (response: GoogleTokenResponse) => void;
            error_callback?: (error: unknown) => void;
          }) => TokenClient;
        };
      };
    };
  }
}

const GOOGLE_SCRIPT = 'https://accounts.google.com/gsi/client';
const DRIVE_FOLDER_MIME = 'application/vnd.google-apps.folder';
const GOOGLE_DOC_MIME = 'application/vnd.google-apps.document';
const DRIVE_SHORTCUT_MIME = 'application/vnd.google-apps.shortcut';
const ROOT_FOLDER_NAME = 'NMRNL Work';
const CLIENT_NOTES_FOLDER_NAME = 'Client Notes';
const INVOICES_FOLDER_NAME = 'Invoices';
const TEMPLATES_FOLDER_NAME = 'Templates';
const SUPPORT_TEMPLATE_NAME = 'Support Note Template';
const DRIVE_SCOPE = [
  'openid',
  'email',
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/documents',
].join(' ');
const TOKEN_KEY = 'nmrnl.google-drive-token.v1';
const TOKEN_EXPIRY_KEY = 'nmrnl.google-drive-token-expiry.v1';

let scriptPromise: Promise<void> | null = null;
let clientIdPromise: Promise<string> | null = null;

export type WorkDriveFile = {
  id: string;
  name: string;
  mimeType: string;
  webViewLink?: string;
  parents?: string[];
  shortcutDetails?: { targetId?: string };
};

export type WorkDriveRepairResult = {
  drive: DriveConnectionState;
  templatesFolderId: string;
  templateFileId: string;
  repaired: boolean;
};

function safeJson<T>(text: string): T {
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error('Google returned an invalid response.');
  }
}

async function googleClientId(): Promise<string> {
  if (!clientIdPromise) {
    clientIdPromise = fetch('/api/google/config')
      .then(async (response) => {
        if (!response.ok) {
          throw new Error('Google Drive configuration is unavailable.');
        }
        const payload = safeJson<{ clientId?: string }>(await response.text());
        return String(payload.clientId || '').trim();
      })
      .catch((error) => {
        clientIdPromise = null;
        throw error;
      });
  }

  const value = await clientIdPromise;
  if (!value) {
    throw new Error(
      'Google Drive is ready in NMRNL but the Google OAuth client ID has not been configured on the Worker yet.',
    );
  }
  return value;
}

function loadGoogleScript(): Promise<void> {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  if (scriptPromise) return scriptPromise;

  scriptPromise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      'script[data-nmrnl-google-identity]',
    );
    if (existing) {
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener(
        'error',
        () => reject(new Error('Could not load Google sign-in.')),
        { once: true },
      );
      return;
    }

    const script = document.createElement('script');
    script.src = GOOGLE_SCRIPT;
    script.async = true;
    script.defer = true;
    script.dataset.nmrnlGoogleIdentity = 'true';
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Could not load Google sign-in.'));
    document.head.appendChild(script);
  }).catch((error) => {
    scriptPromise = null;
    throw error;
  });

  return scriptPromise;
}

function cachedToken(): string {
  try {
    const token = sessionStorage.getItem(TOKEN_KEY)?.trim() || '';
    const expiry = Number(sessionStorage.getItem(TOKEN_EXPIRY_KEY) || 0);
    if (!token || !Number.isFinite(expiry) || Date.now() >= expiry - 30_000) {
      return '';
    }
    return token;
  } catch {
    return '';
  }
}

function rememberToken(token: string, expiresIn = 3600): void {
  try {
    sessionStorage.setItem(TOKEN_KEY, token);
    sessionStorage.setItem(
      TOKEN_EXPIRY_KEY,
      String(Date.now() + Math.max(60, expiresIn) * 1000),
    );
  } catch {
    // Memory-only OAuth remains usable when session storage is unavailable.
  }
}

export function disconnectGoogleDrive(): void {
  try {
    sessionStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(TOKEN_EXPIRY_KEY);
  } catch {
    // Ignore browser storage failures.
  }
}

export async function connectGoogleDrive(
  forceConsent = false,
): Promise<string> {
  const existing = !forceConsent ? cachedToken() : '';
  if (existing) return existing;

  await loadGoogleScript();
  const clientId = await googleClientId();
  const oauth = window.google?.accounts?.oauth2;
  if (!oauth) throw new Error('Google sign-in did not initialise.');

  return new Promise<string>((resolve, reject) => {
    const client = oauth.initTokenClient({
      client_id: clientId,
      scope: DRIVE_SCOPE,
      callback: (response) => {
        if (response.error || !response.access_token) {
          reject(
            new Error(
              response.error_description ||
                response.error ||
                'Google Drive permission was not granted.',
            ),
          );
          return;
        }

        rememberToken(response.access_token, response.expires_in);
        resolve(response.access_token);
      },
      error_callback: () =>
        reject(
          new Error(
            'Google sign-in was blocked or cancelled. Open NMRNL in Safari and try again.',
          ),
        ),
    });

    client.requestAccessToken({ prompt: forceConsent ? 'consent' : '' });
  });
}

async function googleFetch<T>(
  url: string,
  token: string,
  options: RequestInit = {},
): Promise<T> {
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: 'Bearer ' + token,
      ...(options.body
        ? { 'Content-Type': 'application/json; charset=utf-8' }
        : {}),
      ...(options.headers || {}),
    },
  });

  const raw = await response.text();
  if (!response.ok) {
    let message = raw.trim();
    try {
      const decoded = JSON.parse(raw) as { error?: { message?: string } };
      message = decoded.error?.message || message;
    } catch {
      // Keep raw Google error text.
    }

    if (response.status === 401 || response.status === 403) {
      disconnectGoogleDrive();
    }

    throw new Error(message || 'Google Drive request failed.');
  }

  if (!raw) return {} as T;
  return safeJson<T>(raw);
}

async function connectedGoogleEmail(token: string): Promise<string> {
  try {
    const payload = await googleFetch<{ email?: string }>(
      'https://www.googleapis.com/oauth2/v3/userinfo',
      token,
    );
    return String(payload.email || '').trim();
  } catch {
    return '';
  }
}

function driveQueryValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

async function getDriveFile(
  token: string,
  fileId: string,
): Promise<WorkDriveFile | null> {
  if (!fileId) return null;
  try {
    return await googleFetch<WorkDriveFile>(
      'https://www.googleapis.com/drive/v3/files/' +
        encodeURIComponent(fileId) +
        '?fields=id,name,mimeType,webViewLink,parents,shortcutDetails,trashed',
      token,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message.toLowerCase() : '';
    if (message.includes('not found') || message.includes('file not found')) {
      return null;
    }
    throw error;
  }
}

async function listNamedChildren(
  token: string,
  parentId: string,
  name: string,
): Promise<WorkDriveFile[]> {
  const query =
    "'" +
    driveQueryValue(parentId) +
    "' in parents and trashed = false and name = '" +
    driveQueryValue(name) +
    "'";
  const params = new URLSearchParams({
    q: query,
    fields:
      'files(id,name,mimeType,webViewLink,parents,shortcutDetails)',
    spaces: 'drive',
  });
  const payload = await googleFetch<{ files?: WorkDriveFile[] }>(
    'https://www.googleapis.com/drive/v3/files?' + params.toString(),
    token,
  );
  return Array.isArray(payload.files) ? payload.files : [];
}

async function listChildren(
  token: string,
  parentId: string,
): Promise<WorkDriveFile[]> {
  const params = new URLSearchParams({
    q:
      "'" + driveQueryValue(parentId) + "' in parents and trashed = false",
    fields:
      'files(id,name,mimeType,webViewLink,parents,shortcutDetails)',
    spaces: 'drive',
    orderBy: 'folder,name',
  });
  const payload = await googleFetch<{ files?: WorkDriveFile[] }>(
    'https://www.googleapis.com/drive/v3/files?' + params.toString(),
    token,
  );
  return Array.isArray(payload.files) ? payload.files : [];
}

async function createFolder(
  token: string,
  name: string,
  parentId?: string,
): Promise<WorkDriveFile> {
  return googleFetch<WorkDriveFile>(
    'https://www.googleapis.com/drive/v3/files?fields=id,name,mimeType,webViewLink,parents',
    token,
    {
      method: 'POST',
      body: JSON.stringify({
        name,
        mimeType: DRIVE_FOLDER_MIME,
        ...(parentId ? { parents: [parentId] } : {}),
      }),
    },
  );
}

async function findOrCreateFolder(
  token: string,
  name: string,
  parentId?: string,
): Promise<WorkDriveFile> {
  if (parentId) {
    const matches = await listNamedChildren(token, parentId, name);
    const folder = matches.find((item) => item.mimeType === DRIVE_FOLDER_MIME);
    if (folder) return folder;
  } else {
    const params = new URLSearchParams({
      q:
        "trashed = false and mimeType = '" +
        DRIVE_FOLDER_MIME +
        "' and name = '" +
        driveQueryValue(name) +
        "'",
      fields: 'files(id,name,mimeType,webViewLink,parents)',
      spaces: 'drive',
    });
    const payload = await googleFetch<{ files?: WorkDriveFile[] }>(
      'https://www.googleapis.com/drive/v3/files?' + params.toString(),
      token,
    );
    const folder = payload.files?.[0];
    if (folder) return folder;
  }

  return createFolder(token, name, parentId);
}

async function validFolder(
  token: string,
  fileId: string | undefined,
  parentId?: string,
): Promise<WorkDriveFile | null> {
  if (!fileId) return null;
  const file = await getDriveFile(token, fileId);
  if (!file || file.mimeType !== DRIVE_FOLDER_MIME) return null;
  if (parentId && !(file.parents || []).includes(parentId)) return null;
  return file;
}

async function ensureFolder(
  token: string,
  id: string | undefined,
  name: string,
  parentId?: string,
): Promise<{ folder: WorkDriveFile; repaired: boolean }> {
  const existing = await validFolder(token, id, parentId);
  if (existing) {
    if (existing.name !== name) {
      const renamed = await googleFetch<WorkDriveFile>(
        'https://www.googleapis.com/drive/v3/files/' +
          encodeURIComponent(existing.id) +
          '?fields=id,name,mimeType,webViewLink,parents',
        token,
        {
          method: 'PATCH',
          body: JSON.stringify({ name }),
        },
      );
      return { folder: renamed, repaired: true };
    }
    return { folder: existing, repaired: false };
  }

  return {
    folder: await findOrCreateFolder(token, name, parentId),
    repaired: true,
  };
}

async function createGoogleDoc(
  token: string,
  name: string,
  parentId: string,
): Promise<WorkDriveFile> {
  return googleFetch<WorkDriveFile>(
    'https://www.googleapis.com/drive/v3/files?fields=id,name,mimeType,webViewLink,parents',
    token,
    {
      method: 'POST',
      body: JSON.stringify({
        name,
        mimeType: GOOGLE_DOC_MIME,
        parents: [parentId],
      }),
    },
  );
}

async function replaceGoogleDocText(
  token: string,
  documentId: string,
  text: string,
): Promise<void> {
  const document = await googleFetch<{
    body?: { content?: Array<{ endIndex?: number }> };
  }>(
    'https://docs.googleapis.com/v1/documents/' +
      encodeURIComponent(documentId),
    token,
  );

  const content = document.body?.content || [];
  const lastEndIndex = content.reduce(
    (max, item) => Math.max(max, Number(item.endIndex || 1)),
    1,
  );
  const requests: Array<Record<string, unknown>> = [];
  if (lastEndIndex > 2) {
    requests.push({
      deleteContentRange: {
        range: { startIndex: 1, endIndex: lastEndIndex - 1 },
      },
    });
  }
  requests.push({
    insertText: {
      location: { index: 1 },
      text: text.trim() + '\n',
    },
  });

  await googleFetch(
    'https://docs.googleapis.com/v1/documents/' +
      encodeURIComponent(documentId) +
      ':batchUpdate',
    token,
    {
      method: 'POST',
      body: JSON.stringify({ requests }),
    },
  );
}

async function ensureDefaultTemplate(
  token: string,
  templatesFolderId: string,
): Promise<{ file: WorkDriveFile; repaired: boolean }> {
  const matches = await listNamedChildren(
    token,
    templatesFolderId,
    SUPPORT_TEMPLATE_NAME,
  );
  let file = matches.find((item) => item.mimeType === GOOGLE_DOC_MIME);
  let repaired = false;
  if (!file) {
    file = await createGoogleDoc(token, SUPPORT_TEMPLATE_NAME, templatesFolderId);
    repaired = true;
  }

  await replaceGoogleDocText(
    token,
    file.id,
    [
      'NMRNL Work Support Note Template',
      '',
      'Template for reporting of interactions with survivors.',
      'Geographical area. Blenheim',
      '',
      STRUCTURED_SUPPORT_NOTE_TEMPLATE,
      '',
      'Reporting limits',
      'Main topic(s): max. 200 words',
      'Outcome(s): max. 100 words',
      'Overall impression: max. 150 words',
      'Next actions: max. 150 words',
    ].join('\n'),
  );

  return { file, repaired };
}

async function ensureDriveSetupWithToken(
  token: string,
  existing?: DriveConnectionState,
): Promise<WorkDriveRepairResult> {
  const email = await connectedGoogleEmail(token);

  const rootResult = await ensureFolder(
    token,
    existing?.rootFolderId,
    ROOT_FOLDER_NAME,
  );
  const clientResult = await ensureFolder(
    token,
    existing?.clientNotesFolderId,
    CLIENT_NOTES_FOLDER_NAME,
    rootResult.folder.id,
  );
  const invoiceResult = await ensureFolder(
    token,
    existing?.invoicesFolderId,
    INVOICES_FOLDER_NAME,
    rootResult.folder.id,
  );
  const templateResult = await ensureFolder(
    token,
    undefined,
    TEMPLATES_FOLDER_NAME,
    rootResult.folder.id,
  );
  const templateFile = await ensureDefaultTemplate(
    token,
    templateResult.folder.id,
  );

  return {
    drive: {
      rootFolderId: rootResult.folder.id,
      clientNotesFolderId: clientResult.folder.id,
      invoicesFolderId: invoiceResult.folder.id,
      accountEmail: email || existing?.accountEmail || '',
    },
    templatesFolderId: templateResult.folder.id,
    templateFileId: templateFile.file.id,
    repaired:
      rootResult.repaired ||
      clientResult.repaired ||
      invoiceResult.repaired ||
      templateResult.repaired ||
      templateFile.repaired,
  };
}

export async function repairWorkDrive(
  existing?: DriveConnectionState,
): Promise<WorkDriveRepairResult> {
  const token = await connectGoogleDrive();
  return ensureDriveSetupWithToken(token, existing);
}

export async function listWorkDriveRoot(
  existing?: DriveConnectionState,
): Promise<{
  repair: WorkDriveRepairResult;
  rootFiles: WorkDriveFile[];
  templateFiles: WorkDriveFile[];
}> {
  const token = await connectGoogleDrive();
  const repair = await ensureDriveSetupWithToken(token, existing);
  return {
    repair,
    rootFiles: await listChildren(token, repair.drive.rootFolderId),
    templateFiles: await listChildren(token, repair.templatesFolderId),
  };
}

function cleanName(value: string): string {
  return value
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

function periodStartFor(dateText: string, anchorText: string): Date {
  const date = new Date(dateText + 'T12:00:00');
  const anchor = new Date(anchorText + 'T12:00:00');
  const startUtc = Date.UTC(
    anchor.getFullYear(),
    anchor.getMonth(),
    anchor.getDate(),
  );
  const dateUtc = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  const days = Math.floor((dateUtc - startUtc) / 86_400_000);
  const periodOffset = Math.floor(days / 14);
  return new Date(
    anchor.getFullYear(),
    anchor.getMonth(),
    anchor.getDate() + periodOffset * 14,
    12,
  );
}

function dateKey(date: Date): string {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

function invoiceNumberForPeriod(dateText: string, anchorText: string): number {
  const start = periodStartFor(dateText, anchorText);
  const anchor = periodStartFor(anchorText, anchorText);
  const startUtc = Date.UTC(start.getFullYear(), start.getMonth(), start.getDate());
  const anchorUtc = Date.UTC(
    anchor.getFullYear(),
    anchor.getMonth(),
    anchor.getDate(),
  );
  return 5 + Math.floor((startUtc - anchorUtc) / 86_400_000 / 14);
}

async function canonicaliseFile(
  token: string,
  file: WorkDriveFile,
  name: string,
  parentId: string,
): Promise<WorkDriveFile> {
  const currentParents = file.parents || [];
  const needsParentMove =
    !currentParents.includes(parentId) || currentParents.length !== 1;
  const needsRename = file.name !== name;
  if (!needsParentMove && !needsRename) return file;

  const params = new URLSearchParams({
    fields: 'id,name,mimeType,webViewLink,parents',
  });
  if (needsParentMove) {
    params.set('addParents', parentId);
    if (currentParents.length) params.set('removeParents', currentParents.join(','));
  }

  return googleFetch<WorkDriveFile>(
    'https://www.googleapis.com/drive/v3/files/' +
      encodeURIComponent(file.id) +
      '?' +
      params.toString(),
    token,
    {
      method: 'PATCH',
      body: JSON.stringify(needsRename ? { name } : {}),
    },
  );
}

function supportNoteDocumentText(input: {
  entry: WorkEntry;
  personName: string;
  status: SupportNoteStatus;
  noteText: string;
}): string {
  return goldStandardTemplatePlainText(
    input.entry,
    input.personName.trim() || input.entry.client,
    input.noteText,
  );
}

export async function syncSupportNoteToDrive(input: {
  entry: WorkEntry;
  personName: string;
  status: SupportNoteStatus;
  noteText: string;
  payPeriodAnchorDate: string;
  drive?: DriveConnectionState;
  existingMeta?: DriveSupportNoteMeta;
}): Promise<{
  drive: DriveConnectionState;
  meta: DriveSupportNoteMeta;
}> {
  const token = await connectGoogleDrive();
  const repaired = await ensureDriveSetupWithToken(token, input.drive);
  const drive = repaired.drive;

  const clientFolder = await findOrCreateFolder(
    token,
    cleanName(input.entry.client) || 'Client',
    drive.clientNotesFolderId,
  );
  const periodStart = periodStartFor(
    input.entry.date,
    input.payPeriodAnchorDate,
  );
  const periodEnd = new Date(periodStart);
  periodEnd.setDate(periodStart.getDate() + 13);
  const invoiceNumber = invoiceNumberForPeriod(
    input.entry.date,
    input.payPeriodAnchorDate,
  );
  const periodFolder = await findOrCreateFolder(
    token,
    'Invoice ' +
      invoiceNumber +
      ' - ' +
      dateKey(periodStart) +
      ' to ' +
      dateKey(periodEnd),
    clientFolder.id,
  );
  const typeFolder = await findOrCreateFolder(
    token,
    cleanName(entryType(input.entry.type).label),
    periodFolder.id,
  );

  const fileName = cleanName(
    input.entry.client +
      ' - ' +
      input.entry.date +
      ' - ' +
      entryType(input.entry.type).label,
  );

  let file: WorkDriveFile | null = null;
  if (input.existingMeta?.fileId) {
    const candidate = await getDriveFile(token, input.existingMeta.fileId);
    if (candidate?.mimeType === GOOGLE_DOC_MIME) file = candidate;
  }

  if (!file) {
    const matches = await listNamedChildren(token, typeFolder.id, fileName);
    file = matches.find((item) => item.mimeType === GOOGLE_DOC_MIME) || null;
  }
  if (!file) file = await createGoogleDoc(token, fileName, typeFolder.id);

  file = await canonicaliseFile(token, file, fileName, typeFolder.id);
  await replaceGoogleDocText(token, file.id, supportNoteDocumentText(input));

  return {
    drive,
    meta: {
      fileId: file.id,
      fileName,
      parentFolderId: typeFolder.id,
      webViewLink:
        file.webViewLink ||
        'https://docs.google.com/document/d/' +
          encodeURIComponent(file.id) +
          '/edit',
      updatedAt: new Date().toISOString(),
    },
  };
}

async function createShortcut(
  token: string,
  name: string,
  targetId: string,
  parentId: string,
): Promise<void> {
  const matches = await listNamedChildren(token, parentId, name);
  const shortcut = matches.find(
    (item) => item.mimeType === DRIVE_SHORTCUT_MIME,
  );
  if (shortcut?.shortcutDetails?.targetId === targetId) return;

  if (shortcut && shortcut.shortcutDetails?.targetId !== targetId) {
    await googleFetch(
      'https://www.googleapis.com/drive/v3/files/' +
        encodeURIComponent(shortcut.id),
      token,
      { method: 'DELETE' },
    );
  }

  await googleFetch(
    'https://www.googleapis.com/drive/v3/files?fields=id,name,mimeType,webViewLink',
    token,
    {
      method: 'POST',
      body: JSON.stringify({
        name,
        mimeType: DRIVE_SHORTCUT_MIME,
        parents: [parentId],
        shortcutDetails: { targetId },
      }),
    },
  );
}

function invoiceSummaryText(input: {
  invoiceNumber: number;
  startKey: string;
  endKey: string;
  entries: WorkEntry[];
  hourlyRate: number;
  fuelRate: number;
}): string {
  const billableHours = input.entries.reduce(
    (sum, entry) => sum + entryBillableHours(entry),
    0,
  );
  const kilometres = input.entries.reduce(
    (sum, entry) => sum + entryKilometres(entry),
    0,
  );
  const earnings = input.entries.reduce(
    (sum, entry) => sum + entryEarnings(entry, input.hourlyRate),
    0,
  );
  const travel = input.entries.reduce(
    (sum, entry) =>
      sum + entryTravelReimbursement(entry, input.fuelRate),
    0,
  );

  const lines = [
    'NMRNL Work Invoice ' + input.invoiceNumber,
    formatDate(input.startKey) + ' - ' + formatDate(input.endKey),
    '',
    'Entries: ' + input.entries.length,
    'Billable hours: ' + billableHours.toFixed(2),
    'Hourly rate: $' + input.hourlyRate.toFixed(2),
    'Earnings: $' + earnings.toFixed(2),
    'Travel: ' + kilometres.toFixed(1) + ' km',
    'KM rate: $' + input.fuelRate.toFixed(2),
    'Travel reimbursement: $' + travel.toFixed(2),
    'Invoice total: $' + (earnings + travel).toFixed(2),
    '',
    'Entries',
  ];

  for (const entry of input.entries) {
    lines.push(
      entry.date +
        ' | ' +
        entry.startTime +
        ' | ' +
        entry.client +
        ' | ' +
        entryType(entry.type).label +
        ' | ' +
        entryBillableHours(entry).toFixed(2) +
        'h | ' +
        entryKilometres(entry).toFixed(1) +
        'km',
    );
  }

  return lines.join('\n');
}

export async function syncInvoicePeriodToDrive(input: {
  invoiceKey: string;
  invoiceNumber: number;
  startKey: string;
  endKey: string;
  entries: WorkEntry[];
  hourlyRate: number;
  fuelRate: number;
  payPeriodAnchorDate: string;
  drive?: DriveConnectionState;
  existingInvoice?: InvoiceDriveMeta;
  supportNoteMetas: Record<string, DriveSupportNoteMeta>;
}): Promise<{
  drive: DriveConnectionState;
  invoice: InvoiceDriveMeta;
  supportNoteMetas: Record<string, DriveSupportNoteMeta>;
}> {
  const token = await connectGoogleDrive();
  const repaired = await ensureDriveSetupWithToken(token, input.drive);
  const drive = repaired.drive;
  const folderName =
    'Invoice ' +
    input.invoiceNumber +
    ' - ' +
    input.startKey +
    ' to ' +
    input.endKey;

  let folder: WorkDriveFile | null = null;
  if (input.existingInvoice?.folderId) {
    const candidate = await getDriveFile(token, input.existingInvoice.folderId);
    if (
      candidate?.mimeType === DRIVE_FOLDER_MIME &&
      (candidate.parents || []).includes(drive.invoicesFolderId)
    ) {
      folder = candidate;
    }
  }
  if (!folder) {
    folder = await findOrCreateFolder(token, folderName, drive.invoicesFolderId);
  }
  folder = await canonicaliseFile(token, folder, folderName, drive.invoicesFolderId);

  const summaryName = 'Invoice ' + input.invoiceNumber + ' Summary';
  let summaryDoc: WorkDriveFile | null = null;
  if (input.existingInvoice?.summaryFileId) {
    const candidate = await getDriveFile(
      token,
      input.existingInvoice.summaryFileId,
    );
    if (candidate?.mimeType === GOOGLE_DOC_MIME) summaryDoc = candidate;
  }
  if (!summaryDoc) {
    const summaryMatches = await listNamedChildren(token, folder.id, summaryName);
    summaryDoc =
      summaryMatches.find((item) => item.mimeType === GOOGLE_DOC_MIME) || null;
  }
  if (!summaryDoc) {
    summaryDoc = await createGoogleDoc(token, summaryName, folder.id);
  }
  summaryDoc = await canonicaliseFile(token, summaryDoc, summaryName, folder.id);
  await replaceGoogleDocText(token, summaryDoc.id, invoiceSummaryText(input));

  const metas: Record<string, DriveSupportNoteMeta> = {
    ...input.supportNoteMetas,
  };

  for (const entry of input.entries) {
    if (!entry.supportNoteBreakdown.trim()) continue;

    const synced = await syncSupportNoteToDrive({
      entry,
      personName: entry.supportNotePersonName || entry.client,
      status: entry.supportNoteStatus || 'inProgress',
      noteText: entry.supportNoteBreakdown,
      payPeriodAnchorDate: input.payPeriodAnchorDate,
      drive,
      existingMeta: metas[entry.id],
    });
    metas[entry.id] = synced.meta;

    await createShortcut(
      token,
      cleanName(
        entry.client +
          ' - ' +
          entry.date +
          ' - ' +
          entryType(entry.type).label,
      ),
      synced.meta.fileId,
      folder.id,
    );
  }

  return {
    drive,
    invoice: {
      folderId: folder.id,
      webViewLink:
        folder.webViewLink ||
        'https://drive.google.com/drive/folders/' +
          encodeURIComponent(folder.id),
      summaryFileId: summaryDoc.id,
      updatedAt: new Date().toISOString(),
    },
    supportNoteMetas: metas,
  };
}
