import { inflate } from 'pako';

// KRC1 文件头后的 zlib 字节按协议的固定 XOR key 编码；不从 LRC 文本生成词时标。
const KRC_KEY = new Uint8Array([64, 71, 97, 119, 94, 50, 116, 71, 81, 54, 49, 45, 206, 210, 110, 105]);

/** 只解已识别的 KRC1 二进制/hex/base64；损坏的 KRC 不作为纯文本歌词展示。 */
export const decodeKrcPayload = (value: string): string => {
  const text = value.trim();
  const isHex = /^6b726331/i.test(text);
  const isBase64 = text.startsWith('a3JjM');
  const isBinary = text.startsWith('krc1');
  if (!isHex && !isBase64 && !isBinary) return value;
  try {
    let bytes: Uint8Array;
    if (isHex) {
      if (text.length % 2 || !/^[\da-f]+$/i.test(text)) return '';
      bytes = Uint8Array.from(text.match(/../g) || [], (byte) => parseInt(byte, 16));
    } else {
      const binary = isBase64 ? atob(text) : value;
      bytes = Uint8Array.from(binary, (byte) => byte.charCodeAt(0));
    }
    if (String.fromCharCode(...bytes.slice(0, 4)) !== 'krc1') return '';
    const compressed = bytes.slice(4).map((byte, index) => byte ^ KRC_KEY[index % KRC_KEY.length]);
    return new TextDecoder('utf-8', { fatal: true }).decode(inflate(compressed));
  } catch { return ''; }
};
