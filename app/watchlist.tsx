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
type Session = { demo: boolean; configured: boolean; signedIn: boolean; privateMode: boolean; name?: string };
const groups: { label: string; values: Status[] }[] = [
  { label: 'Watching', values: ['CURRENT', 'REPEATING'] }, { label: 'Plan to Watch', values: ['PLANNING'] },
  { label: 'Completed', values: ['COMPLETED'] }, { label: 'On Hold', values: ['PAUSED'] },
  { label: 'Dropped', values: ['DROPPED'] },
];

function displayStatus(entry: Entry): Status {
  return isFullyWatched(entry.media, entry.progress) ? 'COMPLETED' : entry.status;
}

const displayName = (media: Media) => media.title.english ?? media.title.romaji ?? media.title.native ?? 'Untitled';

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
  const [sendingEmail, setSendingEmail] = useState(false);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('All');
  const [notice, setNotice] = useState('');
  const [editError, setEditError] = useState('');
  const [error, setError] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [matches, setMatches] = useState<Media[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<Details | null>(null);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState<number | null>(null);
  const [draft, setDraft] = useState('0');
  const [status, setStatus] = useState<Status | ''>('');
  const dialog = useRef<HTMLDialogElement>(null);

  async function loadList() {
    setLoading(true);
    setError('');
    try { setEntries(await api<Entry[]>('/api/watchlist')); }
    catch (failure) { setError(errorText(failure)); }
    finally { setLoading(false); }
  }

  useEffect(() => {
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

  async function requestEmail(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const email = new FormData(event.currentTarget).get('email');
    setSendingEmail(true);
    setNotice('');
    try {
      await api('/oauth/email/start', { email });
      setNotice('If this email can access the tracker, a sign-in link will arrive shortly.');
    } catch (failure) { setNotice(errorText(failure)); }
    finally { setSendingEmail(false); }
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

  return <>
    <header className={styles.header}><div className={styles.wrap}>
      <a href="/" className={styles.brand}><span className={styles.brandMark} aria-hidden="true" /> Anime Tracker</a>
      <div className={styles.account}>
        <ThemeToggle />
        {session?.name && <span>{session.name}</span>}
        {session?.privateMode && session.signedIn && <form method="post" action="/oauth/sign-out"><button className={styles.secondary}>Sign out</button></form>}
        {session?.signedIn && !session.demo && (session.name
          ? <form method="post" action="/oauth/disconnect"><button className={styles.secondary}>Disconnect</button></form>
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
      {searchOpen && <section className={styles.search} aria-label="Add anime">
        <form onSubmit={search}><label htmlFor="title">Anime title</label><div className={styles.row}>
          <input id="title" name="title" type="search" minLength={2} maxLength={120} required placeholder="Search AniList" />
          <button className={styles.primary} disabled={searching}>{searching ? 'Searching…' : 'Search'}</button>
        </div></form>
        {matches?.length === 0 && <p className={styles.muted}>No matching titles found.</p>}
        {matches?.map(media => <button key={media.id} className={styles.result} onClick={() => void openEntry(media)} disabled={editing}>
          <Cover media={media} /><span><strong>{displayName(media)}</strong>
            <small>{[media.seasonYear, media.format, media.episodes && media.episodes + ' episodes'].filter(Boolean).join(' · ')}</small>
          </span></button>)}
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
          <form onSubmit={requestEmail} className={styles.edit}>
            <label>Email address<input name="email" type="email" autoComplete="email" required maxLength={254} /></label>
            <button className={styles.primary} disabled={sendingEmail}>{sendingEmail ? 'Sending…' : 'Send sign-in link'}</button>
          </form>
        </div>
        : !session?.name ? <div className={styles.empty}><h2>Connect your AniList account</h2>
          <p>{session?.configured ? 'Sign in to see your saved titles and episode progress.' : 'Set your AniList client credentials to enable sign-in.'}</p></div>
        : <div className={styles.layout}>
          <nav aria-label="Watchlist status" className={styles.filters}>
            <button aria-pressed={filter === 'All'} onClick={() => setFilter('All')}>
              All titles <span className={styles.count}>{entries.length}</span>
            </button>
            {groups.map(group => <button key={group.label} aria-pressed={filter === group.label}
              onClick={() => setFilter(group.label)}>{group.label}
              <span className={styles.count}>{entries.filter(entry => group.values.includes(displayStatus(entry))).length}</span>
            </button>)}
            <button className={styles.refresh} onClick={() => void loadList()} disabled={saving !== null}>Refresh</button>
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
                  <Cover media={media} />
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
