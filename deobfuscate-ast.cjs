/**
 * AST-based 反混淆 V2 - 修正解码环境建立方式
 */
const fs = require('fs');
const path = require('path');
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;
const generate = require('@babel/generator').default;
const t = require('@babel/types');

const sourceFile = path.join(__dirname, 'sixyin-music-source-v1.2.1-encrypt.js');
const source = fs.readFileSync(sourceFile, 'utf-8');
console.log(`📄 源文件: ${(source.length / 1024).toFixed(1)} KB`);

// ============ STEP 1: 建立解码环境 ============
console.log('\n--- Step 1: 建立解码环境 ---');

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

const arrInfo = findFuncEnd(source, 'function _0x1fb3()');
// setup 包含: IIFE + _0x234f + 中间代码(反调试等) + _0x1fb3 
// 一起 eval 利用 JS 函数提升
let setupEnd = arrInfo.end;
while (setupEnd < source.length && " ;\n\r".includes(source[setupEnd])) setupEnd++;

const setupCode = source.substring(0, setupEnd);
eval(setupCode);
console.log(`✅ 解码环境就绪, 字符串表 ${_0x1fb3().length} 项`);

// 验证解码
console.log(`   验证: _0x234f(0x107, 0) = "${_0x234f(0x107, 0)}"`);

// ============ STEP 2: 解析 AST ============
console.log('\n--- Step 2: 解析 AST ---');
console.time('AST parse');
let ast;
try {
    ast = parser.parse(source, {
        sourceType: 'script',
        plugins: ['bigInt'],
        errorRecovery: true,
    });
    console.timeEnd('AST parse');
    console.log(`✅ AST 解析成功`);
} catch (e) {
    console.timeEnd('AST parse');
    console.error('❌ AST 解析失败:', e.message);
    process.exit(1);
}

// ============ STEP 3: 收集代理函数 ============
console.log('\n--- Step 3: 收集代理函数 ---');

const proxyFunctions = new Map();

traverse(ast, {
    FunctionDeclaration(nodePath) {
        const node = nodePath.node;
        if (!node.id || !node.id.name.startsWith('_0x')) return;
        if (node.body.body.length !== 1) return;
        const stmt = node.body.body[0];
        if (!t.isReturnStatement(stmt) || !t.isCallExpression(stmt.argument)) return;
        const callee = stmt.argument.callee;
        if (!t.isIdentifier(callee) || callee.name !== '_0x234f') return;
        if (stmt.argument.arguments.length !== 2) return;

        const params = node.params.map(p => p.name);
        const offsetArg = stmt.argument.arguments[0];
        const keyArg = stmt.argument.arguments[1];

        let offsetParamName = null, offsetConstant = 0;

        if (t.isIdentifier(offsetArg)) {
            offsetParamName = offsetArg.name;
        } else if (t.isBinaryExpression(offsetArg)) {
            if (t.isIdentifier(offsetArg.left)) {
                offsetParamName = offsetArg.left.name;
                if (t.isNumericLiteral(offsetArg.right)) {
                    offsetConstant = offsetArg.operator === '-' ? -offsetArg.right.value : offsetArg.right.value;
                } else if (t.isUnaryExpression(offsetArg.right, { operator: '-' }) && t.isNumericLiteral(offsetArg.right.argument)) {
                    // param - -0xNN => +0xNN
                    offsetConstant = offsetArg.operator === '-' ? offsetArg.right.argument.value : -offsetArg.right.argument.value;
                }
            }
        }

        let keyParamName = t.isIdentifier(keyArg) ? keyArg.name : null;

        if (offsetParamName && keyParamName) {
            const oi = params.indexOf(offsetParamName);
            const ki = params.indexOf(keyParamName);
            if (oi >= 0 && ki >= 0) {
                proxyFunctions.set(node.id.name, { paramCount: params.length, oi, oc: offsetConstant, ki });
            }
        }
    }
});
console.log(`✅ ${proxyFunctions.size} 个代理函数`);

// ============ STEP 4: 替换代理函数调用 ============
console.log('\n--- Step 4: 替换代理函数调用 ---');
console.time('proxy replace');

let successCount = 0, skipCount = 0;

function tryEval(node) {
    if (t.isNumericLiteral(node)) return node.value;
    if (t.isStringLiteral(node)) return node.value;
    if (t.isUnaryExpression(node, { operator: '-' }) && t.isNumericLiteral(node.argument)) return -node.argument.value;
    if (t.isBinaryExpression(node)) {
        const l = tryEval(node.left), r = tryEval(node.right);
        if (l !== undefined && r !== undefined) {
            switch (node.operator) {
                case '+': return l + r; case '-': return l - r;
                case '*': return l * r; case '/': return l / r;
                case '%': return l % r; case '|': return l | r;
                case '&': return l & r; case '^': return l ^ r;
                case '<<': return l << r; case '>>': return l >> r;
                case '>>>': return l >>> r;
            }
        }
    }
    return undefined;
}

