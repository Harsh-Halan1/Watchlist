import assert from 'node:assert/strict';
import test from 'node:test';
import { handle } from '../lib/backend.mjs';
import { airing, isFullyWatched, progressLimit } from '../lib/watch.mjs';

const origin = 'http://127.0.0.1:4173';
function request(path, input, { cookie, source = origin } = {}) {
  const headers = { origin: source };
  if (cookie) headers.cookie = cookie;
  return handle(new Request(origin + path, input === undefined ? { headers }
    : { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(input) }));
}

test('lists saved entries and updates episode progress and status', async () => {
  process.env.WATCHLIST_DEMO = '1';
  const entries = await (await request('/api/watchlist')).json();
  const overgeared = entries.find(entry => entry.media.title.english === 'Overgeared');
  assert.equal(entries.length, 6);
  assert.equal(airing(overgeared.media, overgeared.progress), '1 aired episode unwatched');
  const input = { id: overgeared.media.id, action: 'increment' };
  assert.equal((await request('/api/entry', input, { source: 'https://example.com' })).status, 403);
  const updated = await (await request('/api/entry', input)).json();
  assert.equal(updated.progress, 9);
  assert.equal(updated.status, 'CURRENT');
  assert.equal(isFullyWatched(updated.media, updated.media.episodes), false);
  assert.equal(airing(updated.media, updated.progress), 'Caught Up');
  assert.equal(progressLimit(updated.media), 9);
  assert.equal((await request('/api/entry', input)).status, 400);
  assert.equal((await request('/api/entry', { id: input.id, action: 'save', progress: 10,
    expectedProgress: 9, expectedStatus: 'CURRENT' })).status, 400);
  const missing = entries.find(entry => entry.media.title.english === 'Missing schedule');
  assert.equal(progressLimit(missing.media), null);
  assert.equal((await request('/api/entry', { id: missing.media.id, action: 'increment' })).status, 400);
  const corrected = await (await request('/api/entry', { id: missing.media.id, action: 'save', progress: 2,
    expectedProgress: 3, expectedStatus: 'CURRENT' })).json();
  assert.equal(corrected.progress, 2);
  const upcoming = { ...updated.media, nextAiringEpisode: { episode: 11, airingAt: 1000 } };
  assert.equal(progressLimit(upcoming, 999999), 10);
  assert.equal(progressLimit(upcoming, 1000000), null);
  assert.equal(progressLimit({ ...updated.media, status: 'NOT_YET_RELEASED' }), 0);
  assert.equal(airing(updated.media, 10), 'Watched count exceeds aired episodes');
  const reread = await (await request('/api/watchlist')).json();
  assert.equal(reread.find(entry => entry.media.id === input.id).progress, 9);
  const stale = await request('/api/entry', { id: input.id, action: 'save', progress: 8,
    expectedProgress: 8, expectedStatus: 'CURRENT' });
  assert.equal(stale.status, 409);
  const [movie] = await (await request('/api/search?q=Josee')).json();
  assert.equal(movie.format, 'MOVIE');
  assert.equal((await request('/api/entry', { id: movie.id, action: 'increment' })).status, 400);
  const [newSeason] = await (await request('/api/search?q=Blue%20Box%20Season%202')).json();
  const added = await (await request('/api/entry', { id: newSeason.id, action: 'save', progress: 0,
    expectedProgress: null, expectedStatus: null })).json();
  assert.equal(added.status, 'PLANNING');
  const paused = await (await request('/api/entry', { id: input.id, action: 'save', progress: 9,
    expectedProgress: 9, expectedStatus: 'CURRENT', status: 'PAUSED' })).json();
  assert.equal(paused.status, 'PAUSED');
  const [season] = await (await request('/api/search?q=Blue%20Box')).json();
  const complete = await (await request('/api/entry', { id: season.id, action: 'save',
    progress: season.episodes, expectedProgress: 0, expectedStatus: 'PLANNING', status: 'CURRENT' })).json();
  assert.equal(complete.status, 'COMPLETED');
  const list = await (await request('/api/watchlist')).json();
  assert.equal(list.find(entry => entry.media.id === season.id).status, 'COMPLETED');
  const [goldenTime] = await (await request('/api/search?q=Golden%20Time')).json();
  const beforeFinal = await (await request('/api/entry', { id: goldenTime.id, action: 'save',
    progress: goldenTime.episodes - 1, expectedProgress: 13, expectedStatus: 'PAUSED', status: 'CURRENT' })).json();
  assert.equal(beforeFinal.status, 'CURRENT');
  const afterFinal = await (await request('/api/entry', { id: goldenTime.id, action: 'increment' })).json();
  assert.equal(afterFinal.progress, goldenTime.episodes);
  assert.equal(afterFinal.status, 'COMPLETED');
  assert.equal(isFullyWatched(movie, 1), true);
  assert.equal(isFullyWatched({ ...movie, episodes: null }, 1), false);
});

