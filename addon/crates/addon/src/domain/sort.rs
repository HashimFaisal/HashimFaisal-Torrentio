use std::{cmp::Ordering, collections::HashMap};

use crate::{
    domain::config::Config,
    domain::filter::Quality,
    domain::languages,
    domain::stream::Stream,
    domain::title_helper::{extract_seeders, extract_size},
    providers,
};

pub const SORT_KEY: &str = "sort";

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum SortOrder {
    #[default]
    QualitySeeders,
    QualitySize,
    Seeders,
    Size,
}

impl SortOrder {
    pub fn parse(value: &str) -> Self {
        match value.to_lowercase().as_str() {
            "seeders" => Self::Seeders,
            "size" => Self::Size,
            "qualitysize" => Self::QualitySize,
            _ => Self::QualitySeeders,
        }
    }

    fn limit_bucket(self, stream: &Stream) -> String {
        match self {
            Self::QualitySeeders | Self::QualitySize => extract_quality(&stream.name),
            Self::Seeders | Self::Size => String::new(),
        }
    }

    pub fn key(self) -> &'static str {
        match self {
            Self::QualitySeeders => "quality",
            Self::QualitySize => "qualitysize",
            Self::Seeders => "seeders",
            Self::Size => "size",
        }
    }
}

pub struct SortOption {
    pub key: &'static str,
    pub description: &'static str,
}

pub const SORT_OPTIONS: &[SortOption] = &[
    SortOption { key: "quality", description: "By quality then seeders" },
    SortOption { key: "qualitysize", description: "By quality then size" },
    SortOption { key: "seeders", description: "By seeders" },
    SortOption { key: "size", description: "By size" },
];

pub fn sort_streams(streams: Vec<Stream>, config: &Config) -> Vec<Stream> {
    let preferences = config.preferences();
    let languages = Some(preferences.languages.as_slice())
        .filter(|languages| languages.first().is_some_and(|first| first != "english"));
    let Some(languages) = languages else {
        return apply_limit(sort_group(streams, config), config);
    };
    let (with_language, without_language): (Vec<Stream>, Vec<Stream>) =
        streams.into_iter().partition(|stream| languages::contains_language(&stream.title, languages));
    let mut sorted = sort_group(with_language, config);
    sorted.extend(sort_group(without_language, config));
    apply_limit(sorted, config)
}

fn sort_group(streams: Vec<Stream>, config: &Config) -> Vec<Stream> {
    let sorted = filter_by_seeders(streams, config);
    match config.preferences().sort {
        SortOrder::Seeders => sorted,
        SortOrder::Size => sort_by_size(sorted),
        SortOrder::QualitySize => sort_by_quality(sorted, true),
        SortOrder::QualitySeeders => sort_by_quality(sorted, false),
    }
}

fn apply_limit(streams: Vec<Stream>, config: &Config) -> Vec<Stream> {
    let preferences = config.preferences();
    let Some(limit) = preferences.limit else {
        return streams;
    };
    let mut counts: HashMap<String, usize> = HashMap::new();
    streams
        .into_iter()
        .filter(|stream| {
            let count = counts.entry(preferences.sort.limit_bucket(stream)).or_default();
            *count += 1;
            *count <= limit
        })
        .collect()
}

fn filter_by_seeders(streams: Vec<Stream>, config: &Config) -> Vec<Stream> {
    let minimum = config.preferences().min_seeders;
    if minimum == 0 || providers::has_moch_configured(config) {
        return streams;
    }
    streams.into_iter().filter(|stream| extract_seeders(&stream.title) >= minimum).collect()
}

fn sort_by_size(streams: Vec<Stream>) -> Vec<Stream> {
    let mut keyed: Vec<(u64, Stream)> =
        streams.into_iter().map(|stream| (extract_size(&stream.title), stream)).collect();
    keyed.sort_by_key(|entry| std::cmp::Reverse(entry.0));
    keyed.into_iter().map(|(_, stream)| stream).collect()
}

fn sort_by_seeders(streams: Vec<Stream>) -> Vec<Stream> {
    let mut keyed: Vec<(u64, Stream)> =
        streams.into_iter().map(|stream| (extract_seeders(&stream.title), stream)).collect();
    keyed.sort_by_key(|entry| std::cmp::Reverse(entry.0));
    keyed.into_iter().map(|(_, stream)| stream).collect()
}

