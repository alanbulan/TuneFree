/**
 * 反混淆脚本 - 还原 sixyin-music-source-v1.2.1-encrypt.js
 */
const fs = require('fs');
const path = require('path');

const sourceFile = path.join(__dirname, 'sixyin-music-source-v1.2.1-encrypt.js');
const source = fs.readFileSync(sourceFile, 'utf-8');

console.log(`📄 文件大小: ${(source.length / 1024).toFixed(1)} KB`);
console.log(`📄 文件行数: ${source.split('\n').length}`);

// ============ STEP 1: 提取字符串数组 ============

// 找到字符串数组的起始和结束位置
const arrayStart = source.indexOf("function _0x1fb3()");
if (arrayStart === -1) { console.error('找不到 _0x1fb3'); process.exit(1); }

// 手动找匹配的大括号
let braceCount = 0;
let arrayEnd = -1;
let inString = false;
let stringChar = '';
let escaped = false;

for (let i = source.indexOf('{', arrayStart); i < source.length; i++) {
    const ch = source[i];
    if (escaped) { escaped = false; continue; }
    if (ch === '\\') { escaped = true; continue; }
    if (inString) {
        if (ch === stringChar) inString = false;
        continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
        inString = true;
        stringChar = ch;
        continue;
    }
    if (ch === '{') braceCount++;
    if (ch === '}') {
        braceCount--;
        if (braceCount === 0) {
            arrayEnd = i + 1;
            break;
        }
    }
}

const arrayFuncCode = source.substring(arrayStart, arrayEnd);
console.log(`✅ 提取 _0x1fb3 函数: ${arrayFuncCode.length} 字符`);

// ============ STEP 2: 提取解码函数 _0x234f ============
const decoderStart = source.indexOf("function _0x234f(");
if (decoderStart === -1) { console.error('找不到 _0x234f'); process.exit(1); }

braceCount = 0;
let decoderEnd = -1;
inString = false;
escaped = false;

for (let i = source.indexOf('{', decoderStart); i < source.length; i++) {
    const ch = source[i];
    if (escaped) { escaped = false; continue; }
    if (ch === '\\') { escaped = true; continue; }
    if (inString) {
        if (ch === stringChar) inString = false;
        continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
        inString = true;
        stringChar = ch;
        continue;
    }
    if (ch === '{') braceCount++;
    if (ch === '}') {
        braceCount--;
        if (braceCount === 0) {
            decoderEnd = i + 1;
            break;
        }
    }
}

const decoderFuncCode = source.substring(decoderStart, decoderEnd);
console.log(`✅ 提取 _0x234f 函数: ${decoderFuncCode.length} 字符`);

// ============ STEP 3: 提取 IIFE 旋转器 ============
// 从文件开头到 _0x234f 之前
const iifeCode = source.substring(0, decoderStart);
console.log(`✅ 提取 IIFE 旋转器: ${iifeCode.length} 字符`);

// ============ STEP 4: 执行解码环境 ============
const setupCode = `
${arrayFuncCode}
${iifeCode}
${decoderFuncCode}
`;

try {
    eval(setupCode);
    console.log('✅ 解码环境已建立');
} catch (e) {
    console.error('❌ 建立解码环境失败:', e.message);
    // 尝试简化方案：只提取字符串数组
    try {
        eval(arrayFuncCode);
        // 找到旋转参数
        const rotateMatch = source.match(/\}[\s]*\(_0x1fb3,\s*([-]?(?:0x)?[0-9a-fA-F*+\-\s]+)\)\)/);
        console.log('旋转参数匹配:', rotateMatch ? rotateMatch[1] : '未找到');
    } catch (e2) {
        console.error('连字符串数组都无法执行:', e2.message);
    }
}

// ============ STEP 5: 构建字符串表 ============
let stringArray;
try {
    stringArray = _0x1fb3();
    console.log(`\n📋 字符串表共 ${stringArray.length} 个元素\n`);
} catch (e) {
    console.error('无法获取字符串表:', e.message);
    process.exit(1);
}

// ============ STEP 6: 尝试解码所有字符串 ============
console.log('🔄 开始批量解码...\n');

let deobfuscated = source;
let totalReplacements = 0;

// 替换直接的 _0x234f 调用
const directPattern = /_0x234f\((0x[0-9a-fA-F]+(?:\s*[-+*]\s*(?:0x)?[0-9a-fA-F]+)*),\s*([^)]+)\)/g;
deobfuscated = deobfuscated.replace(directPattern, (match, offsetExpr, keyExpr) => {
    try {
        const offset = eval(offsetExpr);
        const key = eval(keyExpr);
        const result = _0x234f(offset, key);
        if (typeof result === 'string') {
            totalReplacements++;
            return JSON.stringify(result);
        }
    } catch (e) { }
    return match;
});

