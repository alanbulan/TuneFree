use std::collections::HashSet;

use rusqlite::Connection;

use super::{catalog, model::RecommendationItem};

#[derive(Default)]
pub struct RecommendationExclusions {
    track_keys: HashSet<String>,
    identities: HashSet<String>,
}

impl RecommendationExclusions {
    pub fn load(conn: &Connection) -> rusqlite::Result<Self> {
        let now = catalog::now_ms();
        let mut exclusions = Self::default();
        let mut stmt = conn.prepare(
            r#"
            SELECT t.track_key, t.name, t.artist
            FROM dismissed_recommendations d
            JOIN tracks t ON t.track_key = d.track_key
            WHERE d.expires_at > ?1
            UNION
            SELECT t.track_key, t.name, t.artist
            FROM play_events e
            JOIN tracks t ON t.track_key = e.track_key
            WHERE e.event_type = 'play_complete' AND e.created_at > ?2
            "#,
        )?;
        let recent_since = now - 2 * 60 * 60 * 1000;
        let rows = stmt.query_map([now, recent_since], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
            ))
        })?;
        for row in rows {
            let (track_key, name, artist) = row?;
            exclusions.track_keys.insert(track_key);
            exclusions.identities.insert(format!(
                "{}:{}",
                catalog::normalize_text(&name),
                catalog::normalize_text(&artist)
            ));
        }
        Ok(exclusions)
    }

    pub fn allows_item(&self, item: &RecommendationItem) -> bool {
        !self.track_keys.contains(&catalog::track_key(&item.song))
            && !self
                .identities
                .contains(&catalog::song_identity(&item.song))
    }
}

pub fn filter_items(
    conn: &Connection,
    items: Vec<RecommendationItem>,
) -> rusqlite::Result<Vec<RecommendationItem>> {
    let exclusions = RecommendationExclusions::load(conn)?;
    Ok(items
        .into_iter()
        .filter(|item| exclusions.allows_item(item))
        .collect())
}

#[cfg(test)]
mod tests {
    use rusqlite::Connection;
    use serde_json::json;

    use super::*;
    use crate::recommendation::{catalog, migration, model::RecSong};

    fn item(source: &str, id: &str, name: &str) -> RecommendationItem {
        RecommendationItem {
            song: RecSong {
                id: json!(id),
                source: source.to_string(),
                name: name.to_string(),
                artist: "Artist".to_string(),
                album: String::new(),
                pic: None,
                pic_id: None,
                url_id: None,
                lyric_id: None,
                types: None,
            },
            score: 0.8,
            reasons: Vec::new(),
            recommendation_source: "hybrid".to_string(),
            request_id: "request".to_string(),
        }
    }

    #[test]
    fn dismissal_filters_same_song_across_sources() {
        let conn = Connection::open_in_memory().unwrap();
        migration::run_migrations(&conn).unwrap();
        let dismissed = item("netease", "1", "Same Song");
        let key = catalog::upsert_track(&conn, &dismissed.song).unwrap();
        conn.execute(
            "INSERT INTO dismissed_recommendations (track_key, created_at, expires_at) VALUES (?1, ?2, ?3)",
            rusqlite::params![key, catalog::now_ms(), catalog::now_ms() + 60_000],
        )
        .unwrap();

        let filtered = filter_items(
            &conn,
            vec![
                dismissed,
                item("qq", "2", "Same Song"),
                item("qq", "3", "Other"),
            ],
        )
        .unwrap();
        assert_eq!(filtered.len(), 1);
        assert_eq!(filtered[0].song.name, "Other");
    }
}
