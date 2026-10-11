// ── Music search for "Your why" ─────────────────────────────────
// So people can find a song or playlist by name instead of copying links.
// Spotify (with the person's own linked account, or the app's keys) and
// YouTube (with YOUTUBE_API_KEY or their linked account), together; Apple's
// free iTunes search only when neither is available, since its player
// plays 30-second previews to anyone not signed in to Apple Music. Every
// result is a normal link the music player already plays.
//
// Settings (optional): SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET (a free
// app at developer.spotify.com); YOUTUBE_API_KEY (Google Cloud, YouTube
// Data API v3). See backend/musicAccounts.js for linking accounts.

let token = { value: null, until: 0 };
async function spotifyToken() {
  if (token.value && Date.now() < token.until) return token.value;
  const auth = Buffer.from(`${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`).toString('base64');
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
  });
  if (!res.ok) throw new Error(`Spotify sign-in failed (${res.status})`);
  const d = await res.json();
  token = { value: d.access_token, until: Date.now() + (d.expires_in - 60) * 1000 };
  return token.value;
}

const smallest = (images = []) => (images.slice().sort((a, b) => (a.width || 0) - (b.width || 0)).find(i => (i.width || 0) >= 60) || images[0] || {}).url || '';

async function searchSpotify(q, userToken) {
  const res = await fetch(`https://api.spotify.com/v1/search?type=track,playlist&limit=6&q=${encodeURIComponent(q)}`, { headers: { Authorization: `Bearer ${userToken || await spotifyToken()}` } });
  if (!res.ok) throw new Error(`Spotify search failed (${res.status})`);
  const d = await res.json();
  const playlists = ((d.playlists && d.playlists.items) || []).filter(Boolean).map(p => ({
    kind: 'playlist', title: p.name, by: (p.owner && p.owner.display_name) || 'Spotify', art: smallest(p.images), url: p.external_urls && p.external_urls.spotify,
  }));
  const tracks = ((d.tracks && d.tracks.items) || []).filter(Boolean).map(t => ({
    kind: 'song', title: t.name, by: (t.artists || []).map(a => a.name).join(', '), art: smallest(t.album && t.album.images), url: t.external_urls && t.external_urls.spotify,
  }));
  return { provider: 'Spotify', results: [...playlists.slice(0, 4), ...tracks.slice(0, 6)].filter(r => r.url).map(r => ({ ...r, service: 'Spotify' })) };
}

// YouTube: full songs and playlists that play right in the app.
const decode = s => String(s || '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
async function searchYouTube(q, userToken) {
  const qs = new URLSearchParams({ part: 'snippet', type: 'video,playlist', maxResults: '8', q, ...(userToken ? {} : { key: process.env.YOUTUBE_API_KEY }) });
  const res = await fetch(`https://www.googleapis.com/youtube/v3/search?${qs}`, userToken ? { headers: { Authorization: `Bearer ${userToken}` } } : {});
  if (!res.ok) throw new Error(`YouTube search failed (${res.status})`);
  const d = await res.json();
  return {
    provider: 'YouTube',
    results: (d.items || []).map(it => {
      const id = it.id || {};
      const sn = it.snippet || {};
      const url = id.videoId ? `https://www.youtube.com/watch?v=${id.videoId}` : id.playlistId ? `https://www.youtube.com/playlist?list=${id.playlistId}` : null;
      return url && { kind: id.playlistId ? 'playlist' : 'song', title: decode(sn.title), by: decode(sn.channelTitle), art: (sn.thumbnails && (sn.thumbnails.default || {}).url) || '', url, service: 'YouTube' };
    }).filter(Boolean),
  };
}

async function searchItunes(q) {
  const res = await fetch(`https://itunes.apple.com/search?media=music&entity=song&limit=10&term=${encodeURIComponent(q)}`);
  if (!res.ok) throw new Error(`Music search failed (${res.status})`);
  const d = await res.json();
  return {
    provider: 'Apple Music',
    results: (d.results || []).filter(r => r.trackViewUrl).map(r => ({
      kind: 'song', title: r.trackName, by: r.artistName, art: r.artworkUrl100 || r.artworkUrl60 || '', url: r.trackViewUrl.replace(/[?&]uo=\d+/, ''), service: 'Apple Music',
    })),
  };
}

// tokens: { spotify, youtube } access tokens for the person's linked
// accounts, when they have them.
async function search(q, tokens = {}) {
  const term = String(q || '').trim().slice(0, 100);
  if (!term) return { provider: null, results: [] };
  const jobs = [];
  if (tokens.spotify || (process.env.SPOTIFY_CLIENT_ID && process.env.SPOTIFY_CLIENT_SECRET)) jobs.push(searchSpotify(term, tokens.spotify));
  if (tokens.youtube || process.env.YOUTUBE_API_KEY) jobs.push(searchYouTube(term, tokens.youtube));
  const found = (await Promise.allSettled(jobs)).flatMap(r => {
    if (r.status === 'fulfilled') return [r.value];
    console.error('Music search:', r.reason && r.reason.message);
    return [];
  }).filter(r => r.results.length);
  if (found.length) {
    // Take turns, so both services show near the top.
    const results = [];
    for (let i = 0; results.length < 14 && found.some(f => f.results[i]); i++) found.forEach(f => { if (f.results[i]) results.push(f.results[i]); });
    return { provider: found.map(f => f.provider).join(' and '), results: results.slice(0, 14) };
  }
  return searchItunes(term);
}

// The real name of a pasted or shared link (oEmbed: no key needed), so it
// doesn't show up as "From YouTube".
async function titleFor(url) {
  let u;
  try { u = new URL(url); } catch { return null; }
  const host = u.hostname.replace(/^www\.|^m\./, '');
  const endpoint = host === 'open.spotify.com' ? 'https://open.spotify.com/oembed'
    : /(^|\.)youtube\.com$|^youtu\.be$/.test(host) ? 'https://www.youtube.com/oembed'
      : host === 'soundcloud.com' ? 'https://soundcloud.com/oembed' : null;
  if (!endpoint) return null;
  try {
    const res = await fetch(`${endpoint}?format=json&url=${encodeURIComponent(url)}`);
    if (!res.ok) return null;
    const d = await res.json();
    return d.title ? String(d.title).slice(0, 60) : null;
  } catch { return null; }
}

// Ready-made picks for one-tap adding (Spotify's own editorial playlists).
const PICKS = [
  { label: 'Deep Focus', url: 'https://open.spotify.com/playlist/37i9dQZF1DWZeKCadgRdKQ' },
  { label: 'Lofi Beats', url: 'https://open.spotify.com/playlist/37i9dQZF1DWWQRwui0ExPn' },
  { label: 'Peaceful Piano', url: 'https://open.spotify.com/playlist/37i9dQZF1DX4sWSpwq3LiO' },
  { label: 'Beast Mode', url: 'https://open.spotify.com/playlist/37i9dQZF1DX76Wlfdnj7AP' },
];

module.exports = { search, titleFor, PICKS, _reset: () => { token = { value: null, until: 0 }; } };
