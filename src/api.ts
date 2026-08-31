import type {
  EntryDraft,
  GeneralAction,
  Mode,
  EmailRecoveryChallenge,
  WorkspaceCredentials,
  WorkspaceSetupChallenge,
  WorkspaceState,
} from './model';

const SESSION_KEY = 'nmrnl.auth-session.v2';
const WORKSPACE_KEY = 'nmrnl.workspace-id.v2';
const LEGACY_KEY = 'nmrnl.private-workspace.v1';

export const NMRNL_ACCOUNT_EMAIL = 'blenhiemmaleroom@gmail.com';

type LegacyCredentials = {
  workspaceId?: string;
  ownerToken?: string;
};

export function loadKnownWorkspaceId(): string {
  try {
    const saved = window.localStorage.getItem(WORKSPACE_KEY)?.trim();
    if (saved) return saved;

    const legacyRaw = window.localStorage.getItem(LEGACY_KEY);
    if (!legacyRaw) return '';
    const legacy = JSON.parse(legacyRaw) as LegacyCredentials;
    return legacy.workspaceId?.trim() || '';
  } catch {
    return '';
  }
}

export function loadCredentials(): WorkspaceCredentials | null {
  try {
    const raw = window.sessionStorage.getItem(SESSION_KEY);
    if (raw) {
      const value = JSON.parse(raw) as Partial<WorkspaceCredentials>;
      if (value.workspaceId && value.sessionToken) {
        return {
          workspaceId: value.workspaceId,
          sessionToken: value.sessionToken,
        };
      }
    }

    const legacyRaw = window.localStorage.getItem(LEGACY_KEY);
    if (!legacyRaw) return null;
    const legacy = JSON.parse(legacyRaw) as LegacyCredentials;
    if (!legacy.workspaceId || !legacy.ownerToken) return null;

    return {
      workspaceId: legacy.workspaceId,
      sessionToken: legacy.ownerToken,
    };
  } catch {
    return null;
  }
}

export function saveCredentials(credentials: WorkspaceCredentials): void {
  window.localStorage.setItem(WORKSPACE_KEY, credentials.workspaceId);
  window.sessionStorage.setItem(SESSION_KEY, JSON.stringify(credentials));
}

export function clearCredentials(): void {
  window.sessionStorage.removeItem(SESSION_KEY);
  window.localStorage.removeItem(LEGACY_KEY);
}

export function rememberWorkspaceId(workspaceId: string): void {
  window.localStorage.setItem(WORKSPACE_KEY, workspaceId);
}

async function parseResponse<T>(response: Response): Promise<T> {
  const payload = (await response.json().catch(() => null)) as
    | ({ error?: string } & T)
    | null;

  if (!response.ok) {
    throw new Error(payload?.error || 'NMRNL request failed (' + response.status + ').');
  }

  if (!payload) throw new Error('NMRNL returned an empty response.');
  return payload;
}

async function authRequest<T>(
  workspaceId: string,
  path: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(
    '/api/workspace/' + encodeURIComponent(workspaceId) + path,
    {
      ...init,
      cache: 'no-store',
      headers: {
        'content-type': 'application/json',
        ...(init?.headers || {}),
      },
    },
  );

  return parseResponse<T>(response);
}

async function workspaceRequest<T>(
  credentials: WorkspaceCredentials,
  path: string,
  init?: RequestInit,
): Promise<T> {
  return authRequest<T>(credentials.workspaceId, path, {
    ...init,
    headers: {
      authorization: 'Bearer ' + credentials.sessionToken,
      ...(init?.headers || {}),
    },
  });
}

export async function openTemporaryWorkspace(): Promise<{
  credentials: WorkspaceCredentials;
  state: WorkspaceState;
}> {
  const response = await fetch('/api/account/open', {
    method: 'POST',
    cache: 'no-store',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });

  const payload = await parseResponse<{
    workspaceId: string;
    state: WorkspaceState;
  }>(response);

  return {
    credentials: {
      workspaceId: payload.workspaceId,
      sessionToken: 'temporary-login-bypass',
    },
    state: payload.state,
  };
}

export async function fetchAccountWorkspace(): Promise<{
  workspaceId: string;
  exists: boolean;
  authenticatorEnabled: boolean;
}> {
  const response = await fetch('/api/account/workspace', {
    method: 'GET',
    cache: 'no-store',
  });

  return parseResponse<{
    workspaceId: string;
    exists: boolean;
    authenticatorEnabled: boolean;
  }>(response);
}

export async function createWorkspace(): Promise<WorkspaceSetupChallenge> {
  const response = await fetch('/api/workspace', {
    method: 'POST',
    cache: 'no-store',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });

  return parseResponse<WorkspaceSetupChallenge>(response);
}

export async function confirmWorkspaceTotp(
  workspaceId: string,
  code: string,
): Promise<{
  credentials: WorkspaceCredentials;
  state: WorkspaceState;
}> {
  const payload = await authRequest<{
    sessionToken: string;
    state: WorkspaceState;
  }>(workspaceId, '/auth/confirm', {
    method: 'POST',
    body: JSON.stringify({ code }),
  });

  return {
    credentials: { workspaceId, sessionToken: payload.sessionToken },
    state: payload.state,
  };
}

