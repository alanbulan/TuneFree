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

/// 校验与实际连接使用同一批 DNS 结果，避免预检后再次解析造成重绑定绕过。
pub(crate) struct PublicDnsResolver;

impl Resolve for PublicDnsResolver {
    fn resolve(&self, name: Name) -> Resolving {
        Box::pin(async move {
            let addresses = tokio::net::lookup_host((name.as_str(), 0)).await?.collect();
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

    #[tokio::test]
    async fn actual_dns_resolution_rejects_loopback() {
        assert!(PublicDnsResolver
            .resolve("localhost".parse().unwrap())
            .await
            .is_err());
    }
}
