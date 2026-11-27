use async_trait::async_trait;

use crate::domain::{
    models::{FileRow, Record, TorrentRow},
    repository::TorrentRepository,
};

/// A no-op repository used by direct-only deployments that do not need torrent records.
#[derive(Default)]
pub struct EmptyRepository;

#[async_trait]
impl TorrentRepository for EmptyRepository {
    async fn torrent(&self, _info_hash: &str) -> anyhow::Result<Option<TorrentRow>> {
        Ok(None)
    }

    async fn files(&self, _info_hashes: &[String]) -> anyhow::Result<Vec<FileRow>> {
        Ok(Vec::new())
    }

    async fn imdb_movie_entries(&self, _imdb_id: &str) -> anyhow::Result<Vec<Record>> {
        Ok(Vec::new())
    }

    async fn imdb_series_entries(&self, _imdb_id: &str, _season: i32, _episode: i32) -> anyhow::Result<Vec<Record>> {
        Ok(Vec::new())
    }

    async fn kitsu_movie_entries(&self, _kitsu_id: i32) -> anyhow::Result<Vec<Record>> {
        Ok(Vec::new())
    }

    async fn kitsu_series_entries(&self, _kitsu_id: i32, _episode: i32) -> anyhow::Result<Vec<Record>> {
        Ok(Vec::new())
    }
}
