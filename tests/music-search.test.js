const test = require('node:test');
const assert = require('node:assert');
const musicSearch = require('../backend/musicSearch');

const realFetch = global.fetch;
const env = { ...process.env };
test.afterEach(() => { global.fetch = realFetch; process.env = { ...env }; musicSearch._reset(); });

test('without Spotify keys, songs come from Apple and play in the app', async () => {
  delete process.env.SPOTIFY_CLIENT_ID; delete process.env.SPOTIFY_CLIENT_SECRET;
  const asked = [];
  global.fetch = async url => { asked.push(url); return { ok: true, json: async () => ({ results: [{ trackName: 'Lose Yourself', artistName: 'Eminem', artworkUrl100: 'https://is1-ssl.mzstatic.com/a.jpg', trackViewUrl: 'https://music.apple.com/gb/album/x/123?i=456&uo=4' }] }) }; };
  const r = await musicSearch.search('lose yourself');
  assert.match(asked[0], /^https:\/\/itunes\.apple\.com\/search\?.*term=lose%20yourself/);
  assert.strictEqual(r.provider, 'Apple Music');
  assert.deepStrictEqual(r.results[0], { kind: 'song', title: 'Lose Yourself', by: 'Eminem', art: 'https://is1-ssl.mzstatic.com/a.jpg', url: 'https://music.apple.com/gb/album/x/123?i=456' });
});

test('with Spotify keys, playlists come first, then songs', async () => {
  process.env.SPOTIFY_CLIENT_ID = 'id'; process.env.SPOTIFY_CLIENT_SECRET = 'secret';
  global.fetch = async url => {
    if (url.includes('accounts.spotify.com')) return { ok: true, json: async () => ({ access_token: 'tok', expires_in: 3600 }) };
    return { ok: true, json: async () => ({
      playlists: { items: [null, { name: 'Gym Hits', owner: { display_name: 'Spotify' }, images: [{ url: 'https://i.scdn.co/p.jpg', width: 300 }], external_urls: { spotify: 'https://open.spotify.com/playlist/abc' } }] },
      tracks: { items: [{ name: 'Eye of the Tiger', artists: [{ name: 'Survivor' }], album: { images: [{ url: 'https://i.scdn.co/big.jpg', width: 640 }, { url: 'https://i.scdn.co/small.jpg', width: 64 }] }, external_urls: { spotify: 'https://open.spotify.com/track/def' } }] },
    }) };
  };
  const r = await musicSearch.search('workout');
  assert.strictEqual(r.provider, 'Spotify');
  assert.deepStrictEqual(r.results.map(x => [x.kind, x.title, x.url]), [['playlist', 'Gym Hits', 'https://open.spotify.com/playlist/abc'], ['song', 'Eye of the Tiger', 'https://open.spotify.com/track/def']]);
  assert.strictEqual(r.results[1].art, 'https://i.scdn.co/small.jpg');
});

test('if Spotify fails, it falls back to Apple; an empty search asks nothing', async () => {
  process.env.SPOTIFY_CLIENT_ID = 'id'; process.env.SPOTIFY_CLIENT_SECRET = 'secret';
  global.fetch = async url => (url.includes('spotify') ? { ok: false, status: 500 } : { ok: true, json: async () => ({ results: [] }) });
  const errors = console.error; console.error = () => {};
  try { assert.strictEqual((await musicSearch.search('x')).provider, 'Apple Music'); } finally { console.error = errors; }
  global.fetch = async () => { throw new Error('should not be called'); };
  assert.deepStrictEqual(await musicSearch.search('   '), { provider: null, results: [] });
});
