use crate::api::{ApiError, MusicProvider};
use async_trait::async_trait;
use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
use reqwest::Client;

/// Compression permutation table (64 entries) for the Kuwo block cipher.
///
/// Derived from the Kuwo mobile client's encryption routine. Each entry
/// maps a bit position in the input to a bit position in the output.
/// Negative values (-1) indicate unused positions.
const C0: [i64; 64] = [
    0x1f, 0x0, 0x1, 0x2, 0x3, 0x4, -0x1, -0x1, 0x3, 0x4, 0x5, 0x6, 0x7, 0x8, -0x1, -0x1, 0x7, 0x8,
    0x9, 0xa, 0xb, 0xc, -0x1, -0x1, 0xb, 0xc, 0xd, 0xe, 0xf, 0x10, -0x1, -0x1, 0xf, 0x10, 0x11,
    0x12, 0x13, 0x14, -0x1, -0x1, 0x13, 0x14, 0x15, 0x16, 0x17, 0x18, -0x1, -0x1, 0x17, 0x18, 0x19,
    0x1a, 0x1b, 0x1c, -0x1, -0x1, 0x1b, 0x1c, 0x1d, 0x1e, 0x1f, 0x1e, -0x1, -0x1,
];

/// Initial permutation table (64 entries) applied to the plaintext block
/// before the Feistel rounds begin.
const C1: [i64; 64] = [
    0x39, 0x31, 0x29, 0x21, 0x19, 0x11, 0x9, 0x1, 0x3b, 0x33, 0x2b, 0x23, 0x1b, 0x13, 0xb, 0x3,
    0x3d, 0x35, 0x2d, 0x25, 0x1d, 0x15, 0xd, 0x5, 0x3f, 0x37, 0x2f, 0x27, 0x1f, 0x17, 0xf, 0x7,
    0x38, 0x30, 0x28, 0x20, 0x18, 0x10, 0x8, 0x0, 0x3a, 0x32, 0x2a, 0x22, 0x1a, 0x12, 0xa, 0x2,
    0x3c, 0x34, 0x2c, 0x24, 0x1c, 0x14, 0xc, 0x4, 0x3e, 0x36, 0x2e, 0x26, 0x1e, 0x16, 0xe, 0x6,
];

/// Final permutation table (64 entries) applied after the Feistel rounds
/// to produce the ciphertext block.
const C2: [i64; 64] = [
    0x27, 0x7, 0x2f, 0xf, 0x37, 0x17, 0x3f, 0x1f, 0x26, 0x6, 0x2e, 0xe, 0x36, 0x16, 0x3e, 0x1e,
    0x25, 0x5, 0x2d, 0xd, 0x35, 0x15, 0x3d, 0x1d, 0x24, 0x4, 0x2c, 0xc, 0x34, 0x14, 0x3c, 0x1c,
    0x23, 0x3, 0x2b, 0xb, 0x33, 0x13, 0x3b, 0x1b, 0x22, 0x2, 0x2a, 0xa, 0x32, 0x12, 0x3a, 0x1a,
    0x21, 0x1, 0x29, 0x9, 0x31, 0x11, 0x39, 0x19, 0x20, 0x0, 0x28, 0x8, 0x30, 0x10, 0x38, 0x18,
];

/// Shift amounts for each of the 16 key-schedule rounds.
const C3: [usize; 16] = [1, 1, 2, 2, 2, 2, 2, 2, 1, 2, 2, 2, 2, 2, 2, 1];

/// Mask values used during key-schedule rotation (left/right split).
const C4: [u64; 3] = [0x0, 0x100001, 0x300003];

/// Permutation table applied to the S-box output within each Feistel round.
const P: [i64; 32] = [
    0xf, 0x6, 0x13, 0x14, 0x1c, 0xb, 0x1b, 0x10, 0x0, 0xe, 0x16, 0x19, 0x4, 0x11, 0x1e, 0x9, 0x1,
    0x7, 0x17, 0xd, 0x1f, 0x1a, 0x2, 0x8, 0x12, 0xc, 0x1d, 0x5, 0x15, 0xa, 0x3, 0x18,
];

