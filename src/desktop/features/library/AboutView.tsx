import type { MouseEvent as ReactMouseEvent } from 'react';
import { Smile, Sparkles } from 'lucide-react';
import { invokeCommand, isTauri } from '../../../core/ipc';
import {
  BoxesIcon, CloudIcon, CodeIcon, DatabaseIcon, ExternalLinkIcon, FileCodeIcon,
  GithubIcon, InfoIcon, LibraryIcon, MusicIcon, RefreshIcon, RocketIcon,
  ServerIcon, SettingsIcon, WaveformIcon,
} from '../../../core/components/Icons';
import { GD_STUDIO_ATTRIBUTION, GD_STUDIO_RATE_LIMIT_HINT } from '../../../core/utils/musicSource';
import { useUpdateChecker } from './hooks/useUpdateChecker';

const buildInfo = __TUNEFREE_BUILD_INFO__;
const versions = buildInfo.tech;
const desktopTechStack = [
  { name: 'React', version: versions.react, detail: '界面与交互', icon: <CodeIcon size={17} /> },
  { name: 'TypeScript', version: versions.typescript, detail: '类型与业务逻辑', icon: <FileCodeIcon size={17} /> },
  { name: 'Vite', version: versions.vite, detail: '前端开发与构建', icon: <RocketIcon size={17} /> },
  { name: 'Motion for React', version: versions.motion, detail: '播放器与面板动效', icon: <WaveformIcon size={17} /> },
  { name: 'Lucide React', version: versions.lucide, detail: '界面图标', icon: <CodeIcon size={17} /> },
  { name: 'bloub', version: versions.bloub, detail: '音乐伙伴动画', icon: <Smile size={17} /> },
  { name: 'Tauri', version: versions.tauri, detail: '原生窗口与系统集成', icon: <BoxesIcon size={17} /> },
  { name: 'Rust', version: versions.rust, detail: '原生后端工具链', icon: <ServerIcon size={17} /> },
  { name: 'Axum', version: versions.axum, detail: '本地音源服务', icon: <CloudIcon size={17} /> },
  { name: 'Tokio', version: versions.tokio, detail: '异步任务运行时', icon: <RocketIcon size={17} /> },
  { name: 'Tower HTTP', version: versions.towerHttp, detail: 'HTTP 中间件', icon: <SettingsIcon size={17} /> },
  { name: 'Reqwest', version: versions.reqwest, detail: '网络请求', icon: <CloudIcon size={17} /> },
  { name: 'rusqlite', version: versions.rusqlite, detail: '本地推荐数据库', icon: <DatabaseIcon size={17} /> },
  { name: 'keyring', version: versions.keyring, detail: '系统凭据保存', icon: <SettingsIcon size={17} /> },
];

const aboutFeatures = [
  { title: '多音源聆听', desc: '聚合网易云、QQ 音乐与酷我，支持扩展音源和多种音质。', icon: <MusicIcon size={20} /> },
  { title: '推荐与 AI 搜歌', desc: '从播放与收藏中发现好音乐，也能用心情和场景寻找下一首。', icon: <Sparkles size={20} /> },
  { title: '沉浸播放', desc: '全屏与桌面歌词、翻译与逐字高亮，搭配随音乐变化的频谱。', icon: <WaveformIcon size={20} /> },
  { title: '我的音乐库', desc: '收藏、歌单、离线下载与备份，让喜欢的音乐各得其所。', icon: <LibraryIcon size={20} /> },
  { title: 'Bloub 音乐伙伴', desc: '可以拖动、记住位置，也会跟随播放和推荐状态回应。', icon: <Smile size={20} /> },
  { title: '自在的桌面体验', desc: '迷你播放器、系统托盘、主题设置与自动更新，融入日常使用。', icon: <BoxesIcon size={20} /> },
];

const aboutDataSources = [
  { name: '网易云音乐', scope: '歌曲搜索、榜单与歌词' },
  { name: 'QQ 音乐', scope: '歌曲搜索、榜单与双语歌词' },
  { name: '酷我音乐', scope: '歌曲搜索、榜单与歌词' },
  { name: 'GD 音乐台', scope: 'JOOX 扩展音源与 AI 搜歌', detail: GD_STUDIO_RATE_LIMIT_HINT },
  { name: 'OpenAI 兼容模型', scope: '使用你配置的服务发现和精选音乐' },
  { name: 'Pollinations AI', scope: 'AI 搜歌的备用服务' },
];

const aboutLinks = [
  { title: '版本发布', desc: '安装包与更新记录', href: 'https://github.com/alanbulan/TuneFree_Mobile/releases', icon: <GithubIcon size={18} /> },
  { title: 'GD 音乐台', desc: '扩展音源服务', href: 'https://music.gdstudio.xyz/', icon: <MusicIcon size={18} /> },
  { title: `Tauri ${versions.tauri}`, desc: '桌面框架文档', href: 'https://v2.tauri.app/', icon: <BoxesIcon size={18} /> },
  { title: `Vite ${versions.vite}`, desc: '前端构建文档', href: 'https://vite.dev/', icon: <RocketIcon size={18} /> },
  { title: `bloub ${versions.bloub}`, desc: '音乐伙伴的开源动画核心', href: 'https://github.com/jeremy-prt/bloub', icon: <Smile size={18} /> },
];

