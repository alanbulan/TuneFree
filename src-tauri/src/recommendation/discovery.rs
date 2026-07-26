mod fetch;
mod parse;

use reqwest::Client;

use super::{catalog, llm::DiscoverySearchQuery, model::RecSong, privacy};

#[derive(Debug, Clone)]
pub struct DiscoveredSong {
    pub song: RecSong,
    pub reason: String,
}

pub async fn discover_songs(
    client: Client,
    queries: Vec<DiscoverySearchQuery>,
    per_source_limit: usize,
    max_total: usize,
) -> Vec<DiscoveredSong> {
    let mut songs = Vec::new();
    let mut seen = std::collections::HashSet::new();

    let handles: Vec<_> = discovery_targets(queries)
        .into_iter()
        .enumerate()
        .map(|(order, target)| {
            let client = client.clone();
            tokio::spawn(async move {
                let found = fetch::search_source(
                    &client,
                    target.source,
                    &target.query.keyword,
                    per_source_limit,
                )
                .await;
                (order, target.query.reason, found)
            })
        })
        .collect();

    let mut batches = Vec::with_capacity(handles.len());
    for handle in handles {
        if let Ok(batch) = handle.await {
            batches.push(batch);
        }
    }
    batches.sort_by_key(|(order, _, _)| *order);

    for (_, reason, found) in batches {
        for song in found {
            let identity = format!(
                "{}:{}",
                catalog::normalize_text(&song.name),
                catalog::normalize_text(&song.artist)
            );
            if identity.trim_matches(':').is_empty() || !seen.insert(identity) {
                continue;
            }
            songs.push(DiscoveredSong {
                song,
                reason: reason.clone(),
            });
            if songs.len() >= max_total {
                return songs;
            }
        }
    }

    songs
}

#[derive(Debug, Clone)]
struct DiscoverySearchTarget {
    query: DiscoverySearchQuery,
    source: &'static str,
}

fn discovery_targets(queries: Vec<DiscoverySearchQuery>) -> Vec<DiscoverySearchTarget> {
    queries
        .into_iter()
        .flat_map(|query| {
            discovery_sources(&query.source)
                .iter()
                .map(move |source| DiscoverySearchTarget {
                    query: query.clone(),
                    source,
                })
        })
        .collect()
}

fn discovery_sources(source: &str) -> &'static [&'static str] {
    match source {
        "netease" => &["netease"],
        "qq" => &["qq"],
        "kuwo" => &["kuwo"],
        _ => &["netease", "qq", "kuwo"],
    }
}

pub fn discovery_reason(input: &str) -> String {
    privacy::short_reason(input)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn query(source: &str) -> DiscoverySearchQuery {
        DiscoverySearchQuery {
            keyword: "测试".to_string(),
            source: source.to_string(),
            reason: "测试原因".to_string(),
        }
    }

    #[test]
    fn expands_all_source_to_supported_platforms() {
        let targets = discovery_targets(vec![query("all")]);
        let sources: Vec<_> = targets.into_iter().map(|target| target.source).collect();

        assert_eq!(sources, vec!["netease", "qq", "kuwo"]);
    }

    #[test]
    fn keeps_single_source_queries_targeted() {
        let targets = discovery_targets(vec![query("qq"), query("kuwo")]);
        let sources: Vec<_> = targets.into_iter().map(|target| target.source).collect();

        assert_eq!(sources, vec!["qq", "kuwo"]);
    }
}
