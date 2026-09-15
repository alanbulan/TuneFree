import type { LxScriptMeta } from './protocol';

/** 单个脚本的体积上限（洛雪音源集里最大的是 333 KB 的六音）。 */
export const MAX_SCRIPT_BYTES = 512 * 1024;

export type ScriptValidation = { ok: true } | { ok: false; reason: string };

const stripBom = (value: string): string =>
  value.charCodeAt(0) === 0xfeff ? value.slice(1) : value;

const stripExtension = (fileName: string): string =>
  fileName.replace(/\.(js|txt|mjs|cjs)$/i, '').trim();

/** 取脚本开头的块注释（音源的身份信息都在这里）。 */
const readHeaderComment = (code: string): string => {
  const match = /^\s*\/\*\*?([\s\S]*?)\*\//.exec(code);
  if (match) return match[1];
  // 少数脚本用行注释；退化为只看开头 2 KB。
  return code.slice(0, 2048);
};

const readField = (header: string, key: string): string => {
  const match = new RegExp(`@${key}[\\t ]+([^\\n\\r]*)`, 'i').exec(header);
  if (!match) return '';
  return match[1].replace(/[\s*]+$/, '').trim();
};

/**
 * 解析脚本头部的身份信息。
 *
 * 洛雪音源普遍在开头的块注释里用 `@name` / `@version` / `@author` 等字段声明元数据；
 * 混淆产物的平台与音质只能靠运行时 `inited`，这里解析出来的部分用于列表展示与
 * `lx.currentScriptInfo`（少数脚本会用它与头部逐字比对，例如「無名」）。
 */
export const parseScriptMeta = (rawCode: string, fileName: string): LxScriptMeta => {
  const code = stripBom(rawCode);
  const header = readHeaderComment(code);
  return {
    name: readField(header, 'name') || stripExtension(fileName) || '未命名音源',
    description: readField(header, 'description'),
    version: readField(header, 'version'),
    author: readField(header, 'author'),
    homepage: readField(header, 'homepage'),
  };
};

/** 导入前的粗校验：只挡明显不是音源脚本的文件，具体错误交给沙箱运行时反馈。 */
export const validateScriptContent = (rawCode: string): ScriptValidation => {
  const code = stripBom(rawCode);
  if (!code.trim()) return { ok: false, reason: '文件内容为空' };
  const bytes = new TextEncoder().encode(code).length;
  if (bytes > MAX_SCRIPT_BYTES) {
    return {
      ok: false,
      reason: `脚本 ${(bytes / 1024).toFixed(0)} KB，超过 ${MAX_SCRIPT_BYTES / 1024} KB 上限`,
    };
  }
  if (/<!doctype|<html[\s>]/i.test(code.slice(0, 4096))) {
    return { ok: false, reason: '这看起来是网页文件，而不是音源脚本' };
  }
  return { ok: true };
};
