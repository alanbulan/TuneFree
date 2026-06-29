# TuneFree Desktop 本地与云端大模型混合推荐系统开发规格

版本：v1.1.2 基线  
适用仓库：`F:\Code\Active\TuneFree\tauri`  
目标平台：Tauri v2 Windows 桌面端  
文档状态：开发规格，不是已实现功能说明

## 1. 结论

当前项目可以实现比现有外部推荐列表更智能的推荐系统。可行方案不是在本机运行大模型，也不是把完整播放历史直接上传给模型，而是采用“本地推荐主干 + OpenAI 兼容云端大模型增强”的混合架构。

第一版目标：

- 本地用 SQLite 保存歌曲、行为日志、画像、共现索引、推荐缓存。
- 本地完成多路召回、粗排、去重、多样性重排，保证断网也能推荐。
- 云端大模型通过 OpenAI 兼容 Chat Completions 接口做意图理解、候选语义重排、冷启动主题扩展和自然语言推荐理由。
- 大模型只处理本地筛出的少量候选，不接收完整播放历史、下载路径、音频文件、歌词全文。
- 本地不默认引入 embedding、ONNX、ALS、BPR、Transformer/DNN 推荐模型。

内存结论：

- 本地推荐额外常驻内存目标控制在 20-80 MB。
- 云端 GPT 类模型不常驻本机内存，只产生 HTTP 请求和少量 JSON 缓存。
- 大模型能力增强主要消耗网络、接口费用和延迟，不会像本地模型一样占用大内存。

质量边界：

- 可以做到接近工业推荐链路的工程形态：召回、粗排、重排、反馈、解释、缓存、降级。
- 不能承诺等同网易云、Spotify 这类平台的线上推荐质量，因为当前没有全站用户协同数据、版权平台全量行为、长期 A/B 实验和大规模训练样本。
- 在个人本地资料库、播放历史、收藏和歌单范围内，可以明显强于当前 `gdStudio.ts` 外部列表式推荐。

## 2. 当前项目基线

当前真实技术栈：

- 前端：Next.js 16.2.9、React 19.2.7、TypeScript 6.0.3、Framer Motion 12、Lucide React 1。
- 桌面容器：Tauri 2.11.3。
- Rust 后端：Axum 0.8.9、Tower HTTP 0.7、Reqwest 0.12。
- 存储：前端资料库主要在 localStorage；下载元数据在下载目录 `downloads.json`。
- 本地服务：`src-tauri/src/server.rs` 提供 `/api/url`、`/api/cors-proxy`、`/health`。
- Tauri 命令：下载、扫描下载目录、保存下载元数据、删除下载、离线播放解析、打开外部链接、选择下载目录、更新安装等。

当前没有：

- SQLite 推荐数据库。
- 行为日志表。
- 用户画像表。
- 本地召回、排序、重排服务。
- 推荐缓存和反馈闭环。
- OpenAI 兼容模型配置。
- 云端语义重排、意图理解和推荐解释。

当前“AI 推荐”位于 `src/core/services/gdStudio.ts`，它是外部接口返回推荐列表后再搜索歌曲，不是基于本地画像和行为反馈的推荐系统。

## 3. 总体架构

```text
React / Next.js
  ├─ PlayerContext: 播放、暂停、切歌、进度埋点
  ├─ LibraryContext: 收藏、歌单、本地资料库同步
  ├─ DesktopHome: 本地推荐 / 智能推荐入口
  ├─ SongTable: 推荐原因、反馈、不感兴趣
  └─ SettingsView: 本地推荐与云端模型配置

Tauri IPC
  ├─ log_recommendation_event
  ├─ sync_recommendation_library
  ├─ get_home_recommendations
  ├─ get_similar_songs
  ├─ get_llm_enhanced_recommendations
  ├─ dismiss_recommendation
  ├─ save_recommendation_feedback
  ├─ rebuild_recommendation_index
  ├─ get_llm_config
  ├─ save_llm_config
  └─ test_llm_provider

Rust recommendation service
  ├─ 本地 catalog / events / profile
  ├─ 多路 recall
  ├─ local rank
  ├─ LLM prompt builder
  ├─ OpenAI-compatible provider
  ├─ LLM rerank parser / validator
  ├─ MMR / safety rerank
  └─ recommendation cache

SQLite
  ├─ tracks
  ├─ play_events
  ├─ user_profile
  ├─ item_cooccurrence
  ├─ recommendation_cache
  ├─ dismissed_recommendations
  ├─ recommendation_feedback
  ├─ llm_config
  ├─ llm_recommendation_cache
  └─ llm_calls
```

推荐请求链路：

```text
用户上下文
  -> 本地召回 200-500 首候选
  -> 本地粗排 50-100 首候选
  -> 云端大模型语义重排 20-40 首候选
  -> 本地校验 track_key、过滤、MMR 多样性
  -> 返回最终 20-30 首推荐
```

断网或模型关闭时：

```text
用户上下文
  -> 本地召回
  -> 本地粗排
  -> 本地 MMR
  -> 返回本地推荐
```

## 4. 产品目标

### 4.1 用户体验目标

1. 用户听几首歌后，首页出现“本地推荐”。
2. 用户开启云端智能增强后，首页出现“智能推荐”，推荐理由更自然。
3. 用户播放某首歌时，可以打开“相似歌曲”。
4. 用户收藏、下载、加入歌单后，推荐能在本地快速变好。
5. 用户选择“不感兴趣”后，类似结果短期减少。
6. 断网、模型超时、模型配置错误时，推荐功能仍可回退到本地结果。
7. 用户能在设置页关闭云端增强、清空推荐数据、测试模型连接。

