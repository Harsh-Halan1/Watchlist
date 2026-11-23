const now = Math.floor(Date.now() / 1000);
const catalog = [
  [999001, 'Overgeared', 12, 10, 'CURRENT', 8],
  [999002, 'Josee, the Tiger and the Fish', 1, null, 'COMPLETED', 1],
  [999003, 'Golden Time', 24, null, 'PAUSED', 13],
  [999004, 'Blue Box', 25, null, 'PLANNING', 0],
  [999005, 'Missing schedule', null, null, 'CURRENT', 3],
  [999006, 'Dan Da Dan', 12, null, 'DROPPED', 7],
  [999007, 'Blue Box Season 2', 12, 8, null, 0],
].map(([id, name, episodes, next, status, progress]) => ({
  media: { id, title: { english: name, romaji: name }, episodes, format: episodes === 1 ? 'MOVIE' : 'TV',
    status: next || !episodes ? 'RELEASING' : 'FINISHED',
    nextAiringEpisode: next ? { episode: next, airingAt: now + 3600 } : null },
  entry: status ? { status, progress, private: true, updatedAt: now } : null,
}));
export function demo(query, { search, id, progress, status }) {
  if (query.startsWith('query Search')) {
    return { Page: { media: catalog.map(item => item.media)
      .filter(item => item.title.english.toLowerCase().includes(search.toLowerCase())) } };
  }
  if (query.startsWith('query Watchlist')) {
    return { MediaListCollection: { hasNextChunk: false, lists: [{ entries: catalog.filter(item => item.entry)
      .map(item => ({ ...item.entry, media: item.media })) }] } };
  }
  const item = catalog.find(item => item.media.id === id);
  if (query.startsWith('mutation Save')) {
    item.entry = { progress, status, private: true, updatedAt: Math.floor(Date.now() / 1000) };
    return { SaveMediaListEntry: item.entry };
  }
  return { Media: item ? { ...item.media, mediaListEntry: item.entry } : null };
}
