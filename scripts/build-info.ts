import { readFileSync } from 'node:fs';

const readText = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

const quotedField = (text: string, key: string): string => {
  const value = text.match(new RegExp(`^${key} = "([^"]+)"\\r?$`, 'm'))?.[1];
  if (!value) throw new Error(`构建信息缺少字段：${key}`);
  return value;
};

/** 在构建配置中读取实际锁定版本；客户端只接收版本号，不包含锁文件或本机环境。 */
export function readBuildInfo() {
  const npmLock = JSON.parse(readText('package-lock.json')) as {
    version: string;
    packages: Record<string, { version: string }>;
  };
  const npmVersion = (name: string): string => {
    const version = npmLock.packages[`node_modules/${name}`]?.version;
    if (!version) throw new Error(`依赖锁文件中缺少 ${name}`);
    return version;
  };

  // Cargo.lock 由 Cargo 生成；应用依赖中的显式版本用于区分同名 crate 的多个版本。
  const packages = readText('src-tauri/Cargo.lock').split('[[package]]').slice(1).map((text) => ({
    name: quotedField(text, 'name'), version: quotedField(text, 'version'), text,
  }));
  const appName = quotedField(readText('src-tauri/Cargo.toml'), 'name');
  const app = packages.find(({ name }) => name === appName);
  if (!app) throw new Error(`Cargo.lock 中缺少应用包 ${appName}`);
  const dependencyList = app.text.match(/^dependencies = \[([\s\S]*?)^\]/m)?.[1] ?? '';
  const dependencies = [...dependencyList.matchAll(/^\s+"([^"]+)",?\r?$/gm)].map((match) => match[1]);
  const cargoVersion = (name: string): string => {
    const dependency = dependencies.find((item) => item === name || item.startsWith(`${name} `));
    if (!dependency) throw new Error(`应用依赖中缺少 ${name}`);
    const version = dependency.split(' ')[1];
    const matches = packages.filter((item) => item.name === name && (!version || item.version === version));
    if (matches.length !== 1) throw new Error(`无法确定 ${name} 的锁定版本`);
    return matches[0].version;
  };
  const bloub = JSON.parse(readText('vendor/bloub/source.json')) as { version: string };

  return {
    appVersion: npmLock.version,
    tech: {
      react: npmVersion('react'),
      typescript: npmVersion('typescript'),
      vite: npmVersion('vite'),
      motion: npmVersion('framer-motion'),
      lucide: npmVersion('lucide-react'),
      bloub: bloub.version,
      tauri: cargoVersion('tauri'),
      rust: quotedField(readText('rust-toolchain.toml'), 'channel'),
      axum: cargoVersion('axum'),
      tokio: cargoVersion('tokio'),
      towerHttp: cargoVersion('tower-http'),
      reqwest: cargoVersion('reqwest'),
      rusqlite: cargoVersion('rusqlite'),
      keyring: cargoVersion('keyring'),
    },
  };
}

export type BuildInfo = ReturnType<typeof readBuildInfo>;
