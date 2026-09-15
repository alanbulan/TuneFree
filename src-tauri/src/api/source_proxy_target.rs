use reqwest::dns::{Addrs, Name, Resolve, Resolving};
use reqwest::Url;
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr};
use url::Host;

fn is_global_v4(address: Ipv4Addr) -> bool {
    let [first, second, third, _] = address.octets();
    !(address.is_private()
        || address.is_loopback()
        || address.is_link_local()
        || address.is_broadcast()
        || address.is_documentation()
        || address.is_unspecified()
        || address.is_multicast()
        || first == 0
        || (first == 100 && (64..128).contains(&second))
        || (first == 192 && second == 0 && third == 0)
        || (first == 198 && (second == 18 || second == 19))
        || first >= 240)
}

fn is_global_v6(address: Ipv6Addr) -> bool {
    if let Some(mapped) = address.to_ipv4_mapped() {
        return is_global_v4(mapped);
    }
    let [first, second, third, ..] = address.segments();
    // 只接受当前分配的全局单播段，排除本地、兼容、组播及保留段。
    if first & 0xe000 != 0x2000
        || (first == 0x2001 && (second < 0x0200 || second == 0x0db8))
        || (first == 0x3fff && second & 0xf000 == 0)
    {
        return false;
    }
    // 6to4 地址包含 IPv4 目标，同样不能指向内网。
    first != 0x2002
        || is_global_v4(Ipv4Addr::new(
            (second >> 8) as u8,
            second as u8,
            (third >> 8) as u8,
            third as u8,
        ))
}

fn is_public_address(address: IpAddr) -> bool {
    match address {
        IpAddr::V4(address) => is_global_v4(address),
        IpAddr::V6(address) => is_global_v6(address),
    }
}

/// URL 与每一跳重定向的初筛；域名的实际连接地址由 PublicDnsResolver 校验。
pub(crate) fn is_public_target(url: &Url) -> bool {
    if !matches!(url.scheme(), "http" | "https") {
        return false;
    }
    let Some(host) = url.host_str() else {
        return false;
    };
    let normalized = host.trim_end_matches('.').to_ascii_lowercase();
    if normalized == "localhost"
        || normalized.ends_with(".localhost")
        || normalized.ends_with(".local")
    {
        return false;
    }
    match url.host() {
        Some(Host::Ipv4(address)) => is_global_v4(address),
        Some(Host::Ipv6(address)) => is_global_v6(address),
        Some(Host::Domain(_)) => true,
        None => false,
    }
}

fn public_addresses(addresses: Vec<SocketAddr>) -> std::io::Result<Addrs> {
    if addresses.is_empty()
        || addresses
            .iter()
            .any(|address| !is_public_address(address.ip()))
    {
        return Err(std::io::Error::new(
            std::io::ErrorKind::PermissionDenied,
            "source proxy DNS target is not public",
        ));
    }
    Ok(Box::new(addresses.into_iter()))
}

fn is_fake_ip(address: IpAddr) -> bool {
    let address = match address {
        IpAddr::V4(address) => Some(address),
        IpAddr::V6(address) => address.to_ipv4_mapped(),
    };
    address.is_some_and(|address| {
        let [first, second, _, _] = address.octets();
        first == 198 && (second == 18 || second == 19)
    })
}

fn needs_public_dns(addresses: &[SocketAddr]) -> bool {
    addresses.iter().any(|address| is_fake_ip(address.ip()))
        && addresses
            .iter()
            .all(|address| is_fake_ip(address.ip()) || is_public_address(address.ip()))
}

async fn query_public_dns(
    client: &reqwest::Client,
    endpoint: &str,
    name: &str,
) -> Result<Addrs, Box<dyn std::error::Error + Send + Sync>> {
    let mut addresses = Vec::new();
    for record_type in ["A", "AAAA"] {
        let response = client
            .get(endpoint)
            .query(&[("name", name), ("type", record_type)])
            .header("accept", "application/dns-json")
            .send()
            .await?
            .error_for_status()?
            .json::<serde_json::Value>()
            .await?;
        if response["Status"].as_u64() != Some(0) {
            return Err(std::io::Error::new(
                std::io::ErrorKind::NotFound,
                "public DNS could not resolve source host",
            )
            .into());
        }
        for answer in response["Answer"].as_array().into_iter().flatten() {
            if !matches!(answer["type"].as_u64(), Some(1 | 28)) {
                continue;
            }
            if let Some(address) = answer["data"]
                .as_str()
                .and_then(|value| value.parse::<IpAddr>().ok())
            {
                addresses.push(SocketAddr::new(address, 0));
            }
        }
    }
    Ok(public_addresses(addresses)?)
}

