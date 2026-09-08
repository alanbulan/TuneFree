import { describe, expect, it } from 'vitest';
import { lightenForDark } from '../theme';
import { readLyricDisplayMode } from '../lyricDisplayMode';
import { getImgReferrerPolicy } from '../../services/utils';
import { normalizeBitrate } from '../../services/gdStudioModel';

describe('显示数据归一化', () => {
  it('绿色主题在深色背景提亮后保持绿色色相', () => {
    expect(lightenForDark('#008800')).toBe('#00b300');
  });
  it('读取歌词偏好失败时仍可展示逐行歌词', () => {
    expect(readLyricDisplayMode({ getItem: () => { throw new DOMException('被拒绝', 'SecurityError'); } })).toBe('line');
  });
  it('网易图片隐藏来源，不支持的音质采用默认码率', () => {
    expect(getImgReferrerPolicy('https://p1.music.126.net/cover.jpg')).toBe('no-referrer');
    expect(getImgReferrerPolicy('https://netease.com/cover.jpg')).toBe('no-referrer');
    expect(normalizeBitrate('legacy')).toBe('320');
  });
});