/// Permutation table (56 entries) applied to the key during key-schedule
/// initialization.
const Q: [i64; 56] = [
    0x38, 0x30, 0x28, 0x20, 0x18, 0x10, 0x8, 0x0, 0x39, 0x31, 0x29, 0x21, 0x19, 0x11, 0x9, 0x1,
    0x3a, 0x32, 0x2a, 0x22, 0x1a, 0x12, 0xa, 0x2, 0x3b, 0x33, 0x2b, 0x23, 0x3e, 0x36, 0x2e, 0x26,
    0x1e, 0x16, 0xe, 0x6, 0x3d, 0x35, 0x2d, 0x25, 0x1d, 0x15, 0xd, 0x5, 0x3c, 0x34, 0x2c, 0x24,
    0x1c, 0x14, 0xc, 0x4, 0x1b, 0x13, 0xb, 0x3,
];

/// Compression table (64 entries) applied to the rotated key value
/// to produce each round sub-key.
const S: [i64; 64] = [
    0xd, 0x10, 0xa, 0x17, 0x0, 0x4, -0x1, -0x1, 0x2, 0x1b, 0xe, 0x5, 0x14, 0x9, -0x1, -0x1, 0x16,
    0x12, 0xb, 0x3, 0x19, 0x7, -0x1, -0x1, 0xf, 0x6, 0x1a, 0x13, 0xc, 0x1, -0x1, -0x1, 0x28, 0x33,
    0x1e, 0x24, 0x2e, 0x36, -0x1, -0x1, 0x1d, 0x27, 0x32, 0x2c, 0x20, 0x2f, -0x1, -0x1, 0x2b, 0x30,
    0x26, 0x37, 0x21, 0x34, -0x1, -0x1, 0x2d, 0x29, 0x31, 0x23, 0x1c, 0x1f, -0x1, -0x1,
];

