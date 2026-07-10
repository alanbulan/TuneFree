import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const bumpType = args.includes('--major') ? 'major'
  : args.includes('--minor') ? 'minor'
    : 'patch';

const paths = {
  packageJson: path.resolve('package.json'),
  packageLock: path.resolve('package-lock.json'),
  tauriConfig: path.resolve('src-tauri/tauri.conf.json'),
  cargoToml: path.resolve('src-tauri/Cargo.toml'),
  cargoLock: path.resolve('src-tauri/Cargo.lock'),
};

const bumpVersion = (currentVersion, type) => {
  const parts = currentVersion.split('.').map(Number);
  if (parts.length !== 3 || parts.some((part) => !Number.isInteger(part) || part < 0)) {
    throw new Error(`不支持的版本号：${currentVersion}`);
  }

  if (type === 'major') return `${parts[0] + 1}.0.0`;
  if (type === 'minor') return `${parts[0]}.${parts[1] + 1}.0`;
  return `${parts[0]}.${parts[1]}.${parts[2] + 1}`;
};

const packageJson = JSON.parse(fs.readFileSync(paths.packageJson, 'utf8'));
const packageLock = JSON.parse(fs.readFileSync(paths.packageLock, 'utf8'));
const tauriConfig = JSON.parse(fs.readFileSync(paths.tauriConfig, 'utf8'));
const cargoToml = fs.readFileSync(paths.cargoToml, 'utf8');
const cargoLock = fs.readFileSync(paths.cargoLock, 'utf8');

const cargoTomlMatch = cargoToml.match(/^version\s*=\s*"([^"]+)"/m);
const cargoLockMatch = cargoLock.match(/\[\[package\]\]\r?\nname = "app"\r?\nversion = "([^"]+)"/);
const currentVersions = {
  'package.json': packageJson.version,
  'package-lock.json': packageLock.version,
  'package-lock.json packages[""]': packageLock.packages?.['']?.version,
  'tauri.conf.json': tauriConfig.version,
  'Cargo.toml': cargoTomlMatch?.[1],
  'Cargo.lock': cargoLockMatch?.[1],
};

const missing = Object.entries(currentVersions).filter(([, version]) => typeof version !== 'string');
if (missing.length > 0) {
  throw new Error(`无法读取版本号：${missing.map(([name]) => name).join('、')}`);
}

const uniqueVersions = new Set(Object.values(currentVersions));
if (uniqueVersions.size !== 1) {
  throw new Error(`版本号不一致，已停止修改：${JSON.stringify(currentVersions)}`);
}

const currentVersion = packageJson.version;
const nextVersion = bumpVersion(currentVersion, bumpType);

packageJson.version = nextVersion;
packageLock.version = nextVersion;
packageLock.packages[''].version = nextVersion;
tauriConfig.version = nextVersion;

const nextCargoToml = cargoToml.replace(
  /^version\s*=\s*"[^"]+"/m,
  `version = "${nextVersion}"`,
);
const nextCargoLock = cargoLock.replace(
  /(\[\[package\]\]\r?\nname = "app"\r?\nversion = ")[^"]+(".*)/,
  `$1${nextVersion}$2`,
);

if (!dryRun) {
  fs.writeFileSync(paths.packageJson, `${JSON.stringify(packageJson, null, 2)}\n`);
  fs.writeFileSync(paths.packageLock, `${JSON.stringify(packageLock, null, 2)}\n`);
  fs.writeFileSync(paths.tauriConfig, `${JSON.stringify(tauriConfig, null, 2)}\n`);
  fs.writeFileSync(paths.cargoToml, nextCargoToml);
  fs.writeFileSync(paths.cargoLock, nextCargoLock);
}

console.log(`[Bump${dryRun ? ':dry-run' : ''}] ${currentVersion} -> ${nextVersion} (${bumpType})`);
