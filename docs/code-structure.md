# 桌面端代码与目录约定

本项目使用 Vite 多入口、React 和 Tauri。`app/` 是共享样式与桌面歌词模块目录；`page.tsx` 由入口显式导入，不采用文件系统路由或服务端组件。

## 目录职责

| 路径 | 职责 | 新增代码放置原则 |
| --- | --- | --- |
| `src/main.tsx`、`src/desktopLyricMain.tsx` | 主窗口与桌面歌词的启动、样式装配 | 入口只负责挂载与必要的宿主初始化 |
| `desktop-lyric/index.html` | 透明歌词窗口的独立 HTML 入口 | 保留独立样式入口，避免主窗口背景破坏透明度 |
| `app/styles/`、`app/globals.css` | 主窗口设计变量、布局和公共样式 | 按界面职责拆分；静态样式使用类与变量 |
| `app/desktop-lyric/` | 歌词窗口页面、组件、时钟与窗口交互 | 独立文档的行为在该模块内维护 |
| `src/core/contexts/` | Provider、状态切片与相邻持久化辅助 | 组件按需要订阅数据、操作、进度等切片 |
| `src/core/player/` | 音频生命周期、解析、播放控制和队列编排 | 播放行为在这里组合，不由页面重复实现 |
| `src/core/services/` | 平台接口、解析、下载与推荐的前端服务 | 不依赖桌面组件或 React 运行时 |
| `src/core/services/sources/` | 音源注册、脚本沙箱、生命周期与缓存 | Worker 注入文本与宿主桥分开维护 |
| `src/core/utils/`、`src/core/components/` | 通用计算、歌词工具与可复用渲染 | 工具保持纯逻辑；组件按真实复用范围放置 |
| `src/core/ipc/` | Tauri 命令、事件、窗口 API、错误与类型 | 前端原生操作全部经此门面 |
| `src/desktop/components/`、`hooks/` | 桌面壳、播放器、弹窗与共享桌面交互 | 不绑定单一功能页的组件放在这里 |
| `src/desktop/features/<feature>/` | 首页、搜索、音乐库页面及视图模型 | 模块共享逻辑上提，禁止横向依赖其他 feature |
| `src-tauri/src/app/` | 窗口、托盘、账号、下载和更新命令编排 | 账号协议按平台拆分；命令不返回凭据 |
| `src-tauri/src/api/`、`server.rs` | 回环 HTTP 服务、匿名解析与代理 | 与携登录会话的账号 IPC 解析分开维护 |
| `src-tauri/src/credentials/` | macOS 共享系统凭据仓库 | 保持操作系统授权边界，不写明文磁盘缓存 |
| `src-tauri/src/recommendation/` | 推荐领域、模型、后台任务和 SQLite | 存储、搜索、任务、排序分别维护 |
| `vendor/bloub/` | 固定版本的上游动画核心及许可 | 项目适配放在 `src/desktop/`，保留来源记录 |
| `e2e/`、相邻 `__tests__/` | 浏览器回归与单元、边界测试 | 浏览器文件使用 `*.e2e.ts`，与 Vitest 隔离 |
| `scripts/` | 构建、契约、发布、验收和性能测量 | 测量脚本不进入产品界面或运行时依赖 |
| `docs/` | 架构、协议来源、开发记录和发布说明 | 大型日志、堆快照和临时产物放本机资料目录 |

## 依赖与规模

`npm run architecture:check` 检查核心层不能反向依赖桌面壳、服务与工具不能依赖 contexts 或 React 运行时、功能模块不能横向导入、Tauri API 必须经 IPC 门面，以及 TypeScript / Rust 的命令契约。

源文件预算为 TSX 300 行、TS / Rust 500 行、CSS 700 行。按守卫的计数方式，末尾换行计入行数。测试文件可按场景拆分，不受生产源文件的行数守卫限制。

组件文件采用组件名，Hook 以 `use` 开头，纯计算使用描述实际行为的名称。持久化键与 IPC 名称属于兼容契约，重命名源码时不能顺带更换。音乐伙伴现在使用 `BloubCompanion` / `useCompanionPosition`；原位置键 `tunefree_desktop_mira_position_v3` 继续读取和保存。

## 2026-11-15 审查结果

审查覆盖 215 个项目 TS / TSX 模块与 12 个上游模块，解析到 815 条本地引用。排除显式类型引用后的保守值引用图为 639 条边，没有循环、失效路径或闲置业务模块；三个仅被类型导入的 `types.ts` 文件保留。动态字面量导入已纳入，生成的 Worker 文本另外按片段装配检查。未显式写 `type`、实际仅用于类型的引用可能保留在这张静态图中，所以边数不等于最终打包的运行时依赖数。

143 个 Rust 文件均由模块声明、测试路径或 `include!` 引用，未发现孤立文件。原生测试还包含同级 `*_tests.rs`、`__tests__/` 与推荐领域的 `tests/`；它们都有真实入口，不因目录形式不同而删除。

本次整理：

- 统一音乐伙伴组件、Hook 与测试的名称，保留原位置数据。
- 删除只被测试调用的旧 `src/core/utils/formatting.ts`，设置页继续使用现有实际格式化逻辑。
- 删除与 `public/icon.svg` 完全相同且没有引用的 `app/icon.svg`，图标资源以 `public/` 为入口。
- 删除 Vite 应用中无效的 `use client` 指令，明确客户端入口职责。
- 移除 `DesktopLibrary` 不读取返回值的聚合 `useLibrary()` 订阅；Provider 由应用根创建，各子页自行读取需要的切片。

## 后续维护重点

| 位置 | 观察 | 后续处理时机 |
| --- | --- | --- |
| `sources/manager.ts`、`recommendation/migration.rs` | 均到达守卫 500 行上限 | 下次增加行为前，按音源生命周期 / 快照或迁移步骤拆分 |
| `contexts/libraryData.ts`、`contexts/playerQueue.ts` | 混合类型、计算与持久化辅助，仍符合现有依赖方向 | 修改对应领域时按职责提取；不为目录整齐一次移动所有状态代码 |
| `DesktopLibrary.tsx` | 七个库页面静态导入在同一个延迟加载模块中 | 仅在测得首屏加载或模块解析瓶颈后，考虑按页进一步拆包 |
| 较大的测试文件 | 架构守卫豁免，阅读成本会随场景增加 | 新增测试时按协议、生命周期、失败恢复等场景拆分 |

`node_modules/`、`src-tauri/target/`、`out/`、`coverage/`、`test-results/` 均已忽略，没有安装包、压缩包、构建缓存或诊断日志被纳入 Git。保留现有锁文件和构建依赖。
