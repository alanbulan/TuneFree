/**
 * 沙箱运行时片段：`lx.utils.crypto`（md5 / aesEncrypt / randomBytes）。
 *
 * 依赖 `bufferSource.ts` 提供的 `tfBytesFromString` / `tfStringFromBytes` /
 * `tfToBytes` / `tfEncodeHex`，必须排在它之后拼接。
 *
 * 实现范围按 23 个真实音源的实际调用面确定：
 * - `md5` 与 `aesEncrypt`（网易 eapi 的 aes-128-ecb）有真实调用点；
 * - `rsaEncrypt` / `aesDecrypt` 在整个音源集里没有任何调用点，
 *   这里保留同名函数并抛出明确错误，避免脚本拿到一个错误结果继续跑。
 */
export const RUNTIME_CRYPTO_SOURCE = String.raw`
/* ---------- MD5（与 gdStudioClient.calculateMD5 同算法，保持一致） ---------- */

const tfMd5 = (value) => {
  const constants = [];
  let index = 0;
  for (; index < 64; ) constants[index] = Math.abs(Math.sin(++index)) * 4294967296 | 0;
  const shifts = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];
  let a = 0x67452301;
  let b = 0xefcdab89;
  let c = 0x98badcfe;
  let d = 0x10325476;
  const utf8 = tfTextEncoder.encode(String(value));
  const length = utf8.length;
  const blocks = Array.from({ length: ((length + 8 >> 6) + 1) * 16 }, () => 0);
  let blockIndex = 0;
  for (; blockIndex < length; blockIndex++) {
    blocks[blockIndex >> 2] |= utf8[blockIndex] << ((blockIndex % 4) << 3);
  }
  blocks[blockIndex >> 2] |= 0x80 << ((blockIndex % 4) << 3);
  blocks[blocks.length > 2 ? blocks.length - 2 : 0] = length * 8;
  for (blockIndex = 0; blockIndex < blocks.length; blockIndex += 16) {
    const [oldA, oldB, oldC, oldD] = [a, b, c, d];
    for (index = 0; index < 64; index++) {
      let f = 0;
      let g = 0;
      if (index < 16) [f, g] = [(b & c) | (~b & d), index];
      else if (index < 32) [f, g] = [(d & b) | (~d & c), (5 * index + 1) % 16];
      else if (index < 48) [f, g] = [b ^ c ^ d, (3 * index + 5) % 16];
      else [f, g] = [c ^ (b | ~d), (7 * index) % 16];
      const previousD = d;
      d = c;
      c = b;
      const sum = a + f + constants[index] + (blocks[blockIndex + g] || 0);
      const shift = shifts[(index >> 4 << 2) + index % 4];
      b = (b + ((sum << shift) | (sum >>> (32 - shift)))) | 0;
      a = previousD;
    }
    a = (a + oldA) | 0;
    b = (b + oldB) | 0;
    c = (c + oldC) | 0;
    d = (d + oldD) | 0;
  }
  const wordToHex = (word) => {
    let hex = '';
    for (let offset = 0; offset < 4; offset++) {
      hex += ((word >> (offset << 3)) & 0xff).toString(16).padStart(2, '0');
    }
    return hex;
  };
  return wordToHex(a) + wordToHex(b) + wordToHex(c) + wordToHex(d);
};

/* ---------- AES（仅加密：ECB / CBC + PKCS#7，crypto-js 语义） ---------- */

/* FIPS-197 5.1.1 的 S 盒常量；硬编码以免生成逻辑出错。 */
const tfAesSbox = new Uint8Array([
  0x63, 0x7c, 0x77, 0x7b, 0xf2, 0x6b, 0x6f, 0xc5, 0x30, 0x01, 0x67, 0x2b, 0xfe, 0xd7, 0xab, 0x76,
  0xca, 0x82, 0xc9, 0x7d, 0xfa, 0x59, 0x47, 0xf0, 0xad, 0xd4, 0xa2, 0xaf, 0x9c, 0xa4, 0x72, 0xc0,
  0xb7, 0xfd, 0x93, 0x26, 0x36, 0x3f, 0xf7, 0xcc, 0x34, 0xa5, 0xe5, 0xf1, 0x71, 0xd8, 0x31, 0x15,
  0x04, 0xc7, 0x23, 0xc3, 0x18, 0x96, 0x05, 0x9a, 0x07, 0x12, 0x80, 0xe2, 0xeb, 0x27, 0xb2, 0x75,
  0x09, 0x83, 0x2c, 0x1a, 0x1b, 0x6e, 0x5a, 0xa0, 0x52, 0x3b, 0xd6, 0xb3, 0x29, 0xe3, 0x2f, 0x84,
  0x53, 0xd1, 0x00, 0xed, 0x20, 0xfc, 0xb1, 0x5b, 0x6a, 0xcb, 0xbe, 0x39, 0x4a, 0x4c, 0x58, 0xcf,
  0xd0, 0xef, 0xaa, 0xfb, 0x43, 0x4d, 0x33, 0x85, 0x45, 0xf9, 0x02, 0x7f, 0x50, 0x3c, 0x9f, 0xa8,
  0x51, 0xa3, 0x40, 0x8f, 0x92, 0x9d, 0x38, 0xf5, 0xbc, 0xb6, 0xda, 0x21, 0x10, 0xff, 0xf3, 0xd2,
  0xcd, 0x0c, 0x13, 0xec, 0x5f, 0x97, 0x44, 0x17, 0xc4, 0xa7, 0x7e, 0x3d, 0x64, 0x5d, 0x19, 0x73,
  0x60, 0x81, 0x4f, 0xdc, 0x22, 0x2a, 0x90, 0x88, 0x46, 0xee, 0xb8, 0x14, 0xde, 0x5e, 0x0b, 0xdb,
  0xe0, 0x32, 0x3a, 0x0a, 0x49, 0x06, 0x24, 0x5c, 0xc2, 0xd3, 0xac, 0x62, 0x91, 0x95, 0xe4, 0x79,
  0xe7, 0xc8, 0x37, 0x6d, 0x8d, 0xd5, 0x4e, 0xa9, 0x6c, 0x56, 0xf4, 0xea, 0x65, 0x7a, 0xae, 0x08,
  0xba, 0x78, 0x25, 0x2e, 0x1c, 0xa6, 0xb4, 0xc6, 0xe8, 0xdd, 0x74, 0x1f, 0x4b, 0xbd, 0x8b, 0x8a,
  0x70, 0x3e, 0xb5, 0x66, 0x48, 0x03, 0xf6, 0x0e, 0x61, 0x35, 0x57, 0xb9, 0x86, 0xc1, 0x1d, 0x9e,
  0xe1, 0xf8, 0x98, 0x11, 0x69, 0xd9, 0x8e, 0x94, 0x9b, 0x1e, 0x87, 0xe9, 0xce, 0x55, 0x28, 0xdf,
  0x8c, 0xa1, 0x89, 0x0d, 0xbf, 0xe6, 0x42, 0x68, 0x41, 0x99, 0x2d, 0x0f, 0xb0, 0x54, 0xbb, 0x16,
]);

/* 轮常量：rc[i] = x 的 i 次幂在 GF(2^8) 上（0x8d 为占位，索引从 1 起）。 */
const tfAesRcon = new Uint8Array([
  0x8d, 0x01, 0x02, 0x04, 0x08, 0x10, 0x20, 0x40, 0x80, 0x1b, 0x36,
]);

const tfAesMultiply = (a, b) => {
  let result = 0;
  let left = a & 0xff;
  let right = b & 0xff;
  while (right) {
    if (right & 1) result ^= left;
    left = (left << 1) ^ (left & 0x80 ? 0x11b : 0);
    right >>= 1;
  }
  return result & 0xff;
};

const tfAesExpandKey = (key) => {
  const keyLength = key.length;
  const rounds = keyLength / 4 + 6;
  const schedule = new Uint8Array((rounds + 1) * 16);
  schedule.set(key.subarray(0, keyLength));
  let generated = keyLength;
  let rconIndex = 1;
  const temp = new Uint8Array(4);
  while (generated < schedule.length) {
    temp[0] = schedule[generated - 4];
    temp[1] = schedule[generated - 3];
    temp[2] = schedule[generated - 2];
    temp[3] = schedule[generated - 1];
    if (generated % keyLength === 0) {
      const head = temp[0];
      temp[0] = tfAesSbox[temp[1]] ^ tfAesRcon[rconIndex];
      temp[1] = tfAesSbox[temp[2]];
      temp[2] = tfAesSbox[temp[3]];
      temp[3] = tfAesSbox[head];
      rconIndex += 1;
    } else if (keyLength > 24 && generated % keyLength === 16) {
      temp[0] = tfAesSbox[temp[0]];
      temp[1] = tfAesSbox[temp[1]];
      temp[2] = tfAesSbox[temp[2]];
      temp[3] = tfAesSbox[temp[3]];
    }
    for (let i = 0; i < 4; i += 1) {
      schedule[generated] = schedule[generated - keyLength] ^ temp[i];
      generated += 1;
    }
  }
  return { schedule, rounds };
};

const tfAesEncryptBlock = (state, schedule, rounds) => {
  const addRoundKey = (round) => {
    for (let i = 0; i < 16; i += 1) state[i] ^= schedule[round * 16 + i];
  };
  const shiftRows = () => {
    const copy = state.slice();
    state[1] = copy[5]; state[5] = copy[9]; state[9] = copy[13]; state[13] = copy[1];
    state[2] = copy[10]; state[6] = copy[14]; state[10] = copy[2]; state[14] = copy[6];
    state[3] = copy[15]; state[7] = copy[3]; state[11] = copy[7]; state[15] = copy[11];
  };
  const mixColumns = () => {
    for (let column = 0; column < 4; column += 1) {
      const offset = column * 4;
      const s0 = state[offset];
      const s1 = state[offset + 1];
      const s2 = state[offset + 2];
      const s3 = state[offset + 3];
      state[offset] = tfAesMultiply(s0, 2) ^ tfAesMultiply(s1, 3) ^ s2 ^ s3;
      state[offset + 1] = s0 ^ tfAesMultiply(s1, 2) ^ tfAesMultiply(s2, 3) ^ s3;
      state[offset + 2] = s0 ^ s1 ^ tfAesMultiply(s2, 2) ^ tfAesMultiply(s3, 3);
      state[offset + 3] = tfAesMultiply(s0, 3) ^ s1 ^ s2 ^ tfAesMultiply(s3, 2);
    }
  };

  addRoundKey(0);
  for (let round = 1; round <= rounds; round += 1) {
    for (let i = 0; i < 16; i += 1) state[i] = tfAesSbox[state[i]];
    shiftRows();
    if (round !== rounds) mixColumns();
    addRoundKey(round);
  }
  return state;
};

const tfAesToBytes = (input, encoding) =>
  typeof input === 'string' ? tfBytesFromString(input, encoding) : tfToBytes(input);

const tfAesEncrypt = (data, mode, key, iv) => {
  const normalizedMode = String(mode || 'cbc').toLowerCase();
  const cipherMode = normalizedMode.indexOf('ecb') >= 0 ? 'ecb' : 'cbc';
  const keyBytes = tfAesToBytes(key, 'utf8');
  // 洛雪实现强制 aes-128 前缀（Node crypto 的字符串密钥走 utf8），
  // 因此模式里写明位数时必须严格匹配，脚本传错密钥要立刻报错而不是静默降级。
  const declaredSize = /aes-(128|192|256)/.exec(normalizedMode);
  if (declaredSize) {
    const expectedLength = Number(declaredSize[1]) / 8;
    if (keyBytes.length !== expectedLength) {
      throw new Error('aesEncrypt 密钥长度与模式不符：' + normalizedMode + ' 需要 ' + expectedLength + ' 字节');
    }
  } else if (![16, 24, 32].includes(keyBytes.length)) {
    throw new Error('aesEncrypt 只支持 16/24/32 字节密钥，收到 ' + keyBytes.length);
  }

  let ivBytes = tfAesToBytes(iv, 'utf8');
  if (cipherMode === 'cbc' && ivBytes.length !== 16) {
    // crypto-js 允许空 IV 并用零填充，这里保持一致以避免脚本报错。
    const padded = new Uint8Array(16);
    padded.set(ivBytes.subarray(0, 16));
    ivBytes = padded;
  }

  const { schedule, rounds } = tfAesExpandKey(keyBytes);
  const plain = tfAesToBytes(data, 'utf8');
  const padding = 16 - (plain.length % 16);
  const padded = new Uint8Array(plain.length + padding);
  padded.set(plain);
  padded.fill(padding, plain.length);

  const output = new Uint8Array(padded.length);
  let previous = ivBytes;
  for (let offset = 0; offset < padded.length; offset += 16) {
    const block = padded.slice(offset, offset + 16);
    if (cipherMode === 'cbc') {
      for (let i = 0; i < 16; i += 1) block[i] ^= previous[i];
    }
    tfAesEncryptBlock(block, schedule, rounds);
    output.set(block, offset);
    previous = block;
  }
  return new TFBuffer(output);
};

/* ---------- lx.utils.crypto ---------- */

const tfCryptoUtils = {
  md5: (value) => tfMd5(value),
  aesEncrypt: (data, mode, key, iv) => tfAesEncrypt(data, mode, key, iv),
  aesDecrypt: () => {
    throw new Error('当前运行时未实现 aesDecrypt');
  },
  rsaEncrypt: () => {
    throw new Error('当前运行时未实现 rsaEncrypt');
  },
  randomBytes: (size) => {
    const bytes = new Uint8Array(Number(size) || 0);
    crypto.getRandomValues(bytes);
    return new TFBuffer(bytes);
  },
};
`;
