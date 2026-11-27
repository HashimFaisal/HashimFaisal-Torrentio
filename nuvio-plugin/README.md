# Torrentio Local for Nuvio

A client-side Nuvio JavaScript plugin. It resolves Nuvio's TMDB ID to an IMDb ID using the TMDB key exposed by Nuvio's plugin runtime, then searches independent torrent catalogs in parallel. The current provider set is The RarBg for movies and TV, YTS for movies, and EZTV for TV.

## Install

Add this manifest URL in Nuvio → Settings → Plugins → Add Repository:

`https://raw.githubusercontent.com/HashimFaisal/HashimFaisal-Torrentio/direct-streaming/nuvio-plugin/manifest.json`

## Features

- Multi-source search: The RarBg, YTS (movies), and EZTV (TV) are queried concurrently. A failure or malformed response from one provider is isolated and does not discard results returned by the others.
- Provider-aware result merging: exact matching BTIH hashes are consolidated across providers, preserving alternate titles and all contributing provider labels without merging different payloads.
- Per-provider health monitoring tracks request totals, smoothed response latency, recent failure rate, consecutive failures, last error category, and recovery timestamps.
- Individual catalog requests are bounded by an 8-second timeout. A provider whose full lookup exceeds 9 seconds is temporarily bypassed for 30 seconds; after three consecutive failures, it is bypassed for 60 seconds. After cooldown, one half-open probe is allowed to test recovery. Other catalogs continue normally.
- Automatic weak / medium / fast selection uses recent catalog response latency and recent provider failure rate as a conservative responsiveness signal. It is not a bandwidth test and does not claim to measure P2P throughput.
- Network profiles change ranking: weak favors smaller 720p/480p releases, medium balances 720p/1080p, and fast can favor 1080p/2160p. Each result is labeled as recommended-size or large-for-profile using profile-specific movie/episode size targets.
- Structured diagnostics count invalid/missing info hashes, malformed or mismatched magnets, missing swarm counters, invalid sizes, failed verification, wrong episodes/packs, and implausible sizes. Provider-level errors are classified as HTTP client/server, malformed index response, timeout, or network failure.
- Short-lived provider response caching (2 minutes) limits repeat lookups while allowing swarm metadata to refresh.

- Movies and exact TV episodes.
- TMDB ID → IMDb ID resolution.
- Exact IMDb/season/episode search through The RarBg API, with YTS IMDb lookup for movies and EZTV IMDb lookup for TV.
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
- Prefers manageable releases on constrained connections when their swarm health is competitive. This is a source-selection heuristic, not a guarantee of playback speed or a measurement of actual throughput. The automatic profile uses catalog API responsiveness as a proxy only; real download speed, peer throughput, buffering, and P2P health require telemetry from Nuvio's native playback engine.
- Nuvio's built-in P2P engine handles playback. This plugin does not host, proxy, or download media.

## Local tests

Run from this directory:

```bash
node --check torrentio.js
node selftest.js
```

The self-test fixtures cover parallel provider fan-out, provider failure isolation, YTS movie mapping, EZTV exact-episode mapping, cross-provider BTIH consolidation, adaptive The RarBg search, hexadecimal/Base32 BTIH normalization and magnet integrity, short-lived caching, concurrent request coalescing, transient API recovery, permanent-error handling, metadata confidence, resolution conflict handling, and invalid metadata rejection. Fixtures are maintained for provider fan-out, failure isolation, cooldown behavior, adaptive network scoring, and structured validation. They have intentionally not been executed yet for this development pass.

## Source and limitations

Provider coverage is split by catalog: [The RarBg public JSON API](https://therarbg.com/developers/) covers movies and TV; [YTS API](https://yts.proxyninja.org/api) supplements movie releases; [EZTV API](https://eztvx.to/api/) supplements TV episodes. YTS is movie-only and its catalog is selective, while EZTV's API is documented as beta. Provider uptime, catalog coverage, and swarm counts can change independently. TV packs and multi-episode ranges are intentionally filtered; this improves episode precision but can reduce result counts.

TMDB and The RarBg are third-party services and may change availability or response formats. Use torrents only where you have the rights and permission to access the content.
