import type { LxSourceDeclaration, LxUpdateAlert } from './protocol';

export interface SourceCallDiagnostic {
  source: string;
  action: string;
  quality: string;
  ok: boolean;
  message: string;
  durationMs: number;
  checkedAt: number;
}

/** 播放地址必须是完整 HTTP(S) URL，错误文案与任意对象都不能当作解析成功。 */
export const readSourceUrl = (result: unknown): string | null => {
  const candidate = typeof result === 'string'
    ? result : result && typeof result === 'object' ? (result as { url?: unknown }).url : null;
  if (typeof candidate !== 'string' || !candidate.trim()) return null;
  try {
    const url = new URL(candidate.trim());
    return ['http:', 'https:'].includes(url.protocol) && url.hostname ? url.href : null;
  } catch {
    return null;
  }
};

/** 只接受结构正确的声明，畸形字段不能回落成默认能力。 */
export const normalizeSources = (raw: unknown): Record<string, LxSourceDeclaration> => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const result: Record<string, LxSourceDeclaration> = {};
  for (const [platform, value] of Object.entries(raw)) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    const declaration = value as Record<string, unknown>;
    if (['actions', 'qualitys'].some((field) => declaration[field] !== undefined
      && (!Array.isArray(declaration[field]) || declaration[field].some((item: unknown) => typeof item !== 'string')))) continue;
    const strings = (input: unknown): string[] | undefined => Array.isArray(input)
      ? [...new Set(input.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean))]
      : undefined;
    result[platform] = {
      name: typeof declaration.name === 'string' ? declaration.name : undefined,
      type: typeof declaration.type === 'string' ? declaration.type : undefined,
      actions: strings(declaration.actions),
      qualitys: strings(declaration.qualitys),
    };
  }
  return result;
};

export const normalizeUpdateAlert = (raw: unknown): LxUpdateAlert | null => {
  if (!raw || typeof raw !== 'object') return null;
  const candidate = raw as Record<string, unknown>;
  if (typeof candidate.log !== 'string' || !candidate.log) return null;
  return { log: candidate.log, updateUrl: typeof candidate.updateUrl === 'string' ? candidate.updateUrl : undefined };
};
