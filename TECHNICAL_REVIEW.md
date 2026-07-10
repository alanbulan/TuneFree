# TuneFree Desktop 技术审查与核验报告

> 本文是 2026-07-10 修复工作开始时的审查基线，用于保留问题依据和修复路线。文中“严重问题”“待复核”等状态不代表当前分支的最终状态；当前实现与验证结果应以代码、测试和对应发布记录为准。

> 审查日期：2026-07-04
> 审查对象：`tauri` 分支 @ `b04665f`（v1.1.15）
> 审查范围：前端核心层（contexts/services/utils）、桌面 UI 层与样式、Rust 后端（src-tauri）、工程规范与构建配置
> 核验说明：本文档中标记 **[已核验]** 的条目均经过逐行代码复核并附有确切的 `文件:行号` 证据，可直接作为修复依据；标记 **[待复核]** 的条目来自初审，动手前需先确认现状。

---

## 目录

1. [项目基线状态](#1-项目基线状态)
2. [严重问题（P0）](#2-严重问题p0)
3. [中等问题（P1）](#3-中等问题p1)
4. [轻微与打磨项（P2）](#4-轻微与打磨项p2)
5. [工程规范缺口](#5-工程规范缺口)
6. [架构优点（修复时不要破坏的设计）](#6-架构优点修复时不要破坏的设计)
7. [修复路线图](#7-修复路线图)
8. [附录：复核修正记录](#8-附录复核修正记录)

---

## 1. 项目基线状态

审查开始时项目构建与测试**全绿**，所有修复工作应保持这一基线：

| 检查项 | 命令 | 结果 |
|---|---|---|
| TypeScript 类型检查 | `npm run lint`（实为 `tsc --noEmit`） | 通过，0 错误 |
| 前端单元测试 | `npm test`（vitest） | 81 个测试全部通过 |
| Rust 静态检查 | `cargo clippy` | 0 warning |
| Rust 单元测试 | `cargo test` | 9 个测试全部通过 |

**技术栈**：Tauri 2.11.5（Rust 后端 + Webview）、Vite 8（多页静态构建）、React 19、TypeScript 7、framer-motion 12；Rust 侧为 axum 0.8 内嵌 HTTP 服务（127.0.0.1:3002）、reqwest 0.13（rustls）、rusqlite 0.40（bundled）、tokio、parking_lot、single-instance。

**代码规模（Rust 侧）**：`lib.rs` 1045 行、`recommendation/service.rs` 1170 行、`recommendation/llm.rs` 612 行、`recommendation/discovery.rs` 451 行、`api/kuwo.rs` 330 行，合计约 5920 行。前端 `app/globals.css` 2832 行。

---

## 2. 严重问题（P0）

以下 4 项均为 **[已核验]** 的确定性缺陷，不是边界条件，建议最优先修复。

### P0-1. 下载与自动更新在 30 秒后必然失败

**位置**：`src-tauri/src/lib.rs:908-913`（client 构建）、`lib.rs:368-435`（`download_with_progress`）、`lib.rs:453`（`download_song_to_local`）、`lib.rs:841`（`download_and_install_update`）

**机制**：全局共享的 reqwest client 设置了 `.timeout(30s)`：

```rust
let client = reqwest::Client::builder()
    .timeout(std::time::Duration::from_secs(30))   // ← 覆盖"从连接到 body 读完"的全程
    .connect_timeout(std::time::Duration::from_secs(10))
    .pool_max_idle_per_host(20)
    .build()
    .expect("Failed to build HTTP client");
```

reqwest 的 `Client::timeout` 是**整个请求生命周期**的超时（含流式读取 body 的全部时间）。`download_song_to_local`（歌曲下载）与 `download_and_install_update`（自动更新）都通过 `State<reqwest::Client>` 复用这个 client。

**影响**：任何耗时超过 30 秒的下载**确定性中途失败**——大体积 FLAC（通常 30–80MB）、慢网环境下的更新包（约 6MB）都极易触发。用户表现为"下载到一半报错""自动更新总是失败转浏览器下载"。

**修复方案**：为下载场景单独构建一个 client（无整体 `timeout`，保留 `connect_timeout`），在 `run()` 中作为第二个 managed state（可用 newtype 包装如 `struct DownloadClient(reqwest::Client)` 以区分注入），`download_with_progress` 的两个调用方改用它。另可选：在流式读取循环中实现"块间超时"（例如单块 30s 无数据判定为断流），防止真正挂死的连接永久占用。

**验证方式**：下载一首 FLAC（>30s 网络耗时）应能完成；`cargo test` / `clippy` 保持绿色。

---

### P0-2. 拖拽进度条语义损坏（React `onChange` 陷阱）

**位置**：`src/desktop/components/DesktopTransport.tsx:270-280`、`src/desktop/components/DesktopFullPlayer.tsx:221-231`

**机制**：代码意图是 `onInput` 拖动预览、`onChange` 松手提交：

```tsx
onInput={(event) => {
  setIsDragging(true);
  setPreviewTime(Number(target.value));
}}
onChange={(event) => {
  setIsDragging(false);
  seek(value);          // ← 意图：松手才执行
}}
```

但 **React 对 `<input type="range">` 的 `onChange` 是由原生 `input` 事件合成的**，与 `onInput` 完全同时、逐次触发。实际行为是：拖动中每一次移动都会执行 `setIsDragging(false)` + `seek(value)`——预览状态刚设置就被取消，音频随拖动持续跳变。

**影响**：拖动进度条时音频反复 seek、卡顿；`isDragging` 状态高频抖动（true→false 每次移动一轮）。两个组件（迷你播放条 + 全屏播放器）行为一致。

**修复方案**：提交动作改绑 `onPointerUp` + `onKeyUp`（键盘方向键调节后松键提交），`onChange`/`onInput` 只更新预览值。注意触摸场景补 `onPointerCancel`。两个组件逻辑相同，建议抽出共用的 `ProgressSlider` 组件一并解决重复代码。

**验证方式**：手动拖动进度条，音频应在松手瞬间才跳转；拖动过程中时间标签平滑跟随。为 `isNewVersionAvailable` 式的纯逻辑补 vitest 不适用于此项，需手测。

---

### P0-3. DesktopShell 整树 10Hz 重渲染 + 高频跨窗口 IPC

**位置**：`src/core/contexts/PlayerContext.tsx:355-371`（节流源头）、`src/desktop/components/DesktopShell.tsx:221-250`（订阅点）

**机制**：PlayerContext 将 `currentTime` 更新节流到 100ms（注释明确写"~10fps"）：

```ts
// Throttle non-forced updates to ~10fps (100ms) to reduce re-renders.
if (force || Math.abs(nextTime - lastProgressTimeRef.current) >= 0.1) {
  updateCurrentTimeState(nextTime);   // setCurrentTime → context 更新
}
```

而 `DesktopShell.tsx:250` 的跨窗口歌词同步 effect 直接把 `currentTime` 放进依赖数组：

```ts
}, [currentSong, isPlaying, currentTime, duration, lyricOffsetSeconds, lyricDisplayMode, showDesktopLyric]);
```

这意味着 **DesktopShell 组件本身订阅了 10Hz 的状态**——每秒约 10 次重渲染整个 Shell 树（标题栏、侧边栏、当前视图 DesktopHome/DesktopSearch/DesktopLibrary、MiraPet、DesktopTransport），且开启桌面歌词时每次都执行一次 `emit('lyric-update')` 跨窗口 IPC（DesktopShell.tsx:227）。

**影响**：播放期间持续的 CPU 占用与耗电；所有子视图的 memo 都会被 Shell 层的重渲染波及（除非各自完全 memo 化）。

**修复方案**（三选一或组合）：
1. **推荐**：把歌词同步 effect 抽成一个不渲染任何 UI 的独立子组件（如 `<LyricSyncBridge />`），只有它订阅 `currentTime`，Shell 本体不再消费该值；
2. 或将 PlayerContext 拆分为"低频状态"（currentSong/isPlaying/duration）与"高频进度"（currentTime）两个 context，让绝大多数组件只订阅低频部分；
3. IPC 侧：`lyric-update` 的发送频率与 UI 渲染解耦（如 250ms 节流，歌词窗口用本地时钟插值——桌面歌词窗口已有 `sentAt` 字段可支持插值）。

**验证方式**：React DevTools Profiler 确认播放时 Shell 不再整树重渲染；歌词窗口滚动依旧平滑。

---

### P0-4. 撇号（`'`）破坏酷我搜索与歌单导入数据

**位置**（三处独立实现，同一错误模式）：
- 前端：`src/core/services/kuwo.ts:85` — `text = text.replace(/'/g, '"');`
- 前端：`src/core/services/playlistImport.ts:230` — `return JSON.parse(text.replace(/'/g, '"'));`
- 后端：`src-tauri/src/recommendation/discovery.rs:305` — `Ok(text) => text.replace('\'', "\"")`

**机制**：酷我 `search.kuwo.cn/r.s` 端点返回用单引号包裹的非标准 JSON，代码用"全局把单引号换成双引号"来修复。但数据**值内部**的撇号也会被替换：
- `Don't Stop` → `Don"t Stop`（字符串提前终止 → 整个响应 `JSON.parse` 失败 → 该次搜索静默返回空）
- 最好情况也是歌名被污染（`Don"t Stop` 展示给用户）。

**影响**：任何含撇号的英文歌名/歌手/专辑（*don't*、*I'm*、*Rock 'n' Roll*……）会导致酷我搜索结果整页丢失或文本损坏；歌单导入同理。这是"功能无法做到完美"最直接的一类缺陷。**注意**：`src-tauri/src/api/kuwo.rs`（播放地址解析）解析的是 `key=value` 文本格式（kuwo.rs:301-307），**不受影响，不要改它**。

**修复方案**：不做全局替换，改为容错解析。推荐策略（三处统一）：
1. 先直接 `JSON.parse` 原文（部分响应本身合法）；
2. 失败后做**结构感知替换**：仅替换紧邻 `{`、`}`、`[`、`]`、`,`、`:` 的定界单引号（正则如 `/(?<=[\{\[,:]\s*)'|'(?=\s*[:,\]\}])/g`），保留值内部撇号；
3. 再失败则记录日志并返回空（当前静默行为保底不变）。
前端两处可抽出共用的 `parseLooseJson()` 工具函数并补 vitest 用例（含 `Don't Stop`、`Rock 'n' Roll` 用例）；Rust 侧在 `discovery.rs` 内实现同等逻辑并补 `#[test]`。

**验证方式**：新增单测覆盖含撇号样本；实际搜索 "don't" 关键词应返回结果。

---

## 3. 中等问题（P1）

### 前端

#### P1-1. localStorage 写入无配额保护 [已核验]

**现状澄清**（初审夸大，复核后修正）：读取侧保护**已经很完善**——
- `LibraryContext.tsx:170-181` 的 `getStoredJson` 有 try/catch + `normalize` 结构校验 + 损坏数据自动备份（`backupCorruptStorage`，LibraryContext.tsx:154-158）；
- `playerPersistence.ts:10-18` 读取有 try/catch + fallback。

**真实剩余缺口**：
1. 所有 `localStorage.setItem` **写入**无 try/catch（`playerPersistence.ts:34-49`、`LibraryContext.tsx:168` 的 `setStoredValue`、`DesktopShell.tsx:255` 等 14 个文件）。配额溢出（`QuotaExceededError`）会从 effect 中向上抛出。
2. `playerPersistence.ts` 读取虽有 try/catch，但 `JSON.parse` 结果**直接断言为目标类型**（`:14`），缺 LibraryContext 那样的 `normalize` 形状校验——JSON 合法但结构错误的队列数据会直接流入播放器。

**修复方案**：新建 `src/core/utils/safeStorage.ts`，提供 `safeGet<T>(key, fallback, validate?)` / `safeSet(key, value)`（写入包 try/catch，失败时 console.warn 并可选清理最大键）；`playerPersistence` 增加与 `Song[]`/`PlayMode` 匹配的轻量校验函数；逐文件替换 14 处裸调用（`Grep: localStorage\.(getItem|setItem)`）。

#### P1-2. fetch 无超时控制 [已核验]

`src/core/services/gdStudio.ts:636`（`syncServerTime` 的 `/time` 请求）及同文件其余 `fetch` 调用均未传 `AbortSignal.timeout(...)`。端点挂起（不返回也不断开）会无限阻塞首次搜索。**注意**：初审声称的"syncServerTime 无界重试"不成立——它每次 API 调用最多尝试一次（gdStudio.ts:85-87 仅在 `!timeSynced` 时调用，且自身有 try/catch）。

**修复方案**：为 gdStudio.ts 内的 fetch 统一加 `signal: AbortSignal.timeout(10_000)`（时间同步可更短，5s）；其余 services 文件顺手排查。

#### P1-3. 搜索无限滚动缺去重与页数上限 [已核验]

`src/desktop/features/search/DesktopSearch.tsx:110-111`：

```ts
setResults((prev) => (page === 1 ? data : [...prev, ...data]));
setHasMore(data.length > 0);
```

**现状澄清**：初审的"失控分页"不成立——IntersectionObserver（`:148`）有 `hasMore && !isSearching && results.length > 0` 三重防护，请求不会并发失控。真实问题是：终止条件**仅依赖 API 返回空页**，且追加**不去重**。聚合源若反复返回相同结果（公开聚合接口常见行为），列表会无限累积重复项。

**修复方案**：追加时按 `source:id` 去重；若某页去重后新增为 0，视为到底（`setHasMore(false)`）；可加最大页数保险（如 20 页）。

#### P1-4. 组件渲染性能杂项 [待复核]

初审提出、尚未逐条验证的中等项，动手前先确认：
- 内联对象/回调导致子组件 memo 失效的若干位置；
- 列表渲染使用数组 index 作 key（增删时错位）；
- 个别 `useEffect` 依赖数组不完整或缺清理函数。

**建议**：这一类交给 ESLint（`react-hooks/exhaustive-deps`）在 P1-E1 落地后统一扫出，而不是人工排查。

### 桌面 UI / 跨窗口

#### P1-5. 死事件监听：`lock-change` 与 `theme-changed` [已核验]

`app/desktop-lyric/_core/useDesktopLyricBridge.ts:72` 监听 `lock-change`、`:118` 监听 `theme-changed`——**全仓库（src/、app/、src-tauri/）没有任何发射端**。

**影响澄清**：锁定功能本身仍可用（`lib.rs:182` 在 `show_desktop_lyric_window` 命令中原生调用 `set_ignore_cursor_events(lock)`），失效的是**歌词窗口打开期间**对锁定状态变更与主题切换的实时响应——用户在主窗口切换锁定/主题时，已打开的歌词窗口不会更新。

**修复方案**：在主窗口对应的状态变更处（锁定开关、`ThemeContext` 主题切换）补 `emit('lock-change', bool)` / `emit('theme-changed')`；或者反向清理——若确认这两个功能路径已由其它机制覆盖，删除死监听并在歌词窗口显示时一次性传入完整状态。**动手前需要先确认产品预期行为**。

#### P1-6. 桌面歌词 IPC 与渲染频率（与 P0-3 联动）

`lyric-update` 事件当前跟随 10Hz 状态更新发送。P0-3 修复时一并处理：payload 已含 `sentAt`（DesktopShell.tsx:242），歌词窗口可用本地时钟插值，事件频率可降至 2–4Hz 而不损失平滑度。

### Rust 后端

#### P1-7. LLM API Key 明文存储 [已核验]

`src-tauri/src/recommendation/migration.rs:118`（`api_key TEXT NOT NULL DEFAULT ''`）、`llm_config.rs:155-160`（明文读回）。API Key 明文存于用户 AppData 下的 SQLite。对本地单机应用是常见做法，但值得：① 在 README/设置界面明示"密钥明文存储于本地"；② 中期考虑 OS keyring（如 `keyring` crate）。**优先级低于功能缺陷，不阻塞。**

#### P1-8. 推荐服务单连接锁的串行化 [已核验，观察项]

`RecommendationService` 全部数据库操作走一个 `Mutex<Connection>`（service.rs:38）。复核确认**没有跨 `.await` 持锁**（所有锁作用域都在同步块内正确释放，如 service.rs:166-174、352-366），无死锁风险。但 `local_recommendations`（service.rs:702-724）在锁内做 500 候选召回 + 排序，期间其它推荐 IPC 会短暂阻塞。当前数据量下无感，曲库过万时可考虑：召回改只读连接（SQLite WAL 支持读写并行）或缩小锁粒度。**暂不动。**

#### P1-9. discovery 搜索静默吞错 [已核验]

`src-tauri/src/recommendation/discovery.rs` 中 `search_netease/search_qq/search_kuwo/fetch_kuwo_cover` 所有网络与解析失败一律 `return Vec::new()` / `None`（如 :123、:127、:211、:215、:301、:307），无任何日志。云端推荐"没有新歌"时无从排查是 LLM 问题还是平台搜索问题。

**修复方案**：失败分支补 `log::warn!("kuwo 搜索失败: {}", e)` 级别日志（注意不要把用户关键词泄漏到日志之外的地方）。

#### P1-10. kuwo 封面串行请求 [已核验]

`discovery.rs:354-359`：对每首无封面的酷我歌曲**串行 await** `fetch_kuwo_cover`。一页 N 首歌 = N 次串行 HTTP 往返，拖慢发现流程。可改 `futures::join_all` 或有界并发（如 4 路）。

### 桌面歌词窗口（Rust 侧）

#### P1-11. 窗口边界保存的 I/O 在事件回调中同步执行 [已核验，观察项]

`lib.rs:955-971`：`WindowEvent::Moved | Resized` 每次触发都同步执行 `save_desktop_lyric_bounds`（含 `std::fs::write`，lib.rs:107-111）。拖动窗口期间会产生高频磁盘写。影响轻微（文件仅几十字节），但拖动流畅度敏感的话可加 500ms 去抖。**暂不动，除非用户反馈拖动卡顿。**

---

## 4. 轻微与打磨项（P2）

### 样式与资源

| # | 条目 | 位置 | 状态 |
|---|---|---|---|
| P2-1 | **Google Fonts 外链 `@import`**：离线/网络受限时阻塞样式加载，与"桌面离线播放器"定位相悖。改为本地打包字体文件（Manrope + Noto Sans SC 子集化 woff2） | `app/globals.css:1` | [已核验] |
| P2-2 | `globals.css` 达 **2832 行**单文件，含约 130 行死 CSS。建议按组件域拆分 + 删除死代码（死 CSS 清单需用覆盖工具重新扫描确认） | `app/globals.css` | 行数[已核验]，死 CSS 明细[待复核] |
| P2-3 | 更新检查指向 `TuneFree_Mobile` 仓库的 releases（命名与桌面项目不符，确认是否为有意复用） | `useUpdateChecker.ts:21-22` | [已核验] |

### Rust 细节

| # | 条目 | 位置 | 说明 |
|---|---|---|---|
| P2-4 | `open_external_url` 的 doc 注释声称 `cmd /C start "" <url>` "preventing command injection"——**表述不准确**：空字符串只是占了 start 的窗口标题位，URL 未加引号，含 `&` 的 URL 会被 cmd 截断（当前调用方传入的都是 GitHub 受控 URL，实际风险低，但注释误导后人） | `lib.rs:729-761` | 修正注释；彻底方案是 URL 加引号或改用系统 API |
| P2-5 | `download_and_install_update` 的 host 白名单用 `ends_with("github.com")`，`"evilgithub.com"` 也能通过。应改为 `host == "github.com" \|\| host.ends_with(".github.com")` 模式（参照 `api/proxy.rs` 中 `is_allowed` 的精确+子域匹配写法） | `lib.rs:847-851` | 实际调用方 URL 来自 GitHub API 响应，风险为纵深防御级别 |
| P2-6 | HTTP client 构建失败 `.expect` 直接 panic（几乎不会触发，追求完美可降级为对话框报错退出） | `lib.rs:913` | 可不修 |
| P2-7 | `delete_download_file` 注释写"use trash if possible"但实现是 `remove_file` 直接删除，注释与实现不符；可考虑接入 `trash` crate 真正移入回收站 | `lib.rs:617-621` | 二选一：改注释或改实现 |
| P2-8 | `new_request_id()` 用毫秒时间戳，同一毫秒内并发生成会重复（`new_job_id` 已用原子序号规避，request_id 未) | `service.rs:727-729` | 影响仅限反馈归因，低危 |

### 前端细节 [待复核]

初审桌面 UI 报告中的次要项主题（约 14 条，未逐条验证，修复前需确认）：焦点管理细节、若干 aria 标签缺失、动画偏好（`prefers-reduced-motion`）未尊重、MiraPet 精灵图边界情况、部分魔法数字未提取常量等。建议在 P0/P1 完成后按需批量处理。

---

## 5. 工程规范缺口

全部 **[已核验]**。这是"代码规范"层面最集中的问题——代码本身风格统一、命名清晰、中文错误信息一致，但**缺少自动化护栏**：

| # | 现状 | 建议动作 |
|---|---|---|
| E1 | `package.json` 的 `"lint": "tsc --noEmit"`——只是类型检查，**项目没有任何 linter**（无 `.eslintrc*` / `eslint.config.*` / `.prettierrc*`） | 引入 ESLint 9（flat config）+ `eslint-plugin-react-hooks` + `@typescript-eslint`；Prettier 或 ESLint stylistic。`react-hooks/exhaustive-deps` 能自动抓出 P1-4 全部问题 |
| E2 | 无 `rustfmt.toml`、无 clippy 配置文件（虽然当前 clippy 干净） | 添加 `rustfmt.toml`（哪怕空文件表示采用默认）；CI 中 `cargo fmt --check` + `cargo clippy -- -D warnings` |
| E3 | **无 CI**（`.github/workflows` 不存在） | 最小 workflow：`tsc --noEmit` + `vitest run` + `cargo test` + `cargo clippy -- -D warnings`，Windows runner |
| E4 | `release/TuneFree_1.1.9_x64-setup.exe`（约 6MB 二进制）被 git 跟踪 | `git rm --cached` + `.gitignore` 加 `release/`；历史体积如需清理用 `git filter-repo`（**破坏性操作，需单独确认**） |
| E5 | 版本号分散：`bump-version.js` 已统一更新 4 处，但 `useUpdateChecker.ts:39` 的 `useState('1.1.15')` 硬编码 fallback 依赖脚本同步 | fallback 改为空串或 `'0.0.0'`（真实版本 2 秒内由 `getVersion()` 填充，硬编码值仅在极端情况下短暂展示），并从 bump-version.js 中移除该文件 |
| E6 | `lint` 脚本名不副实 | E1 落地后：`"lint": "eslint ."`、`"typecheck": "tsc --noEmit"`，CI 两者都跑 |

---

## 6. 架构优点（修复时不要破坏的设计）

复核过程中确认以下设计**正确且值得保持**，修复时注意不要顺手"优化"掉：

1. **本地服务安全边界**：axum 绑定 `127.0.0.1:3002` + 端口占用时 OS 随机端口回退 + `server-port` 事件通知前端（server.rs）；CORS 白名单仅限 127.0.0.1/localhost:3101 与 Tauri 本地源；`/api/cors-proxy` 有 22 个 host 的精确+子域白名单（proxy.rs 的 `is_allowed`），不是开放代理。
2. **优雅关闭链路**：`watch` channel 关闭信号贯穿 `AppLifecycleState` → 服务器 graceful shutdown → 托盘退出 → `RunEvent::ExitRequested`（lib.rs:150-162、1037-1044）。
3. **推荐数据库降级**：磁盘库打开失败自动降级为内存库并继续服务（service.rs:51-64）；WAL + busy_timeout + NORMAL synchronous（db.rs:23-28）；迁移幂等（`IF NOT EXISTS` + `column_exists` 检查）。
4. **推荐任务防竞态**：`recommendation_generation` 原子代数在每个 await 点后检查，`clear_data` 时递增使旧任务自然失效（service.rs:235-366）；动态刷新有去抖 + 最小间隔 + 运行中重试三层控制（service.rs:622-677）。
5. **前端已有的健壮性**：LibraryContext 的 `getStoredJson`（校验 + 损坏备份）是正确范式，P1-1 应把它推广而不是另起炉灶；`useUpdateChecker` 的 unlisten 清理模式（cancelled 标志 + 双路径清理）同样是正确范式。
6. **下载去重命名**、**downloads.json 与磁盘互相校验清理孤儿条目**（lib.rs:536-572）。

---

## 7. 修复路线图

按"收益/风险比"排序，每阶段完成后跑全量检查（`tsc && vitest run && cargo test && cargo clippy`）：

### 阶段一：确定性 bug（P0，建议一个 PR 一项）

| 顺序 | 任务 | 涉及文件 | 风险 |
|---|---|---|---|
| 1 | P0-1 下载专用 client | `lib.rs`（约 3 处改动） | 低，改动内聚 |
| 2 | P0-2 拖拽 seek 语义 | `DesktopTransport.tsx`、`DesktopFullPlayer.tsx`（可顺带抽共用组件） | 低 |
| 3 | P0-4 撇号容错解析 | `kuwo.ts`、`playlistImport.ts`、`discovery.rs` + 单测 | 中——需真实响应样本回归测试 |
| 4 | P0-3 Shell 高频重渲染 | `DesktopShell.tsx`（抽 LyricSyncBridge）、可选 `PlayerContext.tsx` 拆分 | 中——涉及 context 结构，需手测桌面歌词 |

### 阶段二：健壮性（P1）

5. P1-1 `safeStorage` 封装 + playerPersistence 形状校验（14 个文件替换）
6. P1-2 fetch 超时（gdStudio.ts 为主）
7. P1-3 搜索去重 + 到底判定
8. P1-5 死监听处理（**先与作者确认产品预期**：补发射端 vs 删监听）
9. P1-9 discovery 日志、P1-10 封面并发

### 阶段三：工程护栏（E 系列）

10. ESLint + Prettier + rustfmt 配置（E1/E2/E6）——落地后用 `react-hooks/exhaustive-deps` 扫 P1-4
11. GitHub Actions 最小 CI（E3）
12. 移除 git 跟踪的 exe（E4）、版本 fallback 清理（E5）

### 阶段四：打磨（P2）

13. 本地化字体（P2-1）、CSS 拆分与死代码清理（P2-2）
14. Rust 注释修正与白名单收紧（P2-4/P2-5/P2-7）
15. 前端次要项批量处理（复核后）

---

## 8. 附录：复核修正记录

初审由三路并行审查（前端核心、桌面 UI、Rust 后端）+ 工程规范检查构成。终审对全部"严重"结论做了逐行复核，修正如下——**后续如引用初审报告原文，以本节修正为准**：

| 初审结论 | 复核裁定 | 依据 |
|---|---|---|
| "localStorage 无任何异常保护，可能启动崩溃循环"（原 S1/S2，严重） | **降级为 P1-1**：读取侧保护完善（LibraryContext 有校验+损坏备份，playerPersistence 有 try/catch），真实缺口仅为写入无保护 + playerPersistence 缺形状校验 | `LibraryContext.tsx:154-181`、`playerPersistence.ts:10-18` |
| "syncServerTime 无界重试"（原 S3 一部分） | **不成立**：每次 API 调用至多一次尝试，自身有 try/catch。保留"fetch 无超时"部分为 P1-2 | `gdStudio.ts:85-87, 633-648` |
| "失控的搜索分页"（原 S7，严重） | **降级为 P1-3**：观察者有三重防护，不会并发失控；真实问题是不去重 + 终止条件单一 | `DesktopSearch.tsx:110-111, 148` |
| "撇号 bug 存在于 api/kuwo.rs（前后端同源）"（原 S4 表述） | **位置修正**：`api/kuwo.rs` 解析 key=value 文本，不受影响；实际位置为前端两处 + `discovery.rs` 一处 | `api/kuwo.rs:301-307` |
| "死监听 lock-change/theme-changed"（原 S8） | **成立**，但监听端在 `app/`（非 `src/`）目录；且锁定功能本体经原生 API 仍可用，失效范围是窗口打开期间的实时同步 | `useDesktopLyricBridge.ts:72,118`、`lib.rs:182` |
| "下载 30s 超时"（原 B1，中等） | **升级为 P0-1**：这是确定性失败而非弱网边界问题 | `lib.rs:908-913` |
| 拖拽 seek 问题（原 S6） | **成立且根因明确**：React 对 range 的 `onChange` 合成自 `input` 事件 | `DesktopTransport.tsx:270-280` |
| Shell 10Hz 重渲染（原 S5） | **成立**：节流注释与订阅点均已定位 | `PlayerContext.tsx:366`、`DesktopShell.tsx:250` |

> 复核方法说明：初审中约三成"严重"级结论未通过逐行验证（普遍是把"有真实缺口的方向"夸大为"完全缺失"）；同时有一项（下载超时）被初审低估。凡本文标注 [已核验] 的条目均可直接开工；[待复核] 条目动手前先花 10 分钟确认现状。
