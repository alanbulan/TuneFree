//! Structured error contract shared by every Tauri command.
//!
//! Commands used to return `Result<T, String>`, which forced the frontend to
//! pattern-match on localized message text. Every command now returns
//! [`CommandResult`], serialized as `{ "code": "...", "message": "..." }` so the
//! renderer can branch on `code` while still showing `message` to the user.

use serde::Serialize;

/// Machine-readable error category surfaced to the renderer.
///
/// Serializes to SCREAMING_SNAKE_CASE (e.g. `DOWNLOAD_DIR_UNAUTHORIZED`) and
/// mirrors the `IpcErrorCode` union declared in `src/core/ipc/error.ts`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ErrorCode {
    /// Unclassified failure; the renderer shows the message verbatim.
    Internal,
    /// Caller supplied a malformed or out-of-range argument.
    InvalidArgument,
    /// The requested resource does not exist.
    NotFound,
    /// Filesystem operation failed.
    Io,
    /// Outbound HTTP request failed.
    Network,
    /// Operation was cancelled by the user or superseded by a newer request.
    Cancelled,
    /// Operation exceeded its deadline.
    Timeout,
    /// A conflicting operation is already running.
    Busy,
    /// SQLite access failed.
    Database,
    /// The requested download directory was never approved by the user.
    DownloadDirUnauthorized,
    /// The requested download directory is missing, unwritable, or unsafe.
    DownloadDirInvalid,
    /// The download transfer itself failed.
    DownloadFailed,
    /// No provider is registered for the requested music platform.
    UnsupportedPlatform,
    /// The target window is missing or could not be shown.
    WindowUnavailable,
    /// The updater failed to check for or install an update.
    UpdateFailed,
    /// The recommendation subsystem is disabled in settings.
    RecommendationDisabled,
    /// Stored LLM configuration is incomplete or invalid.
    LlmConfigInvalid,
    /// The configured LLM endpoint rejected or failed the request.
    LlmRequestFailed,
    /// The OS credential store is unavailable on this platform.
    CredentialUnavailable,
}

/// Error type returned by every `#[tauri::command]`.
///
/// `message` stays user-facing (Chinese, shown directly in toasts); `code`
/// carries the category so the renderer can pick retry/recovery behaviour
/// without parsing text.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandError {
    pub code: ErrorCode,
    pub message: String,
}

impl CommandError {
    pub fn new(code: ErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }

    pub fn internal(message: impl Into<String>) -> Self {
        Self::new(ErrorCode::Internal, message)
    }

    pub fn invalid_argument(message: impl Into<String>) -> Self {
        Self::new(ErrorCode::InvalidArgument, message)
    }

    pub fn not_found(message: impl Into<String>) -> Self {
        Self::new(ErrorCode::NotFound, message)
    }

    pub fn io(message: impl Into<String>) -> Self {
        Self::new(ErrorCode::Io, message)
    }

    pub fn network(message: impl Into<String>) -> Self {
        Self::new(ErrorCode::Network, message)
    }

    pub fn cancelled(message: impl Into<String>) -> Self {
        Self::new(ErrorCode::Cancelled, message)
    }

    pub fn busy(message: impl Into<String>) -> Self {
        Self::new(ErrorCode::Busy, message)
    }

    pub fn database(message: impl Into<String>) -> Self {
        Self::new(ErrorCode::Database, message)
    }

    pub fn window_unavailable(message: impl Into<String>) -> Self {
        Self::new(ErrorCode::WindowUnavailable, message)
    }
}

impl std::fmt::Display for CommandError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.message)
    }
}

impl std::error::Error for CommandError {}

/// Return type alias for Tauri commands.
pub type CommandResult<T> = Result<T, CommandError>;

impl From<std::io::Error> for CommandError {
    fn from(error: std::io::Error) -> Self {
        let code = match error.kind() {
            std::io::ErrorKind::NotFound => ErrorCode::NotFound,
            _ => ErrorCode::Io,
        };
        Self::new(code, format!("文件操作失败: {}", error))
    }
}

impl From<serde_json::Error> for CommandError {
    fn from(error: serde_json::Error) -> Self {
        log::warn!("JSON 处理失败: {}", error);
        Self::internal("数据格式异常")
    }
}

impl From<rusqlite::Error> for CommandError {
    fn from(error: rusqlite::Error) -> Self {
        log::warn!("数据库操作失败: {}", error);
        Self::database("本地数据读写失败")
    }
}

impl From<tauri::Error> for CommandError {
    fn from(error: tauri::Error) -> Self {
        log::warn!("窗口操作失败: {}", error);
        Self::window_unavailable("窗口操作失败")
    }
}