### 4.2 工程目标

1. 推荐核心运行在 Rust 本地后端。
2. 前端通过 Tauri command 获取推荐结果。
3. 本地行为只写入本机 SQLite。
4. 云端模型只作为可选增强层，不成为播放、搜索、下载的硬依赖。
5. LLM 输出必须经过本地校验，不允许编造歌曲进入最终结果。
6. 不阻塞播放、搜索、下载和歌词解析。
7. 保持现有 localStorage 资料库可用，逐步同步到 SQLite。

## 5. 非目标

第一版不做：

- 本机运行 GPT、LLM、ONNX 深度模型或本地向量数据库。
- 上传完整播放历史、完整歌单、下载路径、音频文件或歌词全文。
- 多用户协同过滤。
- 大规模深度学习训练。
- 音频指纹、节拍、情绪识别。
- 全量歌词 NLP 向量化。
- 自动替换现有搜索源和下载逻辑。
- 对云端模型提供商做付费、额度、账号管理。

## 6. 依赖变更

### 6.1 Rust

在 `src-tauri/Cargo.toml` 增加：

```toml
rusqlite = { version = "0.40", features = ["bundled"] }
parking_lot = "0.12"
keyring = "3"
```

说明：

- `rusqlite` 直接、轻量，适合 Tauri 本地 SQLite。
- `bundled` 降低 Windows 用户环境差异。
- `parking_lot` 用于推荐服务状态锁，减少标准锁中毒处理噪音。
- `keyring` 用于把云端模型 API Key 保存到系统凭据管理器，避免明文写入 SQLite。
- 现有 `reqwest` 已能发起 OpenAI 兼容 HTTP 请求，不需要新增 HTTP 客户端。

不引入：

- `sqlx`：当前本地推荐查询规模不需要异步 SQL 框架。
- 向量数据库：第一版不存大向量。
- 本地推理运行时：第一版不跑本地模型。

### 6.2 前端

第一版不新增 npm 依赖。现有 React hooks、Tauri API、SongTable、SettingsView 能覆盖 UI 接入。

## 7. SQLite 存储位置

数据库文件放在 Tauri app data 目录：

```text
{app_data_dir}/tunefree/recommendation.sqlite
```

不得放在项目目录、安装目录或下载目录。

Rust 侧通过 `app_handle.path().app_data_dir()` 获取路径，首次启动时创建目录和数据库。

## 8. 数据模型

### 8.1 tracks

保存推荐系统知道的歌曲。来源包括搜索结果、榜单结果、收藏、歌单、播放队列、下载记录。

```sql
CREATE TABLE IF NOT EXISTS tracks (
  track_key TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  source_id TEXT NOT NULL,
  name TEXT NOT NULL,
  artist TEXT NOT NULL,
  album TEXT NOT NULL DEFAULT '',
  pic TEXT,
  url_id TEXT,
  lyric_id TEXT,
  types_json TEXT,
  normalized_name TEXT NOT NULL DEFAULT '',
  normalized_artist TEXT NOT NULL DEFAULT '',
  first_seen_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tracks_source ON tracks(source);
CREATE INDEX IF NOT EXISTS idx_tracks_artist ON tracks(normalized_artist);
CREATE INDEX IF NOT EXISTS idx_tracks_seen ON tracks(last_seen_at);
```

`track_key` 使用规则：`${source}:${id}`。如果 `id` 是对象，先按现有歌曲结构取稳定字段，再序列化生成 key。

### 8.2 play_events

所有推荐行为从这里回放生成。

```sql
CREATE TABLE IF NOT EXISTS play_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type TEXT NOT NULL,
  track_key TEXT,
  source TEXT,
  source_id TEXT,
  session_id TEXT NOT NULL,
  position_seconds REAL,
  duration_seconds REAL,
  quality TEXT,
  context TEXT,
  weight REAL NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_play_events_track ON play_events(track_key, created_at);
CREATE INDEX IF NOT EXISTS idx_play_events_type ON play_events(event_type, created_at);
CREATE INDEX IF NOT EXISTS idx_play_events_session ON play_events(session_id, created_at);
```

事件权重：

| event_type | 触发点 | 默认权重 |
| --- | --- | --- |
| `play_start` | `playSong` 成功设置音频源 | 1.0 |
| `play_30s` | 当前歌播放超过 30 秒 | 2.0 |
| `play_complete` | 播放进度超过 80% 或 ended | 4.0 |
| `skip_early` | 30 秒内切歌 | -2.5 |
| `favorite_add` | 收藏 | 5.0 |
| `favorite_remove` | 取消收藏 | -4.0 |
| `playlist_add` | 加入歌单 | 3.0 |
| `download` | 下载成功 | 4.0 |
| `similar_click` | 点击推荐结果 | 2.5 |
| `llm_recommend_click` | 点击智能推荐结果 | 3.0 |
| `dismiss` | 不感兴趣 | -5.0 |

### 8.3 user_profile

保存可解释画像，不保存大向量。

```sql
CREATE TABLE IF NOT EXISTS user_profile (
  key TEXT PRIMARY KEY,
  value REAL NOT NULL,
  updated_at INTEGER NOT NULL
);
```

key 示例：

- `artist:初月`
- `source:netease`
- `quality:flac24bit`
- `keyword:chill`
- `album:...`
- `type:flac`

### 8.4 item_cooccurrence

保存轻量 ItemCF 共现结果。只保留每首歌 TopK。

```sql
CREATE TABLE IF NOT EXISTS item_cooccurrence (
  track_key TEXT NOT NULL,
  related_track_key TEXT NOT NULL,
  score REAL NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (track_key, related_track_key)
);

CREATE INDEX IF NOT EXISTS idx_item_co_score ON item_cooccurrence(track_key, score DESC);
```

