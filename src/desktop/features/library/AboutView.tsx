import { type MouseEvent as ReactMouseEvent } from 'react';
import { invoke } from '@tauri-apps/api/core';
import {
  BoxesIcon,
  CloudIcon,
  CodeIcon,
  DatabaseIcon,
  ExternalLinkIcon,
  FileCodeIcon,
  GithubIcon,
  InfoIcon,
  PanelsIcon,
  RocketIcon,
  ServerIcon,
  SettingsIcon,
  WaveformIcon,
  RefreshIcon,
} from '../../../core/components/Icons';
import { GD_STUDIO_ATTRIBUTION, GD_STUDIO_RATE_LIMIT_HINT } from '../../../core/utils/musicSource';
import { useUpdateChecker } from './hooks/useUpdateChecker';

const desktopTechStack = [
  { name: 'Tauri 2.11.3', detail: '原生桌面容器 / 托盘', icon: <BoxesIcon size={18} /> },
  { name: 'Rust 2021', detail: '命令、更新与下载服务', icon: <ServerIcon size={18} /> },
  { name: 'Next.js 16.2', detail: 'Turbopack / 静态导出', icon: <RocketIcon size={18} /> },
  { name: 'React 19.2', detail: '桌面端交互组件', icon: <CodeIcon size={18} /> },
  { name: 'TypeScript 6.0', detail: '核心播放与 UI 类型', icon: <FileCodeIcon size={18} /> },
  { name: 'Axum 0.8.9', detail: '本地音源 API 服务', icon: <DatabaseIcon size={18} /> },
  { name: 'Tower HTTP 0.7', detail: '本地 CORS 与中间件', icon: <SettingsIcon size={18} /> },
  { name: 'Reqwest 0.12', detail: 'Rust 网络请求代理', icon: <CloudIcon size={18} /> },
  { name: 'Framer Motion 12', detail: '播放器与面板动效', icon: <RocketIcon size={18} /> },
  { name: 'Lucide React 1', detail: '桌面端图标组件', icon: <CodeIcon size={18} /> },
  { name: 'Web Audio API', detail: 'AnalyserNode 音频频谱', icon: <WaveformIcon size={18} /> },
  { name: 'Canvas', detail: '实时波形背景渲染', icon: <PanelsIcon size={18} /> },
];

const aboutFeatures = [
  ['AI 智能意境搜歌', '通过大语言模型本地意境理解推荐，联动跨源普通搜索与并发封面拉取补全。'],
  ['多源聚合搜索', '内置网易云、QQ 音乐、酷我音乐搜索；JOOX 通过 GD Studio 扩展源接入。'],
  ['跨音源播放兜底', '原音源直链失效时，会按歌名与歌手在其它音源寻找可播放候选，优先保证能播。'],
  ['多音质与离线缓存', '支持 128K、320K、FLAC、Hi-Res 选档，并可下载到本地离线库。'],
  ['全屏播放器与队列', '常驻底部迷你播放器、沉浸式全屏歌词、播放队列、喜欢收藏和播放模式切换。'],
  ['多轨歌词解析', '解析主歌词、翻译、罗马音/发音与逐行时间轴，桌面歌词和播放器共享同一时间线。'],
  ['桌面歌词窗口', '独立桌面歌词窗口支持尺寸、字体、锁定与播放控制，并基于播放快照本地投影同步。'],
  ['本地资料库', '收藏、歌单、下载记录、播放队列与默认音质保存在本地，可 JSON 备份导入导出。'],
  ['安和昴（486）桌宠', '桌宠可拖动、记忆位置，并根据待命、加载、播放、暂停和移动状态切换动作。'],
  ['实时频谱动画', '复用 Web Audio AnalyserNode 与 Canvas，在迷你播放器和全屏底部渲染动态波形。'],
  ['系统集成', '接入 Media Session、Tauri 托盘、关闭行为设置与自动更新检查。'],
];

const aboutDataSources = [
  ['网易云', '搜索 / 榜单 / 直链 / 歌词', '本地 Rust API + Web 兼容接口'],
  ['QQ 音乐', '搜索 / 榜单 / 直链 / 双语歌词', 'musicu 请求与 Base64 歌词解码'],
  ['酷我音乐', '搜索 / 榜单 / 封面 / 歌词', '旧版搜索接口 + lyric fallback'],
  ['GD Studio', 'JOOX 扩展源', GD_STUDIO_RATE_LIMIT_HINT],
  ['Pollinations AI', '本地 AI 大模型降级推荐', '完全免 Key 本地闭环的意境大语言模型接口'],
];

const aboutLinks = [
  { title: 'GitHub Releases', desc: '检查安装包与更新记录', href: 'https://github.com/alanbulan/TuneFree_Mobile/releases', icon: <GithubIcon size={30} /> },
  { title: 'GD 音乐台', desc: '扩展音源服务来源', href: 'https://music.gdstudio.xyz/', icon: <ExternalLinkIcon size={30} /> },
  { title: 'Tauri v2', desc: '桌面容器与系统集成文档', href: 'https://tauri.app/', icon: <BoxesIcon size={30} /> },
  { title: 'Next.js', desc: 'App Router 与静态导出文档', href: 'https://nextjs.org/docs', icon: <RocketIcon size={30} /> },
];

