// 测试解码环境能否正常建立
const fs = require('fs');
const vm = require('vm');

const s = fs.readFileSync('sixyin-music-source-v1.2.1-encrypt.js', 'utf-8');

function ef(src, sig) {
    const st = src.indexOf(sig);
    if (st === -1) return null;
    let bc = 0, end = -1, ins = false, sc = '', es = false;
    for (let i = src.indexOf('{', st); i < src.length; i++) {
        const ch = src[i];
        if (es) { es = false; continue; }
        if (ch === '\\') { es = true; continue; }
        if (ins) { if (ch === sc) ins = false; continue; }
        if ("\"'`".includes(ch)) { ins = true; sc = ch; continue; }
        if (ch === '{') bc++;
        if (ch === '}') { bc--; if (bc === 0) { end = i + 1; break; } }
    }
    return end > 0 ? { code: src.substring(st, end), start: st, end: end } : null;
}

const af = ef(s, 'function _0x1fb3()');
const df = ef(s, 'function _0x234f(');
const iife = s.substring(0, df.start);

console.log('arr func length:', af.code.length);
console.log('decoder func length:', df.code.length);
console.log('iife length:', iife.length);
console.log('IIFE first 200:', iife.substring(0, 200));
console.log('---');

// 先在当前上下文中测试（非 vm）
console.log('尝试 eval 字符串数组...');
eval(af.code);
console.log('_0x1fb3 exists:', typeof _0x1fb3);
console.log('array length:', _0x1fb3().length);

console.log('尝试 eval IIFE...');
try {
    eval(iife);
    console.log('IIFE eval 成功');
} catch (e) {
    console.log('IIFE eval 失败:', e.message);
}

console.log('尝试 eval decoder...');
eval(df.code);
console.log('_0x234f exists:', typeof _0x234f);

// 测试解码
try {
    // 用字符串表中的已知值测试
    const arr = _0x1fb3();
    console.log('first 5 strings:', arr.slice(0, 5));

    // _0x234f 的第一个参数是数组索引经过偏移，第二个参数可能未使用（或作为密钥）
    // 偏移是 0x102542 - (-0x1974 + 0x12 * -0x1e + 0x1c97) = 0x102542 - 0x159
    // 即 _0x234f(x, y) => arr[x - 0x159]
    // 但实际上旋转器已经打乱了顺序

    const offset = -0x1974 + 0x12 * -0x1e + 0x1c97;
    console.log('base offset:', offset, '= 0x' + offset.toString(16));

    for (let i = offset; i < offset + 10; i++) {
        try {
            const r = _0x234f(i, 'x');
            console.log(`_0x234f(${i}, 'x') = "${r}"`);
        } catch (e) {
            console.log(`_0x234f(${i}, 'x') error:`, e.message);
        }
    }
} catch (e) {
    console.log('decode test error:', e.message);
}
