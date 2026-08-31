const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
};

const MODES = new Set(['work']);
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
const SUPPORT_NOTE_STATUSES = new Set([
  'incomplete',
  'inProgress',
  'finished',
  'submitted',
]);
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const RATE_WINDOW_MS = 5 * 60 * 1000;
const RATE_LOCK_MS = 10 * 60 * 1000;
const MAX_AUTH_FAILURES = 5;
const ACCOUNT_EMAIL = 'blenhiemmaleroom@gmail.com';
const TEMPORARY_LOGIN_BYPASS = true;
const RECOVERY_CODE_TTL_MS = 10 * 60 * 1000;
const RECOVERY_ENROL_TTL_MS = 10 * 60 * 1000;
const RECOVERY_SEND_COOLDOWN_MS = 60 * 1000;
const MAX_RECOVERY_ATTEMPTS = 5;
const ACCOUNT_ACCESS_TTL_MS = 10 * 60 * 1000;

function json(value, init = {}) {
  const headers = new Headers(init.headers || {});
  for (const [key, val] of Object.entries(JSON_HEADERS)) headers.set(key, val);
  return new Response(JSON.stringify(value), { ...init, headers });
}

function randomBytes(length) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

function bytesToHex(bytes) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function randomToken() {
  return bytesToHex(randomBytes(32));
}

function generateTotpSecret() {
  return base32Encode(randomBytes(20));
}

function base32Encode(bytes) {
  let bits = 0;
  let value = 0;
  let output = '';

  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;

    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }

  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }

  return output;
}

function base32Decode(input) {
  const clean = String(input || '')
    .toUpperCase()
    .replace(/=+$/g, '')
    .replace(/\s+/g, '');

  let bits = 0;
  let value = 0;
  const output = [];

  for (const char of clean) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index < 0) throw new Error('Invalid Authenticator secret.');

    value = (value << 5) | index;
    bits += 5;

    if (bits >= 8) {
      output.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }

  return new Uint8Array(output);
}

function otpauthUri(workspaceId, secret) {
  const label = encodeURIComponent('NMRNL:' + workspaceId);
  return (
    'otpauth://totp/' +
    label +
    '?secret=' +
    encodeURIComponent(secret) +
    '&issuer=' +
    encodeURIComponent('NMRNL') +
    '&algorithm=SHA1&digits=6&period=30'
  );
}

async function hashToken(token) {
  const bytes = new TextEncoder().encode(token);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return bytesToHex(new Uint8Array(digest));
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

function codesEqual(left, right) {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let i = 0; i < left.length; i += 1) {
    mismatch |= left.charCodeAt(i) ^ right.charCodeAt(i);
  }
  return mismatch === 0;
}

async function hotp(secret, counter) {
  const keyBytes = base32Decode(secret);
  const counterBytes = new Uint8Array(8);
  let value = BigInt(counter);

  for (let index = 7; index >= 0; index -= 1) {
    counterBytes[index] = Number(value & 255n);
    value >>= 8n;
  }

  const key = await crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign'],
  );

  const signed = new Uint8Array(
    await crypto.subtle.sign('HMAC', key, counterBytes),
  );
  const offset = signed[signed.length - 1] & 15;
  const binary =
    ((signed[offset] & 127) << 24) |
    ((signed[offset + 1] & 255) << 16) |
    ((signed[offset + 2] & 255) << 8) |
    (signed[offset + 3] & 255);

  return String(binary % 1_000_000).padStart(6, '0');
}

async function verifyTotp(secret, suppliedCode) {
  const code = String(suppliedCode || '').replace(/\s+/g, '');
  if (!/^\d{6}$/.test(code)) return false;

  const counter = Math.floor(Date.now() / 30_000);
  for (const windowOffset of [-1, 0, 1]) {
    const expected = await hotp(secret, counter + windowOffset);
    if (codesEqual(expected, code)) return true;
  }

  return false;
}