traverse(ast, {
    CallExpression(nodePath) {
        const callee = nodePath.node.callee;
        if (!t.isIdentifier(callee)) return;
        const info = proxyFunctions.get(callee.name);
        if (!info) return;
        const args = nodePath.node.arguments;
        if (args.length !== info.paramCount) return;

        const oVal = tryEval(args[info.oi]);
        if (oVal === undefined) { skipCount++; return; }
        const kVal = tryEval(args[info.ki]);
        if (kVal === undefined) { skipCount++; return; }

        try {
            const decoded = _0x234f(oVal + info.oc, kVal);
            if (typeof decoded === 'string') {
                nodePath.replaceWith(t.stringLiteral(decoded));
                successCount++;
            }
        } catch { skipCount++; }
    }
});

console.timeEnd('proxy replace');
console.log(`✅ ${successCount} 成功, ${skipCount} 跳过`);

// ============ STEP 5: 常量折叠 ============
console.log('\n--- Step 5: 常量折叠 ---');
console.time('const fold');
let folded = 0;

// ![] => false, !![] => true (两轮)
traverse(ast, {
    UnaryExpression(p) {
        if (p.node.operator === '!' && t.isArrayExpression(p.node.argument) && p.node.argument.elements.length === 0) {
            p.replaceWith(t.booleanLiteral(false)); folded++;
        }
    }
});
traverse(ast, {
    UnaryExpression(p) {
        if (p.node.operator === '!' && t.isBooleanLiteral(p.node.argument)) {
            p.replaceWith(t.booleanLiteral(!p.node.argument.value)); folded++;
        }
    }
});

// 数值常量折叠
traverse(ast, {
    BinaryExpression(p) {
        const v = tryEval(p.node);
        if (v !== undefined && typeof v === 'number' && isFinite(v) && Number.isInteger(v)) {
            p.replaceWith(t.numericLiteral(v)); folded++;
        }
    }
});

console.timeEnd('const fold');
console.log(`✅ ${folded} 处`);

// ============ STEP 6: 对象属性代理内联 ============
console.log('\n--- Step 6: 对象属性代理内联 ---');
console.time('obj inline');
let objInlined = 0;

traverse(ast, {
    VariableDeclarator(vdPath) {
        if (!t.isObjectExpression(vdPath.node.init) || !t.isIdentifier(vdPath.node.id)) return;
        const objName = vdPath.node.id.name;
        const props = {};

        for (const prop of vdPath.node.init.properties) {
            if (!t.isObjectProperty(prop)) continue;
            const key = t.isStringLiteral(prop.key) ? prop.key.value :
                t.isIdentifier(prop.key) ? prop.key.name : null;
            if (!key) continue;

            if (t.isStringLiteral(prop.value)) {
                props[key] = { type: 'str', val: prop.value.value };
            } else if (t.isFunctionExpression(prop.value) && prop.value.body.body.length === 1 && t.isReturnStatement(prop.value.body.body[0])) {
                const ret = prop.value.body.body[0].argument;
                const pNames = prop.value.params.map(p => p.name);
                if (t.isBinaryExpression(ret) && pNames.length === 2 &&
                    t.isIdentifier(ret.left, { name: pNames[0] }) && t.isIdentifier(ret.right, { name: pNames[1] })) {
                    props[key] = { type: 'binop', op: ret.operator };
                } else if (t.isLogicalExpression(ret) && pNames.length === 2 &&
                    t.isIdentifier(ret.left, { name: pNames[0] }) && t.isIdentifier(ret.right, { name: pNames[1] })) {
                    props[key] = { type: 'logop', op: ret.operator };
                } else if (t.isCallExpression(ret) && t.isIdentifier(ret.callee) && pNames.length >= 1 && ret.callee.name === pNames[0]) {
                    props[key] = { type: 'call', argCount: pNames.length - 1 };
                }
            }
        }
        if (Object.keys(props).length === 0) return;

        const binding = vdPath.scope.getBinding(objName);
        if (!binding) return;

        for (const ref of binding.referencePaths) {
            try {
                const memExpr = ref.parent;
                if (!t.isMemberExpression(memExpr) || memExpr.object !== ref.node) continue;
                const propKey = t.isStringLiteral(memExpr.property) ? memExpr.property.value :
                    (!memExpr.computed && t.isIdentifier(memExpr.property)) ? memExpr.property.name : null;
                if (!propKey || !props[propKey]) continue;

                const pi = props[propKey];
                const gp = ref.parentPath;

                if (pi.type === 'str') {
                    // 只在不是被调用的情况下替换
                    if (!t.isCallExpression(gp.parent) || gp.parent.callee !== memExpr) {
                        gp.replaceWith(t.stringLiteral(pi.val));
                        objInlined++;
                    }
                } else if (pi.type === 'binop' && t.isCallExpression(gp.parent) && gp.parent.callee === memExpr && gp.parent.arguments.length === 2) {
                    const gpPath = gp.parentPath;
                    gpPath.replaceWith(t.binaryExpression(pi.op, gp.parent.arguments[0], gp.parent.arguments[1]));
                    objInlined++;
                } else if (pi.type === 'logop' && t.isCallExpression(gp.parent) && gp.parent.callee === memExpr && gp.parent.arguments.length === 2) {
                    const gpPath = gp.parentPath;
                    gpPath.replaceWith(t.logicalExpression(pi.op, gp.parent.arguments[0], gp.parent.arguments[1]));
                    objInlined++;
                } else if (pi.type === 'call' && t.isCallExpression(gp.parent) && gp.parent.callee === memExpr && gp.parent.arguments.length >= 1) {
                    const [fn, ...rest] = gp.parent.arguments;
                    gp.parentPath.replaceWith(t.callExpression(fn, rest));
                    objInlined++;
                }
            } catch { }
        }
    }
});
console.timeEnd('obj inline');
console.log(`✅ ${objInlined} 处`);

