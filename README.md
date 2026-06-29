# TuneFree Desktop

TuneFree Desktop 是一款基于 Tauri v2、Next.js 16 和 React 19 构建的现代化高性能桌面音乐播放器。项目致力于在桌面端提供统一、流畅且极具质感的音乐流媒体聚合体验。

本分支（tauri 分支）代表 TuneFree 的原生桌面客户端实现，核心业务层由 Rust 构建的本地服务承载，包含 API 代理及音源解密模块，以解决跨域及网络限制问题。

## 技术架构

项目在架构设计上采用前后端分离的混编模式：

*   **容器层**：Tauri v2 运行时，提供原生系统 API 调用能力及轻量化 Webview 容器。
*   **前端渲染层**：Next.js 16 (静态导出) 与 React 19，负责核心 UI 组件渲染与播放状态管理。
*   **本地服务层**：Rust (基于 Axum 异步框架)，用于处理高并发的解密请求与本地音频接口代理。
*   **动效与交互**：Framer Motion 12，用于构建界面的物理阻尼过渡以及平滑转场动画。
*   **音效可视化**：基于 Web Audio API 获取音频时域/频域数据，结合 HTML5 Canvas 进行实时频谱绘制。

## 核心特性

*   **跨源音乐聚合**：集成网易云音乐、QQ音乐、酷我音乐等多家流媒体音源，实现全局跨平台搜索及无缝播放。
*   **原生拖拽标题栏**：采用无边框窗口设计，通过 Tauri 原生窗口控制 API，在前端构建支持鼠标物理拖动及高斯模糊视觉的自定义窗口控制条。
*   **大厂级交互动效**：使用 Framer Motion 实现迷你播放栏与全屏播放面板之间的三维阻尼收放过渡，同时在歌曲切换时应用 Slide Up 与 Cross-Fade 歌词渐显机制。
*   **智能桌面挂件**：内置可拖动的交互式“安和昴（486）”桌面宠物，实时监听播放器加载、播放、暂停等生命周期，其位置数据支持本地持久化存储。
*   **双语歌词系统**：支持 LRC 滚动歌词，能自动对齐双语翻译并提供点击精确定位播放进度的交互。

## 目录结构

```text
├── app/                  # Next.js App Router 路由与页面配置
│   ├── desktop-lyric/    # 桌面歌词窗口路由
│   ├── library/          # 音乐库页面
│   └── search/           # 搜索页面
├── src/
│   ├── core/             # 音乐服务、上下文管理器与核心类型定义
│   └── desktop/          # 桌面端专用交互组件与主视图
├── src-tauri/
│   ├── src/              # Rust 后端主程序与 Axum 代理服务
│   ├── icons/            # 应用程序多尺寸图标资产
│   ├── Cargo.toml        # Rust 依赖与 crate 配置
│   └── tauri.conf.json   # Tauri 容器配置文件
├── public/               # 静态前端资源
├── bump-version.js       # 统一版本号自增脚本（tauri.conf.json / package.json / Cargo.toml）
├── vitest.config.ts      # Vitest 测试配置
└── package.json          # 前端依赖与构建脚本
```

## 开发与构建指南

### 前置依赖

运行本项目前，请确保您的开发环境已安装以下工具：

*   Node.js (建议 v20.9 或以上)
*   Rust 工具链 (包括 cargo 及 rustc compiler)
*   C++ 构建环境 (Windows 平台下需安装 Visual Studio 生成工具)

### 本地开发

1.  克隆仓库并安装 Node 依赖包：
    ```bash
    npm install
    ```

2.  启动开发模式：
    ```bash
    npm run tauri dev
    ```
    该命令会自动运行 Next.js 前端开发服务（端口 3001）并拉起 Tauri 容器，同时在 Rust 后端初始化本地 Axum 代理服务（端口 3002）。

### 生产打包

如需将应用程序打包为独立安装文件，请运行：

```bash
npm run tauri build
```

构建完成后，程序将输出在以下路径：
*   **NSIS 安装程序 (Windows EXE)**: `src-tauri/target/release/bundle/nsis/TuneFree_{version}_x64-setup.exe`

> 其中 `{version}` 为 `tauri.conf.json` 中配置的当前版本号（如 `1.0.25`）。

## 声明

*   本项目仅作为 Next.js、Tauri 与 Rust 混编的交互技术研究使用。
*   音乐资源均来源于第三方 API，本项目不存储、不分发任何音频实体，请支持正版音乐。
