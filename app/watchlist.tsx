'use client';

import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { airing, isFullyWatched, progressLimit } from '../lib/watch.mjs';
import styles from './watchlist.module.css';

type Status = 'CURRENT' | 'PLANNING' | 'COMPLETED' | 'PAUSED' | 'DROPPED' | 'REPEATING';
type Media = {
  id: number; title: { english?: string; romaji?: string; native?: string };
  episodes: number | null; status: string; format?: string; seasonYear?: number;
  coverImage?: { large?: string }; nextAiringEpisode?: { episode: number; airingAt: number } | null;
};
type Progress = { progress: number; status: Status; updatedAt: number };
type Entry = Progress & { media: Media };
type Details = Media & { mediaListEntry?: Progress | null };
type MediaPreview = {
  coverImage?: { extraLarge?: string | null } | null;
  genres?: string[] | null;
  averageScore?: number | null;
  description?: string | null;
};
type AiringFilter = 'all' | 'RELEASING' | 'FINISHED';
const airingFilters: { value: AiringFilter; label: string; icon: keyof typeof icons }[] = [
  { value: 'all', label: 'Any status', icon: 'status' },
  { value: 'RELEASING', label: 'Airing now', icon: 'watching' },
  { value: 'FINISHED', label: 'Finished airing', icon: 'completed' },
];
type Fanservice = 'unknown' | 'flagged' | 'low';
type Recommendation = { media: Media; because: Media['title']; fanservice: Fanservice };
type RecommendationResult = { hasSeeds: boolean; items: Recommendation[] };
const fanserviceLabels: Record<Fanservice, string> = {
  unknown: 'Fanservice unknown', flagged: 'AniList flags sexual content', low: 'Low fanservice',
};
type Session = { demo: boolean; configured: boolean; signedIn: boolean; privateMode: boolean; name?: string };
const icons = {
  all: 'M4 6h16M4 12h16M4 18h16',
  status: 'M4 7h16M7 12h10m-7 5h4',
  sparkle: 'M12 3l2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3Z',
  shield: 'M12 3l7 3v5c0 4-3 7-7 10-4-3-7-6-7-10V6l7-3Zm-3 9 2 2 4-4',
  add: 'M12 5v14M5 12h14',
  watching: 'm8 5 12 7-12 7V5Z',
  planning: 'M6 4h12v17l-6-4-6 4V4Z',
  completed: 'm5 12 4 4L19 6',
  paused: 'M9 5v14M15 5v14',
  dropped: 'm6 6 12 12M18 6 6 18',
  refresh: 'M20 4v6h-6M20 10a8 8 0 1 0-.4 5',
  signOut: 'M10 4H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h5M10 12h10m-4-4 4 4-4 4',
  disconnect: 'm15 10 3-3a2.8 2.8 0 0 0-4-4l-3 3m-2 8-3 3a2.8 2.8 0 0 0 4 4l3-3M3 3l18 18',
};
const groups: { label: string; values: Status[]; icon: keyof typeof icons }[] = [
  { label: 'Watching', values: ['CURRENT', 'REPEATING'], icon: 'watching' },
  { label: 'Plan to Watch', values: ['PLANNING'], icon: 'planning' },
  { label: 'Completed', values: ['COMPLETED'], icon: 'completed' },
  { label: 'On Hold', values: ['PAUSED'], icon: 'paused' },
  { label: 'Dropped', values: ['DROPPED'], icon: 'dropped' },
];

function Icon({ name }: { name: keyof typeof icons }) {
  return <svg className={styles.icon} viewBox="0 0 24 24" aria-hidden="true" focusable="false"
    fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d={icons[name]} />
  </svg>;
}

function ControlLabel({ icon, children }: { icon: keyof typeof icons; children: string }) {
  return <><Icon name={icon} /><span className={styles.compactLabel}>{children}</span></>;
}

function displayStatus(entry: Entry): Status {
  return isFullyWatched(entry.media, entry.progress) ? 'COMPLETED' : entry.status;
}

