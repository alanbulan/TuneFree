import { relaySourceRequest } from './relay';
import { createSourceRecord, type MusicSourceRecord } from './store';
import { LxSandbox } from './workerHost';

export interface SourceUpdateState {
  status: 'checking' | 'updated' | 'current' | 'unsupported' | 'failed';
  message: string;
}

export type PreparedSourceUpdate = SourceUpdateState & {
  record?: MusicSourceRecord;
  sandbox?: LxSandbox;
};

/** 已核对作者仓库的直链；旧脚本未声明更新地址，或仅上报了下载介绍页。 */
export const sourceUpdateUrl = (record: MusicSourceRecord, declaredUrl?: string): string | undefined => {
  if (record.author === 'Ryn' && record.name === 'HYWmusic_beta_公益测试') {
    return 'https://raw.githubusercontent.com/Macrohard0001/HYWmusic_source/main/HYWmusic_公益版_v1.0.3.js';
  }
  if (record.author === '万去了了' && record.name === '星海音乐源') {
    return 'https://raw.githubusercontent.com/cdyUuu/lx-music-xinghai-source/main/xinghai-music-source.js';
  }
  return declaredUrl || record.sourceUrl;
};

/** 比较脚本常见的 v1.2.3 / v501 / v0.8.4_beta5，不猜测无法识别的版本。 */
export const compareScriptVersions = (next: string, current: string): number | null => {
  const parse = (value: string) => /^v?(\d+(?:\.\d+)*)(?:[-_]([a-z][\w.-]*))?$/i.exec(value.trim());
  const a = parse(next);
  const b = parse(current);
  if (!a || !b) return null;
  const left = a[1].split('.').map(Number);
  const right = b[1].split('.').map(Number);
  for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
    const delta = (left[i] ?? 0) - (right[i] ?? 0);
    if (delta) return Math.sign(delta);
  }
  if (!a[2] && b[2]) return 1;
  if (a[2] && !b[2]) return -1;
  return (a[2] ?? '').localeCompare(b[2] ?? '', 'en', { numeric: true });
};

/** 下载作者声明的脚本，并在独立沙箱中完成初始化；不改变正在使用的音源。 */
export const prepareSourceUpdate = async (
  record: MusicSourceRecord,
  updateUrl: string,
  appVersion: string,
): Promise<PreparedSourceUpdate> => {
  let sandbox: LxSandbox | undefined;
  try {
    const url = new URL(updateUrl);
    if (!['https:', 'http:'].includes(url.protocol)) throw new Error('更新地址必须使用 HTTP(S)');
    const response = await relaySourceRequest({
      url: url.href, method: 'GET', headers: {}, bodyBase64: '', timeoutMs: 15_000,
    });
    if ('error' in response) throw new Error(response.error);
    const code = new TextDecoder().decode(Uint8Array.from(atob(response.envelope.bodyBase64), (char) => char.charCodeAt(0)));
    if (response.envelope.status < 200 || response.envelope.status >= 300) {
      let detail = '';
      try {
        const body = JSON.parse(code);
        const message = body?.message || body?.msg || body?.error;
        if (typeof message === 'string') detail = `：${message}`;
      } catch { /* 非 JSON 错误页面只展示状态码。 */ }
      throw new Error(`下载更新失败（HTTP ${response.envelope.status}）${detail}`);
    }
    const created = await createSourceRecord(record.fileName, code);
    if (!created.ok) throw new Error(created.reason);
    if (created.record.id === record.id) return { status: 'current', message: '已经是当前版本' };
    const sameAuthor = !!record.author.trim() && created.record.author.trim() === record.author.trim();
    if (created.record.name !== record.name && !sameAuthor) throw new Error('更新脚本名称与作者不匹配，已保留原音源');
    const order = compareScriptVersions(created.record.version, record.version);
    if (order === null) throw new Error('无法确认新旧版本顺序，请通过作者链接核对');
    if (order <= 0) return { status: 'current', message: '未发现更新版本' };
    sandbox = new LxSandbox({ code, meta: created.record }, { appVersion });
    await sandbox.initialize();
    if (sandbox.getSnapshot().status !== 'ready') throw new Error(`新版初始化失败：${sandbox.getSnapshot().error}`);
    return {
      status: 'updated', message: `已更新至 ${created.record.version}`,
      record: { ...created.record, sourceUrl: url.href }, sandbox,
    };
  } catch (error) {
    sandbox?.dispose();
    return { status: 'failed', message: error instanceof Error ? error.message : '更新失败，已保留原音源' };
  }
};
