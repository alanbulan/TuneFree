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
            ("F000MEDIA.flac".into(), "flac".into()),
            ("F000MEDIASONG.flac".into(), "flac".into()),
            ("M800MEDIA.mp3".into(), "320k".into()),
            ("M800MEDIASONG.mp3".into(), "320k".into()),
            ("M500MEDIA.mp3".into(), "128k".into()),
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
        "RS01MEDIA.flac"
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

#[test]
fn playback_cookie_unifies_browser_and_music_identities_without_oauth_tokens() {
    let mut session = super::super::super::qq::parse_account(
        json!({"info":{"nick":"fixture"}}),
        "qqmusic_uin=1152921504000000001; uin=o789; qqmusic_key=W_X-fixture; psrf_qqaccess_token=oauth",
    )
    .unwrap();
    assert_eq!(
        playback_cookie(&session).unwrap(),
        "uin=1152921504000000001; qqmusic_uin=1152921504000000001; qm_keyst=W_X-fixture; qqmusic_key=W_X-fixture"
    );
    session.account.user_id = "789".into();
    assert!(playback_cookie(&session).is_err());
}

#[test]
fn qq_grants_keep_quality_order_reject_denials_and_accept_the_legacy_filename() {
    let rungs = candidates(&json!({}), "SONG", "MEDIA", "320k").unwrap();
    let denied = json!({"midurlinfo":rungs.iter().map(|(name,_)|
        json!({"filename":name,"result":22,"purl":"M800MEDIA.mp3?vkey=invalid"})).collect::<Vec<_>>()});
    assert!(granted_url(&denied, &rungs, &[]).unwrap().is_none());
    let granted = json!({"midurlinfo":[
        {"filename":"M800MEDIA.mp3","purl":"","result":22},
        {"filename":"M800MEDIASONG.mp3","purl":"","result":22},
        {"filename":"M500MEDIA.mp3","purl":"","result":22},
        {"filename":"M500MEDIASONG.mp3","purl":"M500MEDIASONG.mp3?vkey=valid","result":0}
    ]});
    let (url, quality) = granted_url(&granted, &rungs, &[]).unwrap().unwrap();
    assert_eq!(quality, "128k");
    assert!(url.contains("M500MEDIASONG"));
    assert!(granted_url(&granted, &rungs, &[url]).unwrap().is_none());
    assert!(granted_url(&json!({"midurlinfo":[]}), &rungs, &[]).is_err());
    let mismatched = json!({"midurlinfo":[
        {"filename":"OTHER","purl":""},{},{},{}
    ]});
    assert!(granted_url(&mismatched, &rungs, &[]).is_err());
}
