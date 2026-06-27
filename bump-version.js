import fs from 'fs';
import path from 'path';

// ============================================================
// bump-version.js — 统一版本号自增工具
//
// 用法:
//   node bump-version.js           # 默认 patch 自增 (1.0.25 → 1.0.26)
//   node bump-version.js --minor   # minor 自增    (1.0.25 → 1.1.0)
//   node bump-version.js --major   # major 自增    (1.0.25 → 2.0.0)
//
// 更新范围:
//   1. src-tauri/tauri.conf.json   (Tauri 容器版本)
//   2. package.json                (前端依赖版本)
//   3. src-tauri/Cargo.toml        (Rust crate 版本)
//   4. src/desktop/features/library/DesktopLibrary.tsx (前端硬编码版本)
//
// 注意:
//   DesktopLibrary.tsx 中使用 useState('x.y.z') 硬编码版本号仅为兜底。
//   推荐在运行时通过 Tauri 的 app.getVersion() 获取真实版本号，
//   例如: const appVersion = await getVersion(); (需从 @tauri-apps/api/app 导入)
//   本脚本仍会同步更新硬编码值以保证一致性。
// ============================================================

// 解析命令行参数
const args = process.argv.slice(2);
const bumpType = args.includes('--major') ? 'major'
  : args.includes('--minor') ? 'minor'
  : 'patch';

// 版本号自增逻辑
const bumpVersion = (currentVersion, type) => {
  const parts = currentVersion.split('.').map(Number);
  if (parts.length === 3 && !parts.some(isNaN)) {
    if (type === 'major') {
      parts[0] += 1;
      parts[1] = 0;
      parts[2] = 0;
    } else if (type === 'minor') {
      parts[1] += 1;
      parts[2] = 0;
    } else {
      parts[2] += 1;
    }
  } else {
    // 非标准三段版本号，回退到最后一段自增
    parts[parts.length - 1] += 1;
  }
  return parts.join('.');
};

// 1. 读取并自增 tauri.conf.json
const tauriConfigPath = path.resolve('src-tauri/tauri.conf.json');
const tauriConfig = JSON.parse(fs.readFileSync(tauriConfigPath, 'utf8'));
const currentVersion = tauriConfig.version;
const nextVersion = bumpVersion(currentVersion, bumpType);
tauriConfig.version = nextVersion;
fs.writeFileSync(tauriConfigPath, JSON.stringify(tauriConfig, null, 2) + '\n', 'utf8');
console.log(`[Bump] tauri.conf.json version bumped (${bumpType}): ${currentVersion} -> ${nextVersion}`);

// 2. 写入 package.json
const packagePath = path.resolve('package.json');
const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
packageJson.version = nextVersion;
fs.writeFileSync(packagePath, JSON.stringify(packageJson, null, 2) + '\n', 'utf8');
console.log(`[Bump] package.json version bumped: ${nextVersion}`);

// 3. 更新 src-tauri/Cargo.toml 版本号
const cargoPath = path.resolve('src-tauri/Cargo.toml');
const cargoContent = fs.readFileSync(cargoPath, 'utf8');
const cargoVersionRegex = /^(\s*version\s*=\s*")([0-9]+\.[0-9]+\.[0-9]+)(")/m;
const cargoMatch = cargoContent.match(cargoVersionRegex);
if (cargoMatch) {
  const cargoCurrentVersion = cargoMatch[2];
  if (cargoCurrentVersion !== nextVersion) {
    const updatedCargo = cargoContent.replace(
      cargoVersionRegex,
      `$1${nextVersion}$3`,
    );
    fs.writeFileSync(cargoPath, updatedCargo, 'utf8');
    console.log(`[Bump] Cargo.toml version bumped: ${cargoCurrentVersion} -> ${nextVersion}`);
  } else {
    console.log(`[Bump] Cargo.toml version already at ${nextVersion}, skipping.`);
  }
} else {
  console.warn(`[Bump] Warn: Could not find version field in Cargo.toml.`);
}

// 4. 写入 DesktopLibrary.tsx 里的默认版本号
//    注意: 推荐使用 app.getVersion() 替代硬编码值，此处仅为兜底同步。
const libraryPath = path.resolve('src/desktop/features/library/DesktopLibrary.tsx');
let libraryContent = fs.readFileSync(libraryPath, 'utf8');
const searchStr = `useState('${currentVersion}')`;
const replaceStr = `useState('${nextVersion}')`;
if (libraryContent.includes(searchStr)) {
  libraryContent = libraryContent.replace(searchStr, replaceStr);
  fs.writeFileSync(libraryPath, libraryContent, 'utf8');
  console.log(`[Bump] DesktopLibrary.tsx default appVersion bumped to ${nextVersion}`);
} else {
  // 正则兜底替换
  const regex = /const\s+\[appVersion,\s*setAppVersion\]\s*=\s*useState\(['"][^'"]+['"]\)/;
  if (regex.test(libraryContent)) {
    libraryContent = libraryContent.replace(regex, `const [appVersion, setAppVersion] = useState('${nextVersion}')`);
    fs.writeFileSync(libraryPath, libraryContent, 'utf8');
    console.log(`[Bump] DesktopLibrary.tsx default appVersion bumped via regex to ${nextVersion}`);
  } else {
    console.warn(`[Bump] Warn: Could not find appVersion useState line in DesktopLibrary.tsx to replace.`);
    console.warn(`[Bump] Hint: Consider using app.getVersion() from @tauri-apps/api/app instead of hardcoded version.`);
  }
}