const titleName = (title: Media['title']) => title.english ?? title.romaji ?? title.native ?? 'Untitled';
const displayName = (media: Media) => titleName(media.title);
const episodeCount = (media: Media) => media.episodes != null && media.episodes > 0
  ? media.episodes + (media.episodes === 1 ? ' episode' : ' episodes')
  : 'Episode count unknown';

async function api<T>(path: string, input?: object): Promise<T> {
  const response = await fetch(path, input ? { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input) } : { cache: 'no-store' });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? 'The request failed.');
  return data as T;
}
const errorText = (error: unknown) => error instanceof Error ? error.message : 'Something went wrong.';

function Cover({ media }: { media: Media }) {
  const cover = media.coverImage?.large;
  return cover ? <img className={styles.cover} src={cover} alt="" loading="lazy" />
    : <span className={styles.cover} aria-hidden="true">{displayName(media).slice(0, 1)}</span>;
}

function PosterButton({ media, onPreview }: { media: Media; onPreview: (media: Media) => void }) {
  return <button type="button" className={styles.posterButton} aria-haspopup="dialog"
    aria-label={'Preview ' + displayName(media)} onClick={() => onPreview(media)}>
    <Cover media={media} />
  </button>;
}

function descriptionText(html: string) {
  const template = document.createElement('template');
  template.innerHTML = html.replace(/<br\s*\/?>|<\/p>/gi, '\n');
  return (template.content.textContent ?? '').trim().replace(/\n\s*\n/g, '\n\n');
}

function PosterPreview({ media, onClose }: { media: Media; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [details, setDetails] = useState<MediaPreview | null>(null);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!dialog.current?.open) dialog.current?.showModal();
    let active = true;
    api<MediaPreview>('/api/media?id=' + media.id).then(result => {
      if (active) setDetails({ ...result, description: descriptionText(result.description ?? '') });
    }).catch(failure => {
      if (active) setError(errorText(failure));
    });
    return () => { active = false; };
  }, [media]);

  const synopsis = details?.description ?? '';
  const isLong = synopsis.length > 320;
  const preview = isLong ? synopsis.slice(0, 320).replace(/\s+\S*$/, '') + '…' : synopsis;
  const poster = details?.coverImage?.extraLarge ?? media.coverImage?.large;
  return <dialog ref={dialog} className={`${styles.dialog} ${styles.previewDialog}`}
    aria-labelledby="poster-preview-title" onClose={onClose}>
      <div className={styles.dialogHeading}>
        <h2 id="poster-preview-title">{displayName(media)}</h2>
        <button type="button" className={styles.secondary} aria-label="Close preview" autoFocus
          onClick={() => dialog.current?.close()}>Close</button>
      </div>
      <div className={styles.previewLayout}>
        {poster && <img className={styles.enlargedPoster} src={poster} alt={'Poster for ' + displayName(media)} />}
        <div className={styles.previewInfo}>
          {error ? <p role="alert">{error}</p> : !details ? <p role="status">Loading anime details…</p> : <>
            {details.averageScore != null && <p><strong>AniList score</strong> {details.averageScore}/100</p>}
            {!!details.genres?.length && <p><strong>Genres</strong> {details.genres.join(', ')}</p>}
            <h3>Synopsis</h3>
            <p id="poster-synopsis" className={styles.synopsis}>{(expanded ? synopsis : preview) || 'No synopsis on AniList yet.'}</p>
            {isLong && <button type="button" className={styles.secondary} aria-expanded={expanded}
              aria-controls="poster-synopsis" onClick={() => setExpanded(value => !value)}>
              {expanded ? 'Read less' : 'Read more'}
            </button>}
          </>}
        </div>
      </div>
  </dialog>;
}

function ThemeToggle() {
  const [dark, setDark] = useState(false);
  useEffect(() => { setDark(document.documentElement.dataset.theme === 'dark'); }, []);

  function toggleTheme() {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.themeMotion = 'on';
    document.documentElement.dataset.theme = next;
    setDark(next === 'dark');
    try { localStorage.setItem('watchlist-theme', next); } catch {}
  }

  const label = dark ? 'Switch to light mode' : 'Switch to dark mode';
  return (
    <button type="button" className={styles.themeToggle} aria-label={label} title={label} onClick={toggleTheme}>
      <span key={label} aria-hidden="true">{dark ? '\u2600\uFE0E' : '\u263D\uFE0E'}</span>
    </button>
  );
}

