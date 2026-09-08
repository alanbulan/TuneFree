use super::*;
use serde_json::json;

fn database() -> Connection {
    let conn = Connection::open_in_memory().unwrap();
    migration::run_migrations(&conn).unwrap();
    conn
}

fn song(id: &str) -> RecSong {
    serde_json::from_value(json!({
        "id": id, "source":"qq", "name":id, "artist":"歌手", "album":"专辑"
    }))
    .unwrap()
}

fn empty_snapshot() -> LibrarySnapshot {
    LibrarySnapshot {
        favorites: vec![],
        playlists: vec![],
        queue: vec![],
        current_song: None,
        delta: None,
    }
}

fn track_count(conn: &Connection) -> i64 {
    conn.query_row("SELECT COUNT(*) FROM tracks", [], |row| row.get(0))
        .unwrap()
}

#[test]
fn invalid_delta_memberships_are_rejected_before_mutating_the_library() {
    for (kind, container, key) in [
        ("queue", "queue", "qq:1"),
        ("favorite", " ", "qq:1"),
        ("playlist", "list", " "),
    ] {
        for is_removal in [false, true] {
            let mut conn = database();
            let member = LibraryMembershipChange {
                container_type: kind.into(),
                container_id: container.into(),
                track_key: key.into(),
            };
            let delta = LibraryDelta {
                upsert_songs: vec![song("1")],
                added_memberships: if is_removal {
                    vec![]
                } else {
                    vec![member.clone()]
                },
                removed_memberships: if is_removal { vec![member] } else { vec![] },
            };
            assert!(apply_library_delta(&mut conn, &delta)
                .unwrap_err()
                .contains("成员参数无效"));
            assert_eq!(track_count(&conn), 0);
        }
    }
}

#[test]
fn a_membership_cannot_reference_a_song_missing_from_both_the_database_and_delta() {
    let mut conn = database();
    let delta = LibraryDelta {
        upsert_songs: vec![song("present")],
        added_memberships: vec![LibraryMembershipChange {
            container_type: "favorite".into(),
            container_id: "favorites".into(),
            track_key: "qq:missing".into(),
        }],
        removed_memberships: vec![],
    };
    assert!(apply_library_delta(&mut conn, &delta)
        .unwrap_err()
        .contains("缺少歌曲信息"));
    assert_eq!(track_count(&conn), 0);
}

#[test]
fn rejected_queue_or_current_song_rolls_back_the_rest_of_a_library_snapshot() {
    for current in [false, true] {
        let mut conn = database();
        conn.execute_batch(
            "CREATE TRIGGER reject_song BEFORE INSERT ON tracks WHEN NEW.track_key='qq:rejected'
             BEGIN SELECT RAISE(ABORT, 'song unavailable'); END;",
        )
        .unwrap();
        let snapshot = LibrarySnapshot {
            favorites: vec![song("favorite")],
            queue: if current {
                vec![]
            } else {
                vec![song("rejected")]
            },
            current_song: current.then(|| song("rejected")),
            ..empty_snapshot()
        };
        let error = sync_library_snapshot(&mut conn, &snapshot).unwrap_err();
        assert!(error.contains(if current {
            "同步当前歌曲失败"
        } else {
            "同步播放队列失败"
        }));
        assert_eq!(track_count(&conn), 0);
        assert_eq!(
            conn.query_row("SELECT COUNT(*) FROM library_membership", [], |row| row
                .get::<_, i64>(0))
                .unwrap(),
            0
        );
    }
}

#[test]
fn old_unrecognized_memberships_do_not_contribute_preference_weight() {
    let mut conn = database();
    catalog::upsert_track(&conn, &song("old")).unwrap();
    conn.execute(
        "INSERT INTO library_membership VALUES('queue','old-queue','qq:old',1)",
        [],
    )
    .unwrap();
    assert!(sync_library_snapshot(&mut conn, &empty_snapshot()).unwrap());
    assert_eq!(
        conn.query_row("SELECT COUNT(*) FROM library_profile", [], |row| row
            .get::<_, i64>(0))
            .unwrap(),
        0
    );
    assert_eq!(track_count(&conn), 1);
}
