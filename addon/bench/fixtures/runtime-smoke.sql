-- Disposable integration-test schema only; mirrors the columns queried by repository.rs.
-- This is not a production migration or a replacement for Torrentio's shared database schema.
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
    "imdbId" TEXT,
    "imdbSeason" INTEGER,
    "imdbEpisode" INTEGER
);

INSERT INTO "torrents" (
    "infoHash", "provider", "torrentId", "title", "size", "type",
    "uploadDate", "seeders", "trackers", "languages", "resolution"
) VALUES (
    '0123456789abcdef0123456789abcdef01234567',
    'RuntimeSmokeFixture',
    'runtime-smoke-1',
    'Runtime Smoke Test 2024 1080p WEB-DL x264',
    1500000000,
    'movie',
    NOW(),
    42,
    'udp://tracker.example:80/announce',
    'English',
    '1080p'
);

INSERT INTO "files" (
    "infoHash", "fileIndex", "title", "size", "kitsuId", "imdbId", "imdbSeason", "imdbEpisode"
) VALUES (
    '0123456789abcdef0123456789abcdef01234567',
    0,
    'Runtime Smoke Test 2024 1080p WEB-DL x264.mkv',
    1500000000,
    NULL,
    'tt1234567',
    NULL,
    NULL
);
