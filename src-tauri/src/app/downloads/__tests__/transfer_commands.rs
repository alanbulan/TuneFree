use super::super::meta::read_downloads_json;
use super::super::test_fixture::Downloads;
use super::*;
use crate::app::error::ErrorCode;
use serde_json::{json, Value};
use tauri::{Listener, Manager};
use tokio::io::{AsyncReadExt, AsyncWriteExt};

fn fixture() -> Downloads {
    let fixture = Downloads::new();
    fixture.app.manage(DownloadClient(reqwest::Client::new()));
    fixture.app.manage(DownloadTaskRegistry::default());
    fixture
}

fn metadata() -> DownloadMetadataInput {
    DownloadMetadataInput {
        song: json!({"id":"1", "source":"qq", "name":"本机下载测试"}),
        quality: "320k".into(),
    }
}

async fn response_server(response: &'static [u8]) -> (String, tokio::task::JoinHandle<String>) {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}/track", listener.local_addr().unwrap());
    let task = tokio::spawn(async move {
        let (mut stream, _) = listener.accept().await.unwrap();
        let mut request = vec![0; 4096];
        let read = stream.read(&mut request).await.unwrap();
        stream.write_all(response).await.unwrap();
        String::from_utf8(request[..read].to_vec()).unwrap()
    });
    (url, task)
}

async fn download(
    fixture: &Downloads,
    url: &str,
    filename: &str,
    id: &str,
) -> CommandResult<DownloadedFile> {
    download_song_to_local(
        fixture.app.handle().clone(),
        fixture.app.state(),
        fixture.app.state(),
        url.into(),
        filename.into(),
        id.into(),
        metadata(),
    )
    .await
}

#[tokio::test]
async fn successful_command_commits_audio_metadata_and_progress_then_releases_the_task() {
    let fixture = fixture();
    let progress = Arc::new(parking_lot::Mutex::new(Vec::<Value>::new()));
    let received = progress.clone();
    let listener = fixture.app.listen(DOWNLOAD_PROGRESS_EVENT, move |event| {
        received
            .lock()
            .push(serde_json::from_str(event.payload()).unwrap());
    });
    let (url, server) =
        response_server(b"HTTP/1.1 200 OK\r\nContent-Length: 5\r\nConnection: close\r\n\r\naudio")
            .await;
    let result = download(&fixture, &url, "track.mp3", "download:ok")
        .await
        .unwrap();
    let request = server.await.unwrap();
    assert!(request.to_ascii_lowercase().contains("user-agent: mozilla"));
    assert_eq!(std::fs::read(&result.filepath).unwrap(), b"audio");
    assert_eq!(result.filename, "track.mp3");
    let records = read_downloads_json(&fixture.dir.0).unwrap();
    assert_eq!(records.len(), 1);
    assert_eq!(records[0].quality, "320k");
    let progress = progress.lock();
    assert_eq!(progress.first().unwrap()["progress"], 0);
    assert_eq!(progress.last().unwrap()["progress"], 100);
    assert!(progress
        .iter()
        .all(|event| event["taskId"] == "download:ok" && event["url"] == url));
    let registry = fixture.app.state::<DownloadTaskRegistry>();
    assert!(registry.tasks.lock().is_empty());
    assert!(registry.active_partial_snapshot().is_empty());
    assert!(!cancel_download(fixture.app.state(), "download:ok".into()).unwrap());
    fixture.app.unlisten(listener);
}

#[tokio::test]
async fn command_rejects_invalid_inputs_http_failures_and_incomplete_responses() {
    let fixture = fixture();
    for (url, filename, id) in [
        ("bad-url", "track.mp3", "valid"),
        ("file:///secret", "track.mp3", "valid"),
        ("http://localhost", "track.mp3", "bad/id"),
        ("http://localhost", "../track.mp3", "valid"),
    ] {
        assert_eq!(
            download(&fixture, url, filename, id)
                .await
                .err()
                .unwrap()
                .code,
            ErrorCode::InvalidArgument
        );
    }
    for response in [
        &b"HTTP/1.1 503 Unavailable\r\nContent-Length: 0\r\n\r\n"[..],
        &b"HTTP/1.1 200 OK\r\nContent-Length: 8\r\nConnection: close\r\n\r\nx"[..],
    ] {
        let (url, server) = response_server(response).await;
        assert_eq!(
            download(&fixture, &url, "failed.mp3", "download:failed")
                .await
                .err()
                .unwrap()
                .code,
            ErrorCode::DownloadFailed
        );
        server.await.unwrap();
    }
    let closed = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let url = format!("http://{}", closed.local_addr().unwrap());
    drop(closed);
    assert_eq!(
        download(&fixture, &url, "failed.mp3", "download:failed")
            .await
            .err()
            .unwrap()
            .code,
        ErrorCode::DownloadFailed
    );
    assert!(read_downloads_json(&fixture.dir.0).unwrap().is_empty());
    assert_eq!(std::fs::read_dir(&fixture.dir.0).unwrap().count(), 0);
    assert!(fixture
        .app
        .state::<DownloadTaskRegistry>()
        .tasks
        .lock()
        .is_empty());
}

#[tokio::test]
async fn metadata_failure_preserves_the_completed_audio_and_reports_its_name() {
    let fixture = fixture();
    std::fs::write(fixture.dir.0.join("downloads.json"), b"broken json").unwrap();
    let (url, server) =
        response_server(b"HTTP/1.1 200 OK\r\nContent-Length: 5\r\nConnection: close\r\n\r\naudio")
            .await;
    let error = download(&fixture, &url, "kept.mp3", "download:metadata")
        .await
        .err()
        .unwrap();
    server.await.unwrap();
    assert_eq!(error.code, ErrorCode::Io);
    assert!(error.message.contains("kept.mp3"));
    assert!(error.message.contains("音频已保存"));
    assert_eq!(
        std::fs::read(fixture.dir.0.join("kept.mp3")).unwrap(),
        b"audio"
    );
    assert_eq!(
        std::fs::read(fixture.dir.0.join("downloads.json")).unwrap(),
        b"broken json"
    );
}

#[tokio::test]
async fn cancel_command_aborts_a_request_waiting_for_headers_and_releases_registration() {
    let fixture = fixture();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    let (started_tx, started_rx) = tokio::sync::oneshot::channel();
    let server = tokio::spawn(async move {
        let (mut stream, _) = listener.accept().await.unwrap();
        let mut request = [0; 4096];
        assert!(stream.read(&mut request).await.unwrap() > 0);
        started_tx.send(()).unwrap();
        std::future::pending::<()>().await;
    });
    let work = download(&fixture, &url, "cancelled.mp3", "download:cancel");
    let cancellation = async {
        started_rx.await.unwrap();
        assert!(cancel_download(fixture.app.state(), "download:cancel".into()).unwrap());
    };
    let (result, ()) = tokio::join!(work, cancellation);
    server.abort();
    assert_eq!(result.err().unwrap().code, ErrorCode::Cancelled);
    assert!(fixture
        .app
        .state::<DownloadTaskRegistry>()
        .tasks
        .lock()
        .is_empty());
    assert_eq!(std::fs::read_dir(&fixture.dir.0).unwrap().count(), 0);
    assert_eq!(
        cancel_download(fixture.app.state(), "bad/id".into())
            .unwrap_err()
            .code,
        ErrorCode::InvalidArgument
    );
}