export default function AboutView() {
  const { appVersion, checkingUpdate, downloadingUpdate, updateDownloadProgress, handleCheckUpdate } =
    useUpdateChecker();

  const handleOpenExternal = async (event: ReactMouseEvent<HTMLAnchorElement>, url: string) => {
    event.preventDefault();
    if (isTauri()) {
      try {
        await invokeCommand('open_external_url', { url });
        return;
      } catch {
        // 原生链接打开失败时，保留浏览器打开方式。
      }
    }
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  return (
    <section className="about-grid" aria-label="关于 TuneFree">
      <header className="about-card about-hero-card">
        <img className="about-app-icon" src="/icon.svg" width={76} height={76} alt="" aria-hidden="true" />
        <div className="about-hero-copy">
          <h2>TuneFree Desktop</h2>
          <p>轻盈、自在的桌面音乐空间。</p>
          <div className="about-meta">
            <span className="about-version">v{appVersion || buildInfo.appVersion}</span>
            <span>Windows x64</span>
          </div>
        </div>
        <div className="about-hero-actions">
          <button type="button"
            className={`update-check-btn ${checkingUpdate || downloadingUpdate ? 'checking' : ''}`}
            onClick={handleCheckUpdate} disabled={checkingUpdate || downloadingUpdate}
            aria-busy={checkingUpdate || downloadingUpdate}>
            <RefreshIcon size={15} />
            {downloadingUpdate
              ? updateDownloadProgress === null ? '正在下载更新…' : `正在下载 ${updateDownloadProgress}%`
              : checkingUpdate ? '正在检查…' : '检查更新'}
          </button>
        </div>
      </header>

      <section className="about-card" aria-labelledby="about-features-title">
        <div className="about-card-heading">
          <InfoIcon size={19} /><h2 id="about-features-title">功能一览</h2>
        </div>
        <div className="about-feature-list">
          {aboutFeatures.map((feature) => (
            <div className="about-feature-item" key={feature.title}>
              <span className="about-feature-icon" aria-hidden="true">{feature.icon}</span>
              <div><h3>{feature.title}</h3><p>{feature.desc}</p></div>
            </div>
          ))}
        </div>
      </section>

      <section className="about-card about-tech-card" aria-labelledby="about-tech-title">
        <div className="about-card-heading">
          <CodeIcon size={19} /><h2 id="about-tech-title">技术栈</h2>
          <span className="about-section-note">当前构建版本</span>
        </div>
        <dl className="about-tech-grid">
          {desktopTechStack.map((tech) => (
            <div className="about-tech-chip" key={tech.name}>
              <dt>
                <span className="about-tech-icon" aria-hidden="true">{tech.icon}</span>
                <span className="about-tech-name"><strong>{tech.name}</strong><span>{tech.detail}</span></span>
              </dt>
              <dd>{tech.version}</dd>
            </div>
          ))}
        </dl>
        <p className="about-tech-note">音频频谱由 Web Audio API 与 Canvas 驱动；模型 API Key 保存在 Windows 凭据管理器中。</p>
      </section>

      <div className="about-details-grid">
        <section className="about-card about-api-card" aria-labelledby="about-sources-title">
          <div className="about-card-heading">
            <CloudIcon size={19} /><h2 id="about-sources-title">音乐与 AI 服务</h2>
          </div>
          <dl className="about-source-list">
            {aboutDataSources.map((source) => (
              <div key={source.name}>
                <dt>{source.name}</dt>
                <dd>{source.scope}{source.detail && <small>{source.detail}</small>}</dd>
              </div>
            ))}
          </dl>
          <p className="about-source-note">扩展音源服务由 {GD_STUDIO_ATTRIBUTION} 提供。</p>
        </section>

        <section className="about-card" aria-labelledby="about-links-title">
          <div className="about-card-heading">
            <ExternalLinkIcon size={19} /><h2 id="about-links-title">项目与文档</h2>
          </div>
          <div className="about-resource-list">
            {aboutLinks.map((link) => (
              <a className="about-resource-link" href={link.href} target="_blank" rel="noopener noreferrer"
                onClick={(event) => handleOpenExternal(event, link.href)} key={link.href}>
                <span className="about-resource-icon" aria-hidden="true">{link.icon}</span>
                <span><strong>{link.title}</strong><small>{link.desc}</small></span>
                <ExternalLinkIcon size={13} />
              </a>
            ))}
          </div>
        </section>
      </div>

      <footer className="about-notice">
        <div>
          <strong>开源与致谢</strong>
          <p>项目代码采用 MIT 许可，第三方组件与服务遵循各自许可。感谢每一位开源贡献者。</p>
          <p>音乐与元数据来自第三方服务，下载文件保存在本地，请支持正版音乐。</p>
        </div>
        <span>© 2026 TuneFree</span>
      </footer>
    </section>
  );
}
