const warningTags = new Set(['nudity', 'sexual content', 'explicit sexual content', 'fanservice', 'ecchi']);

export function recommendationSeeds(entries) {
  return entries
    .filter(entry => (entry.progress > 0 || entry.status === 'COMPLETED') &&
      ['CURRENT', 'COMPLETED', 'REPEATING'].includes(entry.status) &&
      (!entry.score || entry.score >= 70))
    .sort((a, b) => (b.score || 0) - (a.score || 0) || b.updatedAt - a.updatedAt)
    .slice(0, 6);
}

export function rankRecommendations(entries, seeds, sources) {
  const tracked = new Set(entries.map(entry => entry.media.id));
  const bySource = new Map(sources.filter(Boolean).map(media => [media.id, media]));
  const candidates = new Map();

  for (const [index, seed] of seeds.entries()) {
    for (const link of bySource.get(seed.media.id)?.recommendations?.nodes ?? []) {
      const media = link?.mediaRecommendation;
      if (!media || tracked.has(media.id) || media.isAdult !== false ||
          !['FINISHED', 'RELEASING'].includes(media.status) || !(link.rating > 0)) continue;

      const weight = Math.log1p(link.rating) * (1 - index * 0.06);
      const previous = candidates.get(media.id);
      if (previous) {
        previous.score += weight;
        if (weight > previous.reasonWeight) {
          previous.because = seed.media.title;
          previous.reasonWeight = weight;
        }
      } else {
        const { genres, tags, isAdult, ...details } = media;
        const flagged = genres?.includes('Ecchi') || tags?.some(tag => tag &&
          (tag.isAdult || warningTags.has(tag.name?.toLowerCase())));
        candidates.set(media.id, { media: details, because: seed.media.title, score: weight,
          reasonWeight: weight, fanservice: flagged ? 'flagged' : 'unknown' });
      }
    }
  }

  return [...candidates.values()].sort((a, b) => b.score - a.score || a.media.id - b.media.id)
    .map(({ media, because, fanservice }) => ({ media, because, fanservice }));
}
