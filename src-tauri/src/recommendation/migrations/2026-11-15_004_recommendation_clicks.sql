-- 整理日期：2026-11-15；保留原迁移语义。
UPDATE play_events
SET event_type = 'recommendation_click', weight = 2.5
WHERE event_type = 'similar_click'
  AND COALESCE(context, '') != 'similar';