console.log(`  直接调用替换: ${totalReplacements} 处`);

// ============ STEP 7: 替换 !![] 和 ![] ============
deobfuscated = deobfuscated.replace(/!!\[\]/g, 'true');
deobfuscated = deobfuscated.replace(/!\[\]/g, 'false');

// ============ STEP 8: 分析关键信息 ============
console.log('\n========================================');
console.log('📊 脚本关键信息分析');
console.log('========================================\n');

// 提取所有中文字符串
const chineseStrings = stringArray.filter(s => /[\u4e00-\u9fa5]/.test(s));
console.log('🇨🇳 中文字符串:');
chineseStrings.forEach(s => console.log(`  "${s}"`));

// 平台相关
const platformStrings = stringArray.filter(s =>
    /music|song|netea|kugou|kuwo|migu|sixyin/.test(s.toLowerCase()) ||
    /音乐|音源/.test(s)
);
console.log('\n🎵 平台/音乐相关:');
[...new Set(platformStrings)].forEach(s => console.log(`  "${s}"`));

// 加密相关
const cryptoStrings = stringArray.filter(s =>
    /aes|rsa|md5|base64|crypt|encrypt|decrypt|hash|sign|key/i.test(s)
);
console.log('\n🔐 加密相关:');
[...new Set(cryptoStrings)].forEach(s => console.log(`  "${s}"`));

// 音质相关
const qualityStrings = stringArray.filter(s =>
    /\d+k|flac|mp3|aac|m4a|ogg|wav/i.test(s)
);
console.log('\n🎶 音质/格式相关:');
[...new Set(qualityStrings)].forEach(s => console.log(`  "${s}"`));

// URL 相关
const urlStrings = stringArray.filter(s =>
    /http|\.com|\.cn|api|\/\//i.test(s)
);
console.log('\n🌐 URL/API 相关:');
[...new Set(urlStrings)].forEach(s => console.log(`  "${s}"`));

// 版本相关
const versionStrings = stringArray.filter(s =>
    /version|versi|1\.2\.\d/i.test(s)
);
console.log('\n📌 版本相关:');
[...new Set(versionStrings)].forEach(s => console.log(`  "${s}"`));

// 所有重要的功能性字符串
const funcStrings = stringArray.filter(s =>
    /GET|POST|request|response|query|header|cookie|url|body|data|json|parse|stringify|then|catch|error|success|fail/i.test(s) ||
    /search|play|song|album|lyric|download/i.test(s)
);
console.log('\n⚙️ 功能性字符串:');
[...new Set(funcStrings)].forEach(s => console.log(`  "${s}"`));

// ============ STEP 9: 保存结果 ============

// 保存字符串映射
const stringMapFile = path.join(__dirname, 'sixyin-string-map.json');
const stringMap = {};
stringArray.forEach((s, i) => { stringMap[i] = s; });
fs.writeFileSync(stringMapFile, JSON.stringify(stringMap, null, 2), 'utf-8');
console.log(`\n💾 字符串映射表已保存到: ${stringMapFile}`);

// 保存部分还原结果
const outputFile = path.join(__dirname, 'sixyin-music-source-v1.2.1-decoded.js');
fs.writeFileSync(outputFile, deobfuscated, 'utf-8');
console.log(`💾 部分还原的代码已保存到: ${outputFile}`);

// ============ STEP 10: 深度分析 webpack 模块结构 ============
console.log('\n========================================');
console.log('🏗️  模块结构分析');
console.log('========================================\n');

// 搜索 webpack 模块 ID
const moduleIds = [];
const modulePattern = /(0x[0-9a-fA-F]+):\s*\(/g;
let mMatch;
let searchArea = source.substring(0, 5000); // 查看开头
while ((mMatch = modulePattern.exec(source)) !== null) {
    if (!moduleIds.includes(mMatch[1])) {
        moduleIds.push(mMatch[1]);
    }
    if (moduleIds.length > 20) break;
}
if (moduleIds.length > 0) {
    console.log('模块 ID:');
    moduleIds.forEach(id => console.log(`  ${id} (${parseInt(id, 16)})`));
}

// 搜索 export 模式
const exportCount = (source.match(/exports/g) || []).length;
console.log(`\nexports 出现次数: ${exportCount}`);

const requireCount = (source.match(/__webpack_require__|require/g) || []).length;
console.log(`require 出现次数: ${requireCount}`);

console.log('\n✅ 分析完成！');
