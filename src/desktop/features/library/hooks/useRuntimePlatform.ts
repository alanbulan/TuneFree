import { useEffect, useState } from 'react';
import { invokeCommand, isTauri } from '../../../../core/ipc';

const osNames: Record<string, string> = { macos: 'macOS', windows: 'Windows', linux: 'Linux' };
const archNames: Record<string, string> = { aarch64: 'arm64', x86_64: 'x64', x86: 'x86' };

export function useRuntimePlatform(): string {
  const [platform, setPlatform] = useState(() => isTauri() ? '正在识别系统…' : '浏览器预览');

  useEffect(() => {
    if (!isTauri()) return;
    let cancelled = false;
    void invokeCommand('get_runtime_info').then(({ os, arch }) => {
      if (!cancelled) setPlatform(`${osNames[os] ?? os} ${archNames[arch] ?? arch}`);
    }).catch(() => {
      if (!cancelled) setPlatform('系统信息不可用');
    });
    return () => { cancelled = true; };
  }, []);

  return platform;
}
