pub mod kuwo;
pub mod netease;
pub mod proxy;
pub mod qq;

use async_trait::async_trait;

/// Unified error type for all music provider APIs.
///
/// This enum covers network errors, parse errors, VIP/copyright restrictions,
/// unsupported platforms, and IO errors. It implements `serde::Serialize`
/// so it can be returned directly from Tauri IPC commands.
#[derive(Debug, thiserror::Error)]
pub enum ApiError {
    /// A network-level error from the HTTP client (connection, timeout, etc.).
    #[error("Network error: {0}")]
    Network(#[from] reqwest::Error),

    /// A data parsing or extraction error (malformed JSON, missing fields, etc.).
    #[error("Parse error: {0}")]
    Parse(String),

    /// The requested song is VIP or copyright-protected and no URL is available.
    #[error("VIP/Copyright protected content")]
    VipContent,

    /// The requested platform is not supported by any provider.
    #[error("Unsupported platform: {0}")]
    UnsupportedPlatform(String),

    /// An I/O error (file system, etc.).
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
}

impl serde::Serialize for ApiError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(self.to_string().as_ref())
    }
}

/// Trait abstracting music URL resolution across different platforms.
///
/// Each platform (Netease, QQ, Kuwo) implements this trait, allowing the
/// server to dispatch requests via trait objects without knowing the
/// concrete provider type.
#[async_trait]
pub trait MusicProvider: Send + Sync {
    /// Returns the platform identifier string (e.g. "netease", "qq", "kuwo").
    fn platform(&self) -> &'static str;

    /// Resolves a playable audio URL for the given song ID and quality.
    ///
    /// # Arguments
    /// * `client` - Shared HTTP client for making requests.
    /// * `id` - The song ID on the target platform.
    /// * `quality` - Desired quality: "128k", "320k", "flac", etc.
    ///
    /// # Returns
    /// The direct audio stream URL on success, or an `ApiError` on failure.
    async fn get_url(
        &self,
        client: &reqwest::Client,
        id: &str,
        quality: &str,
    ) -> Result<String, ApiError>;
}

/// Returns a trait-object provider for the given platform string.
///
/// Accepts platform aliases (e.g. "tencent" maps to the QQ provider).
/// Returns `None` for unrecognized platforms.
pub fn get_provider(platform: &str) -> Option<Box<dyn MusicProvider>> {
    match platform {
        "netease" => Some(Box::new(netease::NeteaseProvider)),
        "qq" | "tencent" => Some(Box::new(qq::QqProvider)),
        "kuwo" => Some(Box::new(kuwo::KuwoProvider)),
        _ => None,
    }
}
#[cfg(all(test, windows))]
#[path = "__tests__/platform_http.rs"]
mod platform_http_tests;