function sessionList(meta) {
  const now = Date.now();
  return (Array.isArray(meta.sessions) ? meta.sessions : [])
    .filter(
      (session) =>
        session &&
        typeof session.hash === 'string' &&
        typeof session.expiresAt === 'string' &&
        Date.parse(session.expiresAt) > now,
    )
    .slice(-9);
}

async function accountWorkspaceId() {
  const bytes = new TextEncoder().encode('nmrnl-account:' + ACCOUNT_EMAIL.toLowerCase());
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)]
    .slice(0, 8)
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');
}

async function approvedAccessEmail(request, ctx) {
  let email = '';

  if (ctx?.access) {
    try {
      const identity = await ctx.access.getIdentity();
      email = String(identity?.email || '').trim().toLowerCase();
    } catch {
      email = '';
    }
  }

  if (!email) {
    email = String(
      request.headers.get('cf-access-authenticated-user-email') || '',
    )
      .trim()
      .toLowerCase();
  }

  return email === ACCOUNT_EMAIL ? email : '';
}

export class SupervisorHub {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  async getMeta() {
    return (await this.state.storage.get('meta')) || null;
  }

  async putMeta(meta) {
    await this.state.storage.put('meta', meta);
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

    const tokenHash = await hashToken(token);

    // Compatibility path for pre-Authenticator workspaces. This field is
    // deleted permanently after a successful in-place TOTP upgrade.
    if (meta.ownerTokenHash && tokenHash === meta.ownerTokenHash) {
      return true;
    }

    return sessionList(meta).some((session) => session.hash === tokenHash);
  }

  async snapshot(meta = null, data = null) {
    const resolvedMeta = meta || (await this.getMeta());
    const resolvedData = data || (await this.getData());

    return {
      workspaceId: resolvedMeta?.workspaceId || '',
      createdAt: resolvedMeta?.createdAt || new Date().toISOString(),
      authenticatorEnabled: Boolean(resolvedMeta?.totpEnabled),
      accountEmail: ACCOUNT_EMAIL,
      recoveryEmailEnabled: true,
      clients: resolvedData.clients,
      entries: resolvedData.entries,
      actions: resolvedData.actions,
    };
  }

  async requireAuth(request) {
    if (TEMPORARY_LOGIN_BYPASS) return null;

    if (!(await this.authenticated(request))) {
      return json(
        { error: 'Session expired. Sign in with a new Authenticator code.' },
        { status: 401 },
      );
    }
    return null;
  }

  async rateLimitStatus() {
    const current = (await this.state.storage.get('authRate')) || null;
    const now = Date.now();

    if (current?.lockedUntil && current.lockedUntil > now) {
      return {
        blocked: true,
        retryAfterSeconds: Math.max(
          1,
          Math.ceil((current.lockedUntil - now) / 1000),
        ),
      };
    }

    return { blocked: false, retryAfterSeconds: 0 };
  }

  async authFailure() {
    const now = Date.now();
    const current = (await this.state.storage.get('authRate')) || {
      windowStartedAt: now,
      failures: 0,
      lockedUntil: 0,
    };

    if (now - current.windowStartedAt > RATE_WINDOW_MS) {
      current.windowStartedAt = now;
      current.failures = 0;
      current.lockedUntil = 0;
    }

    current.failures += 1;

    if (current.failures >= MAX_AUTH_FAILURES) {
      current.lockedUntil = now + RATE_LOCK_MS;
      current.windowStartedAt = now;
      current.failures = 0;
    }

    await this.state.storage.put('authRate', current);
  }

  async authSuccess() {
    await this.state.storage.delete('authRate');
  }

  async verifyAuthenticator(meta, code) {
    const limit = await this.rateLimitStatus();
    if (limit.blocked) {
      return {
        response: json(
          {
            error:
              'Too many incorrect codes. Try again in ' +
              Math.ceil(limit.retryAfterSeconds / 60) +
              ' minute(s).',
          },
          {
            status: 429,
            headers: { 'retry-after': String(limit.retryAfterSeconds) },
          },
        ),
      };
    }

    if (!meta.totpSecret || !(await verifyTotp(meta.totpSecret, code))) {
      await this.authFailure();
      return {
        response: json(
          { error: 'That Authenticator code is not valid.' },
          { status: 401 },
        ),
      };
    }

    await this.authSuccess();
    return { response: null };
  }

