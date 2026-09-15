import { BUILTIN_SCRIPTS, type BuiltinScriptDefinition } from './builtin/builtinScripts';
import { createLxProvider } from './lxProvider';
import { declarationPlatform } from './platformMap';
import { relaySourceRequest } from './relay';
import { setBuiltinScriptProviders, setCustomProviders, type RegisteredProvider } from './registry';
import { parseScriptMeta } from './scriptMeta';
import {
  createSourceRecord,
  decompressScript,
  loadSourceRecords,
  persistSourceRecords,
  totalScriptBytes,
  TOTAL_SCRIPT_BYTES_LIMIT,
  type MusicSourceRecord,
} from './store';
import { LxSandbox } from './workerHost';
import { buildSourceEntry, type MusicSourceEntry } from './sourceEntry';
import { prepareSourceUpdate, sourceUpdateUrl, type SourceUpdateState } from './sourceUpdates';
export type { MusicSourceEntry, MusicSourcePlatform } from './sourceEntry';


/**
 * 自定义音源管理器：持久化记录 + 沙箱生命周期 + provider 注册，是 UI 唯一的状态来源。
 *
 * 这是 core 层模块，不依赖 react；界面通过 `subscribe` + `getSnapshot`
 * （配合 useSyncExternalStore）订阅。
 */

export interface MusicSourcesSnapshot {
  entries: MusicSourceEntry[];
  readyCount: number;
}

export interface ImportOutcome {
  fileName: string;
  ok: boolean;
  message: string;
}

/** 启动沙箱的并发度：脚本初始化会发网络请求，避免一次性全放出去。 */
const START_CONCURRENCY = 3;

let records: MusicSourceRecord[] = [];
const sandboxes = new Map<string, LxSandbox>();
/** 内置脚本沙箱（与用户脚本同一实现，但不落盘、不可删除）。 */
const builtinSandboxes = new Map<string, LxSandbox>();
const builtinMetas = new Map<string, ReturnType<typeof parseScriptMeta>>();
/** 无法启动的脚本（例如内容损坏无法解压）的原因。 */
const startErrors = new Map<string, string>();
const updates = new Map<string, SourceUpdateState>();
const listeners = new Set<() => void>();
let cachedSnapshot: MusicSourcesSnapshot | null = null;
let initialization: Promise<void> | null = null;
let lifecycle = 0;

const appVersion = (): string => __TUNEFREE_BUILD_INFO__.appVersion;

const notify = (): void => {
  cachedSnapshot = null;
  for (const listener of listeners) listener();
};

export const subscribeMusicSources = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** 内置脚本在音源页上的只读条目（同样展示状态、平台与日志）。 */
const buildBuiltinEntries = (): MusicSourceEntry[] =>
  BUILTIN_SCRIPTS.filter((definition) => builtinSandboxes.has(definition.id)).map<MusicSourceEntry>((definition) => {
    const sandbox = builtinSandboxes.get(definition.id);
    const snapshot = sandbox?.getSnapshot();
    const meta = builtinMetas.get(definition.id) ?? parseScriptMeta(definition.code, definition.id);
    return buildSourceEntry({
        id: definition.id,
        name: meta.name,
        version: meta.version,
        author: meta.author,
        description: meta.description,
        homepage: meta.homepage,
        fileName: '内置脚本',
        content: '',
        enabled: true,
        nameMatchFallback: false,
        importedAt: 0,
        bytes: 0,
        builtin: true,
      }, snapshot);
  });

const buildSnapshot = (): MusicSourcesSnapshot => {
  const entries = [...buildBuiltinEntries(), ...records.map<MusicSourceEntry>((record) => {
    const sandbox = sandboxes.get(record.id);
    const snapshot = sandbox?.getSnapshot();
    const failed = startErrors.get(record.id);
    return buildSourceEntry(record, snapshot, failed, updates.get(record.id));
  })];
  return {
    entries,
    readyCount: entries.filter((entry) => entry.status === 'ready').length,
  };
};

export const getMusicSourcesSnapshot = (): MusicSourcesSnapshot =>
  (cachedSnapshot ??= buildSnapshot());

const rebuildProviders = (): void => {
  const entries: RegisteredProvider[] = [];
  for (const record of records) {
    if (!record.enabled) continue;
    const sandbox = sandboxes.get(record.id);
    if (!sandbox || sandbox.getSnapshot().status !== 'ready') continue;
    const snapshot = sandbox.getSnapshot();
    for (const [lxPlatform, declaration] of Object.entries(snapshot.sources)) {
      const mapped = declarationPlatform(lxPlatform, declaration);
      if (!mapped) continue;
      entries.push({
        platform: mapped.appPlatform,
        provider: createLxProvider({
          scriptId: record.id,
          scriptName: record.name,
          appPlatform: mapped.appPlatform,
          lxPlatform,
          declaration,
          sandbox,
          nameMatchFallback: record.nameMatchFallback,
        }),
      });
    }
  }
  setCustomProviders(entries);
};

