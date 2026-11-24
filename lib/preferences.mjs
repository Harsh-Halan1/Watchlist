const kinds = ['skipped', 'lowFanservice'];
const validId = id => Number.isInteger(id) && id > 0 && id <= 2147483647;

export function validPreferenceChange(input) {
  if (input?.action === 'restoreAll') return true;
  if (input?.action === 'set') {
    return kinds.includes(input.kind) && validId(input.id) && typeof input.enabled === 'boolean';
  }
  return input?.action === 'import' && kinds.every(kind =>
    Array.isArray(input[kind]) && input[kind].length <= 10000 && input[kind].every(validId));
}

function applyChange(fields, input) {
  let changed = false;
  for (const kind of kinds) {
    if (input.action === 'import') {
      for (const id of input[kind]) {
        // An explicit removal takes precedence over a legacy mark from another browser.
        if (Object.hasOwn(fields[kind], id)) continue;
        fields[kind][id] = { booleanValue: true };
        changed = true;
      }
    } else if (input.action === 'set' && kind === input.kind) {
      if (fields[kind][input.id]?.booleanValue === input.enabled) continue;
      fields[kind][input.id] = { booleanValue: input.enabled };
      changed = true;
    } else if (input.action === 'restoreAll' && kind === 'skipped') {
      for (const value of Object.values(fields[kind])) {
        if (!value.booleanValue) continue;
        value.booleanValue = false;
        changed = true;
      }
    }
  }
  return changed;
}

export async function preferences(project, uid, viewerId, token, input) {
  const path = [project, uid, viewerId].map(encodeURIComponent);
  const url = 'https://firestore.googleapis.com/v1/projects/' + path[0] +
    '/databases/(default)/documents/watchlistOwners/' + path[1] + '/recommendationPreferences/' + path[2];
  const headers = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };
  const options = { headers, cache: 'no-store' };
  const failure = 'Could not sync recommendation preferences. Check Firestore setup or try again.';

  for (let attempt = 0; attempt < 4; attempt++) {
    const response = await fetch(url, { ...options, signal: AbortSignal.timeout(5000) });
    if (!response.ok && response.status !== 404) throw new Error(failure);
    const document = response.ok ? await response.json() : {};
    const fields = Object.fromEntries(kinds.map(kind => [kind, document.fields?.[kind]?.mapValue?.fields ?? {}]));
    if (input && applyChange(fields, input)) {
      const condition = new URLSearchParams(document.updateTime
        ? { 'currentDocument.updateTime': document.updateTime }
        : { 'currentDocument.exists': 'false' });
      const body = { fields: Object.fromEntries(kinds.map(kind => [kind, { mapValue: { fields: fields[kind] } }])) };
      const write = await fetch(url + '?' + condition, {
        ...options, method: 'PATCH', body: JSON.stringify(body), signal: AbortSignal.timeout(5000),
      });
      if (!write.ok) {
        const result = await write.json().catch(() => ({}));
        if (write.status === 409 || result.error?.status === 'FAILED_PRECONDITION') continue;
        throw new Error(failure);
      }
    }
    return Object.fromEntries(kinds.map(kind => [kind, Object.keys(fields[kind])
      .filter(id => fields[kind][id].booleanValue).map(Number)]));
  }
  throw new Error('Recommendation preferences changed on another device. Try again.');
}