fn sort_by_quality(streams: Vec<Stream>, nested_by_size: bool) -> Vec<Stream> {
    let mut groups: Vec<Vec<Stream>> = Vec::new();
    let mut group_indices: HashMap<String, usize> = HashMap::new();
    for stream in streams {
        let quality = extract_quality(&stream.name);
        let index = *group_indices.entry(quality).or_insert_with(|| {
            groups.push(Vec::new());
            groups.len() - 1
        });
        groups[index].push(stream);
    }
    let mut order: Vec<(String, usize)> = group_indices.into_iter().collect();
    order.sort_by(|(a, a_index), (b, b_index)| compare_qualities(a, b).then_with(|| a_index.cmp(b_index)));
    order
        .into_iter()
        .flat_map(|(_, index)| {
            let members = std::mem::take(&mut groups[index]);
            if nested_by_size { sort_by_size(members) } else { sort_by_seeders(members) }
        })
        .collect()
}

fn resolution_of(quality: &str) -> Option<u32> {
    let digits_len = quality.bytes().take_while(u8::is_ascii_digit).count();
    if digits_len == 0 || !quality.as_bytes().windows(2).any(|pair| pair[0].is_ascii_digit() && pair[1] == b'p') {
        return None;
    }
    quality[..digits_len].parse().ok().filter(|value| *value != 0)
}

fn compare_qualities(a: &str, b: &str) -> Ordering {
    match (resolution_of(a), resolution_of(b)) {
        (Some(a), Some(b)) => b.cmp(&a),
        (Some(_), None) => Ordering::Less,
        (None, Some(_)) => Ordering::Greater,
        (None, None) => compare_utf16(a, b),
    }
}

fn compare_utf16(a: &str, b: &str) -> Ordering {
    a.encode_utf16().cmp(b.encode_utf16())
}

fn extract_quality(name: &str) -> String {
    let Some(description) = name.split('\n').nth(1) else {
        return "undefined".to_owned();
    };
    let has_hdr = description.contains("HDR") || description.contains("DV");
    if let Some(found) = find_resolution(description) {
        with_hdr_score(found, has_hdr)
    } else if contains_ascii_case_insensitive(description, b"8k") {
        with_hdr_score("4320p", has_hdr)
    } else if contains_ascii_case_insensitive(description, b"4k")
        || contains_ascii_case_insensitive(description, b"uhd")
    {
        with_hdr_score("2060p", has_hdr)
    } else if Quality::Cam.matches(Some(description), None) {
        Quality::Cam.label().to_owned()
    } else if Quality::Other.matches(Some(description), None) {
        Quality::Other.label().to_owned()
    } else {
        description.to_owned()
    }
}

fn find_resolution(description: &str) -> Option<&str> {
    let bytes = description.as_bytes();
    let mut index = 0;
    while index < bytes.len() {
        if !bytes[index].is_ascii_digit() {
            index += 1;
            continue;
        }
        let start = index;
        while index < bytes.len() && bytes[index].is_ascii_digit() {
            index += 1;
        }
        if index < bytes.len() && bytes[index] == b'p' {
            return description.get(start..=index);
        }
    }
    None
}

fn contains_ascii_case_insensitive(value: &str, needle: &[u8]) -> bool {
    value.as_bytes().windows(needle.len()).any(|window| window.eq_ignore_ascii_case(needle))
}

