// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { completeRelease, shouldMakeLatest } from '../publish-release.mjs';

vi.mock('node:child_process', () => ({ execFileSync: vi.fn() }));

const released = (tag_name, patch = {}) => ({ tag_name, draft: false, prerelease: false, ...patch });
describe('正式发布版本顺序', () => {
  it('旧标签即使后完成也不能回退 latest', () => {
    expect(shouldMakeLatest('v1.1.9', [released('v1.1.10')])).toBe(false);
    expect(shouldMakeLatest('v1.9.99', [released('v2.0.0')])).toBe(false);
    expect(shouldMakeLatest('v1.1.10', [released('v1.1.9')])).toBe(true);
  });
  it('草稿、预发布和无关标签不改变正式版本排序', () => {
    expect(shouldMakeLatest('v1.1.10', [released('v9.0.0', { draft: true }),
      released('v8.0.0', { prerelease: true }), released('nightly')])).toBe(true);
    expect(() => shouldMakeLatest('v1.1.10-beta', [])).toThrow();
  });
});

describe('发布资产验证与手动公开', () => {
  const tag = 'v1.1.30';
  const draft = () => released(tag, {
    id: 123,
    draft: true,
    assets: ['TuneFree_1.1.30_x64-setup.exe', 'TuneFree_1.1.30_x64-setup.exe.sig', 'latest.json']
      .map((name) => ({ name, size: 100 })),
  });

  beforeEach(() => {
    vi.stubEnv('GITHUB_REPOSITORY', 'alanbulan/TuneFree_Mobile');
    vi.stubEnv('GITHUB_REF_NAME', tag);
    vi.mocked(execFileSync).mockReset().mockReturnValue(JSON.stringify([[draft()]]));
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('默认仅读取并校验草稿，不发送公开请求', () => {
    completeRelease();
    expect(execFileSync).toHaveBeenCalledExactlyOnceWith('gh', [
      'api', '--paginate', '--slurp', 'repos/alanbulan/TuneFree_Mobile/releases?per_page=100',
    ], { encoding: 'utf8', input: undefined });
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Release 保持草稿'));
  });

  it('显式发布才将草稿公开并更新 latest', () => {
    completeRelease({ publish: true });
    expect(execFileSync).toHaveBeenLastCalledWith('gh', [
      'api', 'repos/alanbulan/TuneFree_Mobile/releases/123', '--method', 'PATCH', '--input', '-',
    ], { encoding: 'utf8', input: JSON.stringify({ draft: false, prerelease: false, make_latest: 'true' }) });
  });

  it('发布较旧版本时保留较新的 latest', () => {
    vi.mocked(execFileSync).mockReturnValue(JSON.stringify([[draft()], [released('v1.1.31')]]));
    completeRelease({ publish: true });
    const options = vi.mocked(execFileSync).mock.calls.at(-1)[2];
    expect(JSON.parse(options.input).make_latest).toBe('false');
  });

  it.each(['GITHUB_REPOSITORY', 'GITHUB_REF_NAME'])('缺少 %s 时拒绝执行', (name) => {
    vi.stubEnv(name, '');
    expect(() => completeRelease()).toThrow('缺少 GitHub 仓库或标签');
    expect(execFileSync).not.toHaveBeenCalled();
  });

  it('目标已经公开时拒绝覆盖', () => {
    vi.mocked(execFileSync).mockReturnValue(JSON.stringify([[released(tag)]]));
    expect(() => completeRelease({ publish: true })).toThrow('未找到待发布草稿');
    expect(execFileSync).toHaveBeenCalledTimes(1);
  });

  it.each(['missing', 'empty'])('更新清单 %s 时阻止完成或公开', (failure) => {
    const release = draft();
    if (failure === 'missing') release.assets.pop();
    else release.assets.at(-1).size = 0;
    vi.mocked(execFileSync).mockReturnValue(JSON.stringify([[release]]));
    expect(() => completeRelease({ publish: true })).toThrow('发布资产缺失或为空：latest.json');
    expect(execFileSync).toHaveBeenCalledTimes(1);
  });
});
