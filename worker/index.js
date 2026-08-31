const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
};

const MODES = new Set(['work', 'casework', 'paye']);
const ENTRY_TYPES = new Set([
  'homeVisit',
  'professionalContact',
  'phoneCall',
  'videoCall',
  'emailClient',
  'emailProfessional',
  'adminEducationResources',
  'textNote',
]);
const TEXT_DIRECTIONS = new Set(['received', 'sent', 'exchange']);

function json(value, init = {}) {
  const headers = new Headers(init.headers || {});
  for (const [key, val] of Object.entries(JSON_HEADERS)) headers.set(key, val);
  return new Response(JSON.stringify(value), { ...init, headers });
}

function randomToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function hashToken(token) {
  const bytes = new TextEncoder().encode(token);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}

function bearer(request) {
  const header = request.headers.get('authorization') || '';
  return header.toLowerCase().startsWith('bearer ')
    ? header.slice(7).trim()
    : '';
}

function safeWorkspaceId(value) {
  return /^[a-f0-9]{16}$/i.test(value) ? value.toLowerCase() : '';
}

function stringValue(value, fallback = '') {
  return typeof value === 'string' ? value.trim() : fallback;
}

function numberValue(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function modeValue(value) {
  const mode = stringValue(value);
  return MODES.has(mode) ? mode : 'work';
}

function cloneDefaultData() {
  return {
    version: 1,
    clients: [],
    entries: [],
    actions: [],
  };
}

function normaliseData(value) {
  if (!value || typeof value !== 'object') return cloneDefaultData();
  return {
    version: 1,
    clients: Array.isArray(value.clients) ? value.clients : [],
    entries: Array.isArray(value.entries) ? value.entries : [],
    actions: Array.isArray(value.actions) ? value.actions : [],
  };
}

async function readObject(request) {
  let value;
  try {
    value = await request.json();
  } catch {
    throw new Error('Invalid JSON body.');
  }

  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Expected a JSON object.');
  }

  return value;
}

export class SupervisorHub {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  async getMeta() {
    return (await this.state.storage.get('meta')) || null;
  }

  async getData() {
    return normaliseData(await this.state.storage.get('data'));
  }

  async putData(data) {
    await this.state.storage.put('data', normaliseData(data));
  }

  async authenticated(request) {
    const meta = await this.getMeta();
    if (!meta) return false;
    const token = bearer(request);
    if (!token) return false;
    return (await hashToken(token)) === meta.ownerTokenHash;
  }

  async snapshot(meta = null, data = null) {
    const resolvedMeta = meta || (await this.getMeta());
    const resolvedData = data || (await this.getData());

    return {
      workspaceId: resolvedMeta?.workspaceId || '',
      createdAt: resolvedMeta?.createdAt || new Date().toISOString(),
      clients: resolvedData.clients,
      entries: resolvedData.entries,
      actions: resolvedData.actions,
    };
  }

  async requireAuth(request) {
    if (!(await this.authenticated(request))) {
      return json({ error: 'Workspace key rejected.' }, { status: 401 });
    }
    return null;
  }

  async initialise(request) {
    const existing = await this.getMeta();
    if (existing) {
      return json({ error: 'Workspace already exists.' }, { status: 409 });
    }

    const workspaceId = safeWorkspaceId(
      request.headers.get('x-workspace-id') || '',
    );
    const ownerToken = request.headers.get('x-owner-token') || '';

    if (!workspaceId || ownerToken.length < 32) {
      return json({ error: 'Invalid workspace setup.' }, { status: 400 });
    }

    const createdAt = new Date().toISOString();
    const meta = {
      workspaceId,
      createdAt,
      ownerTokenHash: await hashToken(ownerToken),
    };
    const data = cloneDefaultData();

    await this.state.storage.put('meta', meta);
    await this.putData(data);

    return json({ state: await this.snapshot(meta, data) }, { status: 201 });
  }

