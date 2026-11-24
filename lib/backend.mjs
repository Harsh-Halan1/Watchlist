import { randomBytes } from 'node:crypto';
import { cookies, sessionKey } from './session.mjs';
import { firebase, refreshOwnerToken, verifyEmailLink, verifyPassword } from './owner-auth.mjs';
import { preferences, validPreferenceChange } from './preferences.mjs';
import { resolve } from 'node:path';
import { demo } from './demo.mjs';
import { rankRecommendations, recommendationSeeds } from './recommendations.mjs';
import { nextStatus, progressLimit } from './watch.mjs';

const localOrigin = 'http://127.0.0.1:4173';
const ownerCookie = 'watchlist_owner';
const aniCookie = 'watchlist_ani';
const stateCookie = 'watchlist_state';
const emailCookie = 'watchlist_email';
const ownerSessionSeconds = 7 * 24 * 60 * 60;
const writes = globalThis[Symbol.for('watchlist.writes')] ??= new Map();
const fields = 'id title { english romaji native } coverImage { large } seasonYear format status episodes nextAiringEpisode { episode airingAt }';
const entryFields = 'progress status updatedAt score(format: POINT_100)';
const live = 'https://graphql.anilist.co';

function settings() {
  if (!process.env.VERCEL && (!process.env.ANILIST_CLIENT_ID || !process.env.ANILIST_CLIENT_SECRET)) {
    try { process.loadEnvFile(resolve(process.cwd(), '..', '.env')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  const origin = new URL(process.env.APP_ORIGIN || localOrigin).origin;
  const hosted = Boolean(process.env.VERCEL) || origin !== localOrigin;
  const ownerEmail = process.env.OWNER_EMAIL?.trim().toLowerCase();
  const firebaseKey = process.env.FIREBASE_API_KEY;
  const privateMode = hosted || Boolean(ownerEmail || firebaseKey);
  if (hosted && (origin === localOrigin || !origin.startsWith('https://'))) throw new Error('Set APP_ORIGIN to the production HTTPS origin.');
  if (privateMode && (!ownerEmail || !firebaseKey)) throw new Error('Configure OWNER_EMAIL and FIREBASE_API_KEY.');
  return {
    origin, hosted, ownerEmail, firebaseKey, privateMode,
    firebaseProjectId: privateMode ? process.env.FIREBASE_PROJECT_ID?.trim() : undefined,
    key: sessionKey(process.env.SESSION_SECRET, hosted),
    id: process.env.ANILIST_CLIENT_ID,
    secret: process.env.ANILIST_CLIENT_SECRET,
    demoMode: !privateMode && process.env.WATCHLIST_DEMO === '1',
  };
}

function json(value, status = 200, sessionCookie) {
  const headers = { 'Cache-Control': 'no-store' };
  if (sessionCookie) headers['Set-Cookie'] = sessionCookie;
  return Response.json(value, { status, headers });
}
function redirect(location, ...cookieValues) {
  const headers = { Location: location, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' };
  const response = new Response(null, { status: 303, headers });
  for (const cookie of cookieValues) response.headers.append('Set-Cookie', cookie);
  return response;
}

async function graph(query, variables, token) {
  if (token === 'demo') return demo(query, variables);
  const headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  let response;
  try {
    response = await fetch(live, { method: 'POST', headers, body: JSON.stringify({ query, variables }),
      cache: 'no-store', signal: AbortSignal.timeout(10000) });
  } catch { throw new Error('Could not reach AniList. Try again shortly.'); }
  const result = await response.json().catch(() => ({}));
  if (response.status === 429) throw new Error('AniList is rate limiting requests. Try again shortly.');
  if (response.status === 401) throw new Error('AniList authorization expired. Reconnect your account.');
  if (!response.ok || !result.data || result.errors?.length) throw new Error('AniList could not complete this request.');
  return result.data;
}

async function watchlist(viewer, token) {
  const entries = new Map();
  for (let chunk = 1;; chunk++) {
    const { MediaListCollection: collection } = await graph(`query Watchlist($userId: Int!, $chunk: Int!) {
      MediaListCollection(userId: $userId, type: ANIME, chunk: $chunk, perChunk: 250) {
        hasNextChunk lists { entries { ${entryFields} media { ${fields} } } }
      }
    }`, { userId: viewer.id, chunk }, token);
    if (!collection) throw new Error('AniList did not return your watchlist.');
    for (const group of collection.lists ?? []) {
      for (const entry of group?.entries ?? []) if (entry?.media) entries.set(entry.media.id, entry);
    }
    if (!collection.hasNextChunk) return [...entries.values()].sort((a, b) => b.updatedAt - a.updatedAt);
  }
}

async function recommendations(viewer, token) {
  const entries = await watchlist(viewer, token);
  const seeds = recommendationSeeds(entries);
  if (!seeds.length) return { hasSeeds: false, items: [] };
  const { Page } = await graph(`query ForYou($ids: [Int!]!) {
    Page(perPage: 6) {
      media(id_in: $ids, type: ANIME) {
        id
        recommendations(perPage: 10, sort: [RATING_DESC]) {
          nodes { rating mediaRecommendation { ${fields} isAdult genres tags { name isAdult } } }
        }
      }
    }
  }`, { ids: seeds.map(entry => entry.media.id) }, token);
  return { hasSeeds: true, items: rankRecommendations(entries, seeds, Page?.media ?? []) };
}

async function mediaDetails(id, token) {
  const { Media } = await graph(`query Entry($id: Int!) { Media(id: $id, type: ANIME) {
    ${fields} mediaListEntry { ${entryFields} private }
  } }`, { id }, token);
  return Media;
}

async function airingSchedule(token) {
  const start = Math.floor(Date.now() / 1000);
  const end = start + 7 * 24 * 60 * 60;
  const episodes = new Map();
  for (let page = 1;; page++) {
    const { Page } = await graph(`query Schedule($page: Int!, $start: Int!, $end: Int!) {
      Page(page: $page, perPage: 50) {
        pageInfo { hasNextPage }
        airingSchedules(airingAt_greater: $start, airingAt_lesser: $end, sort: [TIME, ID]) {
          id episode airingAt media { ${fields} isAdult }
        }
      }
    }`, { page, start, end }, token);
    if (!Page) throw new Error('AniList did not return an airing schedule.');
    for (const item of Page.airingSchedules ?? []) {
      if (item?.media?.isAdult === false) episodes.set(item.id, item);
    }
    if (!Page.pageInfo?.hasNextPage) break;
  }
  return [...episodes.values()].sort((a, b) => a.airingAt - b.airingAt || a.id - b.id);
}

async function save(input, viewer, token) {
  const key = viewer.id + ':' + input.id;
  const pending = (writes.get(key) ?? Promise.resolve()).catch(() => {}).then(async () => {
    const media = await mediaDetails(input.id, token);
    if (!media) return json({ error: 'Anime not found.' }, 404);
    const entry = media.mediaListEntry;
    if (input.action === 'save' && (input.expectedProgress !== (entry?.progress ?? null) ||
      input.expectedStatus !== (entry?.status ?? null))) return json({ error: 'This entry changed on AniList. Reopen it and try again.' }, 409);
    const watched = entry?.progress ?? 0;
    const progress = input.action === 'increment' ? watched + 1 : input.progress;
    if (!['save', 'increment'].includes(input.action) || !Number.isInteger(progress) || progress < 0) {
      return json({ error: 'Enter a valid episode count.' }, 400);
    }
    const limit = progressLimit(media);
    if (progress > watched && (limit === null || progress > limit)) {
      const error = limit === null ? "AniList's airing schedule is unavailable. Try refreshing before adding episodes."
        : media.status === 'FINISHED' ? 'Progress cannot exceed the episode count.'
        : limit === 0 ? 'No episodes have aired yet.' : 'You can log up to episode ' + limit + '.';
      return json({ error }, 400);
    }
    if (input.status !== undefined && !['CURRENT','PLANNING','COMPLETED','PAUSED','DROPPED','REPEATING'].includes(input.status)) {
      return json({ error: 'Invalid watch status.' }, 400);
    }
    if (input.score !== undefined) {
      if (input.action !== 'save' || !Number.isInteger(input.score) || input.score < 0 || input.score > 100) {
        return json({ error: 'Enter a whole number from 1 to 100, or leave the rating blank.' }, 400);
      }
      if (input.expectedScore !== (entry?.score ?? 0)) {
        return json({ error: 'The rating changed on AniList. Reopen the entry and try again.' }, 409);
      }
    }
    const status = nextStatus(media, entry?.status, progress, input.status);
    const { SaveMediaListEntry } = await graph(`mutation Save($id: Int!, $progress: Int!, $status: MediaListStatus!, $private: Boolean!, $score: Int) {
      SaveMediaListEntry(mediaId: $id, progress: $progress, status: $status, private: $private, scoreRaw: $score) { ${entryFields} }
    }`, { id: input.id, progress, status, private: entry?.private ?? true, score: input.score }, token);
    return json({ ...SaveMediaListEntry, media });
  });
  writes.set(key, pending);
  try { return await pending; }
  finally { if (writes.get(key) === pending) writes.delete(key); }
}

export async function handle(request) {
  try {
    const config = settings();
    const { origin } = config;
    const callback = origin + '/oauth/callback';
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;
    if (method === 'POST' && request.headers.get('origin') !== origin) {
      return json({ error: 'Request origin rejected. Open the app at ' + origin + '.' }, 403);
    }
    const jar = cookies(request, config.key, config.origin.startsWith('https://'));
    const savedOwner = jar.read(ownerCookie);
    const owner = savedOwner?.email === config.ownerEmail ? savedOwner : null;
    const signedIn = !config.privateMode || Boolean(owner);
    const connection = jar.read(aniCookie);
    const current = signedIn && connection?.uid === owner?.uid ? connection : null;

    if (config.privateMode && path === '/oauth/password' && method === 'POST') {
      const input = await request.json().catch(() => null);
      if (typeof input?.email !== 'string' || input.email.trim().toLowerCase() !== config.ownerEmail ||
          typeof input.password !== 'string' || !input.password || input.password.length > 4096) {
        return json({ error: 'Could not sign in. Check your email and password.' }, 401);
      }
      try {
        const identity = await verifyPassword(config, input.password);
        return json({ signedIn: true }, 200, jar.set(ownerCookie, identity, ownerSessionSeconds));
      } catch {
        return json({ error: 'Could not sign in. Check your email and password.' }, 401);
      }
    }
    if (config.privateMode && path === '/oauth/email/start' && method === 'POST') {
      const input = await request.json().catch(() => null);
      if (typeof input?.email === 'string' && input.email.trim().toLowerCase() === config.ownerEmail) {
        try {
          await firebase(config, 'sendOobCode', { requestType: 'EMAIL_SIGNIN', email: config.ownerEmail,
            continueUrl: origin + '/oauth/email-link', canHandleCodeInApp: true });
        } catch { return json({ error: 'Could not send a sign-in link. Try again later.' }, 503); }
      }
      return json({ sent: true });
    }
    if (config.privateMode && path === '/oauth/email-link' && method === 'GET') {
      const code = url.searchParams.get('oobCode');
      if (!code || code.length > 1024 || url.searchParams.get('mode') !== 'signIn') return redirect('/?email=failed');
      return redirect('/?email=confirm', jar.set(emailCookie, { code }, 600));
    }
    if (config.privateMode && path === '/oauth/email/confirm' && method === 'POST') {
      const pending = jar.read(emailCookie);
      if (pending?.code) {
        try {
          const identity = await verifyEmailLink(config, pending.code);
          return redirect('/', jar.set(ownerCookie, identity, ownerSessionSeconds), jar.clear(emailCookie));
        } catch { return redirect('/?email=failed', jar.clear(emailCookie)); }
      }
      return redirect('/?email=failed');
    }
    if (path === '/oauth/sign-out' && method === 'POST') {
      return redirect('/', jar.clear(ownerCookie), jar.clear(aniCookie), jar.clear(stateCookie), jar.clear(emailCookie));
    }
    const viewer = config.demoMode ? { id: 0, name: 'Demo account' } : current?.viewer;
    const token = config.demoMode ? 'demo' : current?.token;
    const configured = Boolean(config.id && config.secret);
    if (path === '/api/session' && method === 'GET') {
      return json({ demo: config.demoMode, configured, signedIn, privateMode: config.privateMode,
        syncPreferences: Boolean(config.firebaseProjectId), name: viewer?.name, viewerId: viewer?.id });
    }
    if (!signedIn) {
      return path.startsWith('/oauth/') ? redirect('/') : json({ error: 'Sign in with your email first.' }, 401);
    }
    if (path === '/api/watchlist' && method === 'GET') {
      return viewer ? json(await watchlist(viewer, token)) : json({ error: 'Connect AniList first.' }, 401);
    }
    if (path === '/api/recommendations' && method === 'GET') {
      return viewer ? json(await recommendations(viewer, token)) : json({ error: 'Connect AniList first.' }, 401);
    }
    if (path === '/api/recommendation-preferences' && (method === 'GET' || method === 'POST')) {
      if (!config.firebaseProjectId) return json({ error: 'Recommendation sync is unavailable.' }, 404);
      if (!viewer) return json({ error: 'Connect AniList first.' }, 401);
      const input = method === 'POST' ? await request.json().catch(() => null) : undefined;
      if (method === 'POST' && !validPreferenceChange(input)) {
        return json({ error: 'Invalid recommendation preference.' }, 400);
      }
      const identity = owner?.refreshToken ? await refreshOwnerToken(config, owner) : null;
      if (!identity) return json({ error: 'Sign out and sign in again to sync recommendation preferences.' }, 401);
      const remaining = Math.floor((owner.expires - Date.now()) / 1000);
      const cookie = identity.refreshToken !== owner.refreshToken && remaining > 0
        ? jar.set(ownerCookie, { ...owner, refreshToken: identity.refreshToken }, remaining) : undefined;
      try {
        return json(await preferences(config.firebaseProjectId, owner.uid, viewer.id, identity.idToken, input), 200, cookie);
      } catch (error) {
        return json({ error: error instanceof Error ? error.message : 'Could not sync recommendation preferences.' }, 502, cookie);
      }
    }
    if (path === '/api/schedule' && method === 'GET') {
      return viewer ? json(await airingSchedule(token)) : json({ error: 'Connect AniList first.' }, 401);
    }
    if (path === '/api/search' && method === 'GET') {
      const search = url.searchParams.get('q')?.trim() ?? '';
      if (search.length < 2 || search.length > 120) return json({ error: 'Enter 2 to 120 characters.' }, 400);
      const { Page } = await graph(`query Search($search: String!) {
        Page(perPage: 10) { media(search: $search, type: ANIME, sort: SEARCH_MATCH) { ${fields} } }
      }`, { search }, config.demoMode ? token : undefined);
      return json(Page.media);
    }
    if (path === '/api/entry') {
      if (!viewer) return json({ error: 'Connect AniList first.' }, 401);
      const input = method === 'POST' ? await request.json().catch(() => null) : { id: Number(url.searchParams.get('id')) };
      if (!Number.isInteger(input?.id) || input.id < 1 || input.id > 2147483647) return json({ error: 'Invalid anime ID.' }, 400);
      if (method === 'POST') return await save(input, viewer, token);
      const media = await mediaDetails(input.id, token);
      return media ? json(media) : json({ error: 'Anime not found.' }, 404);
    }
    if (path === '/api/media' && method === 'GET') {
      const id = Number(url.searchParams.get('id'));
      if (!Number.isInteger(id) || id < 1 || id > 2147483647) return json({ error: 'Invalid anime ID.' }, 400);
      const { Media } = await graph(`query MediaPreview($id: Int!) {
        Media(id: $id, type: ANIME) {
          coverImage { extraLarge }
          genres
          averageScore
          description(asHtml: true)
        }
      }`, { id }, token);
      return Media ? json(Media) : json({ error: 'Anime not found.' }, 404);
    }
    if (path === '/oauth/start' && method === 'POST' && configured && !config.demoMode) {
      const state = randomBytes(32).toString('hex');
      const params = new URLSearchParams({ client_id: config.id, redirect_uri: callback, response_type: 'code', state });
      return redirect('https://anilist.co/api/v2/oauth/authorize?' + params, jar.set(stateCookie, { state, uid: owner?.uid }, 600));
    }
    if (path === '/oauth/callback' && method === 'GET' && configured && !config.demoMode) {
      const pending = jar.read(stateCookie);
      if (!pending?.state || pending.uid !== owner?.uid || pending.state !== url.searchParams.get('state')) {
        return redirect('/?auth=failed');
      }
      const code = url.searchParams.get('code');
      if (!code) return redirect('/?auth=cancelled', jar.clear(stateCookie));
      try {
        const response = await fetch('https://anilist.co/api/v2/oauth/token', {
          method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ grant_type: 'authorization_code', client_id: config.id,
            client_secret: config.secret, redirect_uri: callback, code }),
          cache: 'no-store', signal: AbortSignal.timeout(10000),
        });
        const auth = await response.json();
        if (!response.ok || !auth.access_token) return redirect('/?auth=failed', jar.clear(stateCookie));
        const { Viewer } = await graph('query Viewer { Viewer { id name } }', {}, auth.access_token);
        return redirect('/', jar.set(aniCookie, { viewer: Viewer, token: auth.access_token, uid: owner?.uid }, 604800), jar.clear(stateCookie));
      } catch { return redirect('/?auth=failed', jar.clear(stateCookie)); }
    }
    if (path === '/oauth/disconnect' && method === 'POST') {
      return redirect('/', jar.clear(aniCookie), jar.clear(stateCookie));
    }
    return json({ error: 'Page not found.' }, 404);
  } catch (error) { return json({ error: error instanceof Error ? error.message : 'Unexpected server error.' }, 502); }
}
