/**
 * V3 - 高效反混淆: 用 vm 沙箱直接执行提取字符串，线性扫描替换
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, 'sixyin-music-source-v1.2.1-encrypt.js'), 'utf-8');
console.log(`📄 文件: ${(source.length / 1024).toFixed(1)} KB`);

// ============ 建立解码环境 ============
function extractFunc(src, funcSig) {
    const start = src.indexOf(funcSig);
    if (start === -1) return null;
    let bc = 0, end = -1, ins = false, sc = '', es = false;
    for (let i = src.indexOf('{', start); i < src.length; i++) {
        const ch = src[i]; if (es) { es = false; continue; } if (ch === '\\') { es = true; continue; }
        if (ins) { if (ch === sc) ins = false; continue; } if ("\"'`".includes(ch)) { ins = true; sc = ch; continue; }
        if (ch === '{') bc++; if (ch === '}') { bc--; if (bc === 0) { end = i + 1; break; } }
    }
    return end > 0 ? { code: src.substring(start, end), start, end } : null;
}

const arrFunc = extractFunc(source, "function _0x1fb3()");
const decFunc = extractFunc(source, "function _0x234f(");
const iifeCode = source.substring(0, decFunc.start);

// 在 vm 沙箱中执行
const sandbox = { BigInt, parseInt, console };
vm.createContext(sandbox);
vm.runInContext(arrFunc.code, sandbox);
vm.runInContext(iifeCode, sandbox);
vm.runInContext(decFunc.code, sandbox);

const _0x234f_fn = sandbox._0x234f;
const stringArr = sandbox._0x1fb3();
console.log(`✅ 解码环境建立, ${stringArr.length} 个字符串`);

// ============ 提取代理函数 ============
const proxyRe = /function\s+(_0x[a-f0-9]+)\(([^)]+)\)\s*\{\s*return\s+_0x234f\(([^,]+),\s*([^)]+)\);\s*\}/g;
const proxyMap = {};
let m;
while ((m = proxyRe.exec(source)) !== null) {
    const name = m[1];
    const params = m[2].split(',').map(p => p.trim());
    const oExpr = m[3].trim();
    const kParam = m[4].trim();

    let opi = -1, oc = 0, kpi = -1;
    for (let i = 0; i < params.length; i++) {
        if (oExpr.includes(params[i])) {
            opi = i;
            // 解析 "param - 0xNN" 或 "param - -0xNN" 形式
            const cm = oExpr.match(/[-+]\s*(-?0x[0-9a-fA-F]+)/);
            if (cm) {
                const val = cm[1].startsWith('-') ? -parseInt(cm[1].slice(1), 16) : parseInt(cm[1], 16);
                oc = oExpr.includes('- -') || oExpr.includes('- (' + cm[1]) ? val : (oExpr.includes('+ ') ? val : -val);
                // 更简单的解析:
                // "param - 0xNN" => offset = paramVal - 0xNN, so const = -0xNN
                // "param - -0xNN" => offset = paramVal + 0xNN, so const = +0xNN
                if (oExpr.match(/\s*-\s*-\s*0x/)) oc = parseInt(cm[1].replace('-', ''), 16);
                else if (oExpr.match(/\s*-\s*0x/)) oc = -parseInt(cm[1], 16);
                else if (oExpr.match(/\s*\+\s*0x/)) oc = parseInt(cm[1], 16);
            }
            break;
        }
    }
    for (let i = 0; i < params.length; i++) {
        if (kParam === params[i]) { kpi = i; break; }
    }
    if (opi >= 0 && kpi >= 0) proxyMap[name] = { paramCount: params.length, opi, oc, kpi };
}
console.log(`✅ ${Object.keys(proxyMap).length} 个代理函数`);

// ============ 线性扫描替换 ============
console.log('🔄 开始线性扫描替换...');
const chunks = [];
let i = 0;
let successCount = 0, skipCount = 0;

while (i < source.length) {
    // 查找 _0x 前缀
    const idx = source.indexOf('_0x', i);
    if (idx === -1) { chunks.push(source.substring(i)); break; }

    // 提取标识符
    let j = idx + 3;
    while (j < source.length && /[a-f0-9]/i.test(source[j])) j++;
    const ident = source.substring(idx, j);

    // 检查是否是已知代理函数 + 后跟 (
    if (proxyMap[ident] && source[j] === '(') {
        const info = proxyMap[ident];
        // 找到匹配的 )
        let depth = 1, pos = j + 1;
        let inS = false, sCh = '', esc2 = false;
        while (pos < source.length && depth > 0) {
            const ch = source[pos];
            if (esc2) { esc2 = false; pos++; continue; }
            if (ch === '\\' && inS) { esc2 = true; pos++; continue; }
            if (inS) { if (ch === sCh) inS = false; pos++; continue; }
            if (ch === '"' || ch === "'") { inS = true; sCh = ch; pos++; continue; }
            if (ch === '(') depth++;
            if (ch === ')') { depth--; if (depth === 0) break; }
            pos++;
        }
        if (depth !== 0) { chunks.push(source.substring(i, j)); i = j; continue; }

        const argsStr = source.substring(j + 1, pos);
        const callEnd = pos + 1;

        // 分割参数
        const args = [];
        let ad = 0, cur = '';
        for (let k = 0; k < argsStr.length; k++) {
            const ch = argsStr[k];
            if (ch === '(' || ch === '[') ad++;
            if (ch === ')' || ch === ']') ad--;
            if (ch === ',' && ad === 0) { args.push(cur.trim()); cur = ''; }
            else cur += ch;
        }
        args.push(cur.trim());

        if (args.length === info.paramCount) {
            try {
                const oArg = args[info.opi];
                let oVal;
                if (/^-?0x[0-9a-fA-F]+$/.test(oArg)) {
                    oVal = oArg.startsWith('-') ? -parseInt(oArg.slice(1), 16) : parseInt(oArg, 16);
                } else {
                    // 跳过复杂表达式
                    chunks.push(source.substring(i, callEnd));
                    i = callEnd;
                    skipCount++;
                    continue;
                }
                const actualOffset = oVal + info.oc;
                const kArg = args[info.kpi];

                // 尝试解码 key 参数
                let keyVal;
                if (/^0x[0-9a-fA-F]+$/.test(kArg)) keyVal = parseInt(kArg, 16);
                else if (/^'[^']*'$/.test(kArg) || /^"[^"]*"$/.test(kArg)) keyVal = kArg.slice(1, -1);
                else { chunks.push(source.substring(i, callEnd)); i = callEnd; skipCount++; continue; }

                const decoded = _0x234f_fn(actualOffset, keyVal);
                if (typeof decoded === 'string') {
                    chunks.push(source.substring(i, idx));
                    chunks.push(JSON.stringify(decoded));
                    i = callEnd;
                    successCount++;
                    continue;
                }
            } catch (e) {
                skipCount++;
            }
        }
        chunks.push(source.substring(i, callEnd));
        i = callEnd;
    } else {
        chunks.push(source.substring(i, j));
        i = j;
    }
}

console.log(`✅ 替换完成: ${successCount} 成功, ${skipCount} 跳过`);

let result = chunks.join('');
result = result.replace(/!!\[\]/g, 'true');
result = result.replace(/!\[\]/g, 'false');

// 保存
const outFile = path.join(__dirname, 'sixyin-music-source-v1.2.1-decoded.js');
fs.writeFileSync(outFile, result, 'utf-8');
console.log(`💾 ${(result.length / 1024).toFixed(1)} KB -> ${outFile}`);

// ============ 分析 ============ 
console.log('\n========================================');
console.log('📊 还原结果分析');
console.log('========================================');

// 提取所有还原出的字符串
const decoded = new Set();
result.replace(/"((?:[^"\\]|\\.)*)"/g, (_, s) => {
    if (s.length > 1 && !s.startsWith('_0x')) decoded.add(s);
});

const cats = { 'URL/API': [], '加密': [], '音质': [], '中文': [], 'HTTP': [], '平台': [], '关键方法': [] };
for (const s of decoded) {
    if (/[\u4e00-\u9fa5]/.test(s)) cats['中文'].push(s);
    if (/https?:|\/\/|\.com|\.cn|\/api/i.test(s)) cats['URL/API'].push(s);
    if (/aes|rsa|md5|encrypt|decrypt|crypt|base64|sign/i.test(s)) cats['加密'].push(s);
    if (/\dk|flac|mp3|bitrat/i.test(s)) cats['音质'].push(s);
    if (/^(GET|POST|User-Agent|Cookie|Content)/i.test(s)) cats['HTTP'].push(s);
    if (/netease|kugou|kuwo|migu|sixyin|qqmusic/i.test(s)) cats['平台'].push(s);
    if (/search|play|song|album|lyric|download|version|source|update|check/i.test(s)) cats['关键方法'].push(s);
}

for (const [c, items] of Object.entries(cats)) {
    const u = [...new Set(items)];
    if (u.length === 0) continue;
    console.log(`\n--- ${c} (${u.length}) ---`);
    u.slice(0, 50).forEach(s => console.log(`  "${s}"`));
}

console.log(`\n总计还原 ${decoded.size} 个字符串, ${successCount} 处替换`);
console.log('✅ 完成！');