/** 内置脚本：与用户脚本同样的沙箱，provider 注册到内置链路（优先级由定义给出）。 */
const startBuiltinScript = async (definition: BuiltinScriptDefinition): Promise<void> => {
  if (builtinSandboxes.has(definition.id)) return;
  const meta = parseScriptMeta(definition.code, definition.id);
  builtinMetas.set(definition.id, meta);
  const sandbox = new LxSandbox({ code: definition.code, meta }, { appVersion: appVersion() });
  builtinSandboxes.set(definition.id, sandbox);
  let capabilities = '';
  sandbox.subscribe(() => {
    if (builtinSandboxes.get(definition.id) !== sandbox) return;
    const snapshot = sandbox.getSnapshot();
    const next = JSON.stringify([snapshot.status, snapshot.sources]);
    if (capabilities !== next) {
      capabilities = next;
      rebuildBuiltinScriptProviders();
    }
    notify();
  });
  await sandbox.initialize();
};

const rebuildBuiltinScriptProviders = (): void => {
  const entries: RegisteredProvider[] = [];
  for (const definition of BUILTIN_SCRIPTS) {
    const sandbox = builtinSandboxes.get(definition.id);
    if (!sandbox) continue;
    const snapshot = sandbox.getSnapshot();
    if (snapshot.status !== 'ready') continue;
    const meta = builtinMetas.get(definition.id);
    for (const [lxPlatform, declaration] of Object.entries(snapshot.sources)) {
      const mapped = declarationPlatform(lxPlatform, declaration);
      if (!mapped) continue;
      entries.push({
        platform: mapped.appPlatform,
        provider: createLxProvider({
          scriptId: definition.id,
          scriptName: meta?.name || definition.id,
          appPlatform: mapped.appPlatform,
          lxPlatform,
          declaration,
          sandbox,
          nameMatchFallback: false,
          priority: definition.priority,
          lyricsPriority: definition.lyricsPriority,
          fallback: true,
          searchTier: 'extended',
          gdStudioQuota: definition.gdStudioQuota,
          metadataRequiresUrl: definition.metadataRequiresUrl,
        }),
      });
    }
  }
  setBuiltinScriptProviders(entries);
};

const startSandbox = async (record: MusicSourceRecord, prepared?: LxSandbox): Promise<void> => {
  if (sandboxes.has(record.id) || startErrors.has(record.id)) return;
  if (!records.some((item) => item.id === record.id && item.enabled)) return;
  let code: string;
  try {
    code = decompressScript(record.content);
  } catch {
    startErrors.set(record.id, '脚本内容已损坏，无法解压，请重新导入');
    notify();
    return;
  }
  const sandbox = prepared ?? new LxSandbox(
    {
      code,
      meta: {
        name: record.name,
        description: record.description,
        version: record.version,
        author: record.author,
        homepage: record.homepage,
      },
    },
    { appVersion: appVersion() },
  );
  sandboxes.set(record.id, sandbox);
  let capabilities = '';
  sandbox.subscribe(() => {
    if (sandboxes.get(record.id) !== sandbox) return;
    const snapshot = sandbox.getSnapshot();
    const next = JSON.stringify([snapshot.status, snapshot.sources]);
    if (capabilities !== next) {
      capabilities = next;
      rebuildProviders();
    }
    notify();
  });
  await sandbox.initialize();
};

const stopSandbox = (id: string): void => {
  const sandbox = sandboxes.get(id);
  if (!sandbox) return;
  sandboxes.delete(id);
  sandbox.dispose();
};

const runWithConcurrency = async (tasks: Array<() => Promise<void>>, limit: number): Promise<void> => {
  const queue = [...tasks];
  const started = lifecycle;
  const workers = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    while (queue.length > 0 && started === lifecycle) {
      const task = queue.shift();
      await task?.();
    }
  });
  await Promise.all(workers);
};

/** 启动所有已启用的音源（幂等，重复调用只跑一次）。 */
export const ensureMusicSourcesInitialized = (): Promise<void> => {
  initialization ??= (async () => {
    records = loadSourceRecords();
    rebuildProviders();
    notify();
    await runWithConcurrency(
      [
        ...BUILTIN_SCRIPTS.map((definition) => () => startBuiltinScript(definition)),
        ...records.filter((record) => record.enabled).map((record) => () => startSandbox(record)),
      ],
      START_CONCURRENCY,
    );
    void checkMusicSourceUpdates(true);
  })();
  return initialization;
};

