import fs from 'fs';
import path from 'path';

// 1. 读取并自增 tauri.conf.json
const tauriConfigPath = path.resolve('src-tauri/tauri.conf.json');
const tauriConfig = JSON.parse(fs.readFileSync(tauriConfigPath, 'utf8'));
const currentVersion = tauriConfig.version;

const parts = currentVersion.split('.').map(Number);
if (parts.length === 3 && !parts.some(isNaN)) {
  parts[2] += 1;
} else {
  parts[parts.length - 1] += 1;
}
const nextVersion = parts.join('.');
tauriConfig.version = nextVersion;
fs.writeFileSync(tauriConfigPath, JSON.stringify(tauriConfig, null, 2) + '\n', 'utf8');
console.log(`[Bump] tauri.conf.json version bumped: ${currentVersion} -> ${nextVersion}`);

// 2. 写入 package.json
const packagePath = path.resolve('package.json');
const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
packageJson.version = nextVersion;
fs.writeFileSync(packagePath, JSON.stringify(packageJson, null, 2) + '\n', 'utf8');
console.log(`[Bump] package.json version bumped: ${nextVersion}`);

// 3. 写入 DesktopLibrary.tsx 里的默认版本号
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
  }
}
