import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { isTauri, invokeCommand } from '../../../../core/ipc';
import {
  getMusicSourcesSnapshot,
  checkMusicSourceUpdates,
  importMusicSourceFiles,
  importMusicSourceFromUrl,
  reloadMusicSources,
  removeMusicSource,
  moveMusicSource,
  setMusicSourceEnabled,
  setMusicSourceNameMatchFallback,
  subscribeMusicSources,
  type ImportOutcome,
  type MusicSourceEntry,
} from '../../../../core/services/sources/manager';
import { getMusicSourceLabel } from '../../../../core/utils/musicSource';
import {
  getOpenCircuits,
  subscribeCircuitBreaker,
} from '../../../../core/services/sources/circuitBreaker';
import { probeMusicSources } from '../../../../core/services/sources/sourceProbe';
import { useDesktopDialog } from '../../../components/DialogHost';
import { useToast } from '../../../components/ToastHost';
import { sourceStatus } from './sourceStatus';

/** 单次最多导入的脚本数，避免一次拖进几百个文件把主线程占满。 */
const MAX_IMPORT_FILES = 50;

const readFileText = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => reject(reader.error ?? new Error('读取文件失败'));
    reader.readAsText(file, 'utf-8');
  });

const summarize = (outcomes: ImportOutcome[]): { tone: 'success' | 'warning' | 'error'; message: string } => {
  if (outcomes.length === 0) return { tone: 'warning', message: '没有可导入的脚本' };
  const succeeded = outcomes.filter((outcome) => outcome.ok).length;
  const failed = outcomes.filter((outcome) => !outcome.ok);
  if (failed.length === 0) return { tone: 'success', message: `已导入 ${succeeded} 个音源` };
  const firstFailure = failed[0].message;
  if (succeeded === 0) {
    return { tone: 'error', message: failed.length === 1 ? firstFailure : `全部导入失败：${firstFailure}` };
  }
  return { tone: 'warning', message: `${succeeded} 个成功，${failed.length} 个失败：${firstFailure}` };
};

/**
 * 音源管理页的视图模型：订阅 core 层管理器状态，并把导入 / 启停 / 删除等动作
 * 包装成带提示与确认的界面行为。
 */
