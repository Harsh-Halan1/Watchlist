export function progressLimit(media, now = Date.now()) {
  const total = media.episodes > 0 ? media.episodes : null;
  if (media.status === 'FINISHED') return total ?? 32768;
  if (media.status === 'NOT_YET_RELEASED') return 0;

  const next = media.nextAiringEpisode;
  if (!Number.isInteger(next?.episode) || next.episode < 1 ||
      !Number.isFinite(next.airingAt) || next.airingAt * 1000 <= now) return null;
  return Math.min(next.episode - 1, total ?? Infinity);
}

export function isFullyWatched(media, progress) {
  return media.status === 'FINISHED' && Number.isInteger(media.episodes) &&
    media.episodes > 0 && progress >= media.episodes;
}

export function airing(media, watched, now = Date.now()) {
  if (media.status === 'FINISHED') return isFullyWatched(media, watched) ? 'All episodes watched' : null;
  if (media.status === 'NOT_YET_RELEASED') return 'Not yet aired';
  if (media.status !== 'RELEASING') return null;
  const aired = progressLimit(media, now);
  if (aired === null) return 'Airing status unknown';
  if (aired === 0) return 'First episode scheduled';
  if (watched > aired) return 'Watched count exceeds aired episodes';
  const remaining = aired - watched;
  if (remaining <= 0) return 'Caught Up';
  return remaining + (remaining === 1 ? ' aired episode unwatched' : ' aired episodes unwatched');
}

export function nextStatus(media, status, progress, requestedStatus) {
  const current = status ?? (progress ? 'CURRENT' : 'PLANNING');

  if (isFullyWatched(media, progress)) return 'COMPLETED';
  if (requestedStatus) return requestedStatus;
  if (!['PLANNING', 'CURRENT'].includes(current)) return current;
  return progress ? 'CURRENT' : current;
}