export async function loginWithTotp(
  workspaceId: string,
  code: string,
): Promise<{
  credentials: WorkspaceCredentials;
  state: WorkspaceState;
}> {
  const payload = await authRequest<{
    sessionToken: string;
    state: WorkspaceState;
  }>(workspaceId, '/auth/login', {
    method: 'POST',
    body: JSON.stringify({ code }),
  });

  return {
    credentials: { workspaceId, sessionToken: payload.sessionToken },
    state: payload.state,
  };
}

export function beginAuthenticatorEnrollment(
  credentials: WorkspaceCredentials,
): Promise<WorkspaceSetupChallenge> {
  return workspaceRequest<WorkspaceSetupChallenge>(
    credentials,
    '/auth/enrol',
    { method: 'POST', body: '{}' },
  );
}

export async function confirmAuthenticatorEnrollment(
  credentials: WorkspaceCredentials,
  code: string,
): Promise<{
  credentials: WorkspaceCredentials;
  state: WorkspaceState;
}> {
  const payload = await workspaceRequest<{
    sessionToken: string;
    state: WorkspaceState;
  }>(credentials, '/auth/enrol/confirm', {
    method: 'POST',
    body: JSON.stringify({ code }),
  });

  return {
    credentials: {
      workspaceId: credentials.workspaceId,
      sessionToken: payload.sessionToken,
    },
    state: payload.state,
  };
}

export function beginAccessRecovery(
  workspaceId: string,
): Promise<EmailRecoveryChallenge> {
  return authRequest<EmailRecoveryChallenge>(
    workspaceId,
    '/auth/recovery/start',
    {
      method: 'POST',
      body: '{}',
    },
  );
}

export async function confirmRecoveryAuthenticator(
  workspaceId: string,
  recoveryToken: string,
  code: string,
): Promise<{
  credentials: WorkspaceCredentials;
  state: WorkspaceState;
}> {
  const payload = await authRequest<{
    sessionToken: string;
    state: WorkspaceState;
  }>(workspaceId, '/auth/recovery/confirm', {
    method: 'POST',
    body: JSON.stringify({ recoveryToken, code }),
  });

  return {
    credentials: {
      workspaceId,
      sessionToken: payload.sessionToken,
    },
    state: payload.state,
  };
}

export function fetchWorkspace(
  credentials: WorkspaceCredentials,
): Promise<WorkspaceState> {
  return workspaceRequest<{ state: WorkspaceState }>(
    credentials,
    '/snapshot',
  ).then((payload) => payload.state);
}

export function createEntry(
  credentials: WorkspaceCredentials,
  draft: EntryDraft,
): Promise<WorkspaceState> {
  return workspaceRequest<{ state: WorkspaceState }>(credentials, '/entries', {
    method: 'POST',
    body: JSON.stringify(draft),
  }).then((payload) => payload.state);
}

export function updateEntry(
  credentials: WorkspaceCredentials,
  entryId: string,
  draft: EntryDraft,
): Promise<WorkspaceState> {
  return workspaceRequest<{ state: WorkspaceState }>(
    credentials,
    '/entries/' + encodeURIComponent(entryId),
    {
      method: 'PATCH',
      body: JSON.stringify(draft),
    },
  ).then((payload) => payload.state);
}

export function deleteEntry(
  credentials: WorkspaceCredentials,
  entryId: string,
): Promise<WorkspaceState> {
  return workspaceRequest<{ state: WorkspaceState }>(
    credentials,
    '/entries/' + encodeURIComponent(entryId),
    { method: 'DELETE' },
  ).then((payload) => payload.state);
}

export function setVisitActionCompleted(
  credentials: WorkspaceCredentials,
  entryId: string,
  actionId: string,
  completed: boolean,
): Promise<WorkspaceState> {
  return workspaceRequest<{ state: WorkspaceState }>(
    credentials,
    '/entries/' +
      encodeURIComponent(entryId) +
      '/actions/' +
      encodeURIComponent(actionId),
    {
      method: 'PATCH',
      body: JSON.stringify({ completed }),
    },
  ).then((payload) => payload.state);
}

export function createGeneralAction(
  credentials: WorkspaceCredentials,
  input: {
    mode: Mode;
    title: string;
    scope: GeneralAction['scope'];
    client: string | null;
  },
): Promise<WorkspaceState> {
  return workspaceRequest<{ state: WorkspaceState }>(credentials, '/actions', {
    method: 'POST',
    body: JSON.stringify(input),
  }).then((payload) => payload.state);
}

export function setGeneralActionCompleted(
  credentials: WorkspaceCredentials,
  actionId: string,
  completed: boolean,
): Promise<WorkspaceState> {
  return workspaceRequest<{ state: WorkspaceState }>(
    credentials,
    '/actions/' + encodeURIComponent(actionId),
    {
      method: 'PATCH',
      body: JSON.stringify({ completed }),
    },
  ).then((payload) => payload.state);
}
