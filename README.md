<div align="center">
  <img src="./public/favicon.svg" width="100" height="100" alt="TuneFree Logo">
  <h1>TuneFree iOS/PWA React</h1>

  <p align="center">
    <strong>移动端优先的 TuneFree React + Vite + PWA 音乐播放器</strong>
  </p>

  <p>
    <a href="https://react.dev/">
      <img src="https://img.shields.io/badge/React-18-61DAFB?style=for-the-badge&logo=react&logoColor=black" alt="React 18">
    </a>
    <a href="https://www.typescriptlang.org/">
      <img src="https://img.shields.io/badge/TypeScript-5-3178C6?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript">
    </a>
    <a href="https://vitejs.dev/">
      <img src="https://img.shields.io/badge/Vite-5-646CFF?style=for-the-badge&logo=vite&logoColor=white" alt="Vite">
    </a>
    <a href="https://reactrouter.com/">
      <img src="https://img.shields.io/badge/React_Router-6-CA4245?style=for-the-badge&logo=reactrouter&logoColor=white" alt="React Router">
    </a>
    <a href="https://www.framer.com/motion/">
      <img src="https://img.shields.io/badge/Framer_Motion-11-0055FF?style=for-the-badge&logo=framer&logoColor=white" alt="Framer Motion">
    </a>
    <a href="https://web.dev/explore/progressive-web-apps">
      <img src="https://img.shields.io/badge/PWA-Mobile_App-5A0FC8?style=for-the-badge&logo=pwa&logoColor=white" alt="PWA">
    </a>
    <a href="https://pages.cloudflare.com/">
      <img src="https://img.shields.io/badge/Cloudflare-Pages-F38020?style=for-the-badge&logo=cloudflare&logoColor=white" alt="Cloudflare Pages">
    </a>
  </p>

  <p>
    <a href="#-项目定位">项目定位</a> •
    <a href="#-功能特性">功能特性</a> •
    <a href="#-技术栈">技术栈</a> •
    <a href="#-接口说明">接口说明</a> •
    <a href="#-本地运行">本地运行</a> •
    <a href="#-部署">部署</a>
  </p>

  <a href="https://music.alanbulan.space/">
    <img src="https://img.shields.io/badge/Live_Demo-在线演示-success?style=for-the-badge&logo=google-chrome&logoColor=white" alt="Live Demo">
  </a>
</div>

<br/>

## 📖 项目定位

这个目录是独立的 iOS/PWA React 项目根目录，对应远程分支 `main`。

- iOS/PWA React：`ios-pwa-react/` → `origin/main`
- Desktop Web：`desktop-next/` → `origin/desktop`
- Flutter：`flutter/` → `origin/flutter`

本分支只保留 Web/PWA 形态，不再包含原生封装、Android 打包脚本或原生运行时依赖。

## ✨ 功能特性

### 🍎 移动端优先体验

- **iOS 风格界面**：延续 TuneFree 原有红白配色、圆角卡片、毛玻璃与弹簧动效。
- **PWA 安装体验**：可添加到手机桌面，以独立窗口运行，保留移动端沉浸式体验。
- **媒体控制集成**：基于 Media Session API 支持锁屏信息展示和系统媒体控制。
- **响应式布局**：针对手机屏幕、触控操作和底部播放器交互进行优化。

### 🎵 核心音乐功能

- **多源聚合搜索**：支持网易云音乐、QQ 音乐、酷我音乐；可手动开启 JOOX 扩展源。
- **播放解析链路**：网易/QQ/酷我优先走内置 `/api/url`，JOOX 和兼容源可走 GD 音乐台；已移除 TuneHub/TuneFree API 依赖。
- **歌词体验**：支持滚动歌词、双语歌词展示和播放进度联动。
- **封面与频谱**：保留移动端播放器封面动画、背景动效和可视化氛围。

### 📂 数据管理

- **本地歌单**：支持创建、编辑、删除本地歌单。
- **收藏与历史**：保留收藏、最近播放、下载记录等移动端常用入口。
- **数据迁移**：支持歌单和收藏数据导出/导入，便于跨设备迁移。

### 🌐 部署能力

- **Cloudflare Pages**：通过 `wrangler.json` 部署静态产物和 Pages Functions。
- **自建代理函数**：`functions/` 提供 CORS 代理，降低第三方公共代理不可用风险。

## 🔌 接口说明

当前版本不再依赖 TuneHub/TuneFree API，也不需要配置 API Key 或 API Base URL。

- **搜索/榜单**：网易云音乐、QQ 音乐、酷我音乐使用各平台直连接口；JOOX 扩展源由 GD 音乐台提供。
- **播放解析**：`functions/api/url.ts` 负责网易/QQ/酷我的原生播放地址解析；`services/resolver.ts` 统一调度原生解析、GD 音乐台解析和歌词/封面补全。
- **CORS 代理**：`functions/api/cors-proxy.ts` 只代理白名单域名，并透传 `Range` 请求以支持音频流式加载。
- **已移除能力**：TuneHub `/v1/parse`、`/v1/methods`、在线歌单导入、TuneHub API Key/Base 设置均已移除。

## 📸 截图展示

| 首页 (Home) | 播放器 (Player) | 搜索 (Search) |
|:---:|:---:|:---:|
| <img src="./home.PNG" width="200" alt="Home"> | <img src="./player.PNG" width="200" alt="Player"> | <img src="./search.PNG" width="200" alt="Search"> |

## 🛠 技术栈

- **React 18**：移动端交互与播放器 UI。
- **TypeScript 5**：核心类型、服务层和页面逻辑。
- **Vite 5**：开发服务器与生产构建。
- **React Router v6**：移动端页面路由。
- **Framer Motion**：页面切换、播放器展开与细节动效。
- **Lucide React**：统一图标体系。
- **Cloudflare Pages Functions**：部署与代理函数。

## 🚀 本地运行

建议使用 Node.js 18+。

```bash
npm install
npm run dev
```

默认开发地址：`http://localhost:3000/`。

如果需要联调 Cloudflare Pages Functions（例如 `/api/url` 和 `/api/cors-proxy`），先构建再启动 Wrangler 本地环境：

```bash
npm run build
npx wrangler pages dev dist
```

## 📦 构建

```bash
npm run build
```

构建产物输出到：

```text
dist/
```

## ☁️ 部署

Cloudflare Pages 推荐配置：

- **Framework preset**：Vite
- **Build command**：`npm run build`
- **Build output directory**：`dist`

也可以使用 Wrangler 手动部署：

```bash
npm run deploy
```

## 📁 目录结构

```text
App.tsx       应用根组件
components/   移动端通用组件
contexts/     播放器、歌单、下载等状态上下文
functions/    Cloudflare Pages Functions
pages/        移动端页面
services/     音乐源、播放解析、代理与下载服务
utils/        工具函数
public/       PWA 图标与静态资源
```

## ⚠️ 声明

本项目仅供学习 React、PWA 与现代前端工程使用。

- 音乐资源来源于第三方 API，本项目不存储任何音频文件。
- 请支持正版音乐，下载功能仅用于个人技术研究，请勿用于商业用途。
- API 接口归属权解释权归原作者所有。