### 8.5 recommendation_cache

保存本地推荐缓存。

```sql
CREATE TABLE IF NOT EXISTS recommendation_cache (
  cache_key TEXT PRIMARY KEY,
  payload_json TEXT NOT NULL,
  generated_at INTEGER NOT NULL
);
```

### 8.6 dismissed_recommendations

用户明确不感兴趣的歌曲短期屏蔽。

```sql
CREATE TABLE IF NOT EXISTS dismissed_recommendations (
  track_key TEXT PRIMARY KEY,
  reason TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
```

### 8.7 recommendation_feedback

保存推荐后的显式反馈，供后续权重调整。

```sql
CREATE TABLE IF NOT EXISTS recommendation_feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id TEXT NOT NULL,
  track_key TEXT NOT NULL,
  action TEXT NOT NULL,
  recommendation_source TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_rec_feedback_request ON recommendation_feedback(request_id);
CREATE INDEX IF NOT EXISTS idx_rec_feedback_track ON recommendation_feedback(track_key, created_at);
```

`recommendation_source` 取值：

- `local`
- `llm`
- `hybrid`

### 8.8 llm_config

保存云端模型非敏感配置。API Key 不写入该表，使用系统凭据管理器保存。

```sql
CREATE TABLE IF NOT EXISTS llm_config (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  enabled INTEGER NOT NULL DEFAULT 0,
  base_url TEXT NOT NULL DEFAULT '',
  model TEXT NOT NULL DEFAULT '',
  timeout_ms INTEGER NOT NULL DEFAULT 8000,
  max_candidates INTEGER NOT NULL DEFAULT 80,
  max_results INTEGER NOT NULL DEFAULT 30,
  cache_ttl_seconds INTEGER NOT NULL DEFAULT 86400,
  upload_recent_events INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);
```

配置字段：

| 字段 | 默认值 | 说明 |
| --- | --- | --- |
| `enabled` | `false` | 是否启用云端智能增强 |
| `base_url` | 空 | OpenAI 兼容 API 根地址，例如 `https://api.openai.com/v1` |
| `model` | 空 | 用户填写的模型名 |
| `timeout_ms` | `8000` | 单次请求超时 |
| `max_candidates` | `80` | 发送给模型的候选上限 |
| `max_results` | `30` | 模型可返回的结果上限 |
| `cache_ttl_seconds` | `86400` | 智能重排缓存时间 |
| `upload_recent_events` | `false` | 是否允许上传最近少量事件摘要，默认关闭 |

### 8.9 llm_recommendation_cache

保存大模型重排结果，降低延迟和接口费用。

```sql
CREATE TABLE IF NOT EXISTS llm_recommendation_cache (
  cache_key TEXT PRIMARY KEY,
  model TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  response_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_llm_cache_expires ON llm_recommendation_cache(expires_at);
```

`cache_key` 由以下内容 hash 生成：

- `model`
- `profile_top_tokens`
- `context`
- `candidate_track_keys`
- `seed_track_key`

### 8.10 llm_calls

记录调用统计，不保存 API Key 和完整请求体。

```sql
CREATE TABLE IF NOT EXISTS llm_calls (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id TEXT NOT NULL,
  model TEXT NOT NULL,
  status TEXT NOT NULL,
  latency_ms INTEGER,
  candidate_count INTEGER NOT NULL,
  result_count INTEGER NOT NULL,
  error_code TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_llm_calls_created ON llm_calls(created_at);
```

## 9. Rust 模块设计

新增目录：

```text
src-tauri/src/recommendation/
  mod.rs
  db.rs
  migration.rs
  model.rs
  events.rs
  catalog.rs
  profile.rs
  recall.rs
  rank.rs
  rerank.rs
  llm_config.rs
  provider.rs
  prompt.rs
  llm.rs
  privacy.rs
  service.rs
```

### 9.1 model.rs

核心结构：

```rust
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct RecSong {
    pub id: serde_json::Value,
    pub source: String,
    pub name: String,
    pub artist: String,
    pub album: String,
    pub pic: Option<String>,
    pub url_id: Option<String>,
    pub lyric_id: Option<String>,
    pub types: Option<Vec<String>>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct RecommendationItem {
    pub song: RecSong,
    pub score: f64,
    pub reasons: Vec<String>,
    pub recommendation_source: String,
    pub request_id: String,
}

#[derive(Debug, Clone, serde::Deserialize)]
pub struct RecommendationQuery {
    pub limit: Option<usize>,
    pub seed: Option<RecSong>,
    pub context: Option<String>,
    pub use_llm: Option<bool>,
}

#[derive(Debug, Clone, serde::Deserialize)]
pub struct RecommendationEvent {
    pub event_type: String,
    pub song: Option<RecSong>,
    pub position_seconds: Option<f64>,
    pub duration_seconds: Option<f64>,
    pub quality: Option<String>,
    pub context: Option<String>,
}
```

### 9.2 service.rs

`RecommendationService` 负责串联所有步骤。

职责：

- 初始化数据库。
- 接收前端事件并写入日志。
- upsert 歌曲到 catalog。
- 增量更新画像。
- 根据上下文生成本地推荐。
- 在配置允许时调用 LLM 增强。
- 周期性重建共现索引。
- 统一处理缓存、错误和降级。

Tauri 状态：

```rust
.manage(RecommendationService::new(app.handle().clone(), client.clone())?)
```

服务内部使用 `Mutex<Connection>` 或单线程任务队列。SQLite 写入必须串行，避免 Windows 文件锁问题。

### 9.3 provider.rs