/// 校验与实际连接使用同一批 DNS 结果，避免预检后再次解析造成重绑定绕过。
/// 代理的 Fake-IP 不能作为公网地址放行；仅对此类结果通过固定 DoH 服务获取真实地址。
pub(crate) struct PublicDnsResolver {
    dns_client: reqwest::Client,
}

impl Default for PublicDnsResolver {
    fn default() -> Self {
        Self {
            dns_client: reqwest::Client::builder()
                .no_proxy()
                .redirect(reqwest::redirect::Policy::none())
                .timeout(std::time::Duration::from_secs(5))
                .build()
                .expect("Failed to build public DNS client"),
        }
    }
}

impl Resolve for PublicDnsResolver {
    fn resolve(&self, name: Name) -> Resolving {
        let client = self.dns_client.clone();
        Box::pin(async move {
            let addresses: Vec<_> = tokio::net::lookup_host((name.as_str(), 0)).await?.collect();
            if needs_public_dns(&addresses) {
                return query_public_dns(&client, "https://dns.alidns.com/resolve", name.as_str())
                    .await;
            }
            Ok(public_addresses(addresses)?)
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dns_results_reject_private_and_mixed_address_sets() {
        let public = "8.8.8.8:0".parse().unwrap();
        for address in [
            "127.0.0.1:0",
            "192.168.1.1:0",
            "169.254.169.254:0",
            "[::ffff:127.0.0.1]:0",
            "[::127.0.0.1]:0",
            "[fec0::1]:0",
            "[2002:7f00:1::]:0",
        ] {
            let private = address.parse().unwrap();
            assert!(public_addresses(vec![private]).is_err(), "{address}");
            assert!(
                public_addresses(vec![public, private]).is_err(),
                "{address}"
            );
        }
        assert!(public_addresses(Vec::new()).is_err());
        let addresses: Vec<_> = public_addresses(vec![public]).unwrap().collect();
        assert_eq!(addresses, vec![public]);
    }

    #[test]
    fn only_fake_ip_results_use_public_dns_and_private_targets_stay_blocked() {
        let fake = "198.18.2.15:0".parse().unwrap();
        let public = "8.8.8.8:0".parse().unwrap();
        let private = "192.168.1.1:0".parse().unwrap();
        assert!(needs_public_dns(&[fake]));
        assert!(needs_public_dns(&[fake, public]));
        assert!(!needs_public_dns(&[public]));
        assert!(!needs_public_dns(&[fake, private]));
        assert!(!needs_public_dns(&[private]));
        assert!(!needs_public_dns(&[]));
        assert!(public_addresses(vec![fake]).is_err());
    }

    #[tokio::test]
    async fn public_dns_answers_are_validated_before_they_can_be_connected() {
        use axum::{routing::get, Json, Router};
        use parking_lot::Mutex;
        use serde_json::json;
        use std::sync::Arc;

        let payload = Arc::new(Mutex::new(json!({
            "Status": 0,
            "Answer": [{"type": 1, "data": "8.8.8.8"}, {"type": 5, "data": "alias.test"}],
        })));
        let handler_payload = payload.clone();
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let endpoint = format!("http://{}/resolve", listener.local_addr().unwrap());
        let app = Router::new().route(
            "/resolve",
            get(move || {
                let value = handler_payload.lock().clone();
                async move { Json(value) }
            }),
        );
        let task = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        let client = reqwest::Client::builder().no_proxy().build().unwrap();
        let addresses: Vec<_> = query_public_dns(&client, &endpoint, "music.test")
            .await
            .unwrap()
            .collect();
        assert!(addresses
            .iter()
            .all(|address| address.ip().to_string() == "8.8.8.8"));
        assert!(!addresses.is_empty());
        for invalid in [
            json!({"Status": 3}),
            json!({"Status": 0, "Answer": []}),
            json!({"Status": 0, "Answer": [{"type": 1, "data": "not-an-ip"}]}),
            json!({"Status": 0, "Answer": [{"type": 1, "data": "198.18.2.15"}]}),
            json!({"Status": 0, "Answer": [{"type": 1, "data": "8.8.8.8"}, {"type": 1, "data": "127.0.0.1"}]}),
        ] {
            *payload.lock() = invalid;
            assert!(query_public_dns(&client, &endpoint, "music.test")
                .await
                .is_err());
        }
        task.abort();
    }

    #[tokio::test]
    async fn actual_dns_resolution_rejects_loopback() {
        assert!(PublicDnsResolver::default()
            .resolve("localhost".parse().unwrap())
            .await
            .is_err());
    }
}
