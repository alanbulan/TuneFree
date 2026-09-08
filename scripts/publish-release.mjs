import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const stableVersion = (tag) => /^v(\d+)\.(\d+)\.(\d+)$/.exec(tag)?.slice(1).map(BigInt);

/** 发布完成顺序不保证版本递增；旧标签只能公开，不能覆盖更高版本的 latest。 */
export function shouldMakeLatest(tag, releases) {
  const current = stableVersion(tag);
  if (!current) throw new Error(`不支持的正式版本标签：${tag}`);
  return !releases.some((release) => {
    if (release.draft || release.prerelease) return false;
    const version = stableVersion(release.tag_name);
    if (!version) return false;
    for (let index = 0; index < 3; index++) {
      if (version[index] !== current[index]) return version[index] > current[index];
    }
    return false;
  });
}

export function verifyReleaseAssets(tag, assets, manifest) {
  const version = tag.slice(1);
  const installer = `TuneFree_${version}_x64-setup.exe`;
  const macUpdater = `TuneFree_${version}_universal.app.tar.gz`;
  for (const name of [installer, `${installer}.sig`, `TuneFree_${version}_universal.dmg`,
    macUpdater, `${macUpdater}.sig`, 'latest.json']) {
    if (!assets.some((asset) => asset.name === name && asset.size > 0)) {
      throw new Error(`发布资产缺失或为空：${name}`);
    }
  }
  if (manifest.version !== version) throw new Error('更新清单版本与标签不一致');
  for (const [platform, name] of Object.entries({
    'windows-x86_64': installer, 'darwin-aarch64': macUpdater, 'darwin-x86_64': macUpdater,
  })) {
    const entry = manifest.platforms?.[platform];
    const asset = assets.find((item) => item.name === name);
    if (!entry?.signature?.trim() || !entry.url ||
        ![asset.url, asset.browser_download_url].includes(entry.url)) {
      throw new Error(`更新平台缺失或指向错误资产：${platform}`);
    }
  }
}

export function completeRelease({ publish = false, allowPublished = false } = {}) {
  const { GITHUB_REPOSITORY: repository, GITHUB_REF_NAME: tag } = process.env;
  if (!repository || !tag) throw new Error('缺少 GitHub 仓库或标签');
  const api = (args, input) => execFileSync('gh', ['api', ...args], { encoding: 'utf8', input });
  const releases = JSON.parse(api(['--paginate', '--slurp', `repos/${repository}/releases?per_page=100`])).flat();
  const release = releases.find((item) => item.tag_name === tag && (item.draft || allowPublished));
  if (!release) throw new Error(`未找到待发布草稿：${tag}`);
  const manifestAsset = release.assets.find((asset) => asset.name === 'latest.json' && asset.size > 0);
  if (!manifestAsset) throw new Error('发布资产缺失或为空：latest.json');
  const manifest = JSON.parse(api([`repos/${repository}/releases/assets/${manifestAsset.id}`,
    '-H', 'Accept: application/octet-stream']));
  verifyReleaseAssets(tag, release.assets, manifest);
  const makeLatest = shouldMakeLatest(tag, releases);
  if (!release.draft) {
    console.log(`已校验 ${tag} 的 Windows / macOS 资产和更新清单；保留当前公开状态。`);
    return;
  }
  if (!publish) {
    console.log(`已校验 ${tag} 的安装包、签名和更新清单；Release 保持草稿，等待手动发布。`);
    return;
  }
  api([`repos/${repository}/releases/${release.id}`, '--method', 'PATCH', '--input', '-'],
    JSON.stringify({ draft: false, prerelease: false, make_latest: String(makeLatest) }));
  console.log(`已发布 ${tag}；${makeLatest ? '更新 latest' : '保留已发布的更高版本为 latest'}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  completeRelease({ publish: process.argv.includes('--publish'),
    allowPublished: process.argv.includes('--allow-published') });
}