test('requires authorization and loads all AniList list chunks without duplicates', async t => {
  process.env.WATCHLIST_DEMO = '0';
  process.env.ANILIST_CLIENT_ID = 'test-id';
  process.env.ANILIST_CLIENT_SECRET = 'test-secret';
  assert.equal((await request('/api/watchlist')).status, 401);
  const start = await request('/oauth/start', {});
  assert.equal(start.status, 303);
  const authorization = new URL(start.headers.get('Location'));
  const pendingCookie = start.headers.get('Set-Cookie').split(';')[0];
  const mock = (id, updatedAt) => ({ updatedAt, media: { id }, status: 'CURRENT', progress: 1 });
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (url.endsWith('/oauth/token')) return Response.json({ access_token: 'fake-token' });
    assert.equal(options.headers.Authorization, 'Bearer fake-token');
    const { query, variables } = JSON.parse(options.body);
    if (query.includes('Viewer')) return Response.json({ data: { Viewer: { id: 42, name: 'Test' } } });
    assert.equal(variables.userId, 42);
    const first = variables.chunk === 1;
    return Response.json({ data: { MediaListCollection: { hasNextChunk: first, lists: [
      { entries: first ? [mock(1, 50)] : [mock(1, 50), mock(2, 60)] },
    ] } } });
  });
  const callback = await request('/oauth/callback?code=example&state=' + authorization.searchParams.get('state'), undefined,
    { cookie: pendingCookie });
  assert.equal(callback.headers.get('Location'), '/');
  const cookie = callback.headers.get('Set-Cookie').split(';')[0];
  const list = await (await request('/api/watchlist', undefined, { cookie })).json();
  assert.deepEqual(list.map(entry => entry.media.id), [2, 1]);
});


test('hosted flow requires the verified owner and validates the OAuth callback across handlers', async t => {
  const before = { ...process.env };
  t.after(() => {
    for (const name of ['VERCEL', 'APP_ORIGIN', 'OWNER_EMAIL', 'FIREBASE_API_KEY', 'SESSION_SECRET']) {
      if (before[name] === undefined) delete process.env[name]; else process.env[name] = before[name];
    }
  });
  const hosted = 'https://watchlist.example.test';
  const email = 'owner@example.test';
  Object.assign(process.env, { VERCEL: '1', APP_ORIGIN: hosted, OWNER_EMAIL: email,
    FIREBASE_API_KEY: 'test-firebase', SESSION_SECRET: 'a'.repeat(64) });
  const { handle: otherInstance } = await import('../lib/backend.mjs?hosted-callback');
  const call = (path, { body, cookie, origin = hosted, handler = handle } = {}) => {
    const headers = { Origin: origin };
    if (cookie) headers.Cookie = cookie;
    return handler(new Request(hosted + path, { headers, ...(body !== undefined
      ? { method: 'POST', body: JSON.stringify(body) } : {}) }));
  };
  const cookieOf = (response, name) => response.headers.getSetCookie().find(value => value.startsWith(name + '=')).split(';')[0];
  let sent = 0;
  let verifiedEmail = email;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    const body = JSON.parse(options.body);
    if (url.includes('accounts:sendOobCode')) {
      sent++;
      assert.equal(body.email, email);
      assert.equal(body.continueUrl, hosted + '/oauth/email-link');
      assert.equal(body.canHandleCodeInApp, true);
      return Response.json({});
    }
    if (url.includes('accounts:signInWithEmailLink')) {
      assert.equal(body.oobCode, 'test-code');
      return Response.json({ idToken: 'test-id-token' });
    }
    if (url.includes('accounts:lookup')) {
      return Response.json({ users: [{ email: verifiedEmail, emailVerified: true, localId: 'owner-id' }] });
    }
    if (url.endsWith('/oauth/token')) {
      assert.equal(body.redirect_uri, hosted + '/oauth/callback');
      return Response.json({ access_token: 'test-ani-token' });
    }
    assert.equal(options.headers.Authorization, 'Bearer test-ani-token');
    return Response.json({ data: { Viewer: { id: 42, name: 'Owner' } } });
  });
  assert.equal((await call('/api/search?q=Golden')).status, 401);
  assert.equal((await call('/api/watchlist')).status, 401);
  assert.equal((await call('/oauth/start', { body: {} })).headers.get('location'), '/');
  assert.equal((await call('/oauth/email/start', { body: { email }, origin })).status, 403);
  await call('/oauth/email/start', { body: { email: 'another@example.test' } });
  assert.equal(sent, 0);
  assert.equal((await call('/oauth/email/start', { body: { email } })).status, 200);
  assert.equal(sent, 1);
  const link = await call('/oauth/email-link?mode=signIn&oobCode=test-code');
  assert.equal(link.headers.get('location'), '/?email=confirm');
  const pending = cookieOf(link, 'watchlist_email');
  verifiedEmail = 'another@example.test';
  const rejected = await call('/oauth/email/confirm', { body: {}, cookie: pending, handler: otherInstance });
  assert.equal(rejected.headers.get('location'), '/?email=failed');
  verifiedEmail = email;
  const confirmed = await call('/oauth/email/confirm', { body: {}, cookie: pending, handler: otherInstance });
  assert.match(confirmed.headers.getSetCookie()[0], /HttpOnly; SameSite=Lax; Secure/);
  const owner = cookieOf(confirmed, 'watchlist_owner');
  assert.equal((await (await call('/api/session', { cookie: owner })).json()).signedIn, true);
  const start = await call('/oauth/start', { body: {}, cookie: owner });
  const authorize = new URL(start.headers.get('location'));
  assert.equal(authorize.searchParams.get('redirect_uri'), hosted + '/oauth/callback');
  const state = cookieOf(start, 'watchlist_state');
  const callback = '/oauth/callback?code=test&state=' + authorize.searchParams.get('state');
  assert.equal((await call(callback, { cookie: owner + '; ' + state, handler: otherInstance })).headers.get('location'), '/');
  const linked = await call(callback, { cookie: owner + '; ' + state, handler: otherInstance });
  const connection = cookieOf(linked, 'watchlist_ani');
  assert.equal((await (await call('/api/session', { cookie: owner + '; ' + connection })).json()).name, 'Owner');
  assert.equal((await (await call('/api/session', { cookie: connection })).json()).signedIn, false);
});

