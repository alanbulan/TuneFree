# TuneFree Desktop

TuneFree Desktop 是 TuneFree 的 Tauri 桌面客户端。本仓库的 `tauri` 分支使用 Tauri v2、React 19、Vite 8 和 Rust 构建，当前正式发布目标为 Windows x64。

## 功能

- 聚合搜索与播放：网易云、QQ 音乐、酷我音乐、JOOX。
- 播放队列、收藏、歌单导入、下载、歌词与逐字歌词。
- 全屏播放器、主题设置、桌面宠物和自动更新。
- 透明桌面歌词窗口：支持锁定、置顶、任务栏隐藏，以及位置和尺寸持久化。
- 智能推荐：Rust 本地服务根据曲库、播放行为和用户反馈召回并持久化结果，可使用用户配置的 OpenAI 兼容模型发现与重排候选。
- Embeat 语境搜歌：根据自然语言场景生成检索意图，再通过 GD Music 的真实音乐源搜索确认歌曲身份。

智能推荐与 Embeat 语境搜歌是两条独立链路。前者的数据和任务状态由本地 SQLite 推荐服务管理；后者依赖外部服务，不会把模型生成的临时歌曲 ID 当作可播放结果。

## 音源说明

| 展示来源 | 搜索 | 播放解析 |
| --- | --- | --- |
| 网易云 | 原生前端服务与聚合搜索 | Tauri 本地服务优先，必要时按现有解析链路处理 |
| QQ 音乐 | 原生前端服务与聚合搜索 | Tauri 本地服务支持 `qq` / `tencent` 别名 |
| 酷我音乐 | 原生前端服务与聚合搜索 | Tauri 本地服务解析 |
| JOOX | GD Music 公开 API | GD Music 解析链路 |

聚合搜索默认合并网易云、QQ 音乐和酷我音乐。JOOX 属于扩展源，需要用户主动开启，并受 GD Music 公开接口频率限制影响。

## 架构

```text
app/                         桌面歌词窗口页面、组件和样式
desktop-lyric/               桌面歌词独立 HTML 入口
src/core/                    播放器、状态、音乐服务、解析与通用工具
src/core/ipc/                前端唯一的 Tauri 调用门面（命令表、事件表、错误码）
src/desktop/                 主窗口组件、功能页面与桌面交互
src-tauri/src/app/           Tauri 命令、窗口、下载和更新编排
src-tauri/src/api/           网易云、QQ、酷我播放解析与代理边界
src-tauri/src/recommendation 本地推荐、LLM 编排和 SQLite 持久化
scripts/                     架构检查、IPC 契约检查和真实 GD Music API 校验脚本
```

前端通过 Tauri IPC 调用 Rust 后端。Rust 侧负责原生窗口、下载、更新、系统命令、本地代理和推荐数据库；前端负责界面、播放状态和音乐服务编排。

## 环境要求

- Node.js 20.19+、22.12+ 或 24
- npm 11.6.2（CI 与发布环境使用该版本）
- Rust stable
- Windows 下的 Visual Studio C++ Build Tools 与 WebView2

## 开发

```powershell
npm ci
npm run tauri dev
```

Vite 开发服务监听 `127.0.0.1:3101`。Tauri 本地服务每次启动绑定 `127.0.0.1` 上的随机端口，并生成一次性令牌；
端口和令牌由 `get_local_server_info` 命令下发，前端不得硬编码端口，也不得把已解析的本地服务 URL 持久化。

## 验证

下面这组命令与 `.github/workflows/validate.yml` 完全一致，CI 与发布流程都复用同一个工作流：

```powershell
npm run version:check
npm run lint
npm run typecheck
npm run architecture:check
npm run test:coverage
cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check
cargo clippy --manifest-path src-tauri/Cargo.toml --locked --all-targets --all-features -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml --locked
npx tauri build --no-bundle
```

说明：

- Clippy 的严格规则（`too_many_lines`、`dbg_macro`、`todo`、`unsafe_code`）固化在 `src-tauri/Cargo.toml`
  的 `[lints]` 段，本地直接跑 `cargo clippy` 就能得到与 CI 相同的结论，命令行只保留 `-D warnings`。
- `npx tauri build --no-bundle` 会通过 `beforeBuildCommand` 自动执行 `npm run build`（`tsc --noEmit` + `vite build`），
  无需在它之前再单独跑一次 `npm run build`。
- `npm run architecture:check` 依次执行文件规模／分层／预算守卫和 Rust ↔ TypeScript 的 IPC 命令表双向 diff。

需要验证 GD Music 真实响应结构时运行：

```powershell
npm run api:verify:gd
npm run api:verify:gd -- --source joox --details
```

该脚本访问真实外部服务，结果会受到来源可用性和频率限制影响。

## 构建与发布

本地构建：

```powershell
npm run tauri build
```

正式版本由 `v*` 标签触发 GitHub Actions 的 `Release signed desktop app` 工作流。该工作流先复用
`Validate` 可复用工作流跑完整套质量门禁，通过后才构建、签名并生成 Windows NSIS 安装包、更新签名和 `latest.json`。

产物发布为**草稿 Release**（`releaseDraft: true`）。因为 updater endpoint 指向
`releases/latest/download/latest.json`，一旦 Release 转为正式版，所有已安装客户端会立即自动升级，
所以必须人工核对资产后再手动 Publish。源码仓库不保存安装包；正式产物从
[GitHub Releases](https://github.com/alanbulan/TuneFree_Mobile/releases) 获取。

安装说明见 [INSTALL_GUIDE.md](./INSTALL_GUIDE.md)，版本升级和签名发布步骤见 [RELEASE.md](./RELEASE.md)。

## 数据与许可

项目源代码采用 [MIT License](./LICENSE)。

音乐内容及元数据来自第三方服务，项目不存储、不分发音频资源。GD Music API 由 GD Studio 提供，使用时应注明“GD音乐台（music.gdstudio.xyz）”，并遵守其 CC BY-NC 4.0 与非商业使用要求。第三方服务的可用性、版权和使用限制以对应服务条款为准。
