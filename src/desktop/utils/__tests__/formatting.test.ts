import { describe, expect, it } from 'vitest';
import { getLyricExtensionLines } from '../formatting';

describe('扩展歌词展示', () => {
  it('保留有内容的扩展轨，隐藏空白和服务端占位文本', () => {
    expect(getLyricExtensionLines({ time: 1, text: '歌词', romanization: 'ge ci', pronunciation: '  ',
      translation: '//', extra: [{ type: 'translation', text: 'translation' }, { type: 'main', text: '//'}] })).toEqual(['ge ci', 'translation']);
  });
});
