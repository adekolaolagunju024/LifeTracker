// ── Music search for "Your why" ─────────────────────────────────
// So people can find a song or playlist by name instead of copying links.
// Uses Spotify's catalogue when the app has Spotify keys (songs and
// playlists), otherwise Apple's free iTunes search (songs). Either way the
// result is a normal link the music player already knows how to play.
//
// Settings (optional): SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET, from a
// free app at developer.spotify.com. No user sign-in is involved.

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

async function searchSpotify(q) {
  const res = await fetch(`https://api.spotify.com/v1/search?type=track,playlist&limit=6&q=${encodeURIComponent(q)}`, { headers: { Authorization: `Bearer ${await spotifyToken()}` } });
  if (!res.ok) throw new Error(`Spotify search failed (${res.status})`);
  const d = await res.json();
  const playlists = ((d.playlists && d.playlists.items) || []).filter(Boolean).map(p => ({
    kind: 'playlist', title: p.name, by: (p.owner && p.owner.display_name) || 'Spotify', art: smallest(p.images), url: p.external_urls && p.external_urls.spotify,
  }));
  const tracks = ((d.tracks && d.tracks.items) || []).filter(Boolean).map(t => ({
    kind: 'song', title: t.name, by: (t.artists || []).map(a => a.name).join(', '), art: smallest(t.album && t.album.images), url: t.external_urls && t.external_urls.spotify,
  }));
  return { provider: 'Spotify', results: [...playlists.slice(0, 4), ...tracks.slice(0, 6)].filter(r => r.url) };
}

async function searchItunes(q) {
  const res = await fetch(`https://itunes.apple.com/search?media=music&entity=song&limit=10&term=${encodeURIComponent(q)}`);
  if (!res.ok) throw new Error(`Music search failed (${res.status})`);
  const d = await res.json();
  return {
    provider: 'Apple Music',
    results: (d.results || []).filter(r => r.trackViewUrl).map(r => ({
      kind: 'song', title: r.trackName, by: r.artistName, art: r.artworkUrl100 || r.artworkUrl60 || '', url: r.trackViewUrl.replace(/[?&]uo=\d+/, ''),
    })),
  };
}

async function search(q) {
  const term = String(q || '').trim().slice(0, 100);
  if (!term) return { provider: null, results: [] };
  if (process.env.SPOTIFY_CLIENT_ID && process.env.SPOTIFY_CLIENT_SECRET) {
    try { return await searchSpotify(term); } catch (e) { console.error('Spotify search:', e.message); }
  }
  return searchItunes(term);
}

// Ready-made picks for one-tap adding (Spotify's own editorial playlists).
const PICKS = [
  { label: 'Deep Focus', url: 'https://open.spotify.com/playlist/37i9dQZF1DWZeKCadgRdKQ' },
  { label: 'Lofi Beats', url: 'https://open.spotify.com/playlist/37i9dQZF1DWWQRwui0ExPn' },
  { label: 'Peaceful Piano', url: 'https://open.spotify.com/playlist/37i9dQZF1DX4sWSpwq3LiO' },
  { label: 'Beast Mode', url: 'https://open.spotify.com/playlist/37i9dQZF1DX76Wlfdnj7AP' },
];

module.exports = { search, PICKS, _reset: () => { token = { value: null, until: 0 }; } };