export const useMusicSourcesViewModel = () => {
  const snapshot = useSyncExternalStore(
    subscribeMusicSources,
    getMusicSourcesSnapshot,
    getMusicSourcesSnapshot,
  );
  // 已熔断的通道单独订阅：用户手动重载音源会清空它，界面要跟着更新。
  const openCircuits = useSyncExternalStore(
    subscribeCircuitBreaker,
    getOpenCircuits,
    getOpenCircuits,
  );
  const { showToast } = useToast();
  const { confirmDialog } = useDesktopDialog();
  const [importing, setImporting] = useState(false);
  const importingRef = useRef(false);
  const [urlInput, setUrlInput] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [dropActive, setDropActive] = useState(false);
  const [reloading, setReloading] = useState(false);
  const [checkingUpdates, setCheckingUpdates] = useState(false);
  const reloadingRef = useRef(false);
  const updatingRef = useRef(false);
  /** 检测进度：已完成数 / 总数 / 正在检测的音源；null 表示没有进行中的检测。 */
  const [probe, setProbe] = useState<{ done: number; total: number; active: string[] } | null>(null);
  const probeRef = useRef<AbortController | null>(null);

  const importFiles = useCallback(
    async (files: File[]) => {
      if (importingRef.current) return;
      const scripts = files.filter((file) => /\.(js|txt|mjs|cjs)$/i.test(file.name)).slice(0, MAX_IMPORT_FILES);
      if (scripts.length === 0) {
        showToast('请选择音源文件（.js 或 .txt）', 'warning');
        return;
      }
      importingRef.current = true;
      setImporting(true);
      try {
        const inputs: Array<{ fileName: string; text: string }> = [];
        for (const file of scripts) {
          try {
            inputs.push({ fileName: file.name, text: await readFileText(file) });
          } catch {
            showToast(`读取 ${file.name} 失败`, 'error');
          }
        }
        if (inputs.length === 0) return;
        const { tone, message } = summarize(await importMusicSourceFiles(inputs));
        showToast(message, tone);
      } catch (error) {
        showToast(error instanceof Error ? error.message : '音源导入失败', 'error');
      } finally {
        importingRef.current = false;
        setImporting(false);
      }
    },
    [showToast],
  );

  const importFromUrl = useCallback(async () => {
    if (importingRef.current) return;
    const url = urlInput.trim();
    if (!/^https?:\/\//i.test(url)) {
      showToast('请输入以 http(s) 开头的脚本链接', 'warning');
      return;
    }
    importingRef.current = true;
    setImporting(true);
    try {
      const outcome = await importMusicSourceFromUrl(url);
      showToast(outcome.ok ? `已导入 ${outcome.fileName}` : outcome.message, outcome.ok ? 'success' : 'error');
      if (outcome.ok) setUrlInput('');
    } catch (error) {
      showToast(error instanceof Error ? error.message : '音源导入失败', 'error');
    } finally {
      importingRef.current = false;
      setImporting(false);
    }
  }, [showToast, urlInput]);

  const remove = useCallback(
    async (entry: MusicSourceEntry) => {
      if (entry.record.builtin) return;
      const confirmed = await confirmDialog({
        title: '删除音源',
        message: `确定删除「${entry.record.name}」？该音源提供的解析会立即失效。`,
        confirmLabel: '删除',
        tone: 'danger',
      });
      if (!confirmed) return;
      const error = removeMusicSource(entry.record.id);
      showToast(error || `已删除「${entry.record.name}」`, error ? 'error' : 'success');
    },
    [confirmDialog, showToast],
  );

  const toggleEnabled = useCallback((entry: MusicSourceEntry, enabled: boolean) => {
    if (entry.record.builtin) return;
    const error = setMusicSourceEnabled(entry.record.id, enabled);
    if (error) showToast(error, 'error');
  }, [showToast]);

  const toggleNameMatch = useCallback((id: string, value: boolean) => {
    const error = setMusicSourceNameMatchFallback(id, value);
    if (error) showToast(error, 'error');
  }, [showToast]);

  const reload = useCallback(async () => {
    if (reloadingRef.current) return;
    reloadingRef.current = true; setReloading(true);
    try { await reloadMusicSources(); showToast('已重新加载音源，解析状态将在播放时更新', 'info'); }
    catch (error) { showToast(error instanceof Error ? error.message : '重新加载失败', 'error'); }
    finally { reloadingRef.current = false; setReloading(false); }
  }, [showToast]);

  const checkUpdates = useCallback(async () => {
    if (updatingRef.current) return;
    updatingRef.current = true; setCheckingUpdates(true);
    try {
      const results = await checkMusicSourceUpdates();
      const updated = results.filter((result) => result.status === 'updated').length;
      const failed = results.filter((result) => result.status === 'failed').length;
      const unsupported = results.filter((result) => result.status === 'unsupported').length;
      showToast(`更新检查完成：${updated} 个已更新${failed ? `，${failed} 个失败` : ''}${unsupported ? `，${unsupported} 个未提供更新链接` : ''}`, failed ? 'warning' : 'success');
    } catch (error) { showToast(error instanceof Error ? error.message : '检查更新失败', 'error'); }
    finally { updatingRef.current = false; setCheckingUpdates(false); }
  }, [showToast]);

  /**
   * 主动检测：逐个音源用检测歌曲真实解析一次播放地址（限并发、可取消、不可重入）。
   * 结果由沙箱写进各音源的诊断记录，状态点与「最近解析」列表随之刷新；
   * 不经过熔断器，也不改变音源顺序。一键检测与单个音源的「检测」共用这一条路径。
   */
  const probeSources = useCallback(async (targets: MusicSourceEntry[]) => {
    if (probeRef.current) return;
    const candidates = targets.filter((entry) => entry.record.enabled && entry.status === 'ready');
    if (candidates.length === 0) {
      showToast('没有可检测的音源（需已启用并加载完成）', 'warning');
      return;
    }
    const controller = new AbortController();
    probeRef.current = controller;
    const total = candidates.length;
    setProbe({ done: 0, total, active: [] });
    try {
      const results = await probeMusicSources(candidates, {
        signal: controller.signal,
        onProgress: (done, active) => setProbe({ done, total, active }),
      });
      const passed = results.filter((result) => result.ok).length;
      const skipped = results.filter((result) => result.skipped).length;
      const failed = results.length - passed - skipped;
      if (controller.signal.aborted) {
        showToast(`已取消检测，完成 ${results.length}/${total}`, 'info');
      } else if (total === 1) {
        const [result] = results;
        const name = candidates[0].record.name;
        showToast(result.ok ? `「${name}」检测通过，用时 ${(result.durationMs / 1000).toFixed(1)} 秒` : `「${name}」检测未通过：${result.message}`,
          result.ok ? 'success' : 'warning');
      } else {
        showToast(`检测完成：${passed} 个可用${failed ? `，${failed} 个失败` : ''}${skipped ? `，${skipped} 个无可检测平台` : ''}`,
          failed ? 'warning' : 'success');
      }
    } finally {
      probeRef.current = null;
      setProbe(null);
    }
  }, [showToast]);

  const cancelProbe = useCallback(() => probeRef.current?.abort(), []);
  // 离开音源页时停止检测，不在后台继续占用脚本请求。
  useEffect(() => () => probeRef.current?.abort(), []);

  const toggleExpanded = useCallback((id: string) => {
    setExpandedId((current) => (current === id ? null : id));
  }, []);

  const openHomepage = useCallback(async (url: string) => {
    let target: URL;
    try {
      target = new URL(url);
      if (target.protocol !== 'https:' || !target.hostname) throw new Error('invalid URL');
    } catch {
      showToast('仅支持打开有效的 HTTPS 链接', 'warning');
      return;
    }
    if (isTauri()) {
      try {
        await invokeCommand('open_external_url', { url: target.href });
      } catch {
        showToast('打开链接失败，请稍后重试', 'error');
      }
      return;
    }
    window.open(target.href, '_blank', 'noopener,noreferrer');
  }, [showToast]);

  const platformLabel = useCallback((platform: string) => getMusicSourceLabel(platform, 'full'), []);

  return {
    moveSource: (id: string, targetId: string) => {
      const error = moveMusicSource(id, targetId);
      if (error) showToast(error, 'error');
    },
    entries: snapshot.entries,
    readyCount: snapshot.readyCount,
    /**
     * 已熔断的通道：上游连续失败被摘下的 (音源, 平台, 能力)。
     * 这是「日志里一片失效」的可解释来源——不是每次都在重试，而是已经放弃了。
     */
    openCircuits,
    healthCounts: {
      unverified: snapshot.entries.filter((entry) => sourceStatus(entry).tone === 'unverified').length,
      success: snapshot.entries.filter((entry) => sourceStatus(entry).tone === 'success').length,
      failed: snapshot.entries.filter((entry) => sourceStatus(entry).tone === 'failed').length,
    },
    importing,
    urlInput,
    setUrlInput,
    expandedId,
    toggleExpanded,
    dropActive,
    setDropActive,
    importFiles,
    importFromUrl,
    remove,
    toggleEnabled,
    toggleNameMatch,
    reload,
    reloading,
    checkingUpdates: checkingUpdates || snapshot.entries.some((entry) => entry.update?.status === 'checking'),
    checkUpdates,
    probe,
    probeSources,
    cancelProbe,
    openHomepage,
    platformLabel,
  };
};

export type MusicSourcesViewModel = ReturnType<typeof useMusicSourcesViewModel>;
