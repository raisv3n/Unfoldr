// YouTube embeds: videos cannot be archived, so exports show a downloaded thumbnail that links
// to the video. Thumbnails come only from YouTube's image host and are fetched without cookies.

import { parseUrl } from './ids';

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const YOUTUBE_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtube-nocookie.com', 'www.youtube-nocookie.com']);

export const YOUTUBE_THUMBNAIL_HOST = 'i.ytimg.com';

/** Extracts the 11-character video ID from the common YouTube URL forms, or undefined. */
export function youTubeVideoId(url: string): string | undefined {
  const u = parseUrl(url);
  if (!u || (u.protocol !== 'https:' && u.protocol !== 'http:')) return undefined;
  const host = u.hostname.toLowerCase();
  let id: string | null | undefined;
  if (host === 'youtu.be' || host === 'www.youtu.be') {
    id = u.pathname.split('/')[1];
  } else if (YOUTUBE_HOSTS.has(host)) {
    const [first, second] = u.pathname.split('/').filter(Boolean);
    if (first === 'watch') id = u.searchParams.get('v');
    else if (first === 'embed' || first === 'shorts' || first === 'live' || first === 'v') id = second;
  }
  return id && VIDEO_ID.test(id) ? id : undefined;
}

export function youTubeWatchUrl(id: string): string {
  return `https://www.youtube.com/watch?v=${id}`;
}

/** 480×360 thumbnail; unlike maxresdefault, it exists for every video. */
export function youTubeThumbnailUrl(id: string): string {
  return `https://${YOUTUBE_THUMBNAIL_HOST}/vi/${id}/hqdefault.jpg`;
}

export function isYouTubeThumbnailHost(hostname: string): boolean {
  return hostname.toLowerCase() === YOUTUBE_THUMBNAIL_HOST;
}
