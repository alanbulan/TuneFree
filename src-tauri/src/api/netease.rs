use crate::api::{ApiError, MusicProvider};
use aes::cipher::{Array, BlockCipherEncrypt, KeyInit};
use aes::Aes128;
use async_trait::async_trait;
use reqwest::Client;
use serde_json::Value;

/// AES-128-ECB key for EAPI request encryption.
///
/// This is a public protocol constant shipped in every Netease client, not an
/// application secret. It must be updated in lockstep if Netease changes the
/// EAPI protocol.
const EAPI_AES_KEY: &[u8; 16] = b"e82ckenh8dichen8";

/// Separator token placed between path, payload, and digest in the EAPI
/// plaintext. Public protocol constant; update if the upstream protocol changes.
const EAPI_SEPARATOR: &str = "36cd479b6b5";

/// EAPI request path, used both inside the signed digest and as the endpoint
/// suffix. Public protocol constant; update if the upstream protocol changes.
const EAPI_SONG_URL_PATH: &str = "/api/song/enhance/player/url";

/// Full EAPI endpoint for resolving playback URLs.
const EAPI_SONG_URL_ENDPOINT: &str =
    "https://interface3.music.163.com/eapi/song/enhance/player/url";

/// Performs AES-128-ECB encryption with PKCS#7 padding on the given data.
///
/// This is used to encrypt the request parameters for the Netease EAPI.
fn aes128_ecb_encrypt(data: &[u8], key: &[u8]) -> Vec<u8> {
    let cipher = Aes128::new_from_slice(key).expect("AES-128 key must be 16 bytes");
    let block_size = 16;
    let padding_len = block_size - (data.len() % block_size);
    let mut padded = data.to_vec();
    padded.extend(std::iter::repeat_n(padding_len as u8, padding_len));

    let mut encrypted = Vec::with_capacity(padded.len());
    for chunk in padded.chunks_exact(block_size) {
        let mut block = Array::from(<[u8; 16]>::try_from(chunk).expect("AES block is 16 bytes"));
        cipher.encrypt_block(&mut block);
        encrypted.extend_from_slice(&block);
    }
    encrypted
}

/// Unit-struct provider for the Netease Cloud Music platform.
pub struct NeteaseProvider;

#[async_trait]
impl MusicProvider for NeteaseProvider {
    fn platform(&self) -> &'static str {
        "netease"
    }

    async fn get_url(
        &self,
        client: &reqwest::Client,
        id: &str,
        quality: &str,
    ) -> Result<String, ApiError> {
        get_netease_url(client, id, quality).await
    }
}

/// Extracts and validates the playback URL from an EAPI response body.
///
/// Netease returns an empty or missing URL for VIP/region-locked songs.
/// Non-http(s) schemes are rejected so the value is safe to hand to media
/// elements, matching the QQ and Kuwo providers.
fn parse_netease_url(data: &Value) -> Result<String, ApiError> {
    let url_str = data["data"][0]["url"]
        .as_str()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or(ApiError::VipContent)?;

    let url = reqwest::Url::parse(url_str)
        .map_err(|e| ApiError::Parse(format!("Netease returned an invalid audio URL: {e}")))?;
    if !matches!(url.scheme(), "http" | "https") {
        return Err(ApiError::Parse(
            "Netease returned an unsupported audio URL scheme".to_string(),
        ));
    }

    Ok(url.to_string())
}