export default function Watchlist() {
  const [session, setSession] = useState<Session | null>(null);
  const [emailConfirmation, setEmailConfirmation] = useState(false);
  const [useEmailLink, setUseEmailLink] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('All');
  const [view, setView] = useState<'watchlist' | 'recommendations'>('watchlist');
  const [recommendations, setRecommendations] = useState<RecommendationResult | null>(null);
  const [recommendationError, setRecommendationError] = useState('');
  const [loadingRecommendations, setLoadingRecommendations] = useState(false);
  const [airingFilter, setAiringFilter] = useState<AiringFilter>('all');
  const [lowOnly, setLowOnly] = useState(false);
  const [lowTitles, setLowTitles] = useState<number[]>([]);
  const [notice, setNotice] = useState('');
  const [editError, setEditError] = useState('');
  const [error, setError] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [matches, setMatches] = useState<Media[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<Details | null>(null);
  const [preview, setPreview] = useState<Media | null>(null);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState<number | null>(null);
  const [draft, setDraft] = useState('0');
  const [status, setStatus] = useState<Status | ''>('');
  const dialog = useRef<HTMLDialogElement>(null);

  async function loadList() {
    setLoading(true);
    setError('');
    try {
      setEntries(await api<Entry[]>('/api/watchlist'));
      setRecommendations(null);
    }
    catch (failure) { setError(errorText(failure)); }
    finally { setLoading(false); }
  }

  async function loadRecommendations() {
    setLoadingRecommendations(true);
    setRecommendationError('');
    try { setRecommendations(await api<RecommendationResult>('/api/recommendations')); }
    catch (failure) { setRecommendationError(errorText(failure)); }
    finally { setLoadingRecommendations(false); }
  }

  function toggleLow(id: number) {
    const next = lowTitles.includes(id) ? lowTitles.filter(title => title !== id) : [...lowTitles, id];
    setLowTitles(next);
    try { localStorage.setItem('watchlist-low-fanservice', JSON.stringify(next)); } catch {}
  }

  useEffect(() => {
    try {
      const saved: unknown = JSON.parse(localStorage.getItem('watchlist-low-fanservice') ?? '[]');
      if (Array.isArray(saved)) setLowTitles(saved.filter(Number.isInteger));
    } catch {}
    const params = new URLSearchParams(window.location.search);
    const auth = params.get('auth');
    setEmailConfirmation(params.get('email') === 'confirm');
    if (params.get('email') === 'failed') setNotice('This link could not be used. Request a new sign-in link.');
    if (auth) {
      setNotice(auth === 'cancelled' ? 'AniList authorization was cancelled.' : 'Could not connect to AniList. Check the callback URL and try again.');
    }
    if (auth || params.get('email') === 'failed') window.history.replaceState(null, '', '/');
    api<Session>('/api/session').then(account => {
      setSession(account);
      if (account.name) void loadList(); else setLoading(false);
    }).catch(failure => { setError(errorText(failure)); setLoading(false); });
  }, []);

  useEffect(() => {
    if (selected && !dialog.current?.open) dialog.current?.showModal();
    if (!selected && dialog.current?.open) dialog.current.close();
  }, [selected]);

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    const email = fields.get('email');
    setSigningIn(true);
    setNotice('');
    try {
      if (useEmailLink) {
        await api('/oauth/email/start', { email });
        setNotice('If this email can access the tracker, a sign-in link will arrive shortly.');
      } else {
        await api('/oauth/password', { email, password: fields.get('password') });
        window.location.assign('/');
      }
    } catch (failure) { setNotice(errorText(failure)); }
    finally { setSigningIn(false); }
  }

  async function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const term = String(new FormData(event.currentTarget).get('title')).trim();
    setSearching(true);
    setMatches(null);
    setNotice('');
    try { setMatches(await api<Media[]>('/api/search?q=' + encodeURIComponent(term))); }
    catch (failure) { setNotice(errorText(failure)); }
    finally { setSearching(false); }
  }

  async function openEntry(media: Media) {
    setEditing(true);
    setEditError('');
    setNotice('');
    try {
      const item: Details = session?.name ? await api<Details>('/api/entry?id=' + media.id) : media;
      setDraft(String(item.mediaListEntry?.progress ?? 0));
      setStatus(item.mediaListEntry?.status ?? '');
      setSelected(item);
    } catch (failure) { setNotice(errorText(failure)); }
    finally { setEditing(false); }
  }

  async function save(id: number, input: { action: 'save' | 'increment' } & Record<string, unknown>) {
    setSaving(id);
    setNotice('');
    setEditError('');
    try {
      const entry = await api<Entry>('/api/entry', { id, ...input });
      setEntries(previous => [entry, ...previous.filter(item => item.media.id !== entry.media.id)]);
      setSelected(null);
      setNotice(entry.status === 'COMPLETED' && isFullyWatched(entry.media, entry.progress)
        ? displayName(entry.media) + ' is in Completed.'
        : 'Saved ' + displayName(entry.media) + (session?.demo ? ' in this demo.' : ' to AniList.'));
    } catch (failure) {
      if (input.action === 'save') setEditError(errorText(failure));
      else setNotice(errorText(failure));
    } finally { setSaving(null); }
  }

  function editProgress(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    const entry = selected.mediaListEntry;
    void save(selected.id, { action: 'save', progress: Number(draft),
      expectedProgress: entry?.progress ?? null, expectedStatus: entry?.status ?? null,
      ...(status && status !== entry?.status ? { status } : {}) });
  }

  const selectedLimit = selected ? progressLimit(selected) : null;
  const selectedProgress = selected?.mediaListEntry?.progress ?? 0;
  const selectedMaximum = Math.max(selectedProgress, selectedLimit ?? 0);
  const tracked = new Set(entries.map(entry => entry.media.id));
  const visibleRecommendations = recommendations?.items.filter(({ media, fanservice }) =>
    !tracked.has(media.id) && (airingFilter === 'all' || media.status === airingFilter) &&
    (!lowOnly || fanservice !== 'flagged' && lowTitles.includes(media.id))) ?? [];

  return <>
    <header className={styles.header}><div className={styles.wrap}>
      <a href="/" className={styles.brand}><span className={styles.brandMark} aria-hidden="true" /> Anime Tracker</a>
      <div className={styles.account}>
        <ThemeToggle />
        {session?.name && <span className={styles.accountName}>{session.name}</span>}
        {session?.privateMode && session.signedIn && <form method="post" action="/oauth/sign-out">
          <button className={`${styles.secondary} ${styles.accountAction}`} title="Sign out of Anime Tracker" aria-label="Sign out of Anime Tracker">
            <Icon name="signOut" /><span className={styles.compactLabel}>Sign out</span>
          </button>
        </form>}
        {session?.signedIn && !session.demo && (session.name
          ? <form method="post" action="/oauth/disconnect">
            <button className={`${styles.secondary} ${styles.accountAction}`} title="Disconnect AniList" aria-label="Disconnect AniList">
              <Icon name="disconnect" /><span className={styles.compactLabel}>Disconnect</span>
            </button>
          </form>
          : session.configured && <form method="post" action="/oauth/start"><button className={styles.primary}>Connect AniList</button></form>)}
      </div>
    </div></header>
    <main className={styles.wrap}>
      <div className={styles.heading}><div><h1>My Watchlist</h1>
        {session?.demo && <p>Demo data resets when the server restarts.</p>}</div>
        {session?.signedIn && <button className={styles.primary} aria-expanded={searchOpen} onClick={() => setSearchOpen(value => !value)}>
          {searchOpen ? 'Close search' : '+ Add anime'}
        </button>}
      </div>
      {session?.name && <nav className={styles.views} aria-label="Anime Tracker views">
        <button className={styles.secondary} title="Watchlist" aria-pressed={view === 'watchlist'}
          onClick={() => setView('watchlist')}><ControlLabel icon="all">Watchlist</ControlLabel></button>
        <button className={styles.secondary} title="For You" aria-pressed={view === 'recommendations'} onClick={() => {
          setView('recommendations');
          if (!recommendations && !loadingRecommendations) void loadRecommendations();
        }}><ControlLabel icon="sparkle">For You</ControlLabel></button>
      </nav>}
      {searchOpen && <section className={styles.search} aria-label="Add anime">
        <form onSubmit={search}><label htmlFor="title">Anime title</label><div className={styles.row}>
          <input id="title" name="title" type="search" minLength={2} maxLength={120} required placeholder="Search AniList" />
          <button className={styles.primary} disabled={searching}>{searching ? 'Searching…' : 'Search'}</button>
        </div></form>
        {matches?.length === 0 && <p className={styles.muted}>No matching titles found.</p>}
        {matches?.map(media => <div key={media.id} className={styles.result}>
          <PosterButton media={media} onPreview={setPreview} />
          <button type="button" className={styles.resultTitle} onClick={() => void openEntry(media)} disabled={editing}>
            <strong>{displayName(media)}</strong>
            <small>{[media.seasonYear, media.format, episodeCount(media)].filter(Boolean).join(' · ')}</small>
          </button>
        </div>)}
      </section>}
      <p className={styles.notice} role="status">{notice}</p>
      {loading ? <p className={styles.muted} role="status">Loading your watchlist…</p> : error
        ? <div className={styles.empty}><p role="alert">{error}</p><button className={styles.secondary} onClick={() => session ? void loadList() : window.location.reload()}>Try again</button></div>
        : emailConfirmation && session?.privateMode ? <div className={styles.empty}>
          <h2>Confirm your sign-in</h2>
          <form method="post" action="/oauth/email/confirm"><button className={styles.primary}>Continue</button></form>
        </div>
        : session?.privateMode && !session.signedIn ? <div className={styles.empty}>
          <h2>Sign in to Anime Tracker</h2>
          <form method="post" onSubmit={signIn} className={styles.edit}>
            <label>Email address<input name="email" type="email" autoComplete="username" required maxLength={254} /></label>
            {!useEmailLink && <label>Password<input name="password" type="password"
              autoComplete="current-password" required maxLength={4096} /></label>}
            <button className={styles.primary} disabled={signingIn}>
              {useEmailLink ? (signingIn ? 'Sending…' : 'Send sign-in link') : (signingIn ? 'Signing in…' : 'Sign in')}
            </button>
            <button type="button" className={styles.secondary} disabled={signingIn}
              onClick={() => { setUseEmailLink(value => !value); setNotice(''); }}>
              {useEmailLink ? 'Use password instead' : 'Use an email link instead'}
            </button>
          </form>
        </div>
        : !session?.name ? <div className={styles.empty}><h2>Connect your AniList account</h2>
          <p>{session?.configured ? 'Sign in to see your saved titles and episode progress.' : 'Set your AniList client credentials to enable sign-in.'}</p></div>
        : view === 'recommendations' ? <section className={styles.section} aria-labelledby="for-you-title">
          <h2 id="for-you-title">For You</h2>
          <div className={styles.recommendationFilters}>
            <div className={styles.airingFilters} role="group" aria-label="Airing status">
              {airingFilters.map(({ value, label, icon }) => <button key={value} type="button" className={styles.filterChip}
                title={label} aria-pressed={airingFilter === value} onClick={() => setAiringFilter(value)}>
                <ControlLabel icon={icon}>{label}</ControlLabel>
              </button>)}
            </div>
            <button type="button" className={styles.filterChip} title="Low fanservice" aria-pressed={lowOnly}
              onClick={() => setLowOnly(value => !value)}><ControlLabel icon="shield">Low fanservice</ControlLabel></button>
            <button className={styles.secondary} title="Refresh picks" disabled={loadingRecommendations}
              onClick={() => void loadRecommendations()}><ControlLabel icon="refresh">Refresh picks</ControlLabel></button>
          </div>
          {loadingRecommendations ? <p role="status">Finding recommendations…</p>
            : recommendationError ? <p role="alert">{recommendationError}</p>
            : !recommendations?.hasSeeds ? <p>Log an episode or finish a show you enjoyed to get your first picks.</p>
            : !visibleRecommendations.length ? <p>{airingFilter !== 'all' || lowOnly
              ? 'No picks match these filters.' : 'No new picks yet. Try again after updating your watchlist.'}</p>
            : <ul className={styles.cards}>{visibleRecommendations.map(({ media, because, fanservice }) => {
              const markedLow = lowTitles.includes(media.id);
              return <li className={`${styles.card} ${styles.recommendationCard}`} key={media.id}>
                <PosterButton media={media} onPreview={setPreview} />
                <div className={styles.cardInfo}>
                  <h3>{displayName(media)}</h3>
                  <p>{episodeCount(media)} · {media.status === 'RELEASING' ? 'Airing now' : 'Finished airing'}</p>
                  <p>Recommended for fans of <strong className={styles.sourceTitle}>{titleName(because)}</strong>.</p>
                  <div className={styles.fanserviceRow}>
                    <p>{fanserviceLabels[markedLow && fanservice !== 'flagged' ? 'low' : fanservice]}</p>
                    {fanservice !== 'flagged' && <button className={styles.markLow} aria-pressed={markedLow}
                      title="Mark as low fanservice" onClick={() => toggleLow(media.id)}>
                      <ControlLabel icon="shield">Mark as low fanservice</ControlLabel>
                    </button>}
                  </div>
                </div>
                <div className={styles.actions}><button className={styles.secondary} title="Add to list"
                  aria-label={'Add ' + displayName(media)} disabled={editing || saving !== null}
                  onClick={() => void openEntry(media)}><ControlLabel icon="add">Add to list</ControlLabel></button></div>
              </li>;
            })}</ul>}
        </section>
        : <div className={styles.layout}>
          <nav aria-label="Watchlist status" className={styles.filters}>
            <button aria-pressed={filter === 'All'} onClick={() => setFilter('All')}>
              <Icon name="all" /><span className={styles.compactLabel}>All titles</span>
              <span className={styles.count}>{entries.length}</span>
            </button>
            {groups.map(group => <button key={group.label} aria-pressed={filter === group.label}
              onClick={() => setFilter(group.label)}>
              <Icon name={group.icon} /><span className={styles.compactLabel}>{group.label}</span>
              <span className={styles.count}>{entries.filter(entry => group.values.includes(displayStatus(entry))).length}</span>
            </button>)}
            <button className={styles.refresh} onClick={() => void loadList()} disabled={saving !== null}>
              <Icon name="refresh" /><span className={styles.compactLabel}>Refresh</span>
            </button>
          </nav>
          <div key={filter} className={styles.list}>
          {groups.filter(group => filter === 'All' || filter === group.label).map(group => {
            const visible = entries.filter(entry => group.values.includes(displayStatus(entry)));
            if (!visible.length && filter === 'All') return null;
            return <section className={styles.section} key={group.label}>
              <h2>{group.label === 'Watching' ? 'Continue Watching' : group.label}</h2>
              {visible.length === 0 && <p className={styles.muted}>No titles here yet.</p>}
              <ul className={styles.cards}>{visible.map(entry => {
                const { media, progress } = entry;
                const now = Date.now();
                const release = airing(media, progress, now);
                const limit = progressLimit(media, now);
                const next = media.nextAiringEpisode;
                const counts = [progress + ' watched', limit !== null && limit + ' aired', media.episodes && media.episodes + ' total'];
                return <li key={media.id} className={styles.card}>
                  <PosterButton media={media} onPreview={setPreview} />
                  <div className={styles.cardInfo}><h3>{displayName(media)}</h3>
                    <p>{media.format === 'MOVIE' && media.episodes === 1 ? (progress ? 'Watched' : 'Ready to watch')
                      : media.status === 'RELEASING' ? counts.filter(Boolean).join(' · ')
                      : progress + (media.episodes ? ' / ' + media.episodes : '') + ' episodes watched'}</p>
                    {media.episodes !== null && media.episodes > 1 && group.label === 'Watching' &&
                      <progress className={styles.progress} value={progress} max={media.episodes}
                        aria-label={'Series progress for ' + displayName(media)} />}
                    {release && !(media.format === 'MOVIE' && release === 'All episodes watched') &&
                      <p className={styles.release}>{release}</p>}
                    {media.status === 'RELEASING' && next && next.airingAt * 1000 > now &&
                      <p className={styles.schedule}>Episode {next.episode} airs <time dateTime={new Date(next.airingAt * 1000).toISOString()}>
                        {new Date(next.airingAt * 1000).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}
                      </time></p>}
                  </div>
                  <div className={styles.actions}>
                      {group.label === 'Watching' && <button className={styles.primary}
                        aria-label={'+1 episode for ' + displayName(media)} disabled={saving !== null || limit === null || progress >= limit}
                        onClick={() => void save(media.id, { action: 'increment' })}>+1</button>}
                      <button className={styles.secondary} aria-label={'Edit ' + displayName(media)}
                        disabled={editing || saving !== null} onClick={() => void openEntry(media)}>Edit</button>
                  </div>
                </li>;
              })}</ul>
            </section>;
          })}
          {entries.length === 0 && filter === 'All' && <div className={styles.empty}><p>Your watchlist is empty.</p>
            <button className={styles.secondary} onClick={() => setSearchOpen(true)}>Add your first anime</button></div>}
          </div>
        </div>}
    </main>
    {preview && <PosterPreview key={preview.id} media={preview} onClose={() => setPreview(null)} />}
    <dialog ref={dialog} className={styles.dialog} aria-labelledby="entry-title" onClose={() => setSelected(null)}
      onCancel={event => { if (saving !== null) event.preventDefault(); }}>
      {selected && <><div className={styles.dialogHeading}><h2 id="entry-title">{displayName(selected)}</h2>
        <button aria-label="Close details" className={styles.secondary} disabled={saving !== null} onClick={() => setSelected(null)}>×</button></div>
        {selected.nextAiringEpisode && selected.nextAiringEpisode.airingAt * 1000 > Date.now() &&
          <p className={styles.muted}>Episode {selected.nextAiringEpisode.episode} scheduled for {new Date(selected.nextAiringEpisode.airingAt * 1000).toLocaleString()}</p>}
        {session?.name ? <form onSubmit={editProgress} className={styles.edit}>
          <label>Episodes watched<input type="number" min={0} max={selectedMaximum}
            aria-describedby={selected.status !== 'FINISHED' ? 'progress-limit' : undefined}
            value={draft} onChange={event => { setDraft(event.target.value); setEditError(''); }} required /></label>
          {selected.status !== 'FINISHED' && <p id="progress-limit" className={styles.muted}>
            {selectedLimit === null ? 'Airing schedule unavailable. You can keep or lower your saved count.'
              : selectedLimit === 0 ? 'No episodes have aired yet.' : 'Episodes aired: ' + selectedLimit}
          </p>}
          <label>Watch status<select value={status} onChange={event => setStatus(event.target.value as Status | '')}>
            <option value="">Automatic</option>
            {groups.map(group => <option key={group.label} value={group.values[0]}>{group.label}</option>)}
            {selected.mediaListEntry?.status === 'REPEATING' && <option value="REPEATING">Rewatching</option>}
          </select></label>
          <button className={styles.primary} disabled={saving !== null}>{saving !== null ? 'Saving…' : 'Save to watchlist'}</button>
          {editError && <p role="alert" className={styles.editError}>{editError}</p>}
        </form> : <p className={styles.muted}>Connect AniList to log your progress.</p>}
      </>}
    </dialog>
  </>;
}
