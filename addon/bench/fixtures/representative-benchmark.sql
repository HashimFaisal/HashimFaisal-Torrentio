-- Deterministic synthetic benchmark dataset. Disposable CI-only data; never production.
-- 250k torrents across 100 IMDb movie IDs (2,500 files per target).
CREATE TABLE "torrents" (
    "infoHash" TEXT PRIMARY KEY,
    "provider" TEXT NOT NULL,
    "torrentId" TEXT,
    "title" TEXT NOT NULL,
    "size" BIGINT,
    "type" TEXT NOT NULL,
    "uploadDate" TIMESTAMPTZ NOT NULL,
    "seeders" SMALLINT,
    "trackers" TEXT,
    "languages" TEXT,
    "resolution" TEXT
);
CREATE TABLE "files" (
    "infoHash" TEXT NOT NULL,
    "fileIndex" INTEGER,
    "title" TEXT NOT NULL,
    "size" BIGINT,
    "kitsuId" INTEGER,
    "kitsuEpisode" INTEGER,
    "imdbId" TEXT,
    "imdbSeason" INTEGER,
    "imdbEpisode" INTEGER
);
INSERT INTO "torrents" (
    "infoHash", "provider", "torrentId", "title", "size", "type",
    "uploadDate", "seeders", "trackers", "languages", "resolution"
)
SELECT
    md5(g.i::text),
    'YTS',
    'benchmark-' || g.i::text,
    'Benchmark Movie ' || g.i::text || ' 1080p WEB-DL x264',
    1500000000 + (g.i % 500000000),
    'movie',
    NOW() - ((g.i % 365)::text || ' days')::interval,
    (g.i % 500)::smallint,
    'udp://tracker.example:80/announce',
    'English',
    '1080p'
FROM generate_series(1, 250000) AS g(i);
INSERT INTO "files" (
    "infoHash", "fileIndex", "title", "size", "kitsuId", "kitsuEpisode",
    "imdbId", "imdbSeason", "imdbEpisode"
)
SELECT
    md5(g.i::text),
    0,
    'Benchmark Movie ' || g.i::text || ' 1080p WEB-DL x264.mkv',
    1500000000 + (g.i % 500000000),
    (g.i % 1000) + 1,
    NULL,
    'tt' || lpad((9000000 + ((g.i - 1) % 100))::text, 7, '0'),
    NULL,
    NULL
FROM generate_series(1, 250000) AS g(i);
CREATE INDEX "files_imdb_id_idx" ON "files" ("imdbId");
CREATE INDEX "files_kitsu_id_episode_idx" ON "files" ("kitsuId", "kitsuEpisode");
CREATE INDEX "files_info_hash_idx" ON "files" ("infoHash");
CREATE INDEX "torrents_info_hash_idx" ON "torrents" ("infoHash");
ANALYZE "torrents";
ANALYZE "files";
