import { createContext, runInContext } from 'node:vm';
import { createHash, createCipheriv } from 'node:crypto';
import { describe, it, expect } from 'vitest';
import { RUNTIME_BUFFER_SOURCE } from '../bufferSource';
import { RUNTIME_CRYPTO_SOURCE } from '../cryptoSource';

/**
 * 运行时片段是拼进 Worker 的源码文本，这里用 `node:vm` 在隔离上下文里执行，
 * 并用 `node:crypto` 作为基准校验 MD5 与 AES 实现（洛雪音源的 eapi 加密依赖它）。
 */
const createSandbox = (): Record<string, any> => {
  const context = createContext({
    TextEncoder,
    TextDecoder,
    atob,
    btoa,
    crypto: globalThis.crypto,
    console,
  });
  runInContext(RUNTIME_BUFFER_SOURCE, context);
  runInContext(RUNTIME_CRYPTO_SOURCE, context);
  // 片段里的顶层 const 是词法绑定，不会成为上下文属性；用求值方式取出来。
  return new Proxy(context as unknown as Record<string, any>, {
    get: (target, property: string) =>
      typeof property === 'string' && !(property in target)
        ? (runInContext(property, context) as unknown)
        : target[property],
  });
};

const nodeMd5 = (value: string): string =>
  createHash('md5').update(value, 'utf8').digest('hex');

const nodeAes = (
  data: Uint8Array,
  mode: 'aes-128-ecb' | 'aes-128-cbc' | 'aes-256-cbc',
  key: Uint8Array,
  iv?: Uint8Array,
): Uint8Array => {
  const cipher = createCipheriv(mode, key, iv ?? null);
  return new Uint8Array(Buffer.concat([cipher.update(data), cipher.final()]));
};

const toHex = (bytes: Uint8Array): string =>
  Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');

const fromUtf8 = (value: string): Uint8Array => new TextEncoder().encode(value);

describe('沙箱运行时片段：Buffer 与 utils.buffer', () => {
  it('Buffer.from 支持 utf-8 / base64 / hex 与随机字节', () => {
    const sandbox = createSandbox();
    const Buffer = sandbox.Buffer;
    expect(typeof Buffer).toBe('function');
    expect(Buffer.isBuffer(Buffer.from('abc'))).toBe(true);
    expect(Buffer.from('abc').toString('utf-8')).toBe('abc');
    expect(Buffer.from('5L2g5aW9', 'base64').toString('utf-8')).toBe('你好');
    expect(Buffer.from('e4bda0', 'hex').toString('utf-8')).toBe('你');
    expect(Buffer.from([0xc4, 0xe3]).toString('latin1')).toBe('你好'.slice(0, 0) + 'Äã');
    expect(Buffer.alloc(3).length).toBe(3);
    expect(Buffer.alloc(2, 7)[1]).toBe(7);
    expect(Buffer.concat([Buffer.from('ab'), Buffer.from('cd')]).toString()).toBe('abcd');
    const bytes = sandbox.tfCryptoUtils.randomBytes(8);
    expect(bytes.length).toBe(8);
  });

  it('bufToString 与 from 保持对称', () => {
    const sandbox = createSandbox();
    const utils = sandbox.tfBufferUtils;
    const buffer = utils.from('测试文本', 'utf-8');
    expect(utils.bufToString(buffer, 'utf-8')).toBe('测试文本');
    expect(utils.bufToString(buffer, 'base64')).toBe(
      Buffer.from('测试文本', 'utf-8').toString('base64'),
    );
    expect(utils.bufToString(utils.from('e4bda0', 'hex'), 'utf-8')).toBe('你');
    expect(utils.bufToString(utils.from('AAECAw==', 'base64'), 'hex')).toBe('00010203');
  });
});

describe('沙箱运行时片段：utils.crypto', () => {
  it('md5 与 node:crypto 结果一致（含中文）', () => {
    const sandbox = createSandbox();
    const md5 = sandbox.tfCryptoUtils.md5;
    for (const value of ['', 'abc', 'The quick brown fox jumps over the lazy dog', '洛雪音源测试']) {
      expect(md5(value)).toBe(nodeMd5(value));
    }
  });

  it('aesEncrypt 与 node:crypto 的 AES-128-ECB/CBC 结果一致', () => {
    const sandbox = createSandbox();
    const aesEncrypt = sandbox.tfCryptoUtils.aesEncrypt;
    const key = fromUtf8('e82ckenh8dichen8');
    const iv = fromUtf8('1234567890abcdef');
    for (const [mode, cipherMode] of [
      ['ecb', 'aes-128-ecb'],
      ['cbc', 'aes-128-cbc'],
      ['aes-128-ecb', 'aes-128-ecb'],
      ['aes-128-cbc', 'aes-128-cbc'],
    ] as const) {
      for (const plain of ['', 'a', '0123456789abcdef', '测试 eapi 参数']) {
        const actual = aesEncrypt(plain, mode, key, cipherMode === 'aes-128-cbc' ? iv : undefined);
        const expected = nodeAes(fromUtf8(plain), cipherMode, key, cipherMode === 'aes-128-cbc' ? iv : undefined);
        expect(toHex(actual)).toBe(toHex(expected));
        expect(actual.toString('base64')).toBe(Buffer.from(expected).toString('base64'));
      }
    }
  });

  it('aesEncrypt 支持 256 位密钥，并在密钥非法时报错', () => {
    const sandbox = createSandbox();
    const aesEncrypt = sandbox.tfCryptoUtils.aesEncrypt;
    const key = fromUtf8('0123456789abcdef0123456789abcdef');
    const iv = fromUtf8('abcdefghijklmnop');
    const actual = aesEncrypt('hello world', 'cbc', key, iv);
    expect(toHex(actual)).toBe(
      toHex(nodeAes(fromUtf8('hello world'), 'aes-256-cbc', key, iv)),
    );
    expect(() => aesEncrypt('x', 'ecb', fromUtf8('short'))).toThrow(/16\/24\/32/);
  });

  it('cbc 空 IV 按零填充处理（crypto-js 兼容）', () => {
    const sandbox = createSandbox();
    const actual = sandbox.tfCryptoUtils.aesEncrypt('data', 'cbc', fromUtf8('e82ckenh8dichen8'), '');
    const expected = nodeAes(fromUtf8('data'), 'aes-128-cbc', fromUtf8('e82ckenh8dichen8'), new Uint8Array(16));
    expect(toHex(actual)).toBe(toHex(expected));
  });

  it('未实现的能力抛出明确错误', () => {
    const sandbox = createSandbox();
    expect(() => sandbox.tfCryptoUtils.rsaEncrypt('x', 'key')).toThrow(/rsaEncrypt/);
    expect(() => sandbox.tfCryptoUtils.aesDecrypt('x', 'ecb', 'key', 'iv')).toThrow(/aesDecrypt/);
  });
});