  async createEntry(request) {
    const body = await readObject(request);
    const mode = modeValue(body.mode);
    const type = stringValue(body.type);
    const date = stringValue(body.date);
    const startTime = stringValue(body.startTime);
    const requestedClient = stringValue(body.client);
    const minutes = Math.max(
      0,
      Math.min(1440, Math.round(numberValue(body.minutes) || 0)),
    );

    if (!ENTRY_TYPES.has(type)) {
      return json({ error: 'Unknown entry type.' }, { status: 400 });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return json({ error: 'A valid date is required.' }, { status: 400 });
    }
    if (!/^\d{2}:\d{2}$/.test(startTime)) {
      return json({ error: 'A valid start time is required.' }, { status: 400 });
    }

    let client = requestedClient;
    if (!client) {
      if (type === 'emailProfessional') client = 'Professional email';
      else if (type === 'adminEducationResources') {
        client = 'Admin / Education / Resources';
      } else {
        return json({ error: 'Client is required for this entry type.' }, { status: 400 });
      }
    }

    const now = new Date().toISOString();
    const data = await this.getData();

    let clientRecord = data.clients.find(
      (item) =>
        item.mode === mode &&
        String(item.name || '').toLowerCase() === client.toLowerCase(),
    );

    if (!clientRecord) {
      clientRecord = {
        id: crypto.randomUUID(),
        name: client,
        mode,
        createdAt: now,
      };
      data.clients.push(clientRecord);
    }

    const notes = Array.isArray(body.notes)
      ? body.notes
          .map((item) => stringValue(item))
          .filter(Boolean)
          .slice(0, 100)
      : [];

    const nextActionText = stringValue(body.nextAction);
    const nextActions = nextActionText
      ? [
          {
            id: crypto.randomUUID(),
            text: nextActionText,
            createdAt: now,
            completedAt: null,
          },
        ]
      : [];

    const direction = TEXT_DIRECTIONS.has(stringValue(body.textContactDirection))
      ? stringValue(body.textContactDirection)
      : 'received';

    const odometerStart = numberValue(body.odometerStart);
    const odometerEnd = numberValue(body.odometerEnd);

    const entry = {
      id: crypto.randomUUID(),
      mode,
      clientId: clientRecord.id,
      client,
      type,
      date,
      startTime,
      minutes,
      notes,
      supportNoteBreakdown: stringValue(body.supportNoteBreakdown),
      nextActions,
      googleCalendarEntered: false,
      importantText: body.importantText === true,
      textContactDirection: direction,
      textReplyNeeded: body.textReplyNeeded === true,
      odometerStart: type === 'homeVisit' ? odometerStart : null,
      odometerEnd: type === 'homeVisit' ? odometerEnd : null,
      createdAt: now,
      updatedAt: now,
    };

    data.entries.push(entry);
    await this.putData(data);

    return json({ state: await this.snapshot(null, data), entry }, { status: 201 });
  }

  async deleteEntry(entryId) {
    const data = await this.getData();
    const before = data.entries.length;
    data.entries = data.entries.filter((entry) => entry.id !== entryId);

    if (data.entries.length === before) {
      return json({ error: 'Entry not found.' }, { status: 404 });
    }

    await this.putData(data);
    return json({ state: await this.snapshot(null, data) });
  }

  async setVisitAction(request, entryId, actionId) {
    const body = await readObject(request);
    const completed = body.completed === true;
    const data = await this.getData();
    const entry = data.entries.find((item) => item.id === entryId);

    if (!entry) return json({ error: 'Entry not found.' }, { status: 404 });

    const action = Array.isArray(entry.nextActions)
      ? entry.nextActions.find((item) => item.id === actionId)
      : null;

    if (!action) {
      return json({ error: 'Visit action not found.' }, { status: 404 });
    }

    action.completedAt = completed ? new Date().toISOString() : null;
    entry.updatedAt = new Date().toISOString();

    await this.putData(data);
    return json({ state: await this.snapshot(null, data) });
  }

  async createGeneralAction(request) {
    const body = await readObject(request);
    const title = stringValue(body.title);

    if (!title) {
      return json({ error: 'Action title is required.' }, { status: 400 });
    }

    const now = new Date().toISOString();
    const data = await this.getData();
    const action = {
      id: crypto.randomUUID(),
      mode: modeValue(body.mode),
      title,
      scope:
        stringValue(body.scope) === 'knowledgeGap'
          ? 'knowledgeGap'
          : 'client',
      client: stringValue(body.client) || null,
      createdAt: now,
      completedAt: null,
      updatedAt: now,
    };

    data.actions.push(action);
    await this.putData(data);

    return json({ state: await this.snapshot(null, data), action }, { status: 201 });
  }

