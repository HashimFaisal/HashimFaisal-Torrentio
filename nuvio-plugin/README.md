# Torrentio Local for Nuvio

A client-side Nuvio JavaScript plugin. It resolves Nuvio's TMDB ID to an IMDb ID using the TMDB key exposed by Nuvio's plugin runtime, then queries The RarBg's public JSON API.

## Install

Add this manifest URL in Nuvio → Settings → Plugins → Add Repository:

`https://raw.githubusercontent.com/HashimFaisal/HashimFaisal-Torrentio/direct-streaming/nuvio-plugin/manifest.json`

## Features

- Movies and TV episodes.
- TMDB ID → IMDb ID resolution.
- Exact IMDb/season/episode search through The RarBg API.
- Validates magnet links and info hashes, removes duplicates, and skips zero-seeder results.
- Adaptive swarm search: tries 10 seeders first, then falls back to 5 and 1 only when fewer than five usable results are found.
- Rejects multi-episode ranges and season packs to avoid starting the wrong file.
- Returns quality, size, seeders, peers and info hash.
- Nuvio's built-in P2P engine handles playback. This plugin does not host, proxy, or download media.

## Local tests

```bash
node --check torrentio.js
node selftest.js
```

## Source and limitations

The sole metadata source in this first version is [The RarBg public JSON API](https://therarbg.com/developers/). Its published unauthenticated quota is 30 requests/minute and 10,000/day. Coverage and seed counts depend on that service and the live swarm. TV packs are intentionally filtered; this improves episode precision but can reduce result counts.

TMDB and The RarBg are third-party services and may change availability or response formats. Use torrents only where you have the rights and permission to access the content.
