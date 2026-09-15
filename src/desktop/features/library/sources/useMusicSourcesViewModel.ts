import { useCallback, useRef, useState, useSyncExternalStore } from 'react';
import { isTauri, invokeCommand } from '../../../../core/ipc';
import {
  getMusicSourcesSnapshot,
  checkMusicSourceUpdates,
  importMusicSourceFiles,
  importMusicSourceFromUrl,
  reloadMusicSources,
  removeMusicSource,
  setMusicSourceEnabled,
  setMusicSourceNameMatchFallback,
  subscribeMusicSources,
  type ImportOutcome,
  type MusicSourceEntry,
} from '../../../../core/services/sources/manager';
import { getMusicSourceLabel } from '../../../../core/utils/musicSource';
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
    entries: snapshot.entries,
    readyCount: snapshot.readyCount,
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
    openHomepage,
    platformLabel,
  };
};

export type MusicSourcesViewModel = ReturnType<typeof useMusicSourcesViewModel>;
