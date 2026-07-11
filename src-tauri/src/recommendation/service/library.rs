use super::*;

impl RecommendationService {
    pub fn sync_library(&self, snapshot: LibrarySnapshot) -> Result<(), String> {
        let library_changed = {
            let mut conn = self.conn.lock();
            if let Some(delta) = snapshot.delta.as_ref() {
                apply_library_delta(&mut conn, delta)?
            } else {
                sync_library_snapshot(&mut conn, &snapshot)?
            }
        };

        if library_changed {
            self.invalidate_and_schedule_refresh("曲库同步");
        }
        Ok(())
    }

    pub fn rebuild_index(&self) -> Result<(), String> {
        let mut conn = self.conn.lock();
        let tx = conn
            .transaction()
            .map_err(|e| format!("开启共现索引事务失败: {}", e))?;
        rebuild_cooccurrence_index(&tx).map_err(|e| format!("重建共现索引失败: {}", e))?;
        tx.commit()
            .map_err(|e| format!("提交共现索引事务失败: {}", e))?;
        Ok(())
    }
}

pub(super) fn sync_library_snapshot(
    conn: &mut Connection,
    snapshot: &LibrarySnapshot,
) -> Result<bool, String> {
    let (new_memberships, library_tracks) = build_library_memberships(snapshot);
    let tx = conn
        .transaction()
        .map_err(|e| format!("开启曲库同步事务失败: {}", e))?;
    let old_memberships =
        load_library_memberships(&tx).map_err(|e| format!("读取曲库成员失败: {}", e))?;
    let added_memberships = new_memberships
        .difference(&old_memberships)
        .cloned()
        .collect::<Vec<_>>();
    let removed_memberships = old_memberships
        .difference(&new_memberships)
        .cloned()
        .collect::<Vec<_>>();
    let mut upsert_songs = Vec::new();
    for (track_key, song) in &library_tracks {
        let existing =
            catalog::get_track(&tx, track_key).map_err(|e| format!("读取曲库歌曲失败: {}", e))?;
        if existing
            .as_ref()
            .map(|current| !song_metadata_equal(current, song))
            .unwrap_or(true)
        {
            upsert_songs.push(song.clone());
        }
    }
    let library_changed =
        apply_library_changes(&tx, &upsert_songs, &added_memberships, &removed_memberships)?;

    for song in &snapshot.queue {
        catalog::upsert_track(&tx, song).map_err(|e| format!("同步播放队列失败: {}", e))?;
    }
    if let Some(song) = &snapshot.current_song {
        catalog::upsert_track(&tx, song).map_err(|e| format!("同步当前歌曲失败: {}", e))?;
    }

    tx.commit()
        .map_err(|e| format!("提交曲库同步事务失败: {}", e))?;
    Ok(library_changed)
}

pub(super) fn apply_library_delta(
    conn: &mut Connection,
    delta: &LibraryDelta,
) -> Result<bool, String> {
    let added_memberships = delta
        .added_memberships
        .iter()
        .map(library_membership_from_change)
        .collect::<Result<Vec<_>, _>>()?;
    let removed_memberships = delta
        .removed_memberships
        .iter()
        .map(library_membership_from_change)
        .collect::<Result<Vec<_>, _>>()?;
    let tx = conn
        .transaction()
        .map_err(|e| format!("开启曲库增量同步事务失败: {}", e))?;
    let changed = apply_library_changes(
        &tx,
        &delta.upsert_songs,
        &added_memberships,
        &removed_memberships,
    )?;
    tx.commit()
        .map_err(|e| format!("提交曲库增量同步事务失败: {}", e))?;
    Ok(changed)
}

fn apply_library_changes(
    conn: &Connection,
    upsert_songs: &[RecSong],
    added_memberships: &[LibraryMembershipKey],
    removed_memberships: &[LibraryMembershipKey],
) -> Result<bool, String> {
    if upsert_songs.is_empty() && added_memberships.is_empty() && removed_memberships.is_empty() {
        return Ok(false);
    }

    let affected_keys = affected_track_keys(upsert_songs, added_memberships, removed_memberships);
    update_affected_profiles(conn, &affected_keys, -1.0, "读取变更前曲库歌曲失败")?;
    remove_memberships(conn, removed_memberships)?;

    for song in upsert_songs {
        catalog::upsert_track(conn, song).map_err(|e| format!("更新曲库歌曲失败: {}", e))?;
    }
    add_memberships(conn, added_memberships)?;
    update_affected_profiles(conn, &affected_keys, 1.0, "读取变更后曲库歌曲失败")?;
    profile::prune_library_profile(conn).map_err(|e| format!("清理曲库画像失败: {}", e))?;
    Ok(true)
}

fn affected_track_keys(
    songs: &[RecSong],
    added: &[LibraryMembershipKey],
    removed: &[LibraryMembershipKey],
) -> HashSet<String> {
    songs
        .iter()
        .map(catalog::track_key)
        .chain(added.iter().map(|item| item.track_key.clone()))
        .chain(removed.iter().map(|item| item.track_key.clone()))
        .collect()
}

