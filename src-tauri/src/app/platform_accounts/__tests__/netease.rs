use super::*;
use crate::app::error::ErrorCode;

fn song(id: u64) -> Value {
    json!({"id":id,"name":format!("song{id}"),"ar":[{"name":"artist"}],"al":{"name":"album","picUrl":"http://p1.music.126.net/cover.jpg"}})
}

#[test]
fn parses_account_and_classifies_created_vs_collected_playlists() {
    assert_eq!(
        parse_account(json!({"code":200,"account":null,"profile":null}), "")
            .err()
            .unwrap()
            .code,
        ErrorCode::AuthRequired
    );
    let session = parse_account(json!({"code":200,"profile":{"userId":123,"nickname":"fixture","avatarUrl":"https://p1.music.126.net/avatar.jpg"}}), "MUSIC_U=fixture").unwrap();
    let data = json!({"code":200,"more":true,"playlist":[
        {"id":1,"name":"created","trackCount":150,"creator":{"userId":123}},
        {"id":2,"name":"collected","trackCount":2,"creator":{"userId":321}}
    ]});
    let (lists, more) = parse_playlists(&data, &session.account.user_id).unwrap();
    assert!(more);
    assert_eq!(lists[0].kind, "created");
    assert_eq!(lists[1].kind, "collected");
    assert!(parse_playlists(&json!({"code":200,"playlist":[]}), "123").is_err());
}

#[test]
fn restores_playlist_order_and_never_reports_missing_songs_as_complete() {
    let ids = vec!["3".into(), "1".into(), "2".into()];
    let songs = [2, 3, 1].map(|id| parse_song(&song(id)).unwrap()).to_vec();
    let ordered = order_songs(&ids, songs).unwrap();
    assert_eq!(
        ordered.iter().map(|song| &song.id).collect::<Vec<_>>(),
        ids.iter().collect::<Vec<_>>()
    );
    assert_eq!(
        ordered[0].pic.as_deref(),
        Some("https://p1.music.126.net/cover.jpg")
    );
    assert!(order_songs(&ids, vec![parse_song(&song(1)).unwrap()]).is_err());
    assert!(parse_song(&json!({"id":"not-numeric"})).is_err());
}
