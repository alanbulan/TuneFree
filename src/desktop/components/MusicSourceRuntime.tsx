import { useEffect } from 'react';
import { ensureMusicSourcesInitialized } from '../../core/services/sources/manager';
import { isTauri } from '../../core/ipc';

/**
 * 自定义音源的运行时宿主：应用启动后拉起已启用音源的沙箱（Worker）。
 *
 * 它不渲染任何界面，只负责让音源在切换页面、播放歌曲期间常驻；
 * 纯浏览器环境没有本地源代理，自定义音源无法工作，因此不做初始化。
 */
export function MusicSourceRuntime() {
  useEffect(() => {
    if (!isTauri()) return;
    // 初始化只跑一次并吞掉异常：音源不可用不能影响应用其它功能。
    void ensureMusicSourcesInitialized().catch((error: unknown) => {
      console.warn('[Sources] 音源初始化失败：', error);
    });
  }, []);

  return null;
}
