import { RUNTIME_BUFFER_SOURCE } from './bufferSource';
import { RUNTIME_CRYPTO_SOURCE } from './cryptoSource';
import { RUNTIME_LX_SOURCE } from './lxSource';

/** 运行时注入到沙箱里的环境信息。 */
export interface RuntimeConfig {
  /** 应用版本，脚本会把它当洛雪版本号使用（影响部分脚本的分支逻辑）。 */
  appVersion: string;
}

/**
 * 组装 Worker 入口脚本文本。
 *
 * 顺序固定：字节工具 → 加密工具 → lx 宿主桥。片段之间通过全局词法绑定共享函数，
 * 因此拼接顺序不能调整。
 */
export const buildRuntimeSource = (config: RuntimeConfig): string => {
  const header = `globalThis.__TUNEFREE_RUNTIME__ = ${JSON.stringify({
    appVersion: config.appVersion,
  })};\n`;
  return header + [RUNTIME_BUFFER_SOURCE, RUNTIME_CRYPTO_SOURCE, RUNTIME_LX_SOURCE].join('\n');
};
