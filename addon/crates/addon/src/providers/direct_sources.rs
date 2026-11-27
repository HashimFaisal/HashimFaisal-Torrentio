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
    api_key: Option<String>,
}

impl DirectSources {
    /// Enables the adapter only when `DIRECT_STREAM_API_URL` is a valid HTTPS URL.
    /// Redirects are disabled so a configured endpoint cannot silently redirect
    /// requests to an unexpected host or an internal network address.
    pub(crate) fn from_env() -> Option<Self> {
        let raw = env::var("DIRECT_STREAM_API_URL").ok()?;
        let endpoint = match Url::parse(&raw) {
            Ok(url)
                if url.scheme() == "https"
                    && url.host_str().is_some()
                    && url.username().is_empty()
                    && url.password().is_none()
                    && !is_non_public_host(url.host_str().unwrap_or_default()) =>
            {
                url
            }
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
        let api_key = env::var("DIRECT_STREAM_API_KEY")
            .ok()
            .map(|value| value.trim().to_owned())
            .filter(|value| !value.is_empty());
        Some(Self { endpoint, client, api_key })
    }

    pub(crate) async fn resolve(&self, content_type: ContentType, id: &str) -> Result<Vec<Stream>> {
        let mut endpoint = self.endpoint.clone();
        endpoint
            .query_pairs_mut()
            .append_pair("type", content_type.as_str())
            .append_pair("id", id);

        let mut request = self.client.get(endpoint);
        if let Some(api_key) = &self.api_key {
            request = request.bearer_auth(api_key);
        }
        let mut response = request
            .send()
            .await
            .context("direct source API request failed")?
            .error_for_status()
            .context("direct source API returned an unsuccessful status")?;

        if response
            .content_length()
            .is_some_and(|length| length > MAX_RESPONSE_BYTES as u64)
        {
            bail!("direct source API response exceeds the 1 MiB limit");
        }

        let mut body = Vec::new();
        while let Some(chunk) = response
            .chunk()
            .await
            .context("failed reading direct source API response")?
        {
            if body.len() + chunk.len() > MAX_RESPONSE_BYTES {
                bail!("direct source API response exceeds the 1 MiB limit");
            }
            body.extend_from_slice(&chunk);
        }

        let payload: DirectApiResponse =
            serde_json::from_slice(&body).context("direct source API returned invalid JSON")?;

        let allow_http = env::var("DIRECT_STREAM_ALLOW_HTTP")
            .is_ok_and(|value| matches!(value.to_ascii_lowercase().as_str(), "1" | "true" | "yes"));
        let streams = payload
            .streams
            .into_iter()
            .filter_map(|stream| validate_stream(stream, allow_http))
            .take(20)
            .collect::<Vec<_>>();
        Ok(streams)
    }
}

fn validate_stream(mut stream: Stream, allow_http: bool) -> Option<Stream> {
    let raw_url = stream.url.as_deref()?;
    let url = Url::parse(raw_url).ok()?;
    if (url.scheme() != "https" && !(allow_http && url.scheme() == "http"))
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.fragment().is_some()
        || is_non_public_host(url.host_str()?)
    {
        return None;
    }

    stream.url = Some(url.to_string());
    let mut name_parts = stream.name.splitn(2, '\n');
    let provider_name = name_parts.next().unwrap_or_default().trim();
    let quality = name_parts.next().unwrap_or("Direct").trim();
    let provider_name = if provider_name.is_empty() {
        "Direct source"
    } else {
        provider_name
    };
    stream.name = format!("[HTTP] {provider_name}\n{quality}");
    Some(stream)
}

fn is_non_public_host(host: &str) -> bool {
    let host = host.trim_end_matches('.').to_ascii_lowercase();
    if host == "localhost"
        || host.ends_with(".localhost")
        || host.rsplit_once('.').is_some_and(|(_, suffix)| suffix == "local")
        || host.ends_with(".internal")
    {
        return true;
    }

    let Ok(ip) = host.parse::<std::net::IpAddr>() else {
        return false;
    };
    match ip {
        std::net::IpAddr::V4(ip) => {
            ip.is_private()
                || ip.is_loopback()
                || ip.is_link_local()
                || ip.is_unspecified()
                || ip.is_broadcast()
                || ip.is_multicast()
        }
        std::net::IpAddr::V6(ip) => {
            ip.is_loopback()
                || ip.is_unique_local()
                || ip.is_unicast_link_local()
                || ip.is_unspecified()
                || ip.is_multicast()
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
    fn accepts_https_and_requires_opt_in_for_http() {
        assert!(validate_stream(stream("https://cdn.example/video.m3u8"), false).is_some());
        assert!(validate_stream(stream("http://media.example/video.mp4"), false).is_none());
        assert!(validate_stream(stream("http://media.example/video.mp4"), true).is_some());
    }

    #[test]
    fn rejects_non_http_schemes_and_credentials() {
        assert!(validate_stream(stream("magnet:?xt=urn:btih:abc"), true).is_none());
        assert!(validate_stream(stream("file:///etc/passwd"), true).is_none());
        assert!(validate_stream(stream("https://user:pass@cdn.example/video.mp4"), true).is_none());
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
            assert!(validate_stream(stream(url), true).is_none(), "{url}");
        }
    }

    #[test]
    fn labels_direct_streams_for_ordering_and_diagnostics() {
        let result = validate_stream(stream("https://cdn.example/video.mp4"), false).unwrap();
        assert_eq!(result.name, "[HTTP] Example CDN\nDirect");
    }

    #[tokio::test]
    async fn requests_the_configured_api_with_identifier_and_optional_bearer_key() {
        use wiremock::{
            matchers::{header, method, path, query_param},
            Mock, MockServer, ResponseTemplate,
        };

        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/streams"))
            .and(query_param("type", "movie"))
            .and(query_param("id", "tt1234567"))
            .and(header("authorization", "Bearer test-secret"))
            .respond_with(ResponseTemplate::new(200).set_body_raw(
                r#"{"streams":[{"name":"Licensed CDN\n1080p","title":"Sample feature","url":"https://cdn.example/video.m3u8"}]}"#,
                "application/json",
            ))
            .expect(1)
            .mount(&server)
            .await;

        let provider = DirectSources {
            endpoint: Url::parse(&format!("{}/streams", server.uri())).unwrap(),
            client: Client::builder().redirect(Policy::none()).build().unwrap(),
            api_key: Some("test-secret".to_owned()),
        };
        let streams = provider.resolve(ContentType::Movie, "tt1234567").await.unwrap();
        assert_eq!(streams.len(), 1);
        assert_eq!(streams[0].url.as_deref(), Some("https://cdn.example/video.m3u8"));
    }

    #[tokio::test]
    async fn rejects_oversized_api_responses() {
        use wiremock::{
            matchers::{method, path},
            Mock, MockServer, ResponseTemplate,
        };

        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/streams"))
            .respond_with(
                ResponseTemplate::new(200).set_body_string("x".repeat(MAX_RESPONSE_BYTES + 1)),
            )
            .mount(&server)
            .await;
        let provider = DirectSources {
            endpoint: Url::parse(&format!("{}/streams", server.uri())).unwrap(),
            client: Client::builder().redirect(Policy::none()).build().unwrap(),
            api_key: None,
        };
        assert!(provider.resolve(ContentType::Movie, "tt1234567").await.is_err());
    }

    #[test]
    fn requires_a_valid_https_endpoint() {
        assert!(Url::parse("https://sources.example/api/streams").is_ok());
        assert!(Url::parse("http://sources.example/api/streams").unwrap().scheme() != "https");
    }

    #[test]
    fn parses_stremio_compatible_direct_api_payload() {
        let payload: DirectApiResponse = serde_json::from_str(
            r#"{"streams":[{"name":"Example CDN\n1080p","title":"Movie.2024.1080p.WEB-DL","url":"https://cdn.example/movie.m3u8"}]}"#,
        )
        .unwrap();
        let result = validate_stream(payload.streams.into_iter().next().unwrap(), false).unwrap();
        assert_eq!(result.name, "[HTTP] Example CDN\n1080p");
        assert_eq!(result.url.as_deref(), Some("https://cdn.example/movie.m3u8"));
    }
}
