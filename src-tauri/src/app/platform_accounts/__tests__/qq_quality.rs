use super::*;

#[test]
fn filenames_keep_song_and_file_mids_separate_and_skip_absent_hires() {
    let rungs = candidates(
        &json!({"size_hires":0,"size_flac":1234,"size_320mp3":987,"size_128mp3":123}),
        "SONG",
        "MEDIA",
        "flac24bit",
    )
    .unwrap();
    assert_eq!(
        rungs,
        vec![
            ("F000MEDIASONG.flac".into(), "flac".into()),
            ("M800MEDIASONG.mp3".into(), "320k".into()),
            ("M500MEDIASONG.mp3".into(), "128k".into())
        ]
    );
    assert_eq!(
        candidates(
            &json!({"size_hires":42,"size_flac":0}),
            "SONG",
            "MEDIA",
            "flac24bit"
        )
        .unwrap()[0]
            .0,
        "RS01MEDIASONG.flac"
    );
    assert!(!valid_mid("../bad"));
}

#[test]
fn qq_wire_guid_is_stable_after_restoring_the_same_saved_login() {
    let session = super::super::super::qq::parse_account(
        json!({"info":{"nick":"fixture"}}),
        "qqmusic_uin=123; qqmusic_key=private-fixture",
    )
    .unwrap();
    let restored: Session =
        serde_json::from_str(&serde_json::to_string(&session).unwrap()).unwrap();
    assert_eq!(guid(&session), guid(&restored));
    let mut changed = restored;
    changed.account.connected_at += 1;
    assert_ne!(guid(&session), guid(&changed));
}
