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
  entry: status ? { status, progress, score: 0, private: true, updatedAt: now } : null,
}));
export function demo(query, { search, id, ids, progress, status, score, start, end }) {
  if (query.startsWith('query Schedule')) {
    const airingSchedules = catalog.flatMap(({ media }) => {
      const next = media.nextAiringEpisode;
      if (!next || next.airingAt <= start || next.airingAt >= end) return [];
      return [{ id: media.id, ...next, media: { ...media, isAdult: false } }];
    });
    return { Page: { pageInfo: { hasNextPage: false }, airingSchedules } };
  }
  if (query.startsWith('query ForYou')) {
    const sample = catalog.find(item => item.media.id === 999007);
    return { Page: { media: ids.map(seed => ({
      id: seed,
      recommendations: { nodes: seed === 999001 ? [
        { rating: 8, mediaRecommendation: { ...sample.media, isAdult: false, genres: ['Romance', 'Sports'] } },
      ] : [] },
    })) } };
  }
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
    item.entry = { progress, status, score: score ?? item.entry?.score ?? 0,
      private: item.entry?.private ?? true, updatedAt: Math.floor(Date.now() / 1000) };
    return { SaveMediaListEntry: item.entry };
  }
  return { Media: item ? { ...item.media, mediaListEntry: item.entry } : null };
}