  async issueSession(meta, disableLegacy = false) {
    const token = randomToken();
    const now = new Date();
    const expires = new Date(now.getTime() + SESSION_TTL_MS);

    meta.sessions = sessionList(meta);
    meta.sessions.push({
      hash: await hashToken(token),
      createdAt: now.toISOString(),
      expiresAt: expires.toISOString(),
    });

    if (disableLegacy) delete meta.ownerTokenHash;

    await this.putMeta(meta);
    return token;
  }

  async initialise(request) {
    const existing = await this.getMeta();
    if (existing) {
      return json({ error: 'Workspace already exists.' }, { status: 409 });
    }

    const workspaceId = safeWorkspaceId(
      request.headers.get('x-workspace-id') || '',
    );
    const totpSecret = request.headers.get('x-totp-secret') || '';

    if (!workspaceId || !/^[A-Z2-7]{32}$/.test(totpSecret)) {
      return json({ error: 'Invalid workspace setup.' }, { status: 400 });
    }

    const createdAt = new Date().toISOString();
    const meta = {
      workspaceId,
      createdAt,
      totpSecret,
      totpEnabled: false,
      sessions: [],
    };
    const data = cloneDefaultData();

    await this.putMeta(meta);
    await this.putData(data);

    return json({ ok: true }, { status: 201 });
  }

  async confirmInitialAuthenticator(request) {
    const meta = await this.getMeta();
    if (!meta) return json({ error: 'Workspace not found.' }, { status: 404 });
    if (meta.totpEnabled) {
      return json(
        { error: 'Authenticator is already enabled. Use sign in instead.' },
        { status: 409 },
      );
    }

    const body = await readObject(request);
    const checked = await this.verifyAuthenticator(meta, body.code);
    if (checked.response) return checked.response;

    meta.totpEnabled = true;
    const sessionToken = await this.issueSession(meta);
    return json({
      sessionToken,
      state: await this.snapshot(meta),
    });
  }

  async loginWithAuthenticator(request) {
    const meta = await this.getMeta();
    if (!meta) return json({ error: 'Workspace not found.' }, { status: 404 });
    if (!meta.totpEnabled) {
      return json(
        {
          error:
            'Google Authenticator has not been enabled for this workspace yet.',
        },
        { status: 409 },
      );
    }

    const body = await readObject(request);
    const checked = await this.verifyAuthenticator(meta, body.code);
    if (checked.response) return checked.response;

    const sessionToken = await this.issueSession(meta);
    return json({
      sessionToken,
      state: await this.snapshot(meta),
    });
  }

  async beginAccessRecovery() {
    const meta = await this.getMeta();
    if (!meta) return json({ error: 'Workspace not found.' }, { status: 404 });
    if (!meta.totpEnabled) {
      return json(
        { error: 'Finish Google Authenticator setup before using recovery.' },
        { status: 409 },
      );
    }

    const totpSecret = generateTotpSecret();
    const recoveryToken = randomToken();

    await this.state.storage.put('recoveryEnrollment', {
      tokenHash: await hashToken(recoveryToken),
      totpSecret,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    });

    return json({
      workspaceId: meta.workspaceId,
      recoveryToken,
      totpSecret,
      otpauthUri: otpauthUri(meta.workspaceId, totpSecret),
    });
  }

