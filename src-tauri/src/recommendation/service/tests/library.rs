use super::*;

#[test]
fn library_sync_is_idempotent_and_removal_reverses_profile() {
    let mut conn = Connection::open_in_memory().unwrap();
    migration::run_migrations(&conn).unwrap();
    let favorite = song("netease", "1", "收藏歌", "收藏歌手");
    let playlist_song = song("qq", "2", "歌单歌", "歌单歌手");
    let snapshot = LibrarySnapshot {
        favorites: vec![favorite.clone()],
        playlists: vec![PlaylistSnapshot {
            id: "playlist-1".to_string(),
            name: "测试歌单".to_string(),
            songs: vec![playlist_song.clone()],
        }],
        queue: Vec::new(),
        current_song: None,
        delta: None,
    };

    assert!(sync_library_snapshot(&mut conn, &snapshot).unwrap());
    let profile_before: Vec<(String, f64)> = {
        let mut stmt = conn
            .prepare("SELECT key, value FROM library_profile ORDER BY key")
            .unwrap();
        stmt.query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
            .unwrap()
            .collect::<rusqlite::Result<_>>()
            .unwrap()
    };
    profile::update_profile_for_song(&conn, &favorite, 1.0, None).unwrap();
    let library_profile_after_behavior: Vec<(String, f64)> = {
        let mut stmt = conn
            .prepare("SELECT key, value FROM library_profile ORDER BY key")
            .unwrap();
        stmt.query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
            .unwrap()
            .collect::<rusqlite::Result<_>>()
            .unwrap()
    };
    assert_eq!(profile_before, library_profile_after_behavior);
    let cooccurrence_before: i64 = conn
        .query_row("SELECT COUNT(*) FROM item_cooccurrence", [], |row| {
            row.get(0)
        })
        .unwrap();

    assert!(!sync_library_snapshot(&mut conn, &snapshot).unwrap());
    let profile_after: Vec<(String, f64)> = {
        let mut stmt = conn
            .prepare("SELECT key, value FROM library_profile ORDER BY key")
            .unwrap();
        stmt.query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
            .unwrap()
            .collect::<rusqlite::Result<_>>()
            .unwrap()
    };
    let cooccurrence_after: i64 = conn
        .query_row("SELECT COUNT(*) FROM item_cooccurrence", [], |row| {
            row.get(0)
        })
        .unwrap();
    assert_eq!(profile_before, profile_after);
    assert_eq!(cooccurrence_before, cooccurrence_after);

    let empty_snapshot = LibrarySnapshot {
        favorites: Vec::new(),
        playlists: Vec::new(),
        queue: Vec::new(),
        current_song: None,
        delta: None,
    };
    assert!(sync_library_snapshot(&mut conn, &empty_snapshot).unwrap());
    let favorite_artist_value: Option<f64> = conn
        .query_row(
            "SELECT value FROM library_profile WHERE key = 'artist:收藏歌手'",
            [],
            |row| row.get(0),
        )
        .optional()
        .unwrap();
    assert!(favorite_artist_value.is_none());
}

#[test]
fn library_delta_updates_metadata_and_reverses_removed_membership() {
    let mut conn = Connection::open_in_memory().unwrap();
    migration::run_migrations(&conn).unwrap();
    let original = song("netease", "1", "旧歌名", "旧歌手");
    let snapshot = LibrarySnapshot {
        favorites: vec![original.clone()],
        playlists: Vec::new(),
        queue: Vec::new(),
        current_song: None,
        delta: None,
    };
    sync_library_snapshot(&mut conn, &snapshot).unwrap();

    let updated = song("netease", "1", "新歌名", "新歌手");
    let update_delta = LibraryDelta {
        upsert_songs: vec![updated.clone()],
        added_memberships: Vec::new(),
        removed_memberships: Vec::new(),
    };
    assert!(apply_library_delta(&mut conn, &update_delta).unwrap());
    let stored = catalog::get_track(&conn, "netease:1").unwrap().unwrap();
    assert_eq!(stored.name, "新歌名");
    assert_eq!(stored.artist, "新歌手");
    let old_artist: Option<f64> = conn
        .query_row(
            "SELECT value FROM library_profile WHERE key = 'artist:旧歌手'",
            [],
            |row| row.get(0),
        )
        .optional()
        .unwrap();
    assert!(old_artist.is_none());

    let remove_delta = LibraryDelta {
        upsert_songs: Vec::new(),
        added_memberships: Vec::new(),
        removed_memberships: vec![LibraryMembershipChange {
            container_type: "favorite".to_string(),
            container_id: "favorites".to_string(),
            track_key: "netease:1".to_string(),
        }],
    };
    assert!(apply_library_delta(&mut conn, &remove_delta).unwrap());
    let membership_count: i64 = conn
        .query_row("SELECT COUNT(*) FROM library_membership", [], |row| {
            row.get(0)
        })
        .unwrap();
    let new_artist: Option<f64> = conn
        .query_row(
            "SELECT value FROM library_profile WHERE key = 'artist:新歌手'",
            [],
            |row| row.get(0),
        )
        .optional()
        .unwrap();
    assert_eq!(membership_count, 0);
    assert!(new_artist.is_none());
}

#[test]
fn large_playlist_is_recalled_without_materialized_quadratic_pairs() {
    let mut conn = Connection::open_in_memory().unwrap();
    migration::run_migrations(&conn).unwrap();
    let songs = (0..1000)
        .map(|index| song("netease", &index.to_string(), &format!("歌{index}"), "歌手"))
        .collect::<Vec<_>>();
    let snapshot = LibrarySnapshot {
        favorites: Vec::new(),
        playlists: vec![PlaylistSnapshot {
            id: "large".to_string(),
            name: "大歌单".to_string(),
            songs: songs.clone(),
        }],
        queue: Vec::new(),
        current_song: None,
        delta: None,
    };
    sync_library_snapshot(&mut conn, &snapshot).unwrap();
    let pair_count: i64 = conn
        .query_row("SELECT COUNT(*) FROM item_cooccurrence", [], |row| {
            row.get(0)
        })
        .unwrap();
    let candidates = recall::collect_candidates(&conn, Some(&songs[0]), 100).unwrap();

    assert_eq!(pair_count, 0);
    assert!(candidates.iter().any(|candidate| {
        candidate.track_key != "netease:0"
            && candidate
                .reasons
                .iter()
                .any(|reason| reason == "来自你的歌单共现")
    }));
}