// ============ STEP 7: 再次常量折叠 ============
console.log('\n--- Step 7: 二次常量折叠 ---');
let folded2 = 0;
traverse(ast, {
    BinaryExpression(p) {
        const v = tryEval(p.node);
        if (v !== undefined && typeof v === 'number' && isFinite(v) && Number.isInteger(v) && Math.abs(v) < 2 ** 31) {
            p.replaceWith(t.numericLiteral(v)); folded2++;
        }
    }
});
console.log(`✅ ${folded2} 处`);

// ============ STEP 8: 生成代码 ============
console.log('\n--- Step 8: 生成代码 ---');
console.time('codegen');
const output = generate(ast, { comments: false, compact: false }, source);
console.timeEnd('codegen');

const outFile = path.join(__dirname, 'sixyin-music-source-v1.2.1-decoded.js');
fs.writeFileSync(outFile, output.code, 'utf-8');
console.log(`💾 ${(output.code.length / 1024).toFixed(1)} KB -> ${outFile}`);

// ============ STEP 9: 分析 ============
console.log('\n========================================');
console.log('📊 还原结果分析');
console.log('========================================');

const decoded = new Set();
const astOut = parser.parse(output.code, { sourceType: 'script', plugins: ['bigInt'], errorRecovery: true });
traverse(astOut, {
    StringLiteral(p) { const v = p.node.value; if (v.length > 1 && !v.startsWith('_0x')) decoded.add(v); }
});

const categories = [
    ['🇨🇳 中文', s => /[\u4e00-\u9fa5]/.test(s)],
    ['🌐 URL/API', s => /https?:|\/\/|\.com|\.cn|\/api|\.html/i.test(s)],
    ['🔐 加密', s => /aes|rsa|md5|encrypt|decrypt|crypt|base64|sign|key/i.test(s)],
    ['🎶 音质', s => /\dkm?(?:bps)?|flac|mp3|\dk\b/i.test(s)],
    ['📡 HTTP', s => /^(GET|POST|User-Agent|Cookie|Content|Referer)/i.test(s)],
    ['🎵 平台', s => /neteas|kugou|kuwo|migu|sixyin|qq\.com|qqmusic/i.test(s)],
    ['⚙️ 关键词', s => /search|playlist|song|album|lyric|download|version|source|update|play_|music/i.test(s)],
];

for (const [label, test] of categories) {
    const items = [...decoded].filter(test);
    if (items.length === 0) continue;
    console.log(`\n${label} (${items.length}):`);
    [...new Set(items)].sort().slice(0, 60).forEach(s => console.log(`  "${s}"`));
}

console.log(`\n📈 总计: ${successCount} 字符串还原 | ${folded + folded2} 常量折叠 | ${objInlined} 对象内联`);
console.log(`📈 ${decoded.size} 个唯一字符串`);
console.log('✅ AST 反混淆完成！');