export default function AboutView() {
  const { appVersion, checkingUpdate, downloadingUpdate, updateDownloadProgress, handleCheckUpdate } =
    useUpdateChecker();

  const handleOpenExternal = async (event: ReactMouseEvent<HTMLAnchorElement>, url: string) => {
    event.preventDefault();
    const isTauri =
      typeof window !== 'undefined' &&
      '__TAURI_INTERNALS__' in window;
    if (isTauri) {
      try {
        await invoke('open_external_url', { url });
        return;
      } catch {
        // Fall back to the browser path below.
      }
    }
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  return (
    <section className="about-grid about-grid-rich">
      <div className="about-card about-hero-card glass-panel">
        <img className="about-app-icon" src="/icon.svg" alt="TuneFree" />
        <div className="about-hero-copy">
          <h3>TuneFree Desktop</h3>
          <p>基于 Tauri 2.11、Next.js 16、React 19、TypeScript 6 与 Rust/Axum 本地服务的桌面音乐播放器。当前版本聚焦多源搜索、跨源播放兜底、多轨歌词、桌面歌词、离线缓存、本地资料库、桌宠与系统托盘集成。</p>
          <div className="about-hero-actions">
            <span className="about-version">Tauri Desktop · v{appVersion}</span>
            <button
              type="button"
              className={`update-check-btn ${checkingUpdate || downloadingUpdate ? 'checking' : ''}`}
              onClick={handleCheckUpdate}
              disabled={checkingUpdate || downloadingUpdate}
            >
              <RefreshIcon size={12} />
              {downloadingUpdate
                ? `正在下载更新 (${updateDownloadProgress ?? 0}%)`
                : checkingUpdate
                  ? '正在检查...'
                  : '检查更新'}
            </button>
          </div>
        </div>
      </div>

      <div className="about-content-grid">
        <div className="about-card about-feature-card glass-panel">
          <div className="about-card-heading">
            <InfoIcon size={30} />
            <h3>功能特性</h3>
          </div>
          <div className="about-feature-list">
            {aboutFeatures.map(([title, desc], index) => (
              <div className="about-feature-item" key={title}>
                <span>{index + 1}</span>
                <div>
                  <strong>{title}</strong>
                  <p>{desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="about-side-stack">
          <div className="about-card about-tech-card glass-panel">
            <div className="about-card-heading">
              <SettingsIcon size={30} />
              <h3>桌面端技术栈</h3>
            </div>
            <div className="about-tech-grid">
              {desktopTechStack.map((tech) => (
                <span className="about-tech-chip" key={tech.name}>
                  <span className="about-tech-icon">{tech.icon}</span>
                  <span>
                    <strong>{tech.name}</strong>
                    <em>{tech.detail}</em>
                  </span>
                </span>
              ))}
            </div>
            <p>前端通过 Next.js 静态导出运行在 Tauri WebView 中；Rust 侧提供下载、自动更新、外部链接、托盘生命周期，以及 Axum 本地接口与代理。</p>
          </div>

          <div className="about-card about-api-card glass-panel">
            <div className="about-card-heading">
              <DatabaseIcon size={30} />
              <h3>后端 API 与数据源</h3>
            </div>
            <p>内置 Rust / Axum 本地服务用于音源接口代理、直链解析和跨域请求。扩展源由 {GD_STUDIO_ATTRIBUTION} 提供。</p>
            <div className="about-source-list">
              {aboutDataSources.map(([name, scope, detail]) => (
                <span key={name}>
                  <strong>{name}</strong>
                  <em>{scope}</em>
                  <small>{detail}</small>
                </span>
              ))}
            </div>
            <div className="about-link-row">
              <a href="https://music.gdstudio.xyz/" target="_blank" rel="noopener noreferrer" onClick={(event) => handleOpenExternal(event, 'https://music.gdstudio.xyz/')}><ExternalLinkIcon size={13} /> GD 音乐台</a>
              <a href="https://github.com/alanbulan/TuneFree_Mobile/releases" target="_blank" rel="noopener noreferrer" onClick={(event) => handleOpenExternal(event, 'https://github.com/alanbulan/TuneFree_Mobile/releases')}><GithubIcon size={13} /> 版本发布</a>
            </div>
          </div>
        </div>
      </div>

      <div className="about-link-grid">
        {aboutLinks.map((link) => (
          <a
            className="about-card glass-panel about-link-card"
            href={link.href}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(event) => handleOpenExternal(event, link.href)}
            key={link.href}
          >
            {link.icon}
            <h3>{link.title}</h3>
            <p>{link.desc}</p>
          </a>
        ))}
      </div>

      <div className="about-card about-notice-card glass-panel">
        <h3>声明</h3>
        <p>本项目仅供学习 React、Next.js、Tauri 与现代桌面端工程实践使用。音乐资源来源于第三方 API，本项目不存储任何音频文件，请支持正版音乐。</p>
        <span>MIT License © 2026 TuneFree</span>
      </div>
    </section>
  );
}
