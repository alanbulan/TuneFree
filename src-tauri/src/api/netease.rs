use crate::api::{ApiError, MusicProvider};
use aes::cipher::{generic_array::GenericArray, BlockEncrypt, KeyInit};
use aes::Aes128;
use async_trait::async_trait;
use reqwest::Client;
use serde_json::Value;

/// Performs AES-128-ECB encryption with PKCS#7 padding on the given data.
///
/// This is used to encrypt the request parameters for the Netease EAPI.
fn aes128_ecb_encrypt(data: &[u8], key: &[u8]) -> Vec<u8> {
    let cipher = Aes128::new(GenericArray::from_slice(key));
    let block_size = 16;
    let padding_len = block_size - (data.len() % block_size);
    let mut padded = data.to_vec();
    padded.extend(std::iter::repeat(padding_len as u8).take(padding_len));

    let mut encrypted = Vec::with_capacity(padded.len());
    for chunk in padded.chunks_exact(block_size) {
        let mut block = GenericArray::clone_from_slice(chunk);
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

    let req_path = "/api/song/enhance/player/url";
    let payload_str = serde_json::json!({
        "ids": format!("[{}]", songmid),
        "br": br,
    })
    .to_string();
    let hash_str = format!("nobody{}use{}md5forencrypt", req_path, payload_str);

    let md5_hash = format!("{:x}", md5::compute(hash_str.as_bytes()));
    let encrypt_target = format!(
        "{}-36cd479b6b5-{}-36cd479b6b5-{}",
        req_path, payload_str, md5_hash
    );

    let aes_key = b"e82ckenh8dichen8";
    let enc_bytes = aes128_ecb_encrypt(encrypt_target.as_bytes(), aes_key);

    // Hex string uppercase
    let params_hex: String = enc_bytes.iter().map(|b| format!("{:02X}", b)).collect();

    let api_url = "https://interface3.music.163.com/eapi/song/enhance/player/url";
    let body = format!("params={}", params_hex);

    let resp = client
        .post(api_url)
        .header("Content-Type", "application/x-www-form-urlencoded")
        .header("Cookie", "os=pc;")
        .body(body)
        .send()
        .await?;

    let data: Value = resp.json().await?;
    if let Some(url) = data["data"][0]["url"].as_str() {
        if !url.is_empty() {
            return Ok(url.to_string());
        }
    }

    Err(ApiError::VipContent)
}
