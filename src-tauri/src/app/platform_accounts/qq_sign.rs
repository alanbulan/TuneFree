//! zzc signing adapted from LingyunStudio/RustMusic qq/mod.rs, Apache-2.0.
//! SHA-1 is required by this public upstream wire protocol, not used for application authentication.
use base64::{engine::general_purpose::STANDARD, Engine as _};
use sha1::{Digest, Sha1};

pub(super) fn sign(text: &str) -> String {
    const P1: [usize; 8] = [23, 14, 6, 36, 16, 40, 7, 19];
    const P2: [usize; 8] = [16, 1, 32, 12, 19, 27, 8, 5];
    const MASK: [u8; 20] = [
        89, 39, 179, 150, 218, 82, 58, 252, 177, 52, 186, 123, 120, 64, 242, 133, 143, 161, 121,
        179,
    ];
    let digest = Sha1::digest(text.as_bytes());
    let hex: String = digest.iter().map(|byte| format!("{byte:02X}")).collect();
    let pick = |positions: &[usize]| {
        positions
            .iter()
            .filter_map(|index| hex.as_bytes().get(*index).copied().map(char::from))
            .collect::<String>()
    };
    let encoded = STANDARD
        .encode(
            digest
                .iter()
                .zip(MASK)
                .map(|(byte, mask)| byte ^ mask)
                .collect::<Vec<_>>(),
        )
        .chars()
        .filter(|character| !matches!(character, '/' | '\\' | '+' | '='))
        .collect::<String>();
    format!("zzc{}{encoded}{}", pick(&P1), pick(&P2)).to_lowercase()
}

#[cfg(test)]
mod tests {
    #[test]
    fn matches_upstream_browser_signature_vectors() {
        assert_eq!(
            super::sign("123"),
            "zzcec1b555gzqzg7laztguyjl2bu20r6x1w50c55f60"
        );
        assert_eq!(
            super::sign("hello world"),
            "zzcfb3415bc4nfoxmd9uik71mkomtubjfjp141a1cbbcc"
        );
    }
}