/// Resolves a playable audio URL from Netease Cloud Music.
///
/// Uses the EAPI (encrypted API) endpoint with AES-128-ECB encryption
/// to obtain a direct stream URL for the given song.
///
/// # Arguments
/// * `client` - Shared HTTP client.
/// * `songmid` - The Netease song ID.
/// * `quality` - "128k", "320k", or "flac" (defaults to 128k).
///
/// # Returns
/// Direct audio URL on success, or `ApiError::VipContent` if the song
/// is VIP/copyright-protected.
pub async fn get_netease_url(
    client: &Client,
    songmid: &str,
    quality: &str,
) -> Result<String, ApiError> {
    let br = match quality {
        "128k" => 128000,
        "320k" => 320000,
        "flac" => 999000,
        _ => 128000,
    };

    let payload_str = format!(r#"{{"ids":"[{}]","br":{}}}"#, songmid, br);
    let hash_str = format!(
        "nobody{}use{}md5forencrypt",
        EAPI_SONG_URL_PATH, payload_str
    );

    let md5_hash = format!("{:x}", md5::compute(hash_str.as_bytes()));
    let encrypt_target = format!(
        "{path}-{sep}-{payload}-{sep}-{digest}",
        path = EAPI_SONG_URL_PATH,
        sep = EAPI_SEPARATOR,
        payload = payload_str,
        digest = md5_hash
    );

    let enc_bytes = aes128_ecb_encrypt(encrypt_target.as_bytes(), EAPI_AES_KEY);

    // Hex string uppercase
    let params_hex: String = enc_bytes.iter().map(|b| format!("{:02X}", b)).collect();

    let body = format!("params={}", params_hex);

    let resp = client
        .post(EAPI_SONG_URL_ENDPOINT)
        .header("Content-Type", "application/x-www-form-urlencoded")
        .header("Cookie", "os=pc;")
        .body(body)
        .send()
        .await?
        .error_for_status()?;

    let data: Value = resp.json().await?;
    parse_netease_url(&data)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_valid_https_url() {
        let data = serde_json::json!({
            "data": [{ "url": "https://m701.music.126.net/song.mp3?vuutv=abc" }]
        });

        assert_eq!(
            parse_netease_url(&data).unwrap(),
            "https://m701.music.126.net/song.mp3?vuutv=abc"
        );
    }

    #[test]
    fn empty_or_missing_url_is_vip_content() {
        let empty = serde_json::json!({ "data": [{ "url": "" }] });
        assert!(matches!(
            parse_netease_url(&empty),
            Err(ApiError::VipContent)
        ));

        let missing = serde_json::json!({ "data": [{}] });
        assert!(matches!(
            parse_netease_url(&missing),
            Err(ApiError::VipContent)
        ));
    }

    #[test]
    fn rejects_unsupported_scheme() {
        let data = serde_json::json!({ "data": [{ "url": "file:///C:/Windows/system.ini" }] });

        assert!(matches!(parse_netease_url(&data), Err(ApiError::Parse(_))));
    }

    #[test]
    fn rejects_every_non_http_scheme() {
        for url in [
            "file:///C:/Windows/system.ini",
            "javascript:alert(1)",
            "data:audio/mpeg;base64,AAAA",
            "ftp://example.com/song.mp3",
            "tauri://localhost/song.mp3",
        ] {
            let data = serde_json::json!({ "data": [{ "url": url }] });
            assert!(
                matches!(parse_netease_url(&data), Err(ApiError::Parse(_))),
                "{url} 必须被拒绝"
            );
        }
    }

    #[test]
    fn rejects_unparsable_url() {
        let data = serde_json::json!({ "data": [{ "url": "not a url" }] });

        assert!(matches!(parse_netease_url(&data), Err(ApiError::Parse(_))));
        // 协议相对地址没有 scheme，无法交给媒体元素，必须拒绝而不是"补全"。
        let relative = serde_json::json!({ "data": [{ "url": "//m701.music.126.net/a.mp3" }] });
        assert!(matches!(
            parse_netease_url(&relative),
            Err(ApiError::Parse(_))
        ));
    }

    #[test]
    fn malformed_payload_shapes_are_treated_as_vip_content() {
        for body in [
            serde_json::json!({}),
            serde_json::json!({ "data": [] }),
            serde_json::json!({ "data": null }),
            serde_json::json!({ "data": "unexpected" }),
            serde_json::json!({ "data": [{ "url": "   " }] }),
            serde_json::json!({ "data": [{ "url": 12345 }] }),
        ] {
            assert!(
                matches!(parse_netease_url(&body), Err(ApiError::VipContent)),
                "{body} 应视为无可用地址"
            );
        }
    }

    #[test]
    fn trims_surrounding_whitespace_before_validating() {
        let data = serde_json::json!({
            "data": [{ "url": "  https://m701.music.126.net/song.mp3  " }]
        });

        assert_eq!(
            parse_netease_url(&data).unwrap(),
            "https://m701.music.126.net/song.mp3"
        );
    }

    #[test]
    fn eapi_encryption_is_block_aligned_and_deterministic() {
        // PKCS#7: 完整块也要补一整块，否则解密方无法区分填充。
        assert_eq!(
            aes128_ecb_encrypt(b"0123456789abcdef", EAPI_AES_KEY).len(),
            32
        );
        assert_eq!(aes128_ecb_encrypt(b"short", EAPI_AES_KEY).len(), 16);

        let repeated = aes128_ecb_encrypt(b"0123456789abcdef0123456789abcdef", EAPI_AES_KEY);
        assert_eq!(repeated.len(), 48);
        // ECB 的固有性质：相同明文块产生相同密文块。
        assert_eq!(repeated[..16], repeated[16..32]);
        assert_eq!(
            aes128_ecb_encrypt(b"stable", EAPI_AES_KEY),
            aes128_ecb_encrypt(b"stable", EAPI_AES_KEY)
        );
    }

    #[test]
    fn provider_reports_its_platform_id() {
        assert_eq!(NeteaseProvider.platform(), "netease");
    }

    /// 上游 4xx/5xx 走 `error_for_status()?`，必须变成 `ApiError::Network`
    /// 而不是被当作"无可用地址"的 VIP 结果。请求只打到本地测试监听器。
    #[tokio::test]
    async fn upstream_error_statuses_become_network_errors() {
        for status in ["404 Not Found", "500 Internal Server Error"] {
            let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
            let address = listener.local_addr().unwrap();
            let status_line = status.to_string();
            tokio::spawn(async move {
                let (mut socket, _) = listener.accept().await.unwrap();
                let mut request = [0_u8; 1024];
                let _ = tokio::io::AsyncReadExt::read(&mut socket, &mut request).await;
                let response = format!(
                    "HTTP/1.1 {status_line}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
                );
                let _ = tokio::io::AsyncWriteExt::write_all(&mut socket, response.as_bytes()).await;
            });

            let outcome: Result<(), ApiError> = async {
                Client::builder()
                    .no_proxy()
                    .build()?
                    .get(format!("http://{address}/eapi"))
                    .send()
                    .await?
                    .error_for_status()?;
                Ok(())
            }
            .await;

            assert!(
                matches!(outcome, Err(ApiError::Network(_))),
                "{status} 应映射为网络错误"
            );
        }
    }
}