  async confirmEmailRecovery(request) {
    const meta = await this.getMeta();
    if (!meta) return json({ error: 'Workspace not found.' }, { status: 404 });

    const body = await readObject(request);
    const recoveryToken = stringValue(body.recoveryToken);
    const code = stringValue(body.code);
    const enrollment = (await this.state.storage.get('recoveryEnrollment')) || null;

    if (!enrollment || Date.parse(enrollment.expiresAt) <= Date.now()) {
      await this.state.storage.delete('recoveryEnrollment');
      return json(
        { error: 'Recovery setup expired. Start recovery again.' },
        { status: 410 },
      );
    }

    if (
      !recoveryToken ||
      !codesEqual(await hashToken(recoveryToken), enrollment.tokenHash)
    ) {
      return json({ error: 'Recovery session rejected.' }, { status: 401 });
    }

    if (!(await verifyTotp(enrollment.totpSecret, code))) {
      return json(
        { error: 'That new Authenticator code is not valid.' },
        { status: 401 },
      );
    }

    meta.totpSecret = enrollment.totpSecret;
    meta.totpEnabled = true;
    meta.sessions = [];
    delete meta.ownerTokenHash;

    await this.state.storage.delete('recoveryEnrollment');

    const sessionToken = await this.issueSession(meta, true);
    return json({
      sessionToken,
      state: await this.snapshot(meta),
    });
  }

  async beginLegacyEnrollment() {
    const meta = await this.getMeta();
    if (!meta) return json({ error: 'Workspace not found.' }, { status: 404 });
    if (meta.totpEnabled) {
      return json(
        { error: 'Google Authenticator is already enabled.' },
        { status: 409 },
      );
    }

    const totpSecret = generateTotpSecret();
    meta.totpSecret = totpSecret;
    await this.putMeta(meta);

    return json({
      workspaceId: meta.workspaceId,
      totpSecret,
      otpauthUri: otpauthUri(meta.workspaceId, totpSecret),
    });
  }

  async confirmLegacyEnrollment(request) {
    const meta = await this.getMeta();
    if (!meta) return json({ error: 'Workspace not found.' }, { status: 404 });
    if (meta.totpEnabled) {
      return json(
        { error: 'Google Authenticator is already enabled.' },
        { status: 409 },
      );
    }

    const body = await readObject(request);
    const checked = await this.verifyAuthenticator(meta, body.code);
    if (checked.response) return checked.response;

    meta.totpEnabled = true;
    const sessionToken = await this.issueSession(meta, true);

    return json({
      sessionToken,
      state: await this.snapshot(meta),
    });
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
        return json(
          { error: 'Client is required for this entry type.' },
          { status: 400 },
        );
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
      supportNoteStatus: stringValue(body.supportNoteBreakdown)
        ? 'inProgress'
        : 'incomplete',
      supportNotePersonName: client,
      supportNoteUpdatedAt: stringValue(body.supportNoteBreakdown) ? now : null,
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

    return json(
      { state: await this.snapshot(null, data), entry },
      { status: 201 },
    );
  }


  async updateEntry(request, entryId) {
    const body = await readObject(request);
    const data = await this.getData();
    const entry = data.entries.find((item) => item.id === entryId);

    if (!entry) {
      return json({ error: 'Entry not found.' }, { status: 404 });
    }

    const mode = modeValue(body.mode || entry.mode);
    const type = stringValue(body.type || entry.type);
    const date = stringValue(body.date || entry.date);
    const startTime = stringValue(body.startTime || entry.startTime);
    const client = stringValue(body.client || entry.client);
    const minutes = Math.max(
      1,
      Math.min(1440, Math.round(numberValue(body.minutes) || entry.minutes || 1)),
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
    if (!client) {
      return json({ error: 'Client is required.' }, { status: 400 });
    }

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
        createdAt: new Date().toISOString(),
      };
      data.clients.push(clientRecord);
    }

