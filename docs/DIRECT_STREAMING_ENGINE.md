# Direct Streaming Engine

## Goal

Add a server-hosted HTTP video source path alongside the existing torrent path. The direct path must not use peer counts, seeders, swarms, or user devices. It returns playable HTTP(S) media URLs supplied by authorized source APIs or user-authorized media origins.

## Current boundary

The existing addon stream workflow is torrent-database based:

1. `Addon::streams` reads records through `TorrentRepository`.
2. Records are converted into torrent streams and sorted.
3. `Mochs` may enrich/resolve streams through configured debrid providers.
4. The addon returns Stremio-compatible stream objects.

The direct path is now integrated as an optional adapter alongside the existing torrent path. Mixed mode queries the configured direct API and torrent database concurrently. If the torrent database fails but direct sources are available, those direct sources are still returned.

## Target flow

1. Receive the movie/episode identifier (IMDb or Kitsu).
2. Ask the configured, authorized HTTP source API for candidates (or skip the torrent database entirely in direct-only mode).
3. Validate each candidate URL and media type.
4. Probe only safe, bounded metadata (HEAD or a small ranged GET where supported).
5. Rank candidates by measured availability, startup latency, throughput evidence, codec/container compatibility, and declared quality. Seeder/viewer counts are not inputs.
6. Return the best valid HTTP(S) candidates as Stremio stream objects with filename/quality metadata.
7. Prefer direct HTTP candidates in the returned list and retain torrent/debrid results as fallback in mixed mode.

## Source adapter contract

The first implementation is a generic HTTPS API adapter configured with `DIRECT_STREAM_API_URL`. It sends `type` and `id` query parameters and expects a JSON object with a `streams` array. Each stream uses the existing Stremio shape: `name` (two lines: provider and quality), `title`, `url`, and optional `behaviorHints`. The response is capped at 1 MiB and 20 candidates; requests time out after 8 seconds and redirects are disabled. Direct candidates receive a 60-second cache lifetime and bypass provider-name and minimum-seeder filters.

Set `DIRECT_STREAM_ONLY=true` to disable torrent database lookups entirely. This mode requires a working configured direct-source API and returns an empty list when it is absent or has no valid results.

Each adapter must have:
- A stable provider ID and display name.
- Explicit supported content types and identifier formats.
- A documented API or a source endpoint the project owner is authorized to use.
- Bounded request timeouts and response sizes.
- Per-provider circuit breaking and rate limits.
- Structured diagnostics that never log API keys or signed media URLs.

No adapter may invent a media URL. A candidate must come from the provider response or an explicitly configured media origin.

## Playback compatibility

Initially support direct HTTPS progressive media and HLS/DASH URLs only when the Nuvio playback engine supports the returned format. Preserve required headers only if the target player can receive them. Range support should be detected rather than assumed. Transcoding is out of scope for the addon itself; it requires a separately operated media server and sufficient rights to process the media.

## Safety and reliability

- Accept HTTPS by default; permit HTTP only through an explicit trusted-provider setting.
- Reject localhost, private, link-local, multicast, and cloud-metadata destinations.
- Re-check DNS/IP destinations after redirects to reduce SSRF and DNS-rebinding risk.
- Limit redirects, response sizes, probe duration, and concurrent probes.
- Do not bypass paywalls, authentication, DRM, geo restrictions, or access controls.
- Use only public or owner-authorized provider APIs and media URLs.
- Never treat a successful HEAD response alone as proof that the full video will play without buffering.

## Phased implementation

### Phase A — contract and compatibility
- [x] Add the configurable HTTPS source adapter and integrate it into stream resolution.
- [x] Add public-URL validation, response-size/time limits, and tests for HTTP(S), unsafe schemes, private/local destinations, and direct-source filtering.
- [ ] Add safe availability/latency probes and measured source ranking.
- Add tests for progressive HTTP, HLS, redirects, invalid/private URLs, and timeouts.

### Phase B — first authorized provider
- Integrate one real source API after its documentation/base URL and authorization method are supplied.
- Map provider results to the direct candidate model.
- Verify playback in Nuvio with a test asset the owner is allowed to use.

### Phase C — ranking and resilience
- Measure startup latency and short-window throughput safely.
- Rank by availability and playback suitability, never by seeders/viewers.
- Add fallback behavior, cache policy, metrics, and provider circuit breakers.

### Phase D — rollout
- Keep torrent mode available behind a configuration switch during validation.
- Enable direct mode only after integration and Nuvio runtime tests pass.
- Do not claim zero buffering; performance depends on source capacity, network conditions, and media bitrate.

## Blocking integration input

The generic adapter is implemented, but no provider endpoint is hard-coded or assumed. To produce real direct playback results, the deployment must set `DIRECT_STREAM_API_URL` to an authorized source API implementing the documented response contract. The repository currently does not contain a real direct-video source API, so this commit does not fabricate links or claim that a live source catalog is available.
