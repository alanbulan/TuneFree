use aes::cipher::{generic_array::GenericArray, BlockEncrypt, KeyInit};
use aes::Aes128;
use reqwest::Client;
use serde_json::Value;
use std::error::Error;

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

pub async fn get_netease_url(client: &Client, songmid: &str, quality: &str) -> Result<String, Box<dyn Error + Send + Sync>> {
    let br = match quality {
        "128k" => 128000,
        "320k" => 320000,
        "flac" => 999000,
        _ => 128000,
    };

    let req_path = "/api/song/enhance/player/url";
    let payload_str = format!(r#"{{"ids":"[{}]","br":{}}}"#, songmid, br);
    let hash_str = format!("nobody{}use{}md5forencrypt", req_path, payload_str);
    
    let md5_hash = format!("{:x}", md5::compute(hash_str.as_bytes()));
    let encrypt_target = format!("{}-36cd479b6b5-{}-36cd479b6b5-{}", req_path, payload_str, md5_hash);
    
    let aes_key = b"e82ckenh8dichen8";
    let enc_bytes = aes128_ecb_encrypt(encrypt_target.as_bytes(), aes_key);
    
    // Hex string uppercase
    let params_hex: String = enc_bytes.iter().map(|b| format!("{:02X}", b)).collect();

    let api_url = "https://interface3.music.163.com/eapi/song/enhance/player/url";
    let body = format!("params={}", params_hex);

    let resp = client.post(api_url)
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

    Err("Netease returned empty URL (VIP/Copyright)".into())
}
