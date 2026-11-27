use std::borrow::Cow;

pub fn extract_seeders(title: &str) -> u64 {
    title
        .match_indices("👤 ")
        .find_map(|(index, marker)| {
            let start = index + marker.len();
            let digits = title[start..].bytes().take_while(u8::is_ascii_digit).count();
            (digits > 0).then(|| title[start..start + digits].parse().unwrap_or(0))
        })
        .unwrap_or(0)
}

pub fn extract_size(title: &str) -> u64 {
    title
        .match_indices("💾 ")
        .find_map(|(index, marker)| {
            let start = index + marker.len();
            let bytes = title.as_bytes();
            let number_len = bytes[start..].iter().take_while(|byte| byte.is_ascii_digit() || **byte == b'.').count();
            if number_len == 0 || bytes.get(start + number_len) != Some(&b' ') {
                return None;
            }
            let unit_start = start + number_len + 1;
            let unit_len =
                bytes[unit_start..].iter().take_while(|byte| byte.is_ascii_alphanumeric() || **byte == b'_').count();
            (unit_len > 0).then(|| parse_size(&title[start..unit_start + unit_len]))
        })
        .unwrap_or(0)
}

pub fn extract_provider(title: &str) -> Option<&str> {
    title.split('\n').find_map(|line| {
        let marker = line.find('⚙')?;
        let (_, provider) = line[marker..].rsplit_once(' ')?;
        (!provider.is_empty()).then_some(provider)
    })
}

pub fn parse_size(text: &str) -> u64 {
    if text.is_empty() {
        return 0;
    }
    let scale: f64 = if text.contains("TB") {
        1024.0 * 1024.0 * 1024.0 * 1024.0
    } else if text.contains("GB") {
        1024.0 * 1024.0 * 1024.0
    } else if text.contains("MB") {
        1024.0 * 1024.0
    } else if text.contains("kB") {
        1024.0
    } else {
        1.0
    };
    let number = if text.contains(',') { Cow::Owned(text.replace(',', "")) } else { Cow::Borrowed(text) };
    (parse_float_prefix(&number) * scale).floor() as u64
}

fn parse_float_prefix(text: &str) -> f64 {
    let end = text
        .char_indices()
        .take_while(|(index, character)| {
            character.is_ascii_digit() || *character == '.' || (*index == 0 && *character == '-')
        })
        .last()
        .map_or(0, |(index, character)| index + character.len_utf8());
    text[..end].parse().unwrap_or(0.0)
}

#[cfg(test)]
mod tests {
    use super::*;

    const TITLE: &str = "Some.Release.1080p\n👤 12 💾 1.5 GB ⚙️ ThePirateBay\n🇬🇧";

    #[test]
    fn extracts_seeders() {
        assert_eq!(extract_seeders(TITLE), 12);
        assert_eq!(extract_seeders("no seeders"), 0);
    }

    #[test]
    fn extracts_size() {
        assert_eq!(extract_size(TITLE), 1_610_612_736);
        assert_eq!(extract_size("none"), 0);
    }

    #[test]
    fn extracts_provider() {
        assert_eq!(extract_provider(TITLE), Some("ThePirateBay"));
        assert_eq!(extract_provider("none"), None);
        assert_eq!(extract_provider("⚙️ first provider\n⚙️ second-provider"), Some("provider"));
        assert_eq!(extract_provider("⚙️ provider with suffix"), Some("suffix"));
        assert_eq!(extract_provider("⚙️"), None);
    }

    #[test]
    fn extractors_preserve_first_regex_match_semantics() {
        assert_eq!(extract_seeders("👤 17 then 👤 4"), 17);
        assert_eq!(extract_seeders("👤 x then 👤 4"), 4);
        assert_eq!(extract_seeders("👤 999999999999999999999999"), 0);
        assert_eq!(extract_size("💾 1.5 GB then 💾 2 GB"), 1_610_612_736);
        assert_eq!(extract_size("💾 bad then 💾 2 GB"), 2_147_483_648);
        assert_eq!(extract_size("💾 1.5-GB"), 0);
        assert_eq!(extract_size("💾 1.5 GB_extra"), 1_610_612_736);
    }

    #[test]
    fn parses_sizes() {
        assert_eq!(parse_size("2 kB"), 2048);
        assert_eq!(parse_size("1,5 MB"), 15_728_640);
        assert_eq!(parse_size(""), 0);
    }
}