`OpenAiCompatibleProvider` 负责调用 OpenAI 兼容接口。

请求接口：

```text
POST {base_url}/chat/completions
Authorization: Bearer {api_key}
Content-Type: application/json
```

请求体第一版只使用通用字段：

```json
{
  "model": "用户配置的模型名",
  "messages": [],
  "temperature": 0.2,
  "response_format": { "type": "json_object" }
}
```

兼容策略：

- 优先使用 `response_format: { "type": "json_object" }`。
- 如提供商不支持该字段，测试连接时标记 `supports_json_object = false`，正式请求改用纯 prompt 约束并做本地 JSON 解析。
- 不依赖 OpenAI 专有工具调用、向量接口或 Responses API，保证兼容更多 GPT 格式服务。

### 9.4 prompt.rs

只构造推荐所需的最小上下文。

允许上传：

- 当前播放歌曲的 `name`、`artist`、`album`、`source`。
- 本地画像 Top 30 token。
- 本地粗排后的候选列表，最多 80 首。
- 最近事件摘要，默认不上传；用户开启后最多 20 条，只包含事件类型和歌曲基础元数据。

禁止上传：

- API Key。
- 本地文件路径。
- 下载目录。
- 音频 URL。
- 完整播放历史。
- 完整歌单。
- 歌词全文。
- 用户系统信息。

### 9.5 llm.rs

职责：

- 读取 LLM 配置。
- 生成 cache key。
- 命中缓存时直接返回。
- 调用 provider。
- 解析 JSON。
- 校验 `track_key` 是否全部来自候选。
- 合并 LLM score 与本地 score。
- 写入 `llm_calls` 和 `llm_recommendation_cache`。

LLM 失败时必须返回本地推荐，不向前端抛出致命错误。

## 10. Tauri command 设计

### 10.1 本地推荐命令

```rust
#[tauri::command]
async fn log_recommendation_event(
    state: State<'_, RecommendationService>,
    event: RecommendationEvent,
) -> Result<(), String>
```

写日志失败不应打断播放，但要写 Rust log。

```rust
#[tauri::command]
async fn sync_recommendation_library(
    state: State<'_, RecommendationService>,
    snapshot: LibrarySnapshot,
) -> Result<(), String>
```

把 localStorage 中的收藏、歌单、队列、当前歌曲同步到 SQLite，不删除 localStorage 原数据。

```rust
#[tauri::command]
async fn get_home_recommendations(
    state: State<'_, RecommendationService>,
    query: RecommendationQuery,
) -> Result<Vec<RecommendationItem>, String>
```

默认：

- `limit = 30`
- `use_llm = false`
- 不传 seed 时按用户画像推荐。
- 冷启动不足时返回收藏、歌单、榜单缓存候选。

```rust
#[tauri::command]
async fn get_similar_songs(
    state: State<'_, RecommendationService>,
    song: RecSong,
    limit: Option<usize>,
    use_llm: Option<bool>,
) -> Result<Vec<RecommendationItem>, String>
```

相似推荐优先级：

1. ItemCF 共现。
2. 同歌手 / 同专辑 / 同来源。
3. 名称关键词相似。
4. 当前歌所在队列附近歌曲。
5. LLM 对候选语义重排。

```rust
#[tauri::command]
async fn dismiss_recommendation(
    state: State<'_, RecommendationService>,
    song: RecSong,
    reason: Option<String>,
) -> Result<(), String>
```

默认屏蔽 14 天。

```rust
#[tauri::command]
async fn save_recommendation_feedback(
    state: State<'_, RecommendationService>,
    feedback: RecommendationFeedback,
) -> Result<(), String>
```

记录点击、播放、跳过、不感兴趣等反馈。

```rust
#[tauri::command]
async fn rebuild_recommendation_index(
    state: State<'_, RecommendationService>,
) -> Result<(), String>
```

用于用户导入歌单后、资料库异常修复后、调试推荐质量。

### 10.2 云端模型命令

```rust
#[tauri::command]
async fn get_llm_config(
    state: State<'_, RecommendationService>,
) -> Result<LlmConfigView, String>
```

返回配置时不返回 API Key 明文，只返回 `has_api_key`。

```rust
#[tauri::command]
async fn save_llm_config(
    state: State<'_, RecommendationService>,
    config: LlmConfigInput,
) -> Result<(), String>
```

保存规则：

- 非敏感配置写 SQLite。
- API Key 写系统凭据管理器。
- API Key 为空时保留已有 key。
- 用户点击“清除密钥”时删除系统凭据。

```rust
#[tauri::command]
async fn test_llm_provider(
    state: State<'_, RecommendationService>,
) -> Result<LlmProviderTestResult, String>
```

验证：

- `base_url` 是否可访问。
- API Key 是否有效。
- 模型名是否可调用。
- 是否支持 JSON object response。
- 返回延迟和错误摘要。

```rust
#[tauri::command]
async fn get_llm_enhanced_recommendations(
    state: State<'_, RecommendationService>,
    query: RecommendationQuery,
) -> Result<Vec<RecommendationItem>, String>
```

行为：

- 先生成本地候选。
- LLM 未启用、配置无效、断网、超时时，返回本地结果。
- LLM 成功时返回 `recommendation_source = "hybrid"` 的推荐项。

## 11. 前端接入设计

### 11.1 新增服务封装

新增：

```text
src/core/services/recommendation.ts
```

封装：

