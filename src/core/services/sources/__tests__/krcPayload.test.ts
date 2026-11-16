import { deflate } from 'pako';
import { describe, expect, it } from 'vitest';
import { decodeKrcPayload } from '../krcPayload';
import { parseLyrics } from '../../../utils/lyrics';

const fixture = (text: string): Uint8Array => {
  const key = new Uint8Array([64, 71, 97, 119, 94, 50, 116, 71, 81, 54, 49, 45, 206, 210, 110, 105]);
  const compressed = deflate(new TextEncoder().encode(text));
  const bytes = new Uint8Array(compressed.length + 4);
  bytes.set(new TextEncoder().encode('krc1'));
  bytes.set(compressed.map((byte, index) => byte ^ key[index % key.length]), 4);
  return bytes;
};
describe('已识别 KRC1 payload解码', () => {
  it('独立zlib/XOR夹具的二进制、hex和base64得到相同真实相对时标', () => {
    const text = '[krc]\n[1000,1200]<0,500,0>你<500,700,0>好';
    const bytes = fixture(text);
    const binary = String.fromCharCode(...bytes);
    for (const encoded of [binary, btoa(binary), Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')]) {
      expect(decodeKrcPayload(encoded)).toBe(text);
      expect(parseLyrics(decodeKrcPayload(encoded))[0].words?.map((word) => word.start)).toEqual([1, 1.5]);
    }
  });
  it('普通歌词保持原文，损坏 KRC不显示为假歌词', () => {
    expect(decodeKrcPayload('[00:01]普通歌词')).toBe('[00:01]普通歌词');
    for (const broken of ['krc1broken', '6b726331g', '6b7263310', 'a3JjM===', 'a3JjMg==']) {
      expect(decodeKrcPayload(broken)).toBe('');
    }
  });
});
