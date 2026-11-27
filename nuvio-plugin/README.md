# Torrentio Local for Nuvio

A client-side Nuvio JavaScript plugin. It resolves Nuvio's TMDB ID to an IMDb ID using the TMDB key exposed by Nuvio's plugin runtime, then queries The RarBg's public JSON API.

## Install

Add this manifest URL in Nuvio → Settings → Plugins → Add Repository:

`https://raw.githubusercontent.com/HashimFaisal/HashimFaisal-Torrentio/direct-streaming/nuvio-plugin/manifest.json`

## Features

- Movies and exact TV episodes.
- TMDB ID → IMDb ID resolution.
- Exact IMDb/season/episode search through The RarBg API.
- Supports both 40-character hexadecimal and 32-character Base32 BTIH hashes. Both forms are normalized to one canonical hexadecimal hash before comparison, deduplication, and returning the stream.
- Verifies that the normalized info hash matches the BTIH hash embedded in each magnet URI; malformed or mismatched pairs are discarded.
- Consolidates repeated API rows by exact `infoHash`, including duplicates encountered across adaptive search thresholds. The merged result keeps the strongest metadata confidence and swarm counters, fills missing source/codec details, and records alternate release titles.
- Does not merge different info hashes solely because their titles look similar; distinct torrent payloads remain separate choices.
- Rejects fractional/negative/unsafe swarm counters, invalid sizes, duplicate hashes, zero-seeder results, and explicitly failed verification. Unchecked states such as `unknown`, `cant_check`, and `retried` are retained with a lower confidence score; only a definitive `failed` verdict is discarded.
- Computes metadata confidence from release-title consistency and available source/codec fields; if title and structured resolution disagree, it conservatively reports the lower resolution and flags the conflict.
- Adaptive swarm search: tries 10 seeders first, then falls back to 5 and 1 only when fewer than five usable results are found.
- Rejects multi-episode ranges and season packs to avoid starting the wrong file.
- Computes a swarm-health score using seed supply, leecher demand, seed/leecher ratio, file size, and resolution. Leecher count is treated as demand/competition, not as extra capacity.
- Retries transient network failures and HTTP 408/429/500/502/503/504 responses up to three attempts with bounded exponential backoff and honors numeric Retry-After hints; permanent 4xx errors fail immediately.
- Caches TMDB-to-IMDb mappings for up to 6 hours and index responses for 90 seconds; concurrent identical requests share one in-flight request. The bounded cache avoids repeated lookups while keeping swarm data fresh.
- Labels each result's swarm as healthy, contended, or thin for diagnostics and exposes a metadata-confidence score plus warning flags.
- Prefers manageable releases on constrained connections when their swarm health is competitive. This is a source-selection heuristic, not a guarantee of playback speed or a measurement of actual throughput.
- Nuvio's built-in P2P engine handles playback. This plugin does not host, proxy, or download media.

## Local tests

Run from this directory:

```bash
node --check torrentio.js
node selftest.js
```

The self-test covers adaptive search, movie lookup, exact episode filtering, season-pack rejection, swarm-aware ordering, hexadecimal/Base32 BTIH normalization and magnet/info-hash integrity, short-lived caching, concurrent request coalescing, transient API recovery, permanent-error fast-fail, metadata confidence, resolution conflict handling, invalid metadata rejection, same-infoHash duplicate consolidation, and cross-threshold metadata merging.

## Source and limitations

The sole metadata source in this version is [The RarBg public JSON API](https://therarbg.com/developers/). Coverage and seed counts depend on that service and the live swarm. TV packs are intentionally filtered; this improves episode precision but can reduce result counts.

TMDB and The RarBg are third-party services and may change availability or response formats. Use torrents only where you have the rights and permission to access the content.
