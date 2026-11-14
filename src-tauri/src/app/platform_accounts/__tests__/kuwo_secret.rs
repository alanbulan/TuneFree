use super::*;

#[test]
fn matches_the_current_browser_secret_and_rejects_missing_cookie() {
    assert_eq!(
        secret_for_nonce("0123456789abcdef0123456789abcdef", 12_345_678).unwrap(),
        "1361b99125125e1ce61cc1f328ded44b38fec3e403cfaa3031b91afbe5e200ea00bc614e"
    );
    assert!(secret_for_nonce("too-short", 12_345_678).is_err());
    assert!(secret("userid=1; sid=fake").is_err());
}

#[test]
fn returned_media_determines_quality_and_trial_flags_deny_full_playback() {
    use serde_json::json;
    let mp3 = "https://er-sycdn.kuwo.cn/song.mp3";
    let flac = "https://er-sycdn.kuwo.cn/song.FLAC";
    assert_eq!(actual_quality(&json!({}), mp3), "128k");
    assert_eq!(actual_quality(&json!({"bitrate":"320000"}), mp3), "320k");
    assert_eq!(actual_quality(&json!({"br":320}), mp3), "320k");
    assert_eq!(actual_quality(&json!({}), flac), "flac");
    assert_eq!(
        actual_quality(&json!({"format":"flac","bitDepth":24}), mp3),
        "flac24bit"
    );
    for row in [
        json!({"isTrial":true}),
        json!({"freeTrialInfo":{}}),
        json!({"audioFlags":"1"}),
        json!({"trialDuration":30}),
    ] {
        assert!(trial(&row));
    }
    assert!(!trial(
        &json!({"isTrial":false,"audioFlags":0,"trialDuration":0})
    ));
}
