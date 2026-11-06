mod fetch;
mod parse;

use reqwest::Client;
use tokio::task::JoinSet;

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

    // JoinSet 随父 future 释放时中止子任务，取消推荐后不会留下后台网络请求。
    let mut searches = JoinSet::new();
    for (order, target) in discovery_targets(queries).into_iter().enumerate() {
        let client = client.clone();
        searches.spawn(async move {
            let found = fetch::search_source(
                &client,
                target.source,
                &target.query.keyword,
                per_source_limit,
            )
            .await;
            (order, target.query.reason, found)
        });
    }

    let mut batches = Vec::with_capacity(searches.len());
    while let Some(result) = searches.join_next().await {
        if let Ok(batch) = result {
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

    pub(super) async fn assert_pending_requests_cancelled<F, Fut>(host: &str, operation: F)
    where
        F: FnOnce(Client) -> Fut,
        Fut: std::future::Future<Output = ()> + Send + 'static,
    {
        use tokio::io::AsyncReadExt;
        use tokio::time::{timeout, Duration};
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let client = Client::builder()
            .no_proxy()
            .resolve(host, listener.local_addr().unwrap())
            .timeout(Duration::from_secs(5))
            .build()
            .unwrap();
        let parent = tokio::spawn(operation(client));
        let mut sockets = Vec::new();
        for _ in 0..2 {
            let (mut socket, _) = timeout(Duration::from_secs(2), listener.accept())
                .await
                .unwrap()
                .unwrap();
            // 暂停在 TLS 握手阶段，确保两个真实网络请求都已开始。
            let mut hello = [0; 4096];
            assert!(
                timeout(Duration::from_secs(2), socket.read(&mut hello))
                    .await
                    .unwrap()
                    .unwrap()
                    > 0
            );
            sockets.push(socket);
        }
        parent.abort();
        assert!(parent.await.unwrap_err().is_cancelled());
        for mut socket in sockets {
            let result = timeout(
                Duration::from_millis(500),
                socket.read_to_end(&mut Vec::new()),
            )
            .await;
            assert!(result.is_ok(), "取消父任务后，子请求仍保持网络连接");
        }
    }

    #[tokio::test]
    async fn cancelling_discovery_closes_all_pending_search_connections() {
        assert_pending_requests_cancelled("music.163.com", |client| async move {
            let _ = discover_songs(client, vec![query("netease"), query("netease")], 3, 6).await;
        })
        .await;
    }

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