```ts
export async function logRecommendationEvent(event: RecommendationEvent): Promise<void>;
export async function syncRecommendationLibrary(snapshot: LibrarySnapshot): Promise<void>;
export async function getHomeRecommendations(options?: RecommendationOptions): Promise<RecommendationItem[]>;
export async function getSimilarSongs(song: Song, options?: RecommendationOptions): Promise<RecommendationItem[]>;
export async function getLlmEnhancedRecommendations(options?: RecommendationOptions): Promise<RecommendationItem[]>;
export async function dismissRecommendation(song: Song, reason?: string): Promise<void>;
export async function saveRecommendationFeedback(feedback: RecommendationFeedback): Promise<void>;
export async function rebuildRecommendationIndex(): Promise<void>;
export async function getLlmConfig(): Promise<LlmConfigView>;
export async function saveLlmConfig(config: LlmConfigInput): Promise<void>;
export async function testLlmProvider(): Promise<LlmProviderTestResult>;
```

所有函数必须判断是否在 Tauri 环境：

- Tauri：走 `invoke`。
- 浏览器开发预览：返回空数组或 no-op。

### 11.2 PlayerContext 埋点

在 `src/core/contexts/PlayerContext.tsx` 加入：

- `playSong` 成功后记录 `play_start`。
- 播放超过 30 秒只记录一次 `play_30s`。
- `ended` 或进度超过 80% 记录 `play_complete`。
- `playNext` / `playPrev` 在 30 秒内切歌时记录 `skip_early`。
- 切换音质时记录 quality 到事件。

埋点不能阻塞播放：

```ts
void logRecommendationEvent(...).catch(() => {});
```

### 11.3 LibraryContext 埋点

在 `src/core/contexts/LibraryContext.tsx` 加入：

- `toggleFavorite` 添加时记录 `favorite_add`。
- `toggleFavorite` 移除时记录 `favorite_remove`。
- `addToPlaylist` 成功时记录 `playlist_add`。
- 资料库初始化后同步 `favorites`、`playlists`、`queue`。

### 11.4 下载埋点

下载成功并保存元数据后记录 `download`。

接入点：

- `src/desktop/hooks/useSongDownload.ts`
- 或 `save_download_meta` 对应前端调用完成后。

### 11.5 首页推荐入口

`src/desktop/features/home/DesktopHome.tsx` 当前有榜单和 AI 推荐。新增两个入口：

- `本地推荐`：只使用本地推荐链路。
- `智能推荐`：本地候选 + 云端大模型增强；未配置时显示设置入口。

行为：

- 点击 `本地推荐` 调用 `getHomeRecommendations({ limit: 30, useLlm: false })`。
- 点击 `智能推荐` 调用 `getLlmEnhancedRecommendations({ limit: 30, useLlm: true })`。
- 返回空时展示冷启动提示，并引导播放或收藏几首歌。
- SongTable 每行展示推荐原因，原因来自本地特征或 LLM 解释。

### 11.6 相似歌曲入口

在全屏播放器或当前播放区域增加“相似歌曲”入口：

- 当前有歌时调用 `getSimilarSongs(currentSong, { limit: 20, useLlm })`。
- 结果复用 `SongTable`。
- 点击播放推荐项时记录 `similar_click` 或 `llm_recommend_click`。

### 11.7 设置页

在 `SettingsView` 增加“推荐系统”区域：

- 启用本地推荐：默认开启。
- 启用云端智能增强：默认关闭。
- API 根地址。
- 模型名。
- API Key 输入框。
- 测试连接按钮。
- 请求超时。
- 候选数量上限。
- 缓存时间。
- 是否允许上传最近事件摘要：默认关闭。
- 重建推荐索引。
- 清空推荐数据。
- 显示数据库大小和智能缓存大小。

## 12. 推荐算法规格

### 12.1 歌曲标准化

标准化字段：

- `normalized_name`
- `normalized_artist`
- `source`
- `album`
- `types`

规则：

- 小写。
- 去首尾空白。
- 多歌手用 `/`、`&`、`,`、`、` 切分。
- live、伴奏、remix、cover 等作为弱特征，不直接删除原名。
- 不同来源的同名同歌手歌曲可以保留多个候选，但最终排序阶段需要去重。

### 12.2 用户画像更新

每个事件产生权重 `w`。

对歌曲提取 token：

- `artist:{artist}`
- `source:{source}`
- `album:{album}`
- `quality:{quality}`
- `keyword:{name_token}`
- `type:{type}`

更新公式：

```text
new_value = old_value * decay + w * token_weight
```

建议：

- `decay = 0.985`
- artist token weight = 1.0
- source token weight = 0.45
- album token weight = 0.35
- keyword token weight = 0.25
- quality token weight = 0.15

画像只保留 Top 500 token。低于 `0.05` 的 token 可在维护任务中清理。

### 12.3 本地召回通道

| 通道 | 数量 | 来源 |
| --- | --- | --- |
| 最近播放相似 | 80 | 最近 20 首播放成功歌曲 |
| 收藏相似 | 80 | 收藏歌曲 |
| 歌单共现 | 80 | 用户歌单内共同出现 |
| ItemCF 共现 | 100 | `item_cooccurrence` |
| 画像匹配 | 100 | `user_profile` token |
| 当前队列扩展 | 50 | 当前播放队列 |
| 冷启动 fallback | 50 | 收藏、下载、榜单缓存 |

候选合并后最多保留 500 条进入本地粗排。

### 12.4 ItemCF 共现

数据来源：

- 同一播放 session 内连续播放。
- 同一歌单内共同出现。
- 收藏集合内共同出现。
- 下载集合内共同出现。

共现分数：

```text
score(i, j) += event_weight / log(2 + container_size)
```

TopK：

- 每首歌最多保留 50 个 related。
- 重建任务可在应用空闲时运行。

### 12.5 本地粗排

每个候选计算：