    entry.mode = mode;
    entry.clientId = clientRecord.id;
    entry.client = client;
    entry.type = type;
    entry.date = date;
    entry.startTime = startTime;
    entry.minutes = minutes;
    entry.notes = Array.isArray(body.notes)
      ? body.notes.map((item) => stringValue(item)).filter(Boolean).slice(0, 100)
      : entry.notes;
    entry.supportNoteBreakdown = stringValue(body.supportNoteBreakdown);
    entry.importantText = body.importantText === true;
    entry.textContactDirection = TEXT_DIRECTIONS.has(
      stringValue(body.textContactDirection),
    )
      ? stringValue(body.textContactDirection)
      : 'received';
    entry.textReplyNeeded = body.textReplyNeeded === true;
    entry.odometerStart =
      type === 'homeVisit' ? numberValue(body.odometerStart) : null;
    entry.odometerEnd =
      type === 'homeVisit' ? numberValue(body.odometerEnd) : null;
    entry.updatedAt = new Date().toISOString();

    await this.putData(data);
    return json({ state: await this.snapshot(null, data), entry });
  }

  async updateSupportNote(request, entryId) {
    const body = await readObject(request);
    const data = await this.getData();
    const entry = data.entries.find((item) => item.id === entryId);

    if (!entry) {
      return json({ error: 'Entry not found.' }, { status: 404 });
    }

    const status = stringValue(body.status);
    if (!SUPPORT_NOTE_STATUSES.has(status)) {
      return json({ error: 'Unknown support note status.' }, { status: 400 });
    }

    const noteText = stringValue(body.noteText);
    const personName = stringValue(body.personName) || entry.client;
    const now = new Date().toISOString();

    entry.supportNoteBreakdown = noteText;
    entry.supportNoteStatus = status;
    entry.supportNotePersonName = personName;
    entry.supportNoteUpdatedAt = now;
    entry.updatedAt = now;

    await this.putData(data);
    return json({ state: await this.snapshot(null, data), entry });
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

    return json(
      { state: await this.snapshot(null, data), action },
      { status: 201 },
    );
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
    try {
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

      if (suffix === '/account/status' && request.method === 'GET') {
        const meta = await this.getMeta();
        return json({
          exists: Boolean(meta),
          workspaceId: meta?.workspaceId || workspaceMatch[1].toLowerCase(),
          authenticatorEnabled: Boolean(meta?.totpEnabled),
        });
      }

      if (suffix === '/temporary/open' && request.method === 'GET') {
        if (!TEMPORARY_LOGIN_BYPASS) {
          return json({ error: 'Temporary login bypass is disabled.' }, { status: 404 });
        }
        return json({ state: await this.snapshot() });
      }

      if (suffix === '/auth/confirm' && request.method === 'POST') {
        return this.confirmInitialAuthenticator(request);
      }

      if (suffix === '/auth/login' && request.method === 'POST') {
        return this.loginWithAuthenticator(request);
      }

      if (suffix === '/auth/recovery/start' && request.method === 'POST') {
        return this.beginAccessRecovery();
      }

      if (suffix === '/auth/recovery/confirm' && request.method === 'POST') {
        return this.confirmEmailRecovery(request);
      }

      const authError = await this.requireAuth(request);
      if (authError) return authError;

      if (suffix === '/auth/enrol' && request.method === 'POST') {
        return this.beginLegacyEnrollment();
      }

      if (suffix === '/auth/enrol/confirm' && request.method === 'POST') {
        return this.confirmLegacyEnrollment(request);
      }

      if (suffix === '/snapshot' && request.method === 'GET') {
        return json({ state: await this.snapshot() });
      }

      if (suffix === '/entries' && request.method === 'POST') {
        return this.createEntry(request);
      }

      const supportNoteUpdate = suffix.match(
        /^\/entries\/([^/]+)\/support-note$/,
      );
      if (supportNoteUpdate && request.method === 'PATCH') {
        return this.updateSupportNote(
          request,
          decodeURIComponent(supportNoteUpdate[1]),
        );
      }

      const entryUpdate = suffix.match(/^\/entries\/([^/]+)$/);
      if (entryUpdate && request.method === 'PATCH') {
        return this.updateEntry(request, decodeURIComponent(entryUpdate[1]));
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
    } catch (error) {
      return json(
        {
          error:
            error instanceof Error ? error.message : 'NMRNL request failed.',
        },
        { status: 400 },
      );
    }
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname.startsWith('/api/') && !TEMPORARY_LOGIN_BYPASS) {
      const email = await approvedAccessEmail(request, ctx);
      if (!email) {
        return json(
          {
            error:
              'Cloudflare Access must verify ' +
              ACCOUNT_EMAIL +
              ' before NMRNL API access.',
          },
          { status: 403 },
        );
      }
    }

    if (url.pathname === '/api/health') {
      return json({
        ok: true,
        app: 'NMRNL',
        service: 'pvp-sim',
        auth: TEMPORARY_LOGIN_BYPASS
          ? 'temporary-bypass'
          : 'cloudflare-access+totp',
        accountEmail: ACCOUNT_EMAIL,
        storage: 'durable-object',
        now: new Date().toISOString(),
      });
    }

    if (url.pathname === '/api/account/open' && request.method === 'POST') {
      if (!TEMPORARY_LOGIN_BYPASS) {
        return json({ error: 'Temporary login bypass is disabled.' }, { status: 404 });
      }

      const workspaceId = await accountWorkspaceId();
      const objectId = env.SUPERVISOR_HUB.idFromName('nmrnl:' + workspaceId);
      const stub = env.SUPERVISOR_HUB.get(objectId);

      const statusResponse = await stub.fetch(
        new Request(
          url.origin + '/api/workspace/' + workspaceId + '/account/status',
          { method: 'GET' },
        ),
      );
      const status = await statusResponse.json();

      if (!status.exists) {
        const initResponse = await stub.fetch(
          new Request(
            url.origin + '/api/workspace/' + workspaceId + '/init',
            {
              method: 'POST',
              headers: {
                'x-workspace-id': workspaceId,
                'x-totp-secret': generateTotpSecret(),
              },
            },
          ),
        );

        if (!initResponse.ok && initResponse.status !== 409) {
          return json(
            { error: 'Could not initialise the NMRNL workspace.' },
            { status: 500 },
          );
        }
      }

      const openResponse = await stub.fetch(
        new Request(
          url.origin + '/api/workspace/' + workspaceId + '/temporary/open',
          { method: 'GET' },
        ),
      );
      const opened = await openResponse.json();

      return json({
        workspaceId,
        state: opened.state,
        temporaryLoginBypass: true,
      });
    }

    if (url.pathname === '/api/account/workspace' && request.method === 'GET') {
      const workspaceId = await accountWorkspaceId();
      const objectId = env.SUPERVISOR_HUB.idFromName('nmrnl:' + workspaceId);
      const stub = env.SUPERVISOR_HUB.get(objectId);
      return stub.fetch(
        new Request(url.origin + '/api/workspace/' + workspaceId + '/account/status', {
          method: 'GET',
        }),
      );
    }

    if (url.pathname === '/api/workspace' && request.method === 'POST') {
      const workspaceId = await accountWorkspaceId();
      const totpSecret = generateTotpSecret();
      const objectId = env.SUPERVISOR_HUB.idFromName('nmrnl:' + workspaceId);
      const stub = env.SUPERVISOR_HUB.get(objectId);
      const initRequest = new Request(
        url.origin + '/api/workspace/' + workspaceId + '/init',
        {
          method: 'POST',
          headers: {
            'x-workspace-id': workspaceId,
            'x-totp-secret': totpSecret,
          },
        },
      );

      const initialised = await stub.fetch(initRequest);
      if (!initialised.ok) {
        if (initialised.status === 409) {
          return json(
            {
              error:
                'This NMRNL account already has a workspace. Sign in instead.',
              workspaceId,
            },
            { status: 409 },
          );
        }
        return json(
          { error: 'Could not initialise NMRNL workspace.' },
          { status: 500 },
        );
      }

      return json(
        {
          workspaceId,
          totpSecret,
          otpauthUri: otpauthUri(workspaceId, totpSecret),
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