/// Eight S-boxes (each 64 entries) used in the Feistel round function.
/// These are the substitution tables that provide non-linearity.
const SBOX: [[u8; 64]; 8] = [
    [
        14, 4, 3, 15, 2, 13, 5, 3, 13, 14, 6, 9, 11, 2, 0, 5, 4, 1, 10, 12, 15, 6, 9, 10, 1, 8,
        12, 7, 8, 11, 7, 0, 0, 15, 10, 5, 14, 4, 9, 10, 7, 8, 12, 3, 13, 1, 3, 6, 15, 12, 6, 11,
        2, 9, 5, 0, 4, 2, 11, 14, 1, 7, 8, 13,
    ],
    [
        15, 0, 9, 5, 6, 10, 12, 9, 8, 7, 2, 12, 3, 13, 5, 2, 1, 14, 7, 8, 11, 4, 0, 3, 14, 11,
        13, 6, 4, 1, 10, 15, 3, 13, 12, 11, 15, 3, 6, 0, 4, 10, 1, 7, 8, 4, 11, 14, 13, 8, 0, 6,
        2, 15, 9, 5, 7, 1, 10, 12, 14, 2, 5, 9,
    ],
    [
        10, 13, 1, 11, 6, 8, 11, 5, 9, 4, 12, 2, 15, 3, 2, 14, 0, 6, 13, 1, 3, 15, 4, 10, 14, 9,
        7, 12, 5, 0, 8, 7, 13, 1, 2, 4, 3, 6, 12, 11, 0, 13, 5, 14, 6, 8, 15, 2, 7, 10, 8, 15, 4,
        9, 11, 5, 9, 0, 14, 3, 10, 7, 1, 12,
    ],
    [
        7, 10, 1, 15, 0, 12, 11, 5, 14, 9, 8, 3, 9, 7, 4, 8, 13, 6, 2, 1, 6, 11, 12, 2, 3, 0, 5,
        14, 10, 13, 15, 4, 13, 3, 4, 9, 6, 10, 1, 12, 11, 0, 2, 5, 0, 13, 14, 2, 8, 15, 7, 4, 15,
        1, 10, 7, 5, 6, 12, 11, 3, 8, 9, 14,
    ],
    [
        2, 4, 8, 15, 7, 10, 13, 6, 4, 1, 3, 12, 11, 7, 14, 0, 12, 2, 5, 9, 10, 13, 0, 3, 1, 11,
        15, 5, 6, 8, 9, 14, 14, 11, 5, 6, 4, 1, 3, 10, 2, 12, 15, 0, 13, 2, 8, 5, 11, 8, 0, 15, 7,
        14, 9, 4, 12, 7, 10, 9, 1, 13, 6, 3,
    ],
    [
        12, 9, 0, 7, 9, 2, 14, 1, 10, 15, 3, 4, 6, 12, 5, 11, 1, 14, 13, 0, 2, 8, 7, 13, 15, 5, 4,
        10, 8, 3, 11, 6, 10, 4, 6, 11, 7, 9, 0, 6, 4, 2, 13, 1, 9, 15, 3, 8, 15, 3, 1, 14, 12, 5,
        11, 0, 2, 12, 14, 7, 5, 10, 8, 13,
    ],
    [
        4, 1, 3, 10, 15, 12, 5, 0, 2, 11, 9, 6, 8, 7, 6, 9, 11, 4, 12, 15, 0, 3, 10, 5, 14, 13,
        7, 8, 13, 14, 1, 2, 13, 6, 14, 9, 4, 1, 2, 14, 11, 13, 5, 0, 1, 10, 8, 3, 0, 11, 3, 5, 9,
        4, 15, 2, 7, 8, 12, 15, 10, 7, 6, 12,
    ],
    [
        13, 7, 10, 0, 6, 9, 5, 15, 8, 4, 3, 10, 11, 14, 12, 5, 2, 11, 9, 6, 15, 12, 0, 3, 4, 1,
        14, 13, 1, 2, 7, 8, 1, 2, 12, 15, 10, 4, 0, 3, 13, 14, 6, 9, 7, 8, 9, 6, 15, 1, 5, 12, 3,
        10, 14, 5, 8, 7, 11, 0, 4, 13, 2, 11,
    ],
];

/// Applies a bit-permutation defined by `arr` to the 64-bit value `val`.
///
/// For each position `i` in `arr`, if `arr[i]` is non-negative, the bit at
/// position `arr[i]` in `val` is placed at position `i` in the result.
fn apply_mask(arr: &[i64], len: usize, val: u64) -> u64 {
    let mut res = 0u64;
    for (i, mask_idx) in arr.iter().copied().take(len).enumerate() {
        if mask_idx < 0 {
            continue;
        }
        let mask = 1u64 << mask_idx;
        if (val & mask) != 0 {
            res |= 1u64 << i;
        }
    }
    res
}

/// Encrypts a single 64-bit data block using 16 Feistel rounds
/// with the given sub-key array.
fn encrypt_block(key_arr: &[u64], data: u64) -> u64 {
    let res = apply_mask(&C1, 64, data);
    let mut blocks = [res & 0xffffffff, (res >> 32) & 0xffffffff];

    for key in key_arr.iter().take(16) {
        let right_block = apply_mask(&C0, 64, blocks[1]) ^ *key;
        let mut sbox_out = 0u64;
        for j in (0..=7).rev() {
            let b = ((right_block >> (j * 8)) & 0xff) as usize;
            sbox_out <<= 4;
            sbox_out |= SBOX[j][b] as u64;
        }
        let right_block_p = apply_mask(&P, 32, sbox_out);

        let temp = blocks[0];
        blocks[0] = blocks[1];
        blocks[1] = temp ^ right_block_p;
    }

    blocks.reverse();
    let res_combined = ((blocks[1] << 32) & 0xffffffff00000000) | (blocks[0] & 0xffffffff);
    apply_mask(&C2, 64, res_combined)
}