| 特征 | 含义 |
| --- | --- |
| `profile_score` | 画像 token 命中 |
| `itemcf_score` | 共现分数 |
| `artist_match` | 歌手命中 |
| `source_preference` | 来源偏好 |
| `recent_penalty` | 最近听过惩罚 |
| `dismiss_penalty` | 不感兴趣惩罚 |
| `quality_bonus` | 有高音质类型或本地缓存 |
| `freshness_bonus` | 最近加入资料库 |
| `diversity_seed_score` | 和当前 seed 的适度相似 |

线性排序：

```text
score =
  1.20 * profile_score +
  1.00 * itemcf_score +
  0.70 * artist_match +
  0.35 * source_preference +
  0.20 * quality_bonus +
  0.15 * freshness_bonus +
  0.25 * diversity_seed_score -
  1.50 * recent_penalty -
  3.00 * dismiss_penalty
```

所有分数归一化到 0-1 后计算。粗排后最多取 80 首发送给 LLM。

### 12.6 云端大模型语义重排

LLM 只做增强，不做最终事实来源。

输入：

- 推荐场景：`home`、`similar`、`cold_start`。
- 用户可解释画像 Top 30。
- 当前 seed 歌曲，可为空。
- 本地粗排候选，最多 80 首。
- 每首候选只包含 `track_key`、`name`、`artist`、`album`、`source`、`local_score`、`local_reasons`。

输出：

- 候选 `track_key` 的新排序。
- 每首歌 1-2 条短推荐理由。
- 可选意图标签，例如 `jpop`、`female_vocal`、`acoustic`。
- 可选剔除理由。

硬性规则：

- 只能返回输入候选里的 `track_key`。
- 不能编造歌曲、歌手、专辑。
- 不能要求上传更多隐私数据。
- 不能返回 Markdown 文本作为主结果。
- 不能让低本地分且无明确理由的候选进入前排。

LLM 分数融合：

```text
hybrid_score =
  0.65 * local_score +
  0.25 * llm_rank_score +
  0.10 * explanation_confidence
```

当用户行为日志少于 10 条时：

```text
hybrid_score =
  0.50 * local_score +
  0.40 * llm_rank_score +
  0.10 * explanation_confidence
```

### 12.7 MMR 与安全重排

LLM 返回后仍需本地 MMR。

```text
mmr = lambda * relevance - (1 - lambda) * max_similarity(selected, candidate)
```

建议：

- `lambda = 0.78`
- 同歌手 similarity = 0.8
- 同专辑 similarity = 0.6
- 同来源 similarity = 0.15
- 名称 token 重叠 similarity = 0.3

配额：

- 单一歌手不超过结果数的 25%。
- 单一来源不超过结果数的 70%，除非候选不足。
- 最近 2 小时完整播放过的歌默认不推荐。
- 用户明确 dismiss 的歌曲在过期前不得返回。

### 12.8 推荐解释

本地解释示例：

- `因为你常听 {artist}`
- `和当前播放歌曲风格相近`
- `来自你的收藏偏好`
- `来自你的歌单共现`
- `你最近常听 {source_label}`
- `高音质候选`

LLM 解释要求：

- 每条不超过 24 个中文字符。
- 只基于候选和画像摘要。
- 不使用“你一定喜欢”这类绝对表达。
- 不暴露模型推理过程。
- 不提“算法”“大模型”“上传数据”。

## 13. LLM Prompt 与 JSON Schema

### 13.1 System Prompt

```text
你是 TuneFree Desktop 的音乐推荐重排器。
你只能基于用户提供的候选歌曲重新排序，不能编造候选之外的歌曲。
你需要兼顾相关性、多样性、用户最近偏好和听歌场景。
输出必须是合法 JSON，不要输出 Markdown，不要解释你的推理过程。
```

### 13.2 User Prompt 结构

```json
{
  "scene": "home",
  "limit": 30,
  "profile_tokens": [
    { "key": "artist:初月", "value": 0.92 },
    { "key": "source:netease", "value": 0.48 }
  ],
  "seed": {
    "track_key": "netease:123",
    "name": "歌曲名",
    "artist": "歌手"
  },
  "candidates": [
    {
      "track_key": "netease:456",
      "name": "候选歌曲",
      "artist": "候选歌手",
      "album": "专辑",
      "source": "netease",
      "local_score": 0.82,
      "local_reasons": ["因为你常听 候选歌手"]
    }
  ]
}
```

### 13.3 返回 JSON

```json
{
  "intent_tags": ["jpop", "female_vocal"],
  "items": [
    {
      "track_key": "netease:456",
      "rank": 1,
      "score": 0.94,
      "reason": "延续你常听的日系人声"
    }
  ],
  "dropped": [
    {
      "track_key": "netease:789",
      "reason": "和当前偏好关联弱"
    }
  ]
}
```

本地校验：

- `items[].track_key` 必须存在于候选列表。
- `score` 缺失时按 `rank` 转换。
- `rank` 重复时按返回顺序处理。
- 未返回的候选保留在尾部，使用本地 score 排序。
- JSON 解析失败、字段缺失或未知 key 超过 20% 时，整次 LLM 结果作废。

## 14. 冷启动策略

行为日志不足 10 条时：

1. 使用收藏歌曲和歌单歌曲作为候选。
2. 使用当前播放队列扩展。
3. 使用最近打开的榜单歌曲。
4. 云端增强开启时，让 LLM 基于少量画像和候选做语义重排。
5. 如果仍为空，首页保留现有榜单推荐，不展示空推荐。

冷启动提示：

```text
多播放或收藏几首歌后，推荐会更准确。
```

冷启动时不允许 LLM 直接生成最终歌曲。它只能：

