import { describe, expect, it, vi } from 'vitest';
import {
  MUSIC_SOURCES_STORAGE_KEY,
  TOTAL_SCRIPT_BYTES_LIMIT,
  compressScript,
  createSourceRecord,
  decompressScript,
  loadSourceRecords,
  persistSourceRecords,
  totalScriptBytes,
  type MusicSourceRecord,
} from '../store';

/** 只在需要时让写入失败，其余场景仍走真实实现（含真实 localStorage）。 */
const mocks = vi.hoisted(() => ({ failWrites: { value: false } }));

vi.mock('../../../utils/safeStorage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../utils/safeStorage')>();
  return {
    ...actual,
    safeSetJson: (key: string, value: unknown) =>
      mocks.failWrites.value ? false : actual.safeSetJson(key, value),
  };
});

const sampleScript = `/**
 * @name 示例音源
 * @version 1.0.0
 * @author tester
 * @description 仅用于测试
 */
globalThis.lx;
`;

const makeRecord = async (overrides: Partial<MusicSourceRecord> = {}): Promise<MusicSourceRecord> => {
  const created = await createSourceRecord('sample.js', sampleScript);
  if (!created.ok) throw new Error('fixture 无效');
  return { ...created.record, ...overrides };
};

describe('store', () => {
  it('压缩与解压可往返，且明显小于原文', () => {
    const payload = compressScript(sampleScript);
    expect(decompressScript(payload)).toBe(sampleScript);
    const repetitive = 'globalThis.lx;\n'.repeat(200);
    expect(compressScript(repetitive).length).toBeLessThan(repetitive.length);
  });

  it('由文本生成记录：解析元数据并计算 md5 主键', async () => {
    const record = await makeRecord();
    expect(record.name).toBe('示例音源');
    expect(record.version).toBe('1.0.0');
    expect(record.author).toBe('tester');
    expect(record.description).toBe('仅用于测试');
    expect(record.fileName).toBe('sample.js');
    expect(record.enabled).toBe(true);
    expect(record.nameMatchFallback).toBe(false);
    expect(record.id).toMatch(/^[0-9a-f]{32}$/);
    expect(record.bytes).toBe(new TextEncoder().encode(sampleScript).length);
    expect(decompressScript(record.content)).toBe(sampleScript);
    // 同内容重复导入得到同一主键。
    const again = await makeRecord();
    expect(again.id).toBe(record.id);
  });

  it('校验失败时不生成记录', async () => {
    const empty = await createSourceRecord('x.js', '');
    expect(empty).toEqual({ ok: false, reason: '文件内容为空' });
  });

  it('持久化后可原样读回，损坏数据回落为空并留备份', () => {
    const record: MusicSourceRecord = {
      id: 'a'.repeat(32),
      name: '示例',
      version: '',
      author: '',
      description: '',
      homepage: '',
      fileName: 'a.js',
      content: compressScript(sampleScript),
      enabled: false,
      nameMatchFallback: true,
      importedAt: 1,
      bytes: 10,
    };
    expect(persistSourceRecords([record])).toEqual({ ok: true });
    expect(loadSourceRecords()).toEqual([record]);

    localStorage.setItem(MUSIC_SOURCES_STORAGE_KEY, '{ 不是 json');
    expect(loadSourceRecords()).toEqual([]);
    expect(
      Object.keys(localStorage).some((key) => key.startsWith(`${MUSIC_SOURCES_STORAGE_KEY}_corrupt_`)),
    ).toBe(true);

    localStorage.setItem(MUSIC_SOURCES_STORAGE_KEY, JSON.stringify({ version: 1, sources: 'nope' }));
    expect(loadSourceRecords()).toEqual([]);

    localStorage.setItem(
      MUSIC_SOURCES_STORAGE_KEY,
      JSON.stringify({ version: 1, sources: [null, 42, { id: 'x' }, record] }),
    );
    expect(loadSourceRecords()).toEqual([record]);

    localStorage.setItem(MUSIC_SOURCES_STORAGE_KEY, JSON.stringify('not an object'));
    expect(loadSourceRecords()).toEqual([]);
  });

  it('存储写入失败时返回明确错误', () => {
    mocks.failWrites.value = true;
    const result = persistSourceRecords([]);
    mocks.failWrites.value = false;
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toContain('配额');
  });

  it('统计脚本总字节数', async () => {
    const record = await makeRecord();
    expect(totalScriptBytes([record, { ...record, bytes: 5 }])).toBe(record.bytes + 5);
    expect(TOTAL_SCRIPT_BYTES_LIMIT).toBeGreaterThan(0);
  });
});
