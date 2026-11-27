# torrentio-addon

The Torrentio Stremio addon in Rust. HTTP surface: `/manifest.json`, `/configure`, `/{config}/stream|meta|catalog/...`,
`/resolve/...`, `/metrics` and the static files in `static/`. It uses the Postgres torrents schema, the Mongo cache
collections and the Redis rate limiter keys shared with the other Torrentio services, and exports the same Prometheus
metric names for everything that still applies.

## Layout

```
crates/addon    the server, organised in layers
  domain          pure logic: typed configuration, filtering, sorting, stream rendering, models, repository port
  application     stream / catalog / meta workflows (Addon), HandlerError
  providers       debrid adapters (Moch trait), provider registry, resolve outcomes, circuit breakers
  infrastructure  Postgres, Mongo, Redis, caches, metrics, logging, concurrency helpers
  http            axum routes, middleware, landing page, manifest
crates/debrid   minimal HTTP clients, one module per debrid provider, only the endpoints the addon calls
bench/load.js   k6 scenario used for the Node vs Rust comparison
```

Torrent titles are parsed with the Rust `parse-torrent-title` crate.

Dependencies are injected at the seams: the workflows depend on the `TorrentRepository` trait, and `Mochs::new` takes the
provider list (`default_providers` builds the real ones), so whole stream/resolve flows are tested against fakes in
`application/addon.rs`.

## Running

```
DATABASE_URI=postgres://... MONGODB_URI=mongodb://... REDIS_URL=redis://... \
METRICS_USER=... METRICS_PASSWORD=... PORT=7000 STATIC_DIR=static \
cargo run --release -p torrentio-addon
```

`MONGODB_URI` and `REDIS_URL` are optional (no store cache / no rate limiting without them). `MONGODB_DATABASE` overrides
the database of the Mongo cache collections, `HOST` the bind address (default `::`). `TORBOX_API_URL` and
`HIGHWAY_API_BASE` override the provider API base urls.

Torrentio is torrent-only: search results are read from the configured torrent index and returned to Stremio as torrent sources. The addon does not host media, scrape arbitrary playback URLs, or provide HTTP/HLS streams; playback is handled by Stremio or an explicitly configured Debrid provider.

`DATABASE_URI` is required for torrent lookups. MongoDB and Redis remain optional and provide persistent caching and distributed rate limiting when configured.

The Docker image is built from this directory: 
`docker build -t torrentio-addon .`

## Logging

One JSON object per line, flat fields, no timestamp (the Docker/Alloy pipeline adds it): warnings and errors go to
stderr, the rest to stdout. Message prefixes match the Node addon so existing Loki greps keep working
(`{service="torrentio_addon"} |= "Failed RealDebrid"`), and the details are fields (`| json | moch="torbox"`).

## Benchmark

`bench/load.js` drives `/stream` requests with k6 against a local Postgres copy (8M torrents, 16M files), Redis and
Mongo, 64 concurrent connections, and a deterministic distinct client IP per iteration so the rate limiter never
triggers. Hot-target selection and client IPs are repeatable across runs; the summary reports p50, p90, p95 and p99
latency in addition to throughput and checks:

```
BASE=http://127.0.0.1:7002 MODE=hot  TARGETS=hot_targets.txt  VUS=64 k6 run bench/load.js
BASE=http://127.0.0.1:7002 MODE=cold TARGETS=cold_targets.txt VUS=64 k6 run bench/load.js
```

Targets are `<type> <id>` lines. `hot` repeats 100 ids against a warm memory cache, `cold` requests 3000 distinct ids
once against empty caches. Add `CONFIG=torbox=<key>` to include a debrid availability call per request. Flush Redis
between runs: every run leaves about a million rate-limit keys behind and a bloated keyspace slows the benchmark itself.

For a controlled official-vs-candidate comparison, point the same script and target files at each deployment.
Keep CPU/memory limits, Postgres snapshot, Redis/Mongo state, configuration, and k6 host identical. Run each case
at least five times and compare the median throughput, p50/p95/p99 latency, failed-request rate, and response
sizes. For cold runs, restore equivalent empty cache state before **each** run; alternate which deployment runs
first to reduce order bias. Save the full k6 summaries:

```
BASE="$OFFICIAL_BASE" MODE=hot  TARGETS=hot_targets.txt  VUS=64 k6 run --summary-export=official-hot.json  bench/load.js
BASE="$CANDIDATE_BASE" MODE=hot  TARGETS=hot_targets.txt  VUS=64 k6 run --summary-export=candidate-hot.json bench/load.js
BASE="$OFFICIAL_BASE" MODE=cold TARGETS=cold_targets.txt VUS=64 k6 run --summary-export=official-cold.json  bench/load.js
BASE="$CANDIDATE_BASE" MODE=cold TARGETS=cold_targets.txt VUS=64 k6 run --summary-export=candidate-cold.json bench/load.js
```

Do not compare runs with different targets, warm/cold cache conditions, debrid keys, or resource limits. These
instructions define the measurement protocol; they are not a claim that a new official-vs-candidate benchmark
has already been run.

Results on one machine (14 cores), clean Redis, Node as deployed (1 worker) and with 4 workers:

| Scenario | Node, 1 worker | Node, 4 workers | Rust, 1 process |
|---|---|---|---|
| Hot stream cache, req/s | 15.4k | 49.2k | 52.1k |
| Cold, Postgres, req/s | 635 | 1,778 | 3,004 |
| Hot + TorBox availability call, req/s | 5.1k | 14.0k | 30.2k |
| Memory (RSS), benchmark | ~370 MB | ~1.5 GB | 60-80 MB (idle, small cache) |

With Redis in the loop the hot path is bounded by Redis itself for both implementations (without Redis the Rust server does
60-80k req/s); the gains show on the cold and debrid paths and in memory.

In production a Node process sat at 0.8-1.7 GB. The Rust process starts around 0.25 GB and grows with the stream cache, which
holds zstd-compressed JSON (about 5.5 KB per entry, an 800 MB budget by default).

## PostgreSQL query plans

Before changing indexes, collect plans from a staging database or a disposable clone
with representative common and rare IMDb/Kitsu IDs. The diagnostic script mirrors the
addon lookup queries and includes the torrent point lookup and batched file lookup:

```sh
psql "$STAGING_DATABASE_URI" \
  -v imdb_id='tt0111161' -v season=1 -v episode=1 \
  -v kitsu_id=1 -v kitsu_episode=1 \
  -v info_hash_1='...' -v info_hash_2='...' \
  -f addon/bench/postgres-explain.sql
```

Review actual versus estimated rows, scan types, sort method, shared buffer hits/reads,
and execution time for each plan. The script also reports existing index definitions,
table sizes and row estimates, planner column statistics, and cumulative index usage;
keep this output with the plans. Do not apply index changes based on query shape alone:
validate candidate indexes against these plans and write throughput on the same staging dataset. The script runs `EXPLAIN ANALYZE` SELECT statements and
must not be run on a latency-sensitive production database.
