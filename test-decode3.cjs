// 找到三个核心函数的精确位置
const fs = require('fs');
const s = fs.readFileSync('sixyin-music-source-v1.2.1-encrypt.js', 'utf-8');

// 在原始文件中，函数声明会被提升
// 所以即使 _0x1fb3 定义在 IIFE 之后，IIFE 中也能调用它
// 但 eval 不会提升函数声明到 eval 之前
// 解决方案：把三段代码一起 eval

// 找到 _0x1fb3 的结束位置
function findFuncEnd(src, sig) {
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
    return end > 0 ? { start: st, end } : null;
}

const iife_start = 0;
const arr = findFuncEnd(s, 'function _0x1fb3()');
const dec = findFuncEnd(s, 'function _0x234f(');

console.log('IIFE: 0 -', dec.start);
console.log('_0x234f:', dec.start, '-', dec.end);
console.log('_0x1fb3:', arr.start, '-', arr.end);

// 我们需要一起 eval: IIFE + _0x234f + _0x1fb3
// 这样函数声明都会被提升
// 找到 _0x1fb3 之后第一个分号后面的位置作为初始化边界
let setupEnd = arr.end;
// 跳过 _0x1fb3 后面可能的分号和空格
while (setupEnd < s.length && (s[setupEnd] === ' ' || s[setupEnd] === ';' || s[setupEnd] === '\n' || s[setupEnd] === '\r')) setupEnd++;

console.log('setup end:', setupEnd);
console.log('char at setup end:', JSON.stringify(s.substring(setupEnd, setupEnd + 50)));

// 整段 setup 代码
const setupCode = s.substring(0, setupEnd);
console.log('setup code length:', setupCode.length);

console.log('\n尝试执行...');
try {
    eval(setupCode);
    console.log('✅ eval 成功!');
    console.log('_0x234f:', typeof _0x234f);
    console.log('_0x1fb3:', typeof _0x1fb3);

    const strArr = _0x1fb3();
    console.log('字符串数组长度:', strArr.length);
    console.log('前10个:', strArr.slice(0, 10));

    // 测试解码
    console.log('\n=== 解码测试 ===');
    const base = -0x1974 + 0x12 * -0x1e + 0x1c97;
    console.log('基础偏移:', base, '(0x' + base.toString(16) + ')');

    for (let i = base; i < base + 30; i++) {
        try {
            const r = _0x234f(i, 0);
            console.log(`  [${i - base}] _0x234f(0x${i.toString(16)}, 0) = "${r}"`);
        } catch (e) { }
    }

    // 测试一个具体的代理函数调用
    // function _0x40b390(a,b,c,d,e) { return _0x234f(b - 0x24a, d); }
    // 例如: _0x40b390(0x6ea, 0x76e, 0x70c, 0x722, 0x936)
    // => _0x234f(0x76e - 0x24a, 0x722) = _0x234f(0x524, 0x722)
    console.log('\n=== 代理函数测试 ===');
    try {
        const r1 = _0x234f(0x76e - 0x24a, 0x722);
        console.log(`_0x40b390(0x6ea,0x76e,0x70c,0x722,0x936) => "${r1}"`);
    } catch (e) {
        console.log('error:', e.message);
    }

    // 更多测试
    try {
        const r2 = _0x234f(0x3d7 - 0x24a, 0x3da);
        console.log(`_0x40b390(_,0x3d7,_,0x3da,_) => "${r2}"`);
    } catch (e) { }

} catch (e) {
    console.log('❌ 失败:', e.message);
    console.log(e.stack?.substring(0, 500));
}
