import type {
  EntryDraft,
  GeneralAction,
  Mode,
  WorkspaceCredentials,
  WorkspaceState,
} from './model';

const STORAGE_KEY = 'nmrnl.private-workspace.v1';

export function loadCredentials(): WorkspaceCredentials | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<WorkspaceCredentials>;
    if (!value.workspaceId || !value.ownerToken) return null;
    return {
      workspaceId: value.workspaceId,
      ownerToken: value.ownerToken,
    };
  } catch {
    return null;
  }
}

export function saveCredentials(credentials: WorkspaceCredentials): void {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(credentials));
}

export function clearCredentials(): void {
  window.localStorage.removeItem(STORAGE_KEY);
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

async function workspaceRequest<T>(
  credentials: WorkspaceCredentials,
  path: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(
    '/api/workspace/' + encodeURIComponent(credentials.workspaceId) + path,
    {
      ...init,
      cache: 'no-store',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer ' + credentials.ownerToken,
        ...(init?.headers || {}),
      },
    },
  );

  return parseResponse<T>(response);
}

export async function createWorkspace(): Promise<{
  credentials: WorkspaceCredentials;
  state: WorkspaceState;
}> {
  const response = await fetch('/api/workspace', {
    method: 'POST',
    cache: 'no-store',
  });
  const payload = await parseResponse<{
    workspaceId: string;
    ownerToken: string;
    state: WorkspaceState;
  }>(response);

  return {
    credentials: {
      workspaceId: payload.workspaceId,
      ownerToken: payload.ownerToken,
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
