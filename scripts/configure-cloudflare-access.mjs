import { readFile } from 'node:fs/promises';

const API_BASE = 'https://api.cloudflare.com/client/v4';
const accountId = process.env.CLOUDFLARE_ACCOUNT_ID?.trim();
const apiToken = process.env.CLOUDFLARE_API_TOKEN?.trim();

if (!accountId) {
  throw new Error('CLOUDFLARE_ACCOUNT_ID is required.');
}
if (!apiToken) {
  throw new Error('CLOUDFLARE_API_TOKEN is required.');
}

const config = JSON.parse(
  await readFile(new URL('../cloudflare/access.config.json', import.meta.url), 'utf8'),
);

const {
  workerName,
  applicationName,
  policyName,
  allowedEmail,
  sessionDuration,
  identityProviderName,
  destinationType,
  autoRedirectToIdentity,
  allowAuthenticateViaWarp,
  appLauncherVisible,
  removeOtherApplicationPolicies,
} = config;

if (!workerName || !applicationName || !policyName || !allowedEmail) {
  throw new Error('cloudflare/access.config.json is missing required values.');
}

function log(message) {
  console.log('[NMRNL Cloudflare]', message);
}

async function cf(path, options = {}) {
  const response = await fetch(API_BASE + path, {
    ...options,
    headers: {
      authorization: 'Bearer ' + apiToken,
      'content-type': 'application/json',
      ...(options.headers || {}),
    },
  });

  const payload = await response.json().catch(() => null);

  if (!response.ok || payload?.success === false) {
    const details =
      payload?.errors?.map((error) => error.message).filter(Boolean).join('; ') ||
      payload?.messages?.map((message) => message.message).filter(Boolean).join('; ') ||
      ('HTTP ' + response.status);

    throw new Error(
      options.method?.toUpperCase() + ' ' + path + ' failed: ' + details,
    );
  }

  return payload?.result ?? payload;
}

async function findWorker() {
  const params = new URLSearchParams({
    name: workerName,
    per_page: '100',
  });

  const results = await cf(
    '/accounts/' +
      encodeURIComponent(accountId) +
      '/workers/scripts-search?' +
      params.toString(),
  );

  const exact = (Array.isArray(results) ? results : []).filter(
    (worker) =>
      worker.script_name === workerName &&
      worker.environment_is_default !== false,
  );

  if (exact.length === 1) return exact[0];

  if (exact.length > 1) {
    const serviceMatch = exact.find(
      (worker) => worker.service_name === workerName,
    );
    if (serviceMatch) return serviceMatch;
  }

  throw new Error(
    'Could not uniquely resolve Worker "' +
      workerName +
      '". Cloudflare returned ' +
      exact.length +
      ' exact default-environment matches.',
  );
}

async function ensureOtpIdentityProvider() {
  const path =
    '/accounts/' +
    encodeURIComponent(accountId) +
    '/access/identity_providers';

  const providers = await cf(path);
  const existing = (Array.isArray(providers) ? providers : []).find(
    (provider) => provider.type === 'onetimepin',
  );

  if (existing) {
    log('Using existing One-time PIN identity provider: ' + existing.name);
    return existing;
  }

  log('Creating One-time PIN identity provider.');
  return cf(path, {
    method: 'POST',
    body: JSON.stringify({
      name: identityProviderName || 'NMRNL One-time PIN',
      type: 'onetimepin',
      config: {},
    }),
  });
}

async function listApplications() {
  return cf(
    '/accounts/' +
      encodeURIComponent(accountId) +
      '/access/apps?per_page=100',
  );
}

function appHasWorkerDestination(app, workerId) {
  return Array.isArray(app?.destinations)
    ? app.destinations.some(
        (destination) =>
          destination?.type === destinationType &&
          destination?.worker_id === workerId,
      )
    : false;
}

async function ensureApplication(workerId, otpIdpId) {
  const appsRaw = await listApplications();
  const apps = Array.isArray(appsRaw) ? appsRaw : [];

  const byDestination = apps.filter(
    (app) =>
      app.type === 'self_hosted' &&
      appHasWorkerDestination(app, workerId),
  );
  const byName = apps.filter(
    (app) =>
      app.type === 'self_hosted' &&
      app.name === applicationName,
  );

  let app =
    byDestination.find((candidate) => candidate.name === applicationName) ||
    (byName.length === 1 ? byName[0] : null);

  if (!app && byName.length > 1) {
    throw new Error(
      'Multiple self-hosted Access applications are named "' +
        applicationName +
        '". Delete the duplicates or rename them before running this workflow.',
    );
  }

  const applicationBody = {
    type: 'self_hosted',
    name: applicationName,
    session_duration: sessionDuration || '24h',
    destinations: [
      {
        type: destinationType || 'worker',
        worker_id: workerId,
      },
    ],
    allowed_idps: [otpIdpId],
    auto_redirect_to_identity: autoRedirectToIdentity !== false,
    allow_authenticate_via_warp: allowAuthenticateViaWarp === true,
    app_launcher_visible: appLauncherVisible === true,
  };

  const appsPath =
    '/accounts/' +
    encodeURIComponent(accountId) +
    '/access/apps';

  if (!app) {
    log(
      'Creating Access application "' +
        applicationName +
        '" for Worker ' +
        workerName +
        '.',
    );

    app = await cf(appsPath, {
      method: 'POST',
      body: JSON.stringify({
        ...applicationBody,
        policies: [
          {
            name: policyName,
            decision: 'allow',
            include: [
              {
                email: {
                  email: allowedEmail,
                },
              },
            ],
            exclude: [],
            require: [],
            precedence: 1,
            session_duration: sessionDuration || '24h',
          },
        ],
      }),
    });
  } else {
    log('Updating existing Access application "' + applicationName + '".');
    app = await cf(
      appsPath + '/' + encodeURIComponent(app.id),
      {
        method: 'PUT',
        body: JSON.stringify(applicationBody),
      },
    );
  }

  return app;
}