/** 先保存再发布，失败时保留当前记录、开关和运行中的沙箱。 */
const applyRecords = (next: MusicSourceRecord[]): string | null => {
  const saved = persistSourceRecords(next);
  if (!saved.ok) return saved.error;
  records = next;
  rebuildProviders();
  notify();
  return null;
};

/**
 * 导入若干脚本文本：校验 → 去重（同内容按 md5 覆盖，保留启用状态）→ 落盘 → 启动沙箱。
 */
export const importMusicSourceFiles = async (
  inputs: Array<{ fileName: string; text: string; sourceUrl?: string }>,
): Promise<ImportOutcome[]> => {
  const outcomes: ImportOutcome[] = [];
  const importedIds: string[] = [];
  // 异步预处理完成后再读取最新记录，避免两个导入批次相互覆盖。
  const prepared = await Promise.all(inputs.map(async (input) => ({
    input, created: await createSourceRecord(input.fileName, input.text),
  })));
  const next = [...records];

  for (const { input, created } of prepared) {
    if (!created.ok) {
      outcomes.push({ fileName: input.fileName, ok: false, message: created.reason });
      continue;
    }
    if (input.sourceUrl) created.record.sourceUrl = input.sourceUrl;
    const duplicateIndex = next.findIndex((record) => record.id === created.record.id);
    const record =
      duplicateIndex >= 0
        ? {
            ...created.record,
            enabled: next[duplicateIndex].enabled,
            nameMatchFallback: next[duplicateIndex].nameMatchFallback,
            importedAt: next[duplicateIndex].importedAt,
            sourceUrl: created.record.sourceUrl ?? next[duplicateIndex].sourceUrl,
          }
        : created.record;
    if (duplicateIndex >= 0) {
      next[duplicateIndex] = record;
      outcomes.push({ fileName: input.fileName, ok: true, message: '内容相同，已更新原有音源' });
    } else {
      next.push(record);
      outcomes.push({ fileName: input.fileName, ok: true, message: '已导入' });
    }
    importedIds.push(record.id);
  }

  if (outcomes.every((outcome) => !outcome.ok)) return outcomes;

  if (totalScriptBytes(next) > TOTAL_SCRIPT_BYTES_LIMIT) {
    const limitMessage = `音源总量超过 ${Math.round(TOTAL_SCRIPT_BYTES_LIMIT / 1024 / 1024)} MB 上限，请先删除部分音源`;
    return outcomes.map((outcome) => (outcome.ok ? { ...outcome, ok: false, message: limitMessage } : outcome));
  }

  const persistError = applyRecords(next);
  if (persistError) {
    return outcomes.map((outcome) => (outcome.ok ? { ...outcome, ok: false, message: persistError } : outcome));
  }
  void runWithConcurrency(importedIds.map((id) => async () => {
    const record = records.find((item) => item.id === id && item.enabled);
    if (!record) return;
    startErrors.delete(id);
    if (sandboxes.get(id)?.getSnapshot().status === 'failed') stopSandbox(id);
    await startSandbox(record);
  }), START_CONCURRENCY);
  return outcomes;
};

const fileNameFromUrl = (url: string): string => {
  try {
    const segments = new URL(url).pathname.split('/').filter(Boolean);
    const last = segments[segments.length - 1];
    if (last && /\.(js|txt)$/i.test(last)) return decodeURIComponent(last);
  } catch {
    /* 落到默认名 */
  }
  return `在线音源-${Date.now()}.js`;
};

/** 从链接导入：先经源代理下载脚本文本，再走本地导入流程。 */
export const importMusicSourceFromUrl = async (url: string): Promise<ImportOutcome> => {
  const fileName = fileNameFromUrl(url);
  const result = await relaySourceRequest({
    url,
    method: 'GET',
    headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
    bodyBase64: '',
  });
  if ('error' in result) return { fileName, ok: false, message: result.error };
  if (result.envelope.status < 200 || result.envelope.status >= 300) {
    return { fileName, ok: false, message: `脚本下载失败（HTTP ${result.envelope.status}）` };
  }
  const text = new TextDecoder('utf-8').decode(
    Uint8Array.from(atob(result.envelope.bodyBase64), (character) => character.charCodeAt(0)),
  );
  const [outcome] = await importMusicSourceFiles([{ fileName, text, sourceUrl: url }]);
  return outcome ?? { fileName, ok: false, message: '导入失败' };
};

export const removeMusicSource = (id: string): string | null => {
  if (!records.some((record) => record.id === id)) return null;
  const error = applyRecords(records.filter((record) => record.id !== id));
  if (error) return error;
  stopSandbox(id);
  startErrors.delete(id);
  updates.delete(id);
  return null;
};