fn update_affected_profiles(
    conn: &Connection,
    track_keys: &HashSet<String>,
    direction: f64,
    error_context: &str,
) -> Result<(), String> {
    for track_key in track_keys {
        if let Some(song) = catalog::get_track(conn, track_key)
            .map_err(|error| format!("{}: {}", error_context, error))?
        {
            apply_membership_profile(conn, track_key, &song, direction)?;
        }
    }
    Ok(())
}

fn remove_memberships(
    conn: &Connection,
    memberships: &[LibraryMembershipKey],
) -> Result<(), String> {
    for item in memberships {
        conn.execute(
            "DELETE FROM library_membership WHERE container_type = ?1 AND container_id = ?2 AND track_key = ?3",
            params![&item.container_type, &item.container_id, &item.track_key],
        )
        .map_err(|error| format!("删除曲库成员失败: {}", error))?;
    }
    Ok(())
}

fn add_memberships(conn: &Connection, memberships: &[LibraryMembershipKey]) -> Result<(), String> {
    let now = catalog::now_ms();
    for item in memberships {
        if catalog::get_track(conn, &item.track_key)
            .map_err(|error| format!("检查曲库歌曲失败: {}", error))?
            .is_none()
        {
            return Err(format!("新增曲库成员缺少歌曲信息: {}", item.track_key));
        }
        conn.execute(
            "INSERT OR IGNORE INTO library_membership (container_type, container_id, track_key, updated_at) VALUES (?1, ?2, ?3, ?4)",
            params![&item.container_type, &item.container_id, &item.track_key, now],
        )
        .map_err(|error| format!("新增曲库成员失败: {}", error))?;
    }
    Ok(())
}

fn apply_membership_profile(
    conn: &Connection,
    track_key: &str,
    song: &RecSong,
    direction: f64,
) -> Result<(), String> {
    let mut stmt = conn
        .prepare("SELECT container_type FROM library_membership WHERE track_key = ?1")
        .map_err(|e| format!("读取曲库成员画像失败: {}", e))?;
    let memberships = stmt
        .query_map([track_key], |row| row.get::<_, String>(0))
        .and_then(|rows| rows.collect::<rusqlite::Result<Vec<_>>>())
        .map_err(|e| format!("读取曲库成员画像失败: {}", e))?;
    for container_type in memberships {
        profile::add_library_profile_for_song(
            conn,
            song,
            direction * membership_profile_weight(&container_type),
            None,
        )
        .map_err(|e| format!("更新曲库画像失败: {}", e))?;
    }
    Ok(())
}

fn library_membership_from_change(
    change: &LibraryMembershipChange,
) -> Result<LibraryMembershipKey, String> {
    if !matches!(change.container_type.as_str(), "favorite" | "playlist")
        || change.container_id.trim().is_empty()
        || change.track_key.trim().is_empty()
    {
        return Err("曲库增量成员参数无效".to_string());
    }
    Ok(LibraryMembershipKey {
        container_type: change.container_type.clone(),
        container_id: change.container_id.clone(),
        track_key: change.track_key.clone(),
    })
}

fn song_metadata_equal(left: &RecSong, right: &RecSong) -> bool {
    left.source == right.source
        && left.name == right.name
        && left.artist == right.artist
        && left.album == right.album
        && left.pic == right.pic
        && left.url_id == right.url_id
        && left.lyric_id == right.lyric_id
        && left.types == right.types
}

fn build_library_memberships(
    snapshot: &LibrarySnapshot,
) -> (HashSet<LibraryMembershipKey>, HashMap<String, RecSong>) {
    let mut memberships = HashSet::new();
    let mut tracks = HashMap::new();

    for song in &snapshot.favorites {
        let track_key = catalog::track_key(song);
        tracks.insert(track_key.clone(), song.clone());
        memberships.insert(LibraryMembershipKey {
            container_type: "favorite".to_string(),
            container_id: "favorites".to_string(),
            track_key,
        });
    }

    for playlist in &snapshot.playlists {
        for song in &playlist.songs {
            let track_key = catalog::track_key(song);
            tracks.insert(track_key.clone(), song.clone());
            memberships.insert(LibraryMembershipKey {
                container_type: "playlist".to_string(),
                container_id: playlist.id.clone(),
                track_key,
            });
        }
    }

    (memberships, tracks)
}

fn load_library_memberships(conn: &Connection) -> rusqlite::Result<HashSet<LibraryMembershipKey>> {
    let mut stmt =
        conn.prepare("SELECT container_type, container_id, track_key FROM library_membership")?;
    let rows = stmt.query_map([], |row| {
        Ok(LibraryMembershipKey {
            container_type: row.get(0)?,
            container_id: row.get(1)?,
            track_key: row.get(2)?,
        })
    })?;
    rows.collect()
}

fn membership_profile_weight(container_type: &str) -> f64 {
    match container_type {
        "favorite" => FAVORITE_PROFILE_WEIGHT,
        "playlist" => PLAYLIST_PROFILE_WEIGHT,
        _ => 0.0,
    }
}

pub(super) fn rebuild_cooccurrence_index(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM item_cooccurrence", [])?;
    events::rebuild_session_cooccurrence(conn)
}
