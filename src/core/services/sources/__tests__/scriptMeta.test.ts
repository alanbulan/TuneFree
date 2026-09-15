import { describe, expect, it } from 'vitest';
import { MAX_SCRIPT_BYTES, parseScriptMeta, validateScriptContent } from '../scriptMeta';

describe('scriptMeta', () => {
  it('解析块注释里的身份字段', () => {
    const code = `/*!
 * @name 星海音乐源
 * @description GDAPI | 聚合
 * @version v3.2.11
 * @author 万去了了
 * @homepage https://example.test/
 * @lastUpdate 2026-08-06
 */
const x = 1;
`;
    expect(parseScriptMeta(code, 'any.js')).toEqual({
      name: '星海音乐源',
      description: 'GDAPI | 聚合',
      version: 'v3.2.11',
      author: '万去了了',
      homepage: 'https://example.test/',
    });
  });

  it('缺少 @name 时退回文件名，行注释也能识别', () => {
    const code = `// @name 行注释音源
// @version 1.0.0
globalThis.lx;
`;
    expect(parseScriptMeta(code, 'fallback.js').name).toBe('行注释音源');
    expect(parseScriptMeta('globalThis.lx;', '我的音源.js').name).toBe('我的音源');
    expect(parseScriptMeta('globalThis.lx;', '').name).toBe('未命名音源');
    expect(parseScriptMeta('globalThis.lx;', 'no-ext').name).toBe('no-ext');
  });

  it('跳过 BOM 后再解析', () => {
    const code = `﻿/*\n * @name 带 BOM 的音源\n */\nglobalThis.lx;`;
    expect(parseScriptMeta(code, 'x.js').name).toBe('带 BOM 的音源');
  });

  it('导入校验拦住空文件、超大文件与网页文件', () => {
    expect(validateScriptContent('')).toEqual({ ok: false, reason: '文件内容为空' });
    expect(validateScriptContent('   \n')).toEqual({ ok: false, reason: '文件内容为空' });
    const huge = 'x'.repeat(MAX_SCRIPT_BYTES + 1);
    const hugeResult = validateScriptContent(huge);
    expect(hugeResult.ok).toBe(false);
    expect(hugeResult.ok === false && hugeResult.reason).toContain('超过');
    expect(validateScriptContent('<!DOCTYPE html><html>')).toEqual({
      ok: false,
      reason: '这看起来是网页文件，而不是音源脚本',
    });
    expect(validateScriptContent('<HTML lang="zh">')).toEqual({
      ok: false,
      reason: '这看起来是网页文件，而不是音源脚本',
    });
    expect(validateScriptContent('<div>不是网页声明</div>')).toEqual({ ok: true });
    expect(validateScriptContent('globalThis.lx && lx.send(lx.EVENT_NAMES.inited, {})')).toEqual({
      ok: true,
    });
  });
});