- 对已有候选排序。
- 生成搜索关键词建议供后续搜索流程使用。
- 给候选生成短理由。

## 15. 数据同步策略

### 15.1 从 localStorage 同步

首次启动推荐服务后，前端调用：

```ts
syncRecommendationLibrary({
  favorites,
  playlists,
  queue,
  currentSong,
});
```

作用：

- 把 favorites、playlists、queue 里的歌曲 upsert 到 `tracks`。
- 根据收藏和歌单生成弱行为事件。
- 不删除 localStorage 原数据。

### 15.2 从 downloads.json 同步

Rust 侧已有 `scan_download_dir`。推荐服务可以复用下载目录解析：

- upsert 下载歌曲到 `tracks`。
- 写入 `download` 事件。
- 标记 `quality_bonus`。

## 16. 隐私与安全

默认策略：

- 本地推荐数据仅保存在本机。
- 云端智能增强默认关闭。
- API Key 不写入 SQLite、不写日志、不出现在前端普通状态对象中。
- 默认不上传最近事件摘要。
- 每次请求只上传少量候选元数据和画像 Top token。
- 清空推荐数据不删除收藏、歌单、下载文件。

设置页必须明确显示：

- 启用云端智能增强会把候选歌曲元数据发送到用户配置的模型服务。
- 关闭云端智能增强后，只使用本地推荐。
- 清除 API Key 会删除系统凭据中的密钥。

日志禁止记录：

- API Key。
- Authorization header。
- 完整请求体。
- 完整响应体。
- 本地文件路径。

## 17. 成本、限流与降级

成本控制：

- 每次最多发送 80 首候选。
- 每首候选只发必要字段。
- 相同上下文命中缓存，不重复请求。
- 默认缓存 24 小时。
- 用户频繁切换 tab 时，同一请求 2 秒内去重。

超时和失败：

- 默认超时 8 秒。
- 401 / 403：提示密钥或权限错误，关闭本次智能增强。
- 404：提示模型名或 base_url 错误。
- 429：提示限流，并使用本地推荐。
- 5xx / 网络错误：静默回退本地推荐，设置页记录最近错误。
- JSON 解析失败：记录 `llm_calls.status = invalid_json`，回退本地推荐。

降级顺序：

```text
LLM 缓存
  -> 实时 LLM 重排
  -> 本地推荐缓存
  -> 本地实时推荐
  -> 现有榜单 / 收藏 / 歌单 fallback
```

## 18. 性能预算

| 操作 | 目标 |
| --- | --- |
| 写事件 | < 20 ms |
| 首页本地推荐缓存命中 | < 50 ms |
| 首页本地推荐重算 | < 300 ms |
| 相似歌曲本地推荐 | < 150 ms |
| LLM 缓存命中 | < 80 ms |
| LLM 实时增强 | < 8 s |
| 重建共现索引 | 1000 首歌内 < 2 s |
| 本地额外常驻内存 | < 80 MB |
| SQLite 文件 | 初期 < 20 MB |
| 单次 LLM 请求 JSON | 目标 < 80 KB |

超过预算时：

- 降低候选数量。
- 缩小 ItemCF TopK。
- 延长缓存时间。
- 后台分批处理。
- LLM 降级为只解释前 30 首候选。

## 19. 错误处理

推荐失败时：

- 不影响播放。
- 不影响搜索。
- 不影响下载。
- 首页推荐区域显示轻量提示。
- Rust log 记录错误摘要。
- 前端 fallback 到现有榜单或空态。

SQLite 打不开时：

- 禁用本地推荐。
- 不阻止应用启动。
- 设置页显示“推荐数据库不可用”。

系统凭据不可用时：

- 不保存 API Key。
- 设置页提示“密钥保存失败，请重新输入或关闭云端增强”。
- 不把 API Key 明文写入 SQLite 作为自动降级。

## 20. 开发阶段

### 阶段 1：SQLite 基础与迁移

文件：

- `src-tauri/src/recommendation/db.rs`
- `src-tauri/src/recommendation/migration.rs`
- `src-tauri/src/recommendation/model.rs`

完成标准：

- 应用启动后能创建 SQLite。
- migration 可重复执行。
- `tracks`、`play_events`、`user_profile` 表存在。
- `cargo check` 通过。

### 阶段 2：事件埋点与资料库同步

文件：

- `src/core/services/recommendation.ts`
- `src/core/contexts/PlayerContext.tsx`
- `src/core/contexts/LibraryContext.tsx`
- `src/desktop/hooks/useSongDownload.ts`

完成标准：

- 播放、完成、早切、收藏、歌单、下载事件能写入 SQLite。
- localStorage 收藏、歌单、队列可同步到 `tracks`。
- 事件失败不影响播放器。
- 有基础单元测试覆盖权重映射。

### 阶段 3：本地画像、召回与排序

文件：

- `recommendation/catalog.rs`
- `recommendation/profile.rs`
- `recommendation/recall.rs`
- `recommendation/rank.rs`
- `recommendation/rerank.rs`
- `recommendation/service.rs`

完成标准：

- 任意 `Song` 可转换为 `tracks` 记录。
- 画像 token 可增量更新。
- 画像 Top 500 清理有效。
- `get_home_recommendations` 返回稳定结果。
- `get_similar_songs` 可基于当前歌曲返回候选。
- 冷启动不报错。

### 阶段 4：前端本地推荐 UI

文件：

- `DesktopHome.tsx`
- `SongTable.tsx`
- `DesktopFullPlayer.tsx` 或 `FullPlayerActions.tsx`
- `SettingsView.tsx`

完成标准：

