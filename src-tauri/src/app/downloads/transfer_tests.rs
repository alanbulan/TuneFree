use super::*;
use std::path::{Path, PathBuf};
use tokio::io::{AsyncReadExt, AsyncWriteExt};

async fn test_http_response(
    content_length: Option<usize>,
    body: Vec<u8>,
    body_delay: Duration,
) -> reqwest::Response {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    tokio::spawn(async move {
        let (mut socket, _) = listener.accept().await.unwrap();
        let mut request = [0_u8; 1024];
        let _ = socket.read(&mut request).await;
        let length_header = content_length
            .map(|size| format!("Content-Length: {}\r\n", size))
            .unwrap_or_default();
        let headers = format!(
            "HTTP/1.1 200 OK\r\n{}Connection: close\r\n\r\n",
            length_header
        );
        socket.write_all(headers.as_bytes()).await.unwrap();
        socket.flush().await.unwrap();
        if !body_delay.is_zero() {
            tokio::time::sleep(body_delay).await;
        }
        let _ = socket.write_all(&body).await;
    });
    reqwest::Client::new()
        .get(format!("http://{}/audio", address))
        .send()
        .await
        .unwrap()
}

fn temp_download_path(test_name: &str) -> PathBuf {
    std::env::temp_dir()
        .join(format!(
            "tunefree-download-test-{}-{}-{}",
            test_name,
            std::process::id(),
            super::super::path::now_millis()
        ))
        .join("track.mp3")
}

fn assert_no_partial_file(file_path: &Path) {
    let parent = file_path.parent().unwrap();
    let has_partial = std::fs::read_dir(parent)
        .into_iter()
        .flatten()
        .flatten()
        .any(|entry| entry.file_name().to_string_lossy().contains(".partial-"));
    assert!(!has_partial);
}

#[test]
fn download_progress_serializes_task_id_for_the_frontend() {
    let payload = serde_json::to_value(DownloadProgress {
        task_id: "download:test".to_string(),
        url: "https://example.com/audio.mp3".to_string(),
        progress: 42,
    })
    .unwrap();
    assert_eq!(payload["taskId"], "download:test");
    assert!(payload.get("task_id").is_none());
    assert_eq!(payload["progress"], 42);
}

#[test]
fn download_limits_and_task_ids_are_validated() {
    use super::super::path::{
        checked_downloaded_size, validate_download_size, validate_download_task_id,
        MAX_AUDIO_DOWNLOAD_BYTES,
    };
    assert!(validate_download_task_id("download:valid-id_1").is_ok());
    assert!(validate_download_task_id("").is_err());
    assert!(validate_download_task_id("download:invalid/id").is_err());
    assert!(validate_download_size(MAX_AUDIO_DOWNLOAD_BYTES, MAX_AUDIO_DOWNLOAD_BYTES).is_ok());
    assert!(
        validate_download_size(MAX_AUDIO_DOWNLOAD_BYTES + 1, MAX_AUDIO_DOWNLOAD_BYTES).is_err()
    );
    assert!(checked_downloaded_size(4, 2, 5).is_err());
}

#[test]
fn download_task_registry_registers_cancels_and_finishes_tasks() {
    let registry = DownloadTaskRegistry::default();
    let cancellation = registry.register("download:test").unwrap();
    assert!(registry.register("download:test").is_err());
    assert!(!cancellation.is_cancelled());
    assert!(registry.cancel("download:test"));
    assert!(cancellation.is_cancelled());
    registry.finish("download:test");
    assert!(!registry.cancel("download:test"));
}

#[tokio::test]
async fn persist_download_response_writes_and_renames_the_partial_file() {
    let file_path = temp_download_path("success");
    let response = test_http_response(Some(5), b"audio".to_vec(), Duration::ZERO).await;
    let mut progress = Vec::new();
    persist_download_response(
        response,
        &file_path,
        Duration::from_secs(1),
        16,
        &DownloadCancellation::default(),
        |value| progress.push(value),
    )
    .await
    .unwrap();
    assert_eq!(tokio::fs::read(&file_path).await.unwrap(), b"audio");
    assert_eq!(progress.first(), Some(&0));
    assert_eq!(progress.last(), Some(&100));
    assert_no_partial_file(&file_path);
    let _ = tokio::fs::remove_dir_all(file_path.parent().unwrap()).await;
}

async fn assert_failed_download_cleanup(
    test_name: &str,
    response: reqwest::Response,
    timeout: Duration,
    max_bytes: u64,
    cancellation: &DownloadCancellation,
    expected_error: &str,
) {
    let file_path = temp_download_path(test_name);
    let error = persist_download_response(
        response,
        &file_path,
        timeout,
        max_bytes,
        cancellation,
        |_| {},
    )
    .await
    .unwrap_err();
    assert!(error.contains(expected_error));
    assert!(!file_path.exists());
    assert_no_partial_file(&file_path);
    let _ = tokio::fs::remove_dir_all(file_path.parent().unwrap()).await;
}

#[tokio::test]
async fn persist_download_response_removes_partial_when_stream_exceeds_limit() {
    let response = test_http_response(None, b"too-large".to_vec(), Duration::ZERO).await;
    assert_failed_download_cleanup(
        "size-limit",
        response,
        Duration::from_secs(1),
        4,
        &DownloadCancellation::default(),
        "大小限制",
    )
    .await;
}

#[tokio::test]
async fn persist_download_response_removes_partial_after_idle_timeout() {
    let response = test_http_response(Some(1), b"x".to_vec(), Duration::from_millis(100)).await;
    assert_failed_download_cleanup(
        "idle-timeout",
        response,
        Duration::from_millis(10),
        16,
        &DownloadCancellation::default(),
        "读取超时",
    )
    .await;
}

#[tokio::test]
async fn persist_download_response_removes_partial_after_cancellation() {
    let response = test_http_response(Some(5), b"audio".to_vec(), Duration::from_millis(100)).await;
    let cancellation = Arc::new(DownloadCancellation::default());
    let trigger = cancellation.clone();
    tokio::spawn(async move {
        tokio::time::sleep(Duration::from_millis(10)).await;
        trigger.cancel();
    });
    assert_failed_download_cleanup(
        "cancelled",
        response,
        Duration::from_secs(1),
        16,
        &cancellation,
        "已取消",
    )
    .await;
}