fn with_hdr_score(resolution: &str, has_hdr: bool) -> String {
    if has_hdr && resolution.ends_with("0p") {
        let mut scored = resolution.to_owned();
        let zero_index = scored.len() - 2;
        scored.replace_range(zero_index..=zero_index, "1");
        scored
    } else {
        resolution.to_owned()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn stream(name: &str, title: &str) -> Stream {
        Stream { name: name.to_owned(), title: title.to_owned(), ..Stream::default() }
    }

    #[test]
    fn extracts_quality_buckets() {
        assert_eq!(extract_quality("Torrentio\n1080p"), "1080p");
        assert_eq!(extract_quality("Torrentio\n1080p HDR"), "1081p");
        assert_eq!(extract_quality("Torrentio\n4k"), "2060p");
        assert_eq!(extract_quality("Torrentio\nBluRay"), Quality::Other.label());
        assert_eq!(extract_quality("Torrentio\nCAM"), Quality::Cam.label());
    }

    #[test]
    fn resolution_parser_handles_numeric_buckets_without_allocating() {
        assert_eq!(resolution_of("1080p"), Some(1080));
        assert_eq!(resolution_of("4320p"), Some(4320));
        assert_eq!(resolution_of("0p"), None);
        assert_eq!(resolution_of("undefined"), None);
        assert_eq!(resolution_of("1080foo720p"), Some(1080));
        assert_eq!(resolution_of("foo1080p"), None);
        assert_eq!(resolution_of("1080foo p"), None);
    }

    #[test]
    fn higher_resolution_sorts_first() {
        let config = Config::parse("");
        let streams = vec![
            stream("T\n720p", "a\n👤 9 ⚙️ x"),
            stream("T\n1080p", "b\n👤 9 ⚙️ x"),
            stream("T\n4k", "c\n👤 9 ⚙️ x"),
        ];
        let names: Vec<String> = sort_streams(streams, &config).into_iter().map(|stream| stream.title).collect();
        assert_eq!(names, vec!["c\n👤 9 ⚙️ x", "b\n👤 9 ⚙️ x", "a\n👤 9 ⚙️ x"]);
    }

    #[test]
    fn quality_groups_sort_by_seeders_descending_and_keep_ties_stable() {
        let config = Config::parse("");
        let streams = vec![
            stream("T\n1080p", "few\n👤 4"),
            stream("T\n1080p", "many\n👤 40"),
            stream("T\n1080p", "tie-first\n👤 40"),
            stream("T\n720p", "lower\n👤 100"),
        ];
        let titles: Vec<String> = sort_streams(streams, &config).into_iter().map(|stream| stream.title).collect();
        assert_eq!(titles, vec!["many\n👤 40", "tie-first\n👤 40", "few\n👤 4", "lower\n👤 100"]);
    }

    #[test]
    fn quality_size_sort_still_uses_file_size_within_quality() {
        let config = Config::parse("sort=qualitysize");
        let streams = vec![
            stream("T\n1080p", "small\n💾 700 MB"),
            stream("T\n1080p", "large\n💾 4.2 GB"),
            stream("T\n720p", "lower\n💾 20 GB"),
        ];
        let titles: Vec<String> = sort_streams(streams, &config).into_iter().map(|stream| stream.title).collect();
        assert_eq!(titles, vec!["large\n💾 4.2 GB", "small\n💾 700 MB", "lower\n💾 20 GB"]);
    }

    #[test]
    fn limit_applies_per_quality() {
        let config = Config::parse("limit=1");
        let streams = vec![stream("T\n1080p", "a\n👤 9"), stream("T\n1080p", "b\n👤 9"), stream("T\n720p", "c\n👤 9")];
        assert_eq!(sort_streams(streams, &config).len(), 2);
    }

    #[test]
    fn limit_applies_per_quality_across_language_groups() {
        let config = Config::parse("language=portuguese|limit=2");
        let streams = vec![
            stream("T\n1080p", "a\n👤 9\n🇵🇹"),
            stream("T\n1080p", "b\n👤 9"),
            stream("T\n1080p", "c\n👤 9"),
            stream("T\n720p", "d\n👤 9"),
            stream("T\n720p", "e\n👤 9\n🇵🇹"),
            stream("T\n720p", "f\n👤 9\n🇵🇹"),
        ];
        let titles: Vec<String> = sort_streams(streams, &config).into_iter().map(|stream| stream.title).collect();
        assert_eq!(titles.len(), 4);
        assert!(titles[0].starts_with('a') && titles[1].starts_with('e') && titles[2].starts_with('f'));
    }

    #[test]
    fn low_seeder_streams_are_kept_by_default() {
        let config = Config::parse("");
        let streams: Vec<Stream> = (0..10).map(|index| stream("T\n720p", &format!("{index}\n👤 0"))).collect();
        assert_eq!(sort_streams(streams, &config).len(), 10);
    }

    #[test]
    fn min_seeders_hides_streams_below_the_minimum() {
        let config = Config::parse("minseeders=5");
        let streams = vec![stream("T\n720p", "a\n👤 5"), stream("T\n720p", "b\n👤 4"), stream("T\n720p", "c\n👤 0")];
        assert_eq!(sort_streams(streams, &config).len(), 1);
    }

    #[test]
    fn min_seeders_applies_before_language_priority_and_limit() {
        let config = Config::parse("language=portuguese|minseeders=5|limit=1");
        let streams = vec![
            stream("T\n1080p", "a\n👤 2\n🇵🇹"),
            stream("T\n1080p", "b\n👤 9\n🇵🇹"),
            stream("T\n1080p", "c\n👤 9"),
            stream("T\n720p", "d\n👤 0"),
            stream("T\n720p", "e\n👤 9"),
        ];
        let titles: Vec<String> = sort_streams(streams, &config).into_iter().map(|stream| stream.title).collect();
        assert_eq!(titles.len(), 2);
        assert!(titles[0].starts_with('b') && titles[1].starts_with('e'));
    }

    #[test]
    fn min_seeders_is_ignored_with_a_debrid_key() {
        let config = Config::parse("realdebrid=abcdefghijklmnopqrstuvwxyz|minseeders=5");
        let streams = vec![stream("T\n720p", "a\n👤 5"), stream("T\n720p", "b\n👤 0")];
        assert_eq!(sort_streams(streams, &config).len(), 2);
    }
}
