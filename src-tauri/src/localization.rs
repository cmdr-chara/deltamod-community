// SPDX-FileCopyrightText: 2026 cmdr-chara
// SPDX-License-Identifier: EUPL-1.2
//! Trusted, compiled-in UI catalogs. Locale selection never supplies file paths,
//! translated command names, permissions or untrusted executable content.
use serde_json::Value;
use std::collections::BTreeMap;
use std::sync::{
    atomic::{AtomicUsize, Ordering},
    OnceLock,
};

const CODES: [&str; 17] = [
    "en", "it", "pl", "es", "fr", "de", "pt-br", "ja", "ru", "zh-CN", "zh-TW", "ko", "tr",
    "es-419", "uk", "th", "ar",
];
const SOURCES: [&str; 17] = [
    include_str!("../../web/langs/en/language.json"),
    include_str!("../../web/langs/it/language.json"),
    include_str!("../../web/langs/pl/language.json"),
    include_str!("../../web/langs/es/language.json"),
    include_str!("../../web/langs/fr/language.json"),
    include_str!("../../web/langs/de/language.json"),
    include_str!("../../web/langs/pt-br/language.json"),
    include_str!("../../web/langs/ja/language.json"),
    include_str!("../../web/langs/ru/language.json"),
    include_str!("../../web/langs/zh-CN/language.json"),
    include_str!("../../web/langs/zh-TW/language.json"),
    include_str!("../../web/langs/ko/language.json"),
    include_str!("../../web/langs/tr/language.json"),
    include_str!("../../web/langs/es-419/language.json"),
    include_str!("../../web/langs/uk/language.json"),
    include_str!("../../web/langs/th/language.json"),
    include_str!("../../web/langs/ar/language.json"),
];
static LANGUAGE: AtomicUsize = AtomicUsize::new(0);
static CATALOGS: [OnceLock<BTreeMap<String, Value>>; 17] = [const { OnceLock::new() }; 17];
static ENGLISH_KEYS: OnceLock<BTreeMap<&'static str, &'static str>> = OnceLock::new();

fn locale_index(code: &str) -> usize {
    if code.len() > 32 {
        return 0;
    }
    CODES
        .iter()
        .position(|entry| entry.eq_ignore_ascii_case(code))
        .unwrap_or(0)
}
pub fn set_language(code: &str) {
    LANGUAGE.store(locale_index(code), Ordering::Relaxed);
}
pub fn language() -> &'static str {
    CODES[LANGUAGE.load(Ordering::Relaxed)]
}
pub fn direction() -> &'static str {
    if language() == "ar" {
        "rtl"
    } else {
        "ltr"
    }
}
fn catalog(index: usize) -> &'static BTreeMap<String, Value> {
    CATALOGS[index].get_or_init(|| serde_json::from_str(SOURCES[index]).unwrap_or_default())
}
fn text_at(index: usize, source: &str) -> String {
    let keys = ENGLISH_KEYS.get_or_init(|| {
        let mut result = BTreeMap::new();
        for (key, value) in catalog(0) {
            if let Some(value) = value.as_str() {
                result.entry(value).or_insert(key.as_str());
            }
        }
        result
    });
    keys.get(source)
        .and_then(|key| catalog(index).get(*key))
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .unwrap_or(source)
        .to_owned()
}
pub fn text(source: &str) -> String {
    text_at(LANGUAGE.load(Ordering::Relaxed), source)
}
/// Interpolate once, never replace tokens introduced by an argument. Arguments
/// remain plain text; bidirectional isolation affects display only.
pub fn format(source: &str, arguments: &[&str]) -> String {
    let index = LANGUAGE.load(Ordering::Relaxed);
    interpolate(&text_at(index, source), arguments, CODES[index] == "ar")
}
fn interpolate(template: &str, arguments: &[&str], rtl: bool) -> String {
    let mut output = String::with_capacity(template.len());
    let mut remaining = template;
    while let Some(start) = remaining.find('{') {
        output.push_str(&remaining[..start]);
        remaining = &remaining[start..];
        if let Some(end) = remaining.find('}') {
            if let Ok(index) = remaining[1..end].parse::<usize>() {
                if let Some(argument) = arguments.get(index) {
                    if rtl {
                        output.push('\u{2068}');
                    }
                    output.push_str(argument);
                    if rtl {
                        output.push('\u{2069}');
                    }
                    remaining = &remaining[end + 1..];
                    continue;
                }
            }
        }
        output.push('{');
        remaining = &remaining[1..];
    }
    output.push_str(remaining);
    output
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn only_bundled_locale_names_are_accepted() {
        assert_eq!(locale_index("../../secrets"), 0);
        assert_eq!(locale_index("zh-cn"), 9);
        assert_eq!(locale_index("es-419"), 13);
        assert_eq!(locale_index("PT-BR"), 6);
    }
    #[test]
    fn literal_arguments_are_never_reinterpolated() {
        assert_eq!(
            interpolate("{0} / {1}", &["{1}", "雪/لعبة"], false),
            "{1} / 雪/لعبة"
        );
        assert_eq!(
            interpolate("ملف: {0}", &["C:/game/data.win"], true),
            "ملف: \u{2068}C:/game/data.win\u{2069}"
        );
        assert_eq!(interpolate("{9}", &[], false), "{9}");
    }
    #[test]
    fn native_catalogs_are_utf8_and_support_fallback() {
        for (index, code) in CODES.iter().enumerate() {
            assert!(!catalog(index).is_empty(), "{code}");
            assert_eq!(
                text_at(index, "UNRECOGNIZED_DIAGNOSTIC_ID"),
                "UNRECOGNIZED_DIAGNOSTIC_ID"
            );
        }
        assert_eq!(text_at(1, "Options"), "Opzioni");
    }
}