async function normaliseApplicationPolicies(appId) {
  const base =
    '/accounts/' +
    encodeURIComponent(accountId) +
    '/access/apps/' +
    encodeURIComponent(appId) +
    '/policies';

  let policies = await cf(base);
  policies = Array.isArray(policies) ? policies : [];

  if (removeOtherApplicationPolicies !== false) {
    for (const policy of policies) {
      if (policy.name === policyName) continue;

      log(
        'Removing unmanaged policy "' +
          (policy.name || policy.id) +
          '" from NMRNL Access application.',
      );
      await cf(base + '/' + encodeURIComponent(policy.id), {
        method: 'DELETE',
      });
    }
  }

  policies = await cf(base);
  policies = Array.isArray(policies) ? policies : [];

  const matches = policies.filter((policy) => policy.name === policyName);

  if (matches.length > 1) {
    const [keep, ...duplicates] = matches;
    for (const duplicate of duplicates) {
      log('Removing duplicate policy "' + policyName + '".');
      await cf(base + '/' + encodeURIComponent(duplicate.id), {
        method: 'DELETE',
      });
    }
    matches.length = 1;
    matches[0] = keep;
  }

  const desiredPolicy = {
    name: policyName,
    decision: 'allow',
    include: [
      {
        email: {
          email: allowedEmail,
        },
      },
    ],
    exclude: [],
    require: [],
    precedence: 1,
    session_duration: sessionDuration || '24h',
    purpose_justification_required: false,
    approval_required: false,
  };

  if (matches.length === 1) {
    log('Enforcing exact-email policy for ' + allowedEmail + '.');
    await cf(base + '/' + encodeURIComponent(matches[0].id), {
      method: 'PUT',
      body: JSON.stringify(desiredPolicy),
    });
  } else {
    log('Creating exact-email policy for ' + allowedEmail + '.');
    await cf(base, {
      method: 'POST',
      body: JSON.stringify(desiredPolicy),
    });
  }
}

async function verifyConfiguration(workerId, otpIdpId, appId) {
  const app = await cf(
    '/accounts/' +
      encodeURIComponent(accountId) +
      '/access/apps/' +
      encodeURIComponent(appId),
  );

  const policies = await cf(
    '/accounts/' +
      encodeURIComponent(accountId) +
      '/access/apps/' +
      encodeURIComponent(appId) +
      '/policies',
  );

  const expectedPolicy = (Array.isArray(policies) ? policies : []).find(
    (policy) => policy.name === policyName,
  );

  const exactEmailRule = expectedPolicy?.include?.some(
    (rule) => rule?.email?.email?.toLowerCase() === allowedEmail.toLowerCase(),
  );

  const otherPolicies = (Array.isArray(policies) ? policies : []).filter(
    (policy) => policy.name !== policyName,
  );

  const ok =
    app?.name === applicationName &&
    app?.type === 'self_hosted' &&
    appHasWorkerDestination(app, workerId) &&
    Array.isArray(app.allowed_idps) &&
    app.allowed_idps.includes(otpIdpId) &&
    app.auto_redirect_to_identity === true &&
    expectedPolicy?.decision === 'allow' &&
    exactEmailRule &&
    otherPolicies.length === 0;

  if (!ok) {
    throw new Error(
      'Cloudflare accepted the requests, but the final NMRNL Access configuration did not verify.',
    );
  }

  log('Verified: application = ' + applicationName);
  log('Verified: Worker destination = ' + workerName + ' (' + workerId + ')');
  log('Verified: identity provider = One-time PIN only');
  log('Verified: allowed email = ' + allowedEmail);
  log('Verified: session duration = ' + (sessionDuration || '24h'));
}

const worker = await findWorker();
log(
  'Resolved Worker "' +
    workerName +
    '" to immutable Worker ID ' +
    worker.id +
    '.',
);

const otpIdp = await ensureOtpIdentityProvider();
if (!otpIdp?.id) {
  throw new Error('One-time PIN identity provider did not return an ID.');
}

const app = await ensureApplication(worker.id, otpIdp.id);
if (!app?.id) {
  throw new Error('Access application did not return an ID.');
}

await normaliseApplicationPolicies(app.id);
await verifyConfiguration(worker.id, otpIdp.id, app.id);

if (process.env.GITHUB_STEP_SUMMARY) {
  const { appendFile } = await import('node:fs/promises');
  await appendFile(
    process.env.GITHUB_STEP_SUMMARY,
    [
      '## NMRNL Cloudflare Access configured',
      '',
      '- Application: **' + applicationName + '**',
      '- Worker: **' + workerName + '**',
      '- Destination: **production + previews**',
      '- Identity provider: **One-time PIN**',
      '- Allowed account: **' + allowedEmail + '**',
      '- Session duration: **' + (sessionDuration || '24h') + '**',
      '',
    ].join('\n'),
  );
}