  async setGeneralAction(request, actionId) {
    const body = await readObject(request);
    const completed = body.completed === true;
    const data = await this.getData();
    const action = data.actions.find((item) => item.id === actionId);

    if (!action) {
      return json({ error: 'Action not found.' }, { status: 404 });
    }

    action.completedAt = completed ? new Date().toISOString() : null;
    action.updatedAt = new Date().toISOString();

    await this.putData(data);
    return json({ state: await this.snapshot(null, data) });
  }

  async fetch(request) {
    const url = new URL(request.url);
    const workspaceMatch = url.pathname.match(
      /^\/api\/workspace\/([a-f0-9]{16})(\/.*)?$/i,
    );

    if (!workspaceMatch) {
      return json({ error: 'Invalid workspace route.' }, { status: 404 });
    }

    const suffix = workspaceMatch[2] || '/';

    if (suffix === '/init' && request.method === 'POST') {
      return this.initialise(request);
    }

    const authError = await this.requireAuth(request);
    if (authError) return authError;

    if (suffix === '/snapshot' && request.method === 'GET') {
      return json({ state: await this.snapshot() });
    }

    if (suffix === '/entries' && request.method === 'POST') {
      return this.createEntry(request);
    }

    const entryDelete = suffix.match(/^\/entries\/([^/]+)$/);
    if (entryDelete && request.method === 'DELETE') {
      return this.deleteEntry(decodeURIComponent(entryDelete[1]));
    }

    const visitAction = suffix.match(
      /^\/entries\/([^/]+)\/actions\/([^/]+)$/,
    );
    if (visitAction && request.method === 'PATCH') {
      return this.setVisitAction(
        request,
        decodeURIComponent(visitAction[1]),
        decodeURIComponent(visitAction[2]),
      );
    }

    if (suffix === '/actions' && request.method === 'POST') {
      return this.createGeneralAction(request);
    }

    const generalAction = suffix.match(/^\/actions\/([^/]+)$/);
    if (generalAction && request.method === 'PATCH') {
      return this.setGeneralAction(
        request,
        decodeURIComponent(generalAction[1]),
      );
    }

    return json({ error: 'Workspace route not found.' }, { status: 404 });
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/api/health') {
      return json({
        ok: true,
        app: 'NMRNL',
        service: 'pvp-sim',
        storage: 'durable-object',
        now: new Date().toISOString(),
      });
    }

    if (url.pathname === '/api/workspace' && request.method === 'POST') {
      const workspaceId = crypto.randomUUID().replaceAll('-', '').slice(0, 16);
      const ownerToken = randomToken();
      const objectId = env.SUPERVISOR_HUB.idFromName('nmrnl:' + workspaceId);
      const stub = env.SUPERVISOR_HUB.get(objectId);
      const initRequest = new Request(
        url.origin + '/api/workspace/' + workspaceId + '/init',
        {
          method: 'POST',
          headers: {
            'x-workspace-id': workspaceId,
            'x-owner-token': ownerToken,
          },
        },
      );

      const initialised = await stub.fetch(initRequest);
      if (!initialised.ok) {
        return json({ error: 'Could not initialise NMRNL workspace.' }, { status: 500 });
      }

      const payload = await initialised.json();
      return json(
        {
          workspaceId,
          ownerToken,
          state: payload.state,
        },
        { status: 201 },
      );
    }

    const match = url.pathname.match(
      /^\/api\/workspace\/([a-f0-9]{16})(?:\/.*)?$/i,
    );
    if (match) {
      const workspaceId = safeWorkspaceId(match[1]);
      if (!workspaceId) {
        return json({ error: 'Invalid workspace ID.' }, { status: 400 });
      }
      const objectId = env.SUPERVISOR_HUB.idFromName('nmrnl:' + workspaceId);
      return env.SUPERVISOR_HUB.get(objectId).fetch(request);
    }

    if (url.pathname.startsWith('/api/')) {
      return json({ error: 'Not found.' }, { status: 404 });
    }

    return env.ASSETS.fetch(request);
  },
};
