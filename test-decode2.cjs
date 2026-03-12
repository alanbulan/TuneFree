// 测试解码环境 - 正确顺序
const fs = require('fs');
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
// IIFE 是从文件开头到 function _0x234f 之前
// 但 IIFE 内部的代理函数调用 _0x234f，所以执行顺序必须是:
// 1. _0x1fb3 (字符串数组)
// 2. _0x234f (解码函数)
// 3. IIFE (旋转器，里面调用 _0x234f)

// 实际上原始代码中的顺序是: IIFE(_0x1fb3) -> _0x234f -> 后续代码
// IIFE 接收 _0x1fb3 作为参数，内部定义了多个代理函数，然后调用 _0x234f
// 但是 _0x234f 在 IIFE 之后定义...
// 这在 JS 中通过函数提升 (hoisting) 工作: function declarations 被提升到作用域顶部

// 所以直接 eval 整个前面的部分就行了
const setupCode = s.substring(0, df.end);
console.log('setup code length:', setupCode.length);
console.log('setup code last 100:', setupCode.substring(setupCode.length - 100));

console.log('\n执行 setup...');
try {
    eval(setupCode);
    console.log('✅ 成功！');
    console.log('_0x234f type:', typeof _0x234f);
    console.log('_0x1fb3 type:', typeof _0x1fb3);

    const arr = _0x1fb3();
    console.log('字符串数组长度:', arr.length);

    // 测试解码
    const base = -0x1974 + 0x12 * -0x1e + 0x1c97; // 计算基础偏移
    console.log('基础偏移:', base, '(0x' + base.toString(16) + ')');

    for (let i = base; i < base + 20; i++) {
        try {
            const r = _0x234f(i, 'test');
            console.log(`  _0x234f(0x${i.toString(16)}) = "${r}"`);
        } catch (e) { }
    }

    // 测试代理函数调用
    // function _0x156754(_0x3bd401, _0x5e7111, _0x5e3e5e, _0x590a58, _0xd3d5d9) 
    //   { return _0x234f(_0xd3d5d9 - -0x4c, _0x5e7111); }
    // 所以: offset = arg4 + 0x4c, key = arg1
    // 测试: _0x156754(x, key, x, x, 0x100) = _0x234f(0x100 + 0x4c, key) = _0x234f(0x14c, key)

    console.log('\n代理函数测试:');
    for (let argVal = 0x100; argVal < 0x120; argVal++) {
        try {
            const r = _0x234f(argVal + 0x4c, 'x');
            console.log(`  proxy(_, 'x', _, _, 0x${argVal.toString(16)}) => _0x234f(0x${(argVal + 0x4c).toString(16)}) = "${r}"`);
        } catch (e) { }
    }
} catch (e) {
    console.log('❌ 失败:', e.message);
    console.log(e.stack?.substring(0, 500));
}