/// Derives 16 round sub-keys from the 64-bit master key using
/// the key-schedule permutation and rotation tables.
fn prepare_key(key: u64, key_arr: &mut [u64]) {
    let mut key_val = apply_mask(&Q, 56, key);
    for i in 0..16 {
        let c3_i = C3[i] as u32;
        let c4_val = C4[C3[i] % 3]; // Prevent out-of-bounds
        let part1 = (key_val & c4_val) << (0x1c - c3_i);
        let part2 = (key_val & !c4_val) >> c3_i;
        key_val = part1 | part2;
        key_arr[i] = apply_mask(&S, 64, key_val);
    }
}

/// Encrypts arbitrary-length text using the Kuwo block cipher (DES-like).
///
/// The text is split into 8-byte blocks, each encrypted independently.
/// A final partial block is padded and encrypted separately.
///
/// # Arguments
/// * `text` - Plaintext to encrypt (ASCII string).
/// * `key_str` - 8-byte key string (typically "ylzsxkwm").
///
/// # Returns
/// The concatenated ciphertext bytes.
pub fn kuwo_encrypt(text: &str, key_str: &str) -> Vec<u8> {
    let mut key_int = 0u64;
    let key_bytes = key_str.as_bytes();
    for i in 0..8 {
        if i < key_bytes.len() {
            key_int |= (key_bytes[i] as u64) << (i * 8);
        }
    }

    let block_count = text.len() / 8;
    let mut key_arr = [0u64; 16];
    prepare_key(key_int, &mut key_arr);

    let text_bytes = text.as_bytes();
    let mut data_blocks = vec![0u64; block_count];
    for i in 0..block_count {
        for j in 0..8 {
            data_blocks[i] |= (text_bytes[j + i * 8] as u64) << (j * 8);
        }
    }

    let cipher_len = block_count + 1;
    let mut cipher_blocks = vec![0u64; cipher_len];
    for i in 0..block_count {
        cipher_blocks[i] = encrypt_block(&key_arr, data_blocks[i]);
    }

    let remaining_len = text.len() % 8;
    let mut last_block = 0u64;
    for i in 0..remaining_len {
        last_block |= (text_bytes[block_count * 8 + i] as u64) << (i * 8);
    }
    cipher_blocks[block_count] = encrypt_block(&key_arr, last_block);

    let mut res_arr = vec![0u8; 8 * cipher_blocks.len()];
    let mut idx = 0;
    for block in cipher_blocks {
        for i in 0..8 {
            res_arr[idx] = ((block >> (i * 8)) & 0xff) as u8;
            idx += 1;
        }
    }

    res_arr
}

/// Unit-struct provider for the Kuwo Music platform.
pub struct KuwoProvider;

#[async_trait]
impl MusicProvider for KuwoProvider {
    fn platform(&self) -> &'static str {
        "kuwo"
    }

    async fn get_url(
        &self,
        client: &reqwest::Client,
        id: &str,
        quality: &str,
    ) -> Result<String, ApiError> {
        get_kuwo_url(client, id, quality).await
    }
}

fn parse_kuwo_url(body: &str) -> Result<String, ApiError> {
    if body.lines().any(|line| line.trim() == "bitrate=1") {
        return Err(ApiError::VipContent);
    }

    for line in body.lines() {
        let line = line.trim();
        if let Some(url_part) = line.strip_prefix("url=") {
            let url = reqwest::Url::parse(url_part.trim())
                .map_err(|e| ApiError::Parse(format!("Kuwo returned an invalid audio URL: {e}")))?;
            if !matches!(url.scheme(), "http" | "https") {
                return Err(ApiError::Parse(
                    "Kuwo returned an unsupported audio URL scheme".to_string(),
                ));
            }
            return Ok(url.to_string());
        }
    }

    Err(ApiError::Parse(format!("Kuwo parsing failed: {body}")))
}

