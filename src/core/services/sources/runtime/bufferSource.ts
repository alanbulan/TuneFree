/**
 * 沙箱运行时片段：字节工具、`Buffer` 与 `lx.utils.buffer`。
 *
 * 片段是**源码文本**，会被拼进 Worker 入口脚本（见 `runtimeSource.ts`），因此：
 * - 只用单引号与字符串相加，不出现反引号或 `${`，避免与外层模板字符串冲突；
 * - 正则里的反斜杠要写成 `\\d` 这类双反斜杠形式；
 * - 只依赖 Worker 全局（`TextEncoder` / `TextDecoder` / `atob` / `btoa`）。
 *
 * 导出的字符串本身不产生可执行代码，行覆盖由调用方（workerHost）的测试承担。
 */
export const RUNTIME_BUFFER_SOURCE = String.raw`
/* ---------- 字节与编码工具（洛雪 lx.utils.buffer 的语义） ---------- */

const tfTextEncoder = new TextEncoder();
const tfTextDecoder = new TextDecoder('utf-8');

const tfDecodeBase64 = (text) => {
  const binary = atob(String(text).replace(/\s+/g, ''));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
};

const tfEncodeBase64 = (bytes) => {
  let binary = '';
  const chunk = 8192;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
};

const tfEncodeHex = (bytes) => {
  let out = '';
  for (let i = 0; i < bytes.length; i += 1) out += bytes[i].toString(16).padStart(2, '0');
  return out;
};

const tfDecodeHex = (text) => {
  const normalized = String(text).replace(/[^0-9a-fA-F]/g, '');
  const bytes = new Uint8Array(Math.floor(normalized.length / 2));
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = parseInt(normalized.substr(i * 2, 2), 16);
  }
  return bytes;
};

const tfNormalizeEncoding = (encoding) => {
  const name = String(encoding || 'utf-8').toLowerCase();
  if (name === 'utf8' || name === 'utf-8') return 'utf8';
  if (name === 'base64') return 'base64';
  if (name === 'hex') return 'hex';
  if (name === 'latin1' || name === 'binary' || name === 'ascii') return 'latin1';
  return 'utf8';
};

const tfBytesFromString = (text, encoding) => {
  switch (tfNormalizeEncoding(encoding)) {
    case 'base64':
      return tfDecodeBase64(text);
    case 'hex':
      return tfDecodeHex(text);
    case 'latin1': {
      const bytes = new Uint8Array(text.length);
      for (let i = 0; i < text.length; i += 1) bytes[i] = text.charCodeAt(i) & 0xff;
      return bytes;
    }
    default:
      return tfTextEncoder.encode(text);
  }
};

const tfStringFromBytes = (bytes, encoding) => {
  switch (tfNormalizeEncoding(encoding)) {
    case 'base64':
      return tfEncodeBase64(bytes);
    case 'hex':
      return tfEncodeHex(bytes);
    case 'latin1': {
      let out = '';
      for (let i = 0; i < bytes.length; i += 1) out += String.fromCharCode(bytes[i]);
      return out;
    }
    default:
      return tfTextDecoder.decode(bytes);
  }
};

const tfToBytes = (input) => {
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if (ArrayBuffer.isView(input)) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  if (Array.isArray(input)) return new Uint8Array(input);
  return Uint8Array.of();
};

const tfConcatBytes = (chunks) => {
  let total = 0;
  for (let i = 0; i < chunks.length; i += 1) total += chunks[i].length;
  const merged = new Uint8Array(total);
  let offset = 0;
  for (let i = 0; i < chunks.length; i += 1) {
    merged.set(chunks[i], offset);
    offset += chunks[i].length;
  }
  return merged;
};

/* ---------- Buffer（洛雪脚本会直接用全局 Buffer） ---------- */

class TFBuffer extends Uint8Array {
  static from(input, encoding) {
    if (typeof input === 'string') return new TFBuffer(tfBytesFromString(input, encoding));
    if (typeof input === 'number') return new TFBuffer(input);
    if (input instanceof ArrayBuffer) return new TFBuffer(new Uint8Array(input));
    if (ArrayBuffer.isView(input)) {
      return new TFBuffer(new Uint8Array(input.buffer, input.byteOffset, input.byteLength));
    }
    if (Array.isArray(input)) return new TFBuffer(Uint8Array.from(input));
    if (input && typeof input.length === 'number') return new TFBuffer(Uint8Array.from(input));
    return new TFBuffer(0);
  }

  static alloc(size, fill) {
    const buffer = new TFBuffer(size);
    if (fill !== undefined) buffer.fill(fill);
    return buffer;
  }

  static isBuffer(value) {
    return value instanceof Uint8Array;
  }

  static concat(list, totalLength) {
    const chunks = (list || []).map((item) => tfToBytes(item));
    const merged = tfConcatBytes(chunks);
    if (typeof totalLength === 'number' && totalLength < merged.length) {
      return new TFBuffer(merged.subarray(0, totalLength));
    }
    return new TFBuffer(merged);
  }

  toString(encoding) {
    return tfStringFromBytes(this, encoding || 'utf-8');
  }

  toJSON() {
    return { type: 'Buffer', data: Array.from(this) };
  }
}

globalThis.Buffer = TFBuffer;

const tfBufferUtils = {
  from: (input, encoding) => TFBuffer.from(input, encoding),
  bufToString: (buffer, encoding) => tfStringFromBytes(tfToBytes(buffer), encoding || 'utf-8'),
};
`;
