import { readFileSync } from 'node:fs';

const readText = (path: string) =>
  readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

/**
 * 在构建配置里读取锁文件中实际锁定的版本。
 * 只有版本号会进包——锁文件内容和本机环境都不会传给客户端。
 */
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

  return {
    appVersion: npmLock.version,
    tech: {
      react: npmVersion('react'),
      reactRouter: npmVersion('react-router-dom'),
      motion: npmVersion('framer-motion'),
      lucide: npmVersion('lucide-react'),
      typescript: npmVersion('typescript'),
      vite: npmVersion('vite'),
      pako: npmVersion('pako'),
      qrcDecoder: npmVersion('qrc-decoder'),
      wrangler: npmVersion('wrangler'),
    },
  };
}

export type BuildInfo = ReturnType<typeof readBuildInfo>;
