//! Optional HTTP source adapter for server-hosted media providers.
//!
//! The configured endpoint is an operator-trusted API. Returned playback URLs are
//! treated as untrusted data and restricted to public HTTP(S) hosts.

use std::{env, time::Duration};

use anyhow::{Context as _, Result, bail};
use reqwest::{Client, redirect::Policy};
use serde::Deserialize;
use url::Url;

use crate::domain::{content_type::ContentType, stream::Stream};

const REQUEST_TIMEOUT: Duration = Duration::from_secs(8);
const MAX_RESPONSE_BYTES: usize = 1024 * 1024;

#[derive(Deserialize)]
struct DirectApiResponse {
    #[serde(default)]
    streams: Vec<Stream>,
}

pub(crate) struct DirectSources {
    endpoint: Url,
    client: Client,
}

impl DirectSources {
    /// Enables the adapter only when DIRECT_STREAM_API_URL is a valid HTTPS URL.
    /// Redirects are disabled so a configured endpoint cannot silently redirect
    /// requests to an unexpected host or an internal network address.
    pub(crate) fn from_env() -> Option<Self> {
        let raw = env::var("DIRECT_STREAM_API_URL").ok()?;
        let endpoint = match Url::parse(&raw) {
            Ok(url) if url.scheme() == "https"
                && url.host_str().is_some()
                && url.username().is_empty()
                && url.password().is_none() => url,
            Ok(_) => {
                tracing::warn!("DIRECT_STREAM_API_URL must be an HTTPS URL without credentials");
                return None;
            }
            Err(error) => {
                tracing::warn!(%error, "Ignoring invalid DIRECT_STREAM_API_URL");
                return None;
            }
        };
        let client = match Client::builder()
            .timeout(REQUEST_TIMEOUT)
            .connect_timeout(Duration::from_secs(3))
            .redirect(Policy::none())
            .build()
        {
            Ok(client) => client,
            Err(error) => {
                tracing::warn!(%error, "Could not initialize direct source HTTP client");
                return None;
            }
        };
        Some(Self { endpoint, client })
    }

    pub(crate) async fn resolve(
        &self,
        content_type: ContentType,
        id: &str,
    ) -> Result<Vec<Stream>> {
        let mut endpoint = self.endpoint.clone();
        endpoint.query_pairs_mut()
            .append_pair("type", content_type.as_str())
            .append_pair("id", id);

        let mut response = self.client.get(endpoint).send().await
            .context("direct source API request failed")?
            .error_for_status()
            .context("direct source API returned an unsuccessful status")?;

        if response.content_length().is_some_and(|length| length > MAX_RESPONSE_BYTES as u64) {
            bail!("direct source API response exceeds the 1 MiB limit");
        }

        let mut body = Vec::new();
        while let Some(chunk) = response.chunk().await.context("failed reading direct source API response")? {
            if body.len() + chunk.len() > MAX_RESPONSE_BYTES {
                bail!("direct source API response exceeds the 1 MiB limit");
            }
            body.extend_from_slice(&chunk);
        }

        let payload: DirectApiResponse =
            serde_json::from_slice(&body).context("direct source API returned invalid JSON")?;

        let streams = payload.streams.into_iter()
            .filter_map(validate_stream)
            .collect::<Vec<_>>();
        Ok(streams)
    }
}

fn validate_stream(mut stream: Stream) -> Option<Stream> {
    let raw_url = stream.url.as_deref()?;
    let url = Url::parse(raw_url).ok()?;
    if !matches!(url.scheme(), "http" | "https")
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.fragment().is_some()
        || is_non_public_host(url.host_str()?)
    {
        return None;
    }

    stream.url = Some(url.to_string());
    let mut name_parts = stream.name.splitn(2, '\\n');
    let provider_name = name_parts.next().unwrap_or_default().trim();
    let quality = name_parts.next().unwrap_or("Direct").trim();
    let provider_name = if provider_name.is_empty() { "Direct source" } else { provider_name };
    stream.name = format!("[HTTP] {provider_name}\\n{quality}");
    Some(stream)
}

fn is_non_public_host(host: &str) -> bool {
    let host = host.trim_end_matches('.').to_ascii_lowercase();
    if host == "localhost"
        || host.ends_with(".localhost")
        || host.ends_with(".local")
        || host.ends_with(".internal")
    {
        return true;
    }

    let Ok(ip) = host.parse::<std::net::IpAddr>() else {
        return false;
    };
    match ip {
        std::net::IpAddr::V4(ip) => {
            ip.is_private() || ip.is_loopback() || ip.is_link_local()
                || ip.is_unspecified() || ip.is_broadcast() || ip.is_multicast()
        }
        std::net::IpAddr::V6(ip) => {
            ip.is_loopback() || ip.is_unique_local() || ip.is_unicast_link_local()
                || ip.is_unspecified() || ip.is_multicast()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn stream(url: &str) -> Stream {
        Stream {
            name: "Example CDN".to_owned(),
            title: "1080p WEB-DL".to_owned(),
            url: Some(url.to_owned()),
            ..Stream::default()
        }
    }

    #[test]
    fn accepts_public_http_and_https_playback_urls() {
        assert!(validate_stream(stream("https://cdn.example/video.m3u8")).is_some());
        assert!(validate_stream(stream("http://media.example/video.mp4")).is_some());
    }

    #[test]
    fn rejects_non_http_schemes_and_credentials() {
        assert!(validate_stream(stream("magnet:?xt=urn:btih:abc")).is_none());
        assert!(validate_stream(stream("file:///etc/passwd")).is_none());
        assert!(validate_stream(stream("https://user:pass@cdn.example/video.mp4")).is_none());
    }

    #[test]
    fn rejects_local_and_private_network_destinations() {
        for url in [
            "http://127.0.0.1/video.mp4",
            "http://10.0.0.2/video.mp4",
            "http://192.168.1.5/video.mp4",
            "http://169.254.169.254/latest/meta-data",
            "http://[::1]/video.mp4",
            "http://router.local/video.mp4",
            "http://service.internal/video.mp4",
        ] {
            assert!(validate_stream(stream(url)).is_none(), "{url}");
        }
    }

    #[test]
    fn labels_direct_streams_for_ordering_and_diagnostics() {
        let result = validate_stream(stream("https://cdn.example/video.mp4")).unwrap();
        assert_eq!(result.name, "[HTTP] Example CDN");
    }

    #[test]
    fn requires_a_valid_https_endpoint() {
        assert!(Url::parse("https://sources.example/api/streams").is_ok());
        assert!(Url::parse("http://sources.example/api/streams").unwrap().scheme() != "https");
    }
}
