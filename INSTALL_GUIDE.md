# 🎵 TuneFree Desktop 安装与运行指引 (Tauri v2 + Vite)

感谢使用 **TuneFree Desktop** 桌面定制版！
本项目由 **AlanBulan** 专为桌面端打造，基于 **Tauri v2** 容器与 **Rust (Axum)** 本地后端，支持网易云、QQ音乐、酷我等多源聚合解析，完美复刻 TuneFree 的红白色系、玻璃卡片风格，并加入大厂级过渡动画与可爱的 **安和昴（486）** 桌宠。

---

## 🛠️ 安装步骤 (Windows 正式版)

由于此版本已由 **AlanBulan** 进行了深度定制并使用 Tauri 正式打包，您可以直接通过安装包进行一键安装：

### 第一步：获取安装包

普通用户请前往 [GitHub Releases](https://github.com/alanbulan/TuneFree_Mobile/releases) 下载最新版本的 `TuneFree_{version}_x64-setup.exe`。

- 当前官方发布目标：Windows x64。
- `.sig` 和 `latest.json` 是应用自动更新使用的签名元数据，普通安装时无需手动下载。
- macOS、Linux 当前没有官方安装包。

开发者在本地编译后，安装程序会输出到：`src-tauri/target/release/bundle/nsis/TuneFree_{version}_x64-setup.exe`。

### 第二步：安装向导 (简体中文)
1. 双击运行 `TuneFree_{version}_x64-setup.exe`（其中 `{version}` 为当前版本号）。
2. 安装向导已由 **AlanBulan** 强制指定为 **简体中文**，引导步骤清晰无碍。
3. 按照引导选择您的安装路径，并点击 **安装** 按钮。
4. 安装完成后，勾选 **运行 TuneFree**，点击完成即可立即启动！

---

## 🚀 开发者本地调试指引 (如果您需要本地运行源码)

若您是开发者，需要在本地调试或修改代码，可以参考以下步骤：

### 1. 环境准备
本地开发需要安装以下运行环境：
- **Node.js**：使用 20.19 以上版本，或 22.12 以上版本。
- **Rust (Cargo)**：由于后端使用 Rust 编写，需本地有 Rust 编译链。
- **Git**：拉取和维护分支代码。

### 2. 依赖安装与启动
在 `tauri` 项目根目录下，依次在终端运行以下命令：

```bash
# 1. 安装前端及编译依赖
npm install

# 2. 启动 Tauri 开发调试服务器 (前端 3101 端口 + Rust 后端 3002 端口 + Tauri 容器)
npm run tauri dev
```
启动后，调试窗口会自动弹出，此时支持前端热重载（Vite Fast Refresh），Rust 代码修改后 Tauri 会自动重新编译。

### 3. 正式版打包编译
当您修改了代码，需要自己输出新的安装包时，运行：
```bash
npm run tauri build
```
打包成功后，生成的 `.exe` 中文安装程序将生成在 `src-tauri/target/release/bundle/nsis/` 目录下。

---

## 💎 特色功能与使用说明

1. **安和昴（486）桌宠**：
   - 默认显示在桌面左下角。
   - **交互**：可以使用鼠标自由拖拽它到屏幕任何位置（松开鼠标后自动保存位置）。
   - **开关**：如果您觉得它占空间，可点击左侧的 **“管理” (设置)**，在核心设置中取消勾选 **“启用桌面宠物”** 并点击 **保存配置**，即可将其完全隐藏。
2. **大厂级过渡动画**：
   - 当点击底部播放栏展开全屏播放器时，面板会从屏幕底部伴随 `scale` 和 `opacity` 的苹果级阻尼感向上滑入；关闭时亦有平滑的下滑动画。
   - 歌曲切换及歌词状态更替时，带有 Slide & Fade 的纵向滑位淡入淡出动画，视觉流畅，质感拉满。
3. **中文控制提示**：
   - 悬浮在右上角关闭、最小化、最大化按钮时，会有高亮毛玻璃效果的中文 Tooltip 交互提示，取代简陋的浏览器原生悬停框。

---
*MIT License © 2026 TuneFree Desktop (Customized by AlanBulan)*
