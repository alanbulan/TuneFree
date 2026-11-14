use super::*;

#[test]
fn preserves_music_identity_album_mid_and_media_mid() {
    let song = parse_song(
        &json!({"mid":"SONGMID","id":123,"name":"fixture","singer":[{"name":"artist"}],
        "album":{"name":"album","mid":"ALBUMMID"},"file":{"media_mid":"MEDIAMID"}}),
    )
    .unwrap();
    assert_eq!(song.id, "SONGMID");
    assert_eq!(song.lyric_id.as_deref(), Some("123"));
    assert_eq!(song.str_media_mid.as_deref(), Some("MEDIAMID"));
    assert!(song.pic.unwrap().contains("ALBUMMID"));
    assert!(parse_song(&json!({"mid":"../escape"})).is_err());
}

#[test]
fn parses_real_user_playlist_format_and_completion_flags() {
    let session = parse_account(
        json!({"info":{"nick":"fixture","encryptUin":"encrypted"}}),
        "qqmusic_uin=123; qqmusic_key=fixture",
    )
    .unwrap();
    assert_eq!(session.account.user_id, "123");
    assert_eq!(session.encrypted_user_id.as_deref(), Some("encrypted"));
    let row = json!({"tid":456,"dirid":2,"title":"created","songnum":100,"picurl":"https://y.gtimg.cn/cover.jpg"});
    let (lists, more) = parse_playlists(
        &json!({"v_playlist":[row.clone()],"bFinish":true}),
        "created",
    )
    .unwrap();
    assert!(!more);
    assert_eq!(lists[0].id, "456");
    let (_, more) = parse_playlists(&json!({"v_list":[row],"hasmore":1}), "collected").unwrap();
    assert!(more);
    assert!(parse_song_page(&json!({"songlist":[],"total_song_num":100,"hasmore":1})).is_ok());
    assert!(parse_playlists(&json!({"v_list":[]}), "collected").is_err());
}
