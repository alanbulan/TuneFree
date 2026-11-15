-- 整理日期：2026-11-15；保留原迁移语义。
UPDATE play_events
SET weight = CASE event_type
  WHEN 'play_start' THEN 1.0
  WHEN 'play_30s' THEN 2.0
  WHEN 'play_complete' THEN 4.0
  WHEN 'skip_early' THEN -2.5
  WHEN 'favorite_add' THEN 5.0
  WHEN 'favorite_remove' THEN -4.0
  WHEN 'playlist_add' THEN 3.0
  WHEN 'download' THEN 4.0
  WHEN 'recommendation_click' THEN 2.5
  WHEN 'similar_click' THEN 2.5
  WHEN 'llm_recommend_click' THEN 3.0
  WHEN 'dismiss' THEN -5.0
  ELSE 0.0
END;
DELETE FROM item_cooccurrence;