/// Resolves a playable audio URL from Kuwo Music.
///
/// Encrypts request parameters using the Kuwo block cipher, Base64-encodes
/// the ciphertext, and queries the Kuwo mobile API. The response is a
/// key=value text format; the complete `url=` value is preserved because
/// query parameters may contain signatures or expiry tokens.
///
/// # Arguments
/// * `client` - Shared HTTP client.
/// * `songmid` - The Kuwo song ID (rid).
/// * `quality` - "128k", "192k", "320k", "ape", "flac", or "flac24bit".
///
/// # Returns
/// Direct audio URL, including query parameters, on success.
pub async fn get_kuwo_url(
    client: &Client,
    songmid: &str,
    quality: &str,
) -> Result<String, ApiError> {
    let (bitrate, format) = match quality {
        "128k" => ("128kmp3", "mp3"),
        "192k" => ("192kmp3", "mp3"),
        "320k" => ("320kmp3", "mp3"),
        "ape" => ("2000kape", "ape"),
        "flac" | "flac24bit" => ("2000kflac", "flac"),
        _ => ("128kmp3", "mp3"),
    };

    let params = format!(
        "type=convert_url&br={}&format={}&sig=0&rid={}&network=wifi&response=url&prod=kwplayer_ar_10.3.3.0",
        bitrate, format, songmid
    );

    let enc_bytes = kuwo_encrypt(&params, "ylzsxkwm");
    let q_params = BASE64_STANDARD.encode(&enc_bytes);

    let endpoint = "https://mobi.kuwo.cn/mobi.s?f=kuwo&q=";
    let api_url = format!("{}{}", endpoint, q_params);

    let resp = client
        .get(&api_url)
        .header(
            "User-Agent",
            "Mozilla/5.0 (iPhone; CPU iPhone OS 9_1 like Mac OS X) AppleWebKit/601.1.46 (KHTML, like Gecko) Version/9.0 Mobile/13B143 Safari/601.1",
        )
        .header("Referer", "http://kuwo.cn/")
        .send()
        .await?
        .error_for_status()?;

    let body_str = resp.text().await?;
    parse_kuwo_url(&body_str)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_kuwo_crypto() {
        let params = "type=convert_url&br=128kmp3&format=mp3&sig=0&rid=2423984&network=wifi&response=url&prod=kwplayer_ar_10.3.3.0";
        let enc_bytes = kuwo_encrypt(params, "ylzsxkwm");
        use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
        let q_params = BASE64_STANDARD.encode(&enc_bytes);
        assert_eq!(
            q_params,
            "18NsawlyRyRtNBB3YsCCYL6ViZJYU1V9YBbTxJJUSf9p8lacnpS0hlBvB+O3STOLkOQ9yIuZWZQZe7UvfQE6Zwn6AeQojd5MyPZr2iJoyOzi94OXIkC0yc+NwbIR+ERWTYsVc58LtjS25laWOGjchw=="
        );
    }

    #[test]
    fn parse_kuwo_url_preserves_signed_query_parameters() {
        let body = "format=mp3\r\nurl=http://audio.kwcdn.kuwo.cn/song.mp3?token=abc&expire=123\r\n";

        assert_eq!(
            parse_kuwo_url(body).unwrap(),
            "http://audio.kwcdn.kuwo.cn/song.mp3?token=abc&expire=123"
        );
    }

    #[test]
    fn parse_kuwo_url_recognizes_vip_response_with_lf_lines() {
        let body = "format=mp3\nbitrate=1\n";

        assert!(matches!(parse_kuwo_url(body), Err(ApiError::VipContent)));
    }

    #[test]
    fn parse_kuwo_url_rejects_unsupported_scheme() {
        let body = "url=file:///tmp/song.mp3\n";

        assert!(matches!(parse_kuwo_url(body), Err(ApiError::Parse(_))));
    }
}
