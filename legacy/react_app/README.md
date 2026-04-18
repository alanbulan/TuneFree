
<div align="center">
  <img src="./public/favicon.svg" width="100" height="100" alt="TuneFree Logo">
  <h1>TuneFree Mobile</h1>
  
  <p align="center">
    <strong>一个高颜值的现代化 PWA 音乐播放器</strong>
  </p>
  
  <p>
    <a href="https://react.dev/">
      <img src="https://img.shields.io/badge/React-19-61DAFB?style=flat-square&logo=react&logoColor=black" alt="React 19">
    </a>
    <a href="https://www.typescriptlang.org/">
      <img src="https://img.shields.io/badge/TypeScript-5.0-3178C6?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript">
    </a>
    <a href="https://tailwindcss.com/">
      <img src="https://img.shields.io/badge/Tailwind_CSS-3.4-38B2AC?style=flat-square&logo=tailwind-css&logoColor=white" alt="Tailwind CSS">
    </a>
    <a href="https://vitejs.dev/">
      <img src="https://img.shields.io/badge/Vite-5.0-646CFF?style=flat-square&logo=vite&logoColor=white" alt="Vite">
    </a>
    <a href="https://pages.cloudflare.com/">
      <img src="https://img.shields.io/badge/Cloudflare-Pages-F38020?style=flat-square&logo=cloudflare&logoColor=white" alt="Cloudflare Pages">
    </a>
  </p>
  
  <p>
    <a href="#-功能特性">功能特性</a> •
    <a href="#-技术栈">技术栈</a> •
    <a href="#-本地运行">本地运行</a> •
    <a href="#-部署">部署指南</a> •
    <a href="#-致谢">致谢</a>
  </p>

  <a href="https://xilan.ccwu.cc/">
    <img src="https://img.shields.io/badge/Live_Demo-在线演示-success?style=for-the-badge&logo=google-chrome&logoColor=white" alt="Live Demo">
  </a>
</div>

<br/>

## 📖 简介

**TuneFree Mobile** 是一款基于 Web 技术构建的移动端优先音乐播放器。它不仅拥有媲美原生 iOS 应用的丝滑交互和毛玻璃 UI 设计，还集成了多平台音乐搜索、实时歌词、频谱可视化以及完善的本地歌单管理功能。

得益于 PWA (Progressive Web App) 技术，你可以将其直接安装到手机桌面，享受近乎原生的 App 体验。

## ✨ 功能特性

### 🍎 iOS 深度优化
- **灵动岛适配**: 完美适配 iPhone 灵动岛 (Dynamic Island) 显示，支持媒体状态实时展示。
- **后台播放**: 利用 Media Session API 实现稳定的后台播放与控制中心集成，锁屏状态下可切歌、调整进度。
- **沉浸式体验**: 深度还原 iOS 设计规范，包括毛玻璃(Glassmorphism)效果、非线性弹簧动画和触觉反馈。
- **PWA 支持**: 支持添加到主屏幕，拥有独立的启动画面，去除浏览器地址栏，体验媲美原生 App。

### 🎵 核心音乐功能
- **多源聚合搜索**: 支持网易云音乐、QQ音乐、酷我音乐等多个平台的资源搜索。
- **无损音质**: 支持标准(128k)、高品(320k)、无损(FLAC)及 Hi-Res 音质播放与下载。
- **全功能播放器**:
  - 🔄 播放模式切换（顺序/单曲/随机）
  - 📊 实时音频频谱可视化 (Canvas绘制)
  - 🎤 逐字/逐行滚动的实时歌词
  - 💿 经典的黑胶唱片旋转动画

### 📂 数据管理
- **本地歌单**: 即使不登录也可以创建、重命名、编辑歌单，数据存储在本地。
- **在线导入**: 支持一键导入主流音乐平台的歌单。
- **数据备份**: 支持将歌单和收藏数据导出为 JSON 文件，并在不同设备间迁移。

### 📈 系统监控
- **状态仪表盘**: 内置可视化监控面板，实时查看 API 健康度、延迟、QPS 及平台可用性趋势。

## 📸 截图展示

| 首页 (Home) | 播放器 (Player) | 搜索 (Search) |
|:---:|:---:|:---:|
| <img src="./home.PNG" width="200" alt="Home"> | <img src="./player.PNG" width="200" alt="Player"> | <img src="./search.PNG" width="200" alt="Search"> |

## 🛠 技术栈

本项目采用现代前端工程化方案构建：

- **核心框架**: [React 19](https://react.dev/) - 紧跟最新的 React 特性。
- **构建工具**: [Vite](https://vitejs.dev/) - 极速的开发服务器和构建优化。
- **语言**: [TypeScript](https://www.typescriptlang.org/) - 强类型保障代码健壮性。
- **样式**: [Tailwind CSS](https://tailwindcss.com/) - 原子化 CSS，快速构建 UI。
- **路由**: [React Router v6](https://reactrouter.com/) - 声明式路由管理。
- **图标**: [Lucide React](https://lucide.dev/) - 优雅、统一的图标库。
- **部署**: [Cloudflare Pages](https://pages.cloudflare.com/) - 自动化边缘网络部署。

## 🚀 本地运行

确保你的环境中已安装 [Node.js](https://nodejs.org/) (推荐 v18+)。

1. **克隆项目**
   ```bash
   git clone https://github.com/alanbulan/musicxilan.git
   cd musicxilan
   ```

2. **安装依赖**
   ```bash
   npm install
   ```

3. **启动开发服务器**
   ```bash
   npm run dev
   ```
   访问 `http://localhost:3000` 即可预览。

## 📦 部署

本项目配置了 `wrangler.json`，针对 Cloudflare Pages 进行了优化。

### 方式一：推送到 GitHub 自动部署 (推荐)
1. 将代码推送到 GitHub 仓库。
2. 登录 Cloudflare Dashboard，进入 **Pages**。
3. 选择 "Connect to Git"，选择你的仓库。
4. 构建设置：
   - **Framework preset**: Vite
   - **Build command**: `npm run build`
   - **Build output directory**: `dist`
5. 点击保存并部署。

### 方式二：CLI 手动部署
如果你安装了 Wrangler CLI：
```bash
npm run deploy
```

## 🤝 贡献

欢迎提交 Issue 或 Pull Request！

1. Fork 本仓库
2. 新建分支 (`git checkout -b feature/AmazingFeature`)
3. 提交更改 (`git commit -m 'Add some AmazingFeature'`)
4. 推送分支 (`git push origin feature/AmazingFeature`)
5. 提交 Pull Request

## 🌟 Star History

[![Star History Chart](https://api.star-history.com/svg?repos=alanbulan/musicxilan&type=Date)](https://star-history.com/#alanbulan/musicxilan&Date)

## 🌟 致谢

特别感谢后端 API 的提供者，本项目核心数据服务依赖于其无私分享：
- **API 作者**: [是青旨啊@sayqz](https://linux.do/u/sayqz) (Linux.do)
- **原帖地址**: [Linux.do 话题链接](https://linux.do/t/topic/1326425)

## ⚠️ 声明

本项目仅供学习 React 及现代前端技术栈使用。
- 音乐资源来源于第三方 API，本项目不存储任何音频文件。
- 请支持正版音乐，下载功能仅用于个人技术研究，请勿用于商业用途。
- API 接口归属权解释权归原作者所有。

## 📄 License

[MIT](LICENSE) © 2026 TuneFree
