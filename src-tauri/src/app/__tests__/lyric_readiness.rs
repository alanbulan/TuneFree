use super::*;
use tauri::Manager;

#[tokio::test]
async fn ready_notification_releases_all_waiters_and_future_calls_return_immediately() {
    let app = crate::test_support::app();
    app.manage(DesktopLyricRenderState::default());
    let state = app.state::<DesktopLyricRenderState>();
    let signal = async {
        tokio::task::yield_now().await;
        mark_desktop_lyric_ready(app.state()).unwrap();
    };
    let (first, second, ()) = tokio::join!(
        wait_for_desktop_lyric_ready(&state),
        wait_for_desktop_lyric_ready(&state),
        signal
    );
    first.unwrap();
    second.unwrap();
    tokio::time::timeout(
        Duration::from_millis(10),
        wait_for_desktop_lyric_ready(&state),
    )
    .await
    .unwrap()
    .unwrap();
}

#[tokio::test]
async fn missing_first_paint_times_out_and_missing_windows_return_typed_errors() {
    let state = DesktopLyricRenderState::default();
    assert_eq!(
        wait_for_desktop_lyric_ready(&state).await.unwrap_err().code,
        ErrorCode::Timeout
    );
    let app = crate::test_support::app();
    let handle = app.handle().clone();
    use crate::app::desktop_lyric::*;
    assert_eq!(
        show_desktop_lyric_window(handle.clone(), false)
            .await
            .unwrap_err()
            .code,
        ErrorCode::WindowUnavailable
    );
    assert_eq!(
        set_desktop_lyric_lock(handle.clone(), false)
            .unwrap_err()
            .code,
        ErrorCode::WindowUnavailable
    );
    assert_eq!(
        hide_desktop_lyric_window(handle).await.unwrap_err().code,
        ErrorCode::WindowUnavailable
    );
}