impl From<reqwest::Error> for CommandError {
    fn from(error: reqwest::Error) -> Self {
        // Upstream errors can embed hostnames and ports; keep those in the log
        // and hand the renderer a generic summary.
        log::warn!("网络请求失败: {}", error);
        if error.is_timeout() {
            Self::new(ErrorCode::Timeout, "网络请求超时")
        } else {
            Self::network("网络请求失败")
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serializes_code_as_screaming_snake_case() {
        let error = CommandError::new(ErrorCode::DownloadDirUnauthorized, "下载目录未授权");
        let json = serde_json::to_value(&error).unwrap();
        assert_eq!(json["code"], "DOWNLOAD_DIR_UNAUTHORIZED");
        assert_eq!(json["message"], "下载目录未授权");
    }

    #[test]
    fn every_code_serializes_as_screaming_snake_case() {
        let expected = [
            (ErrorCode::Internal, "INTERNAL"),
            (ErrorCode::InvalidArgument, "INVALID_ARGUMENT"),
            (ErrorCode::NotFound, "NOT_FOUND"),
            (ErrorCode::Io, "IO"),
            (ErrorCode::Network, "NETWORK"),
            (ErrorCode::Cancelled, "CANCELLED"),
            (ErrorCode::Timeout, "TIMEOUT"),
            (ErrorCode::Busy, "BUSY"),
            (ErrorCode::Database, "DATABASE"),
            (
                ErrorCode::DownloadDirUnauthorized,
                "DOWNLOAD_DIR_UNAUTHORIZED",
            ),
            (ErrorCode::DownloadDirInvalid, "DOWNLOAD_DIR_INVALID"),
            (ErrorCode::DownloadFailed, "DOWNLOAD_FAILED"),
            (ErrorCode::UnsupportedPlatform, "UNSUPPORTED_PLATFORM"),
            (ErrorCode::WindowUnavailable, "WINDOW_UNAVAILABLE"),
            (ErrorCode::UpdateFailed, "UPDATE_FAILED"),
            (ErrorCode::RecommendationDisabled, "RECOMMENDATION_DISABLED"),
            (ErrorCode::LlmConfigInvalid, "LLM_CONFIG_INVALID"),
            (ErrorCode::LlmRequestFailed, "LLM_REQUEST_FAILED"),
            (ErrorCode::CredentialUnavailable, "CREDENTIAL_UNAVAILABLE"),
        ];
        for (code, wire) in expected {
            assert_eq!(serde_json::to_value(code).unwrap(), wire);
        }
    }

    #[test]
    fn serialized_shape_is_exactly_code_and_message() {
        let json = serde_json::to_value(CommandError::busy("忙")).unwrap();
        let object = json.as_object().unwrap();
        assert_eq!(object.len(), 2);
        assert!(object.contains_key("code"));
        assert!(object.contains_key("message"));
    }

    #[test]
    fn convenience_constructors_pick_the_matching_code() {
        let built: Vec<(ErrorCode, ErrorCode)> = vec![
            (CommandError::internal("x").code, ErrorCode::Internal),
            (
                CommandError::invalid_argument("x").code,
                ErrorCode::InvalidArgument,
            ),
            (CommandError::not_found("x").code, ErrorCode::NotFound),
            (CommandError::io("x").code, ErrorCode::Io),
            (CommandError::network("x").code, ErrorCode::Network),
            (CommandError::cancelled("x").code, ErrorCode::Cancelled),
            (CommandError::busy("x").code, ErrorCode::Busy),
            (CommandError::database("x").code, ErrorCode::Database),
            (
                CommandError::window_unavailable("x").code,
                ErrorCode::WindowUnavailable,
            ),
        ];
        for (actual, expected) in built {
            assert_eq!(actual, expected);
        }
    }

    #[test]
    fn maps_missing_file_to_not_found() {
        let io_error = std::io::Error::new(std::io::ErrorKind::NotFound, "missing");
        let error: CommandError = io_error.into();
        assert_eq!(error.code, ErrorCode::NotFound);
    }

    #[test]
    fn maps_other_io_kinds_to_io() {
        for kind in [
            std::io::ErrorKind::PermissionDenied,
            std::io::ErrorKind::AlreadyExists,
            std::io::ErrorKind::UnexpectedEof,
        ] {
            let error: CommandError = std::io::Error::new(kind, "boom").into();
            assert_eq!(error.code, ErrorCode::Io);
            assert!(error.message.starts_with("文件操作失败"));
        }
    }

    #[test]
    fn maps_json_and_sqlite_errors_to_generic_messages() {
        let json_error = serde_json::from_str::<serde_json::Value>("{oops").unwrap_err();
        let error: CommandError = json_error.into();
        assert_eq!(error.code, ErrorCode::Internal);
        assert_eq!(error.message, "数据格式异常");

        let sqlite_error = rusqlite::Connection::open_in_memory()
            .unwrap()
            .execute("NOT SQL", [])
            .unwrap_err();
        let error: CommandError = sqlite_error.into();
        assert_eq!(error.code, ErrorCode::Database);
        assert_eq!(error.message, "本地数据读写失败");
    }

    #[tokio::test]
    async fn maps_reqwest_timeouts_and_transport_failures() {
        // 只监听、从不 accept：内核 backlog 会完成握手，请求因此卡在等待响应上。
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();

        let timeout: CommandError = reqwest::Client::builder()
            .no_proxy()
            .timeout(std::time::Duration::from_millis(50))
            .build()
            .unwrap()
            .get(format!("http://{address}/never"))
            .send()
            .await
            .unwrap_err()
            .into();
        assert_eq!(timeout.code, ErrorCode::Timeout);
        assert_eq!(timeout.message, "网络请求超时");
        drop(listener);

        // 连接被拒绝的错误里带着主机与端口，转换后必须只剩概括文案。
        let dead_port = {
            let probe = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
            probe.local_addr().unwrap().port()
        };
        let refused: CommandError = reqwest::Client::builder()
            .no_proxy()
            .build()
            .unwrap()
            .get(format!("http://127.0.0.1:{dead_port}/x"))
            .send()
            .await
            .unwrap_err()
            .into();
        assert_eq!(refused.code, ErrorCode::Network);
        assert_eq!(refused.message, "网络请求失败");
        assert!(!refused.message.contains(&dead_port.to_string()));
    }

    #[test]
    fn display_exposes_user_facing_message() {
        let error = CommandError::internal("出错了");
        assert_eq!(error.to_string(), "出错了");
        let boxed: Box<dyn std::error::Error> = Box::new(CommandError::io("磁盘错误"));
        assert_eq!(boxed.to_string(), "磁盘错误");
    }
}
