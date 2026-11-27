-- PostgreSQL query-plan diagnostics for the Torrentio addon.
--
-- Run ONLY against a staging database or a disposable production-sized clone:
--   psql "$STAGING_DATABASE_URI" \
--     -v imdb_id='tt0111161' -v season=1 -v episode=1 \
--     -v kitsu_id=1 -v kitsu_episode=1 \
--     -v info_hash_1='...' -v info_hash_2='...' \
--     -f addon/bench/postgres-explain.sql
--
-- Choose representative IDs with both common and rare matches. EXPLAIN ANALYZE
-- executes each SELECT; do not run this diagnostic on a latency-sensitive
-- production database. No schema or index changes are made by this file.

\set ON_ERROR_STOP on
SET statement_timeout = '30s';
SET lock_timeout = '2s';

-- IMDb movie lookup
EXPLAIN (ANALYZE, BUFFERS, SETTINGS, SUMMARY)
SELECT
    f."infoHash" AS f_info_hash, f."fileIndex" AS f_file_index, f."title" AS f_title, f."size" AS f_size,
    f."kitsuId" AS f_kitsu_id,
    t."provider" AS t_provider, t."torrentId" AS t_torrent_id, t."title" AS t_title,
    t."size" AS t_size, t."type" AS t_type, t."uploadDate" AS t_upload_date, t."seeders" AS t_seeders,
    t."trackers" AS t_trackers, t."languages" AS t_languages, t."resolution" AS t_resolution
FROM "files" AS f INNER JOIN "torrents" AS t ON f."infoHash" = t."infoHash"
WHERE f."imdbId" = :'imdb_id'
ORDER BY COALESCE(t."seeders", 0) DESC, t."uploadDate" DESC
LIMIT 500;

-- IMDb episode lookup
EXPLAIN (ANALYZE, BUFFERS, SETTINGS, SUMMARY)
SELECT
    f."infoHash" AS f_info_hash, f."fileIndex" AS f_file_index, f."title" AS f_title, f."size" AS f_size,
    f."kitsuId" AS f_kitsu_id,
    t."provider" AS t_provider, t."torrentId" AS t_torrent_id, t."title" AS t_title,
    t."size" AS t_size, t."type" AS t_type, t."uploadDate" AS t_upload_date, t."seeders" AS t_seeders,
    t."trackers" AS t_trackers, t."languages" AS t_languages, t."resolution" AS t_resolution
FROM "files" AS f INNER JOIN "torrents" AS t ON f."infoHash" = t."infoHash"
WHERE f."imdbId" = :'imdb_id' AND f."imdbSeason" = :season AND f."imdbEpisode" = :episode
ORDER BY COALESCE(t."seeders", 0) DESC, t."uploadDate" DESC
LIMIT 500;

-- Kitsu movie lookup
EXPLAIN (ANALYZE, BUFFERS, SETTINGS, SUMMARY)
SELECT
    f."infoHash" AS f_info_hash, f."fileIndex" AS f_file_index, f."title" AS f_title, f."size" AS f_size,
    f."kitsuId" AS f_kitsu_id,
    t."provider" AS t_provider, t."torrentId" AS t_torrent_id, t."title" AS t_title,
    t."size" AS t_size, t."type" AS t_type, t."uploadDate" AS t_upload_date, t."seeders" AS t_seeders,
    t."trackers" AS t_trackers, t."languages" AS t_languages, t."resolution" AS t_resolution
FROM "files" AS f INNER JOIN "torrents" AS t ON f."infoHash" = t."infoHash"
WHERE f."kitsuId" = :kitsu_id
ORDER BY COALESCE(t."seeders", 0) DESC, t."uploadDate" DESC
LIMIT 500;

-- Kitsu episode lookup
EXPLAIN (ANALYZE, BUFFERS, SETTINGS, SUMMARY)
SELECT
    f."infoHash" AS f_info_hash, f."fileIndex" AS f_file_index, f."title" AS f_title, f."size" AS f_size,
    f."kitsuId" AS f_kitsu_id,
    t."provider" AS t_provider, t."torrentId" AS t_torrent_id, t."title" AS t_title,
    t."size" AS t_size, t."type" AS t_type, t."uploadDate" AS t_upload_date, t."seeders" AS t_seeders,
    t."trackers" AS t_trackers, t."languages" AS t_languages, t."resolution" AS t_resolution
FROM "files" AS f INNER JOIN "torrents" AS t ON f."infoHash" = t."infoHash"
WHERE f."kitsuId" = :kitsu_id AND f."kitsuEpisode" = :kitsu_episode
ORDER BY COALESCE(t."seeders", 0) DESC, t."uploadDate" DESC
LIMIT 500;

-- Single torrent lookup
EXPLAIN (ANALYZE, BUFFERS, SETTINGS, SUMMARY)
SELECT "infoHash" AS info_hash, "provider", "torrentId" AS torrent_id, "title", "size",
       "type" AS kind, "uploadDate" AS upload_date, "seeders", "trackers", "languages", "resolution"
FROM "torrents"
WHERE "infoHash" = :'info_hash_1'
LIMIT 1;

-- Batched file lookup (same shape as WHERE "infoHash" = ANY($1))
EXPLAIN (ANALYZE, BUFFERS, SETTINGS, SUMMARY)
SELECT "infoHash", "title", "imdbId", "imdbSeason", "imdbEpisode"
FROM "files"
WHERE "infoHash" = ANY(ARRAY[:'info_hash_1', :'info_hash_2']::text[]);

-- Existing index definitions: inspect these before proposing any new index.
SELECT schemaname, tablename, indexname, indexdef
FROM pg_indexes
WHERE tablename IN ('files', 'torrents')
ORDER BY tablename, indexname;

-- Table size and estimated row counts help explain plan choices.
SELECT
    relname AS table_name,
    n_live_tup AS estimated_live_rows,
    n_dead_tup AS estimated_dead_rows,
    last_analyze,
    last_autoanalyze,
    pg_size_pretty(pg_total_relation_size(relid)) AS total_size,
    pg_size_pretty(pg_relation_size(relid)) AS heap_size
FROM pg_stat_user_tables
WHERE relname IN ('files', 'torrents')
ORDER BY relname;

-- Column statistics used by the planner for the lookup and join predicates.
SELECT
    tablename,
    attname AS column_name,
    null_frac,
    n_distinct,
    correlation,
    most_common_vals,
    most_common_freqs
FROM pg_stats
WHERE tablename IN ('files', 'torrents')
  AND attname IN (
      'infoHash', 'imdbId', 'imdbSeason', 'imdbEpisode',
      'kitsuId', 'kitsuEpisode', 'seeders', 'uploadDate'
  )
ORDER BY tablename, attname;

-- Index usage counters are cumulative since the last statistics reset.
-- A low idx_scan count alone is not proof that an index is unused.
SELECT
    relname AS table_name,
    indexrelname AS index_name,
    idx_scan,
    idx_tup_read,
    idx_tup_fetch,
    pg_size_pretty(pg_relation_size(indexrelid)) AS index_size
FROM pg_stat_user_indexes
WHERE relname IN ('files', 'torrents')
ORDER BY relname, indexrelname;