- 首页有“本地推荐”入口。
- 当前歌曲有“相似歌曲”入口。
- 设置页可重建和清空推荐数据。
- 推荐项有本地原因。
- UI 不阻塞、不闪退。

### 阶段 5：云端模型配置与连接测试

文件：

- `recommendation/llm_config.rs`
- `recommendation/provider.rs`
- `recommendation/privacy.rs`
- `SettingsView.tsx`
- `src/core/services/recommendation.ts`

完成标准：

- 设置页可保存 base_url、model、timeout、候选数、缓存时间。
- API Key 存入系统凭据管理器。
- `test_llm_provider` 能返回成功、失败、延迟和 JSON 支持情况。
- 密钥不会进入日志、SQLite 和普通前端状态。

### 阶段 6：LLM 重排与混合推荐

文件：

- `recommendation/prompt.rs`
- `recommendation/llm.rs`
- `recommendation/service.rs`
- `DesktopHome.tsx`
- `SongTable.tsx`

完成标准：

- 本地粗排后最多 80 首候选发送给 LLM。
- LLM 只能返回候选 `track_key`。
- LLM JSON 解析和校验失败时自动回退本地推荐。
- 智能推荐有自然语言短理由。
- LLM 缓存生效。

### 阶段 7：验证与发布

完成标准：

- `npm run lint`
- `npm test -- --run`
- `cargo check`
- `npx tauri build`
- 手动验证：
  - 新用户冷启动。
  - 播放 3 首后出现本地推荐。
  - 收藏后推荐变化。
  - 早切后该歌降低出现概率。
  - 云端增强关闭时仅走本地。
  - 云端增强开启且连接成功时出现智能推荐。
  - 断网或模型错误时回退本地推荐。
  - 清空推荐数据后恢复冷启动。

## 21. 测试规格

### 21.1 Rust 单元测试

覆盖：

- song key 生成。
- 事件权重。
- token 标准化。
- profile 更新和 decay。
- ItemCF 共现 TopK。
- 线性排序。
- MMR 去重。
- LLM cache key 生成。
- LLM 返回 JSON 校验。
- 未知 `track_key` 过滤。

### 21.2 前端测试

覆盖：

- `recommendation.ts` 在非 Tauri 环境 no-op。
- 推荐结果转换成 `SongTable` 输入。
- 设置页保存、测试连接、清空、重建按钮状态。
- 智能推荐未配置时显示设置入口。

### 21.3 集成测试

流程：

1. 启动应用。
2. 播放歌曲 A 超过 30 秒。
3. 收藏歌曲 B。
4. 加入歌单 C。
5. 请求首页本地推荐。
6. 验证推荐不为空且包含原因。
7. 配置测试模型服务。
8. 请求智能推荐。
9. 验证返回结果都来自本地候选。
10. 模拟模型超时。
11. 验证回退本地推荐。

## 22. 发布规则

推荐系统功能进入发布包时必须：

- 升级 `package.json`、`src-tauri/Cargo.toml`、`src-tauri/tauri.conf.json` 版本。
- 重新生成 `package-lock.json` 和 `Cargo.lock`。
- 构建 `release/TuneFree_{version}_x64-setup.exe`。
- 创建对应 Git tag。
- 创建 GitHub Release，并上传 exe asset。
- Release 标题、提交信息、发布说明使用中文。
- 确认 `https://api.github.com/repos/alanbulan/TuneFree_Mobile/releases/latest` 返回新版本。

应用内更新检测依赖 GitHub Release asset，不依赖单纯 Git tag，也不依赖仓库里的 `release/` 目录文件。

## 23. 风险与处理

| 风险 | 处理 |
| --- | --- |
| 推荐质量达不到“大厂”预期 | 明确第一版是工业链路形态，不等同平台级全量推荐；用反馈和缓存持续调权 |
| LLM 编造歌曲 | 只接受候选 `track_key`，未知 key 全部丢弃 |
| LLM 延迟高 | 缓存、超时、本地回退 |
| LLM 成本高 | 限制候选数、缓存、请求去重 |
| API Key 泄露 | 系统凭据保存，日志脱敏，不写 SQLite |
| SQLite 文件损坏 | 启动时备份损坏文件并新建库 |
| 推荐重复 | 增强 MMR 和 recent penalty |
| 写事件过频 | 播放进度事件节流，只记录关键节点 |
| DB 锁 | 写入串行化，避免多线程同时写 |
| 用户不想被记录 | 设置页提供关闭和清空 |

## 24. 第一版验收清单

- [ ] 新增 SQLite 推荐数据库。
- [ ] 事件日志可写入。
- [ ] 收藏、歌单、下载、播放事件可被推荐使用。
- [ ] 首页本地推荐可展示。
- [ ] 当前歌曲相似推荐可展示。
- [ ] 推荐项有本地原因。
- [ ] 设置页可清空和重建推荐数据。
- [ ] 云端模型配置可保存。
- [ ] API Key 不写入 SQLite 和日志。
- [ ] 模型连接可测试。
- [ ] 智能推荐只返回本地候选歌曲。
- [ ] LLM 失败时回退本地推荐。
- [ ] 内存不因推荐功能持续增长。
- [ ] 发布包版本号、Git tag、GitHub Release asset 同步。

## 25. 后续可选增强

这些能力不能进入第一版默认实现：

- 本地歌词关键词抽取。
- 可选小型 embedding 索引。
- ONNX 精排模型。
- ALS / BPR 离线训练。
- 推荐结果 A/B 参数调试面板。
- 推荐质量离线回放评估。
- 多模型路由和成本统计面板。
- 按场景自动生成搜索关键词并扩展候选池。

只有当第一版日志量足够、内存预算明确、用户可关闭时，才考虑引入。
