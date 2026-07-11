use super::*;

#[test]
fn merge_keeps_discovery_candidates_inside_llm_window() {
    let local_items: Vec<_> = (0..20)
        .map(|index| recommendation_item("local", &index.to_string(), &format!("本地歌{index}")))
        .collect();
    let discovered: Vec<_> = (0..5)
        .map(|index| discovered_song(&format!("new-{index}"), &format!("新歌{index}")))
        .collect();

    let merged = merge_discovery_candidates(local_items, discovered, "req-test", 12, None);
    let first_window = merged.iter().take(12).collect::<Vec<_>>();
    let discovery_count = first_window
        .iter()
        .filter(|item| item.recommendation_source == "discovery")
        .count();

    assert_eq!(discovery_count, 5);
}

#[test]
fn seed_identity_is_excluded_across_sources() {
    let seed = song("netease", "1", "同一首歌", "同一歌手");
    let same_source = song("netease", "1", "同一首歌", "同一歌手");
    let cross_source = song("qq", "other", " 同一首歌 ", "同一歌手");
    let other = song("qq", "2", "另一首歌", "同一歌手");

    assert!(is_seed_song(&same_source, &seed));
    assert!(is_seed_song(&cross_source, &seed));
    assert!(!is_seed_song(&other, &seed));
}
