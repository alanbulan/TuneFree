-- 整理日期：2026-11-15；原迁移版本 5，仅升级旧版的 8 秒默认值。
-- ?1 由 Rust 的 DEFAULT_LLM_TIMEOUT_MS 提供，用户后续保存的值不再改写。
UPDATE llm_config SET timeout_ms = ?1 WHERE id = 1 AND timeout_ms = 8000;
