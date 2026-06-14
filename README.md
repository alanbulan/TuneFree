<div align="center">
  <h1>TuneFree Desktop</h1>

  <p align="center">
    <strong>面向 Web PC / 桌面端的 TuneFree Next.js 音乐播放器 · Desktop Web v1.2.0</strong>
  </p>

  <p>
    <a href="https://nextjs.org/">
      <img src="https://img.shields.io/badge/Next.js-15-000000?style=for-the-badge&logo=nextdotjs&logoColor=white" alt="Next.js 15">
    </a>
    <a href="https://react.dev/">
      <img src="https://img.shields.io/badge/React-18-61DAFB?style=for-the-badge&logo=react&logoColor=black" alt="React 18">
    </a>
    <a href="https://www.typescriptlang.org/">
      <img src="https://img.shields.io/badge/TypeScript-5-3178C6?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript">
    </a>
    <a href="https://www.framer.com/motion/">
      <img src="https://img.shields.io/badge/Framer_Motion-11-0055FF?style=for-the-badge&logo=framer&logoColor=white" alt="Framer Motion">
    </a>
    <a href="https://developer.mozilla.org/docs/Web/API/Web_Audio_API">
      <img src="https://img.shields.io/badge/Web_Audio-API-FF6F00?style=for-the-badge&logo=webauthn&logoColor=white" alt="Web Audio API">
    </a>
    <a href="https://pages.cloudflare.com/">
      <img src="https://img.shields.io/badge/Cloudflare-Pages-F38020?style=for-the-badge&logo=cloudflare&logoColor=white" alt="Cloudflare Pages">
    </a>
  </p>

  <p>
    <a href="#-项目定位">项目定位</a> •
    <a href="#-功能特性">功能特性</a> •
    <a href="#-技术栈">技术栈</a> •
    <a href="#-本地运行">本地运行</a> •
    <a href="#-部署">部署</a>
  </p>

  <a href="https://music.alanbulan.space/">
    <img src="https://img.shields.io/badge/Live_Demo-在线演示-success?style=for-the-badge&logo=google-chrome&logoColor=white" alt="Live Demo">
  </a>
</div>

<br/>

## 📖 项目定位

这个目录是独立的桌面端项目根目录，对应远程分支 `desktop`。

- Desktop Web：`desktop-next/` → `origin/desktop`
- iOS/PWA React：`ios-pwa-react/` → `origin/main`
- Flutter：`flutter/` → `origin/flutter`

本分支是桌面 Web 客户端，使用 Next.js App Router 组织页面，并将原移动端能力改造成主流音乐软件的 PC 布局体验。Desktop Web v1.2.0 重点完成 TuneHub / TuneFree API 移除、播放链路稳定性修复，以及可拖动 Mira 桌面宠物接入。

## ✨ 功能特性

### 🖥 桌面端布局

- **侧边导航**：首页、搜索、资料库、关于页面拆分为独立入口。
- **顶部搜索区**：保留桌面端全局搜索和页面级内容切换。
- **主工作区**：榜单、推荐、资料库和结果列表适配宽屏展示。
- **底部迷你播放器**：固定在窗口底部，支持播放控制、进度、队列和歌词摘要。
- **全屏播放器**：点击迷你播放器进入沉浸式播放页，展示封面、歌词、队列和交互按钮。
- **Mira 桌面宠物**：左下角常驻、可拖动、会保存位置，并通过气泡反馈播放、加载、暂停和移动状态。

### 🎵 音乐播放体验

- **多源搜索与解析**：网易云、QQ、酷我使用直连接口与同源 `/api/url` 解析，JOOX / Bilibili 等扩展源由 GD Studio 提供。
- **移除 TuneHub 依赖**：桌面版不再依赖已关闭的 TuneHub / TuneFree API，避免失效解析链路影响播放。
- **稳定播放链路**：修复 URL 解析竞态、duration 同步、无音频 URL 清理和下一首预加载，减少封面/歌词已加载但音频不播放的问题。
- **双语歌词**：统一 LRC 解析，支持网易云/QQ 翻译歌词回退和合并展示。
- **歌词追踪**：根据播放进度定位当前歌词，开头和切歌场景自动追踪。
- **播放队列**：支持队列列表、当前播放态、高亮和快捷切歌。
- **常用操作**：保留收藏、下载、分享、音质、播放模式等播放器交互。

### ✨ 桌面质感

- **TuneFree 色系**：延续移动端红白视觉系统，而不是通用暗色模板。
- **毛玻璃卡片**：侧栏、播放器、队列和歌词区域使用玻璃质感层次。
- **动态背景**：封面背景、波谱、歌词和页面切换动效协同呈现。
- **性能优化**：长列表使用虚拟列表思路，加载态提供骨架屏反馈。

## 🛠 技术栈

- **Next.js 15**：App Router、静态导出与桌面端页面组织。
- **React 18**：播放器 UI、状态组合和交互组件。
- **TypeScript 5**：音乐服务、播放器上下文与业务类型。
- **Framer Motion**：页面切换、全屏播放器和细节动画。
- **Lucide React**：桌面端图标系统。
- **Web Audio API / Canvas**：频谱、波形和播放器氛围动效。
- **Cloudflare Pages Functions**：部署与 CORS 代理函数。

## 🚀 本地运行

建议使用 Node.js 18+。

```bash
npm install
npm run dev
```

默认开发地址：`http://127.0.0.1:3001/`。

## 📦 构建

```bash
npm run build
```

静态导出产物输出到：

```text
out/
```

## ☁️ 部署

Cloudflare Pages 推荐配置：

- **Production branch**：`desktop`
- **Root directory**：留空或 `/`，不要再填旧的 `reactdestop`
- **Framework preset**：Next.js / Static HTML
- **Build command**：`npm run build`
- **Build output directory**：`out`

`wrangler.json` 已配置：

```json
{
  "pages_build_output_dir": "./out"
}
```

## 📁 目录结构

```text
app/          Next.js App Router 页面与全局样式
functions/    Cloudflare Pages Functions
src/core/     音乐业务层、服务、上下文、类型
src/desktop/  桌面端 UI 与页面模块
public/       静态资源
```

## ⚠️ 声明

本项目仅供学习 Next.js、React 与音乐播放器交互设计使用。

- 音乐资源来源于第三方 API，本项目不存储任何音频文件。
- 请支持正版音乐，下载功能仅用于个人技术研究，请勿用于商业用途。
- API 接口归属权解释权归原作者所有。