export const setMusicSourceEnabled = (id: string, enabled: boolean): string | null => {
  const target = records.find((record) => record.id === id);
  if (!target || target.enabled === enabled) return null;
  const error = applyRecords(records.map((record) => (record.id === id ? { ...record, enabled } : record)));
  if (error) return error;
  updates.delete(id);
  if (enabled) {
    startErrors.delete(id);
    void startSandbox(target);
  } else {
    stopSandbox(id);
  }
  rebuildProviders();
  notify();
  return null;
};

export const setMusicSourceNameMatchFallback = (id: string, value: boolean): string | null => {
  if (!records.some((record) => record.id === id && record.nameMatchFallback !== value)) return null;
  return applyRecords(
    records.map((record) => (record.id === id ? { ...record, nameMatchFallback: value } : record)),
  );
};

/** 更新完成并通过初始化验证后才替换；下载失败、旧版本和并发删除均保留原状态。 */
export const checkMusicSourceUpdates = async (automatic = false): Promise<SourceUpdateState[]> => {
  const started = lifecycle;
  const results: SourceUpdateState[] = [];
  const entries = getMusicSourcesSnapshot().entries.filter((entry) => !entry.record.builtin && entry.record.enabled);
  await runWithConcurrency(entries.map((entry) => async () => {
    const id = entry.record.id;
    if (updates.get(id)?.status === 'checking') return;
    const url = sourceUpdateUrl(entry.record, entry.updateAlert?.updateUrl);
    if (!url && automatic) return;
    if (!url) {
      const result: SourceUpdateState = { status: 'unsupported', message: '作者未提供可用的更新链接' };
      updates.set(id, result); results.push(result); notify(); return;
    }
    const checking: SourceUpdateState = { status: 'checking', message: '正在检查更新…' };
    updates.set(id, checking); notify();
    const prepared = await prepareSourceUpdate(entry.record, url, appVersion());
    const current = records.find((record) => record.id === id);
    if (started !== lifecycle || !current || !current.enabled || updates.get(id) !== checking) { prepared.sandbox?.dispose(); return; }
    let result: SourceUpdateState = { status: prepared.status, message: prepared.message };
    if (prepared.record && prepared.sandbox) {
      const replacement = { ...prepared.record, enabled: current.enabled, nameMatchFallback: current.nameMatchFallback, importedAt: current.importedAt };
      const next = records.map((record) => record.id === id ? replacement : record);
      const error = next.some((record) => record.id === replacement.id && record !== replacement)
        ? '列表中已存在该新版音源'
        : totalScriptBytes(next) > TOTAL_SCRIPT_BYTES_LIMIT ? '更新后音源总量超过存储上限' : applyRecords(next);
      if (error) { prepared.sandbox.dispose(); result = { status: 'failed', message: error }; }
      else {
        stopSandbox(id); startErrors.delete(id); updates.delete(id);
        await startSandbox(replacement, prepared.sandbox);
        rebuildProviders(); updates.set(replacement.id, result);
      }
    }
    if (records.some((record) => record.id === id)) updates.set(id, result);
    results.push(result); notify();
  }), START_CONCURRENCY);
  return results;
};

/** 重新加载全部已启用音源（脚本升级或排查时使用）。 */
export const reloadMusicSources = async (): Promise<void> => {
  lifecycle += 1;
  const builtins = BUILTIN_SCRIPTS.filter((definition) => builtinSandboxes.has(definition.id));
  for (const id of sandboxes.keys()) stopSandbox(id);
  const previousBuiltins = [...builtinSandboxes.values()];
  builtinSandboxes.clear();
  for (const sandbox of previousBuiltins) sandbox.dispose();
  startErrors.clear();
  for (const [id, update] of updates) if (update.status === 'checking') updates.delete(id);
  rebuildProviders();
  rebuildBuiltinScriptProviders();
  notify();
  await runWithConcurrency(
    [
      ...builtins.map((definition) => () => startBuiltinScript(definition)),
      ...records.filter((record) => record.enabled).map((record) => () => startSandbox(record)),
    ],
    START_CONCURRENCY,
  );
};

/** 释放全部沙箱与状态（应用退出、测试清理用）。 */
export const disposeMusicSources = (): void => {
  lifecycle += 1;
  for (const id of sandboxes.keys()) stopSandbox(id);
  const previousBuiltins = [...builtinSandboxes.values()];
  builtinSandboxes.clear();
  for (const sandbox of previousBuiltins) sandbox.dispose();
  builtinMetas.clear();
  updates.clear();
  startErrors.clear();
  records = [];
  initialization = null;
  setCustomProviders([]);
  setBuiltinScriptProviders([]);
  notify();
};
