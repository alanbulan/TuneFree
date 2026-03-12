/**
 * 深度 AST 反混淆 - 多轮迭代
 * 处理: 递归代理函数链、字符串拼接、对象代理字典、控制流平坦化、死代码消除
 */
const fs = require('fs');
const path = require('path');
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;
const generate = require('@babel/generator').default;
const t = require('@babel/types');

const sourceFile = path.join(__dirname, 'sixyin-music-source-v1.2.1-decoded.js');
const source = fs.readFileSync(sourceFile, 'utf-8');
console.log(`📄 输入文件: ${(source.length / 1024).toFixed(1)} KB`);

// ============ STEP 0: 重建解码环境 ============
console.log('\n--- Step 0: 重建解码环境 ---');
const origSource = fs.readFileSync(path.join(__dirname, 'sixyin-music-source-v1.2.1-encrypt.js'), 'utf-8');
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
const arrInfo = findFuncEnd(origSource, 'function _0x1fb3()');
let setupEnd = arrInfo.end;
while (setupEnd < origSource.length && " ;\n\r".includes(origSource[setupEnd])) setupEnd++;
eval(origSource.substring(0, setupEnd));
console.log(`✅ 解码环境就绪, 字符串表 ${_0x1fb3().length} 项`);

// ============ STEP 1: 解析 AST ============
console.log('\n--- Step 1: 解析 AST ---');
console.time('parse');
let ast = parser.parse(source, {
    sourceType: 'script',
    plugins: ['bigInt'],
    errorRecovery: true,
});
console.timeEnd('parse');

// ============ 辅助函数 ============
function tryEvalNode(node) {
    if (t.isNumericLiteral(node)) return node.value;
    if (t.isStringLiteral(node)) return node.value;
    if (t.isUnaryExpression(node, { operator: '-' }) && t.isNumericLiteral(node.argument))
        return -node.argument.value;
    if (t.isBinaryExpression(node)) {
        const l = tryEvalNode(node.left), r = tryEvalNode(node.right);
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

// ============ STEP 2: 收集所有层级的代理函数 ============
console.log('\n--- Step 2: 收集代理函数链 ---');

// 第一层: 直接调用 _0x234f 的函数
const directProxies = new Map();
// 收集所有代理函数 (包括间接的)
const allProxies = new Map();

function collectProxyFunctions() {
    directProxies.clear();
    allProxies.clear();

    traverse(ast, {
        FunctionDeclaration(nodePath) {
            const node = nodePath.node;
            if (!node.id || !node.id.name.startsWith('_0x')) return;
            if (node.body.body.length !== 1) return;
            const stmt = node.body.body[0];
            if (!t.isReturnStatement(stmt) || !t.isCallExpression(stmt.argument)) return;
            const callee = stmt.argument.callee;
            if (!t.isIdentifier(callee)) return;
            
            const params = node.params.map(p => p.name);
            const callArgs = stmt.argument.arguments;
            
            // 直接调用 _0x234f
            if (callee.name === '_0x234f' && callArgs.length === 2) {
                const info = parseProxyArgs(params, callArgs);
                if (info) {
                    directProxies.set(node.id.name, info);
                    allProxies.set(node.id.name, info);
                }
            }
            // 调用另一个代理函数
            else if (callee.name.startsWith('_0x') && directProxies.has(callee.name)) {
                const target = directProxies.get(callee.name);
                // 尝试解析参数映射链
                const chainInfo = resolveChain(params, callArgs, target, callee.name);
                if (chainInfo) {
                    allProxies.set(node.id.name, chainInfo);
                }
            }
        },
        // 也收集函数表达式中定义的代理函数
        FunctionExpression(nodePath) {
            const parent = nodePath.parent;
            if (!t.isVariableDeclarator(parent) || !t.isIdentifier(parent.id)) return;
            const node = nodePath.node;
            if (node.body.body.length !== 1) return;
            const stmt = node.body.body[0];
            if (!t.isReturnStatement(stmt) || !t.isCallExpression(stmt.argument)) return;
            const callee = stmt.argument.callee;
            if (!t.isIdentifier(callee) || callee.name !== '_0x234f') return;
            if (stmt.argument.arguments.length !== 2) return;

            const params = node.params.map(p => p.name);
            const info = parseProxyArgs(params, stmt.argument.arguments);
            if (info) {
                directProxies.set(parent.id.name, info);
                allProxies.set(parent.id.name, info);
            }
        }
    });
}

function parseProxyArgs(params, callArgs) {
    const offsetArg = callArgs[0];
    const keyArg = callArgs[1];
    let offsetParamName = null, offsetConstant = 0;

    if (t.isIdentifier(offsetArg)) {
        offsetParamName = offsetArg.name;
    } else if (t.isBinaryExpression(offsetArg)) {
        if (t.isIdentifier(offsetArg.left)) {
            offsetParamName = offsetArg.left.name;
            if (t.isNumericLiteral(offsetArg.right)) {
                offsetConstant = offsetArg.operator === '-' ? -offsetArg.right.value : offsetArg.right.value;
            } else if (t.isUnaryExpression(offsetArg.right, { operator: '-' }) && t.isNumericLiteral(offsetArg.right.argument)) {
                offsetConstant = offsetArg.operator === '-' ? offsetArg.right.argument.value : -offsetArg.right.argument.value;
            }
        }
    }

    const keyParamName = t.isIdentifier(keyArg) ? keyArg.name : null;

    if (offsetParamName && keyParamName) {
        const oi = params.indexOf(offsetParamName);
        const ki = params.indexOf(keyParamName);
        if (oi >= 0 && ki >= 0) {
            return { paramCount: params.length, oi, oc: offsetConstant, ki };
        }
    }
    return null;
}

function resolveChain(myParams, callArgs, targetInfo, targetName) {
    // 我的函数调用 target(映射后的参数)
    // 需要解出最终哪个参数映射到 offset、哪个映射到 key
    if (callArgs.length !== targetInfo.paramCount) return null;

    // 获取传给 target 的 offset 位置的参数表达式
    const offsetExpr = callArgs[targetInfo.oi];
    const keyExpr = callArgs[targetInfo.ki];

    // offsetExpr 需要能解析成 myParams[X] + constant 的形式
    let myOffsetParam = null, totalOffset = targetInfo.oc;
    if (t.isIdentifier(offsetExpr) && myParams.includes(offsetExpr.name)) {
        myOffsetParam = offsetExpr.name;
    } else if (t.isBinaryExpression(offsetExpr)) {
        const simplified = simplifyLinearExpr(offsetExpr, myParams);
        if (simplified) {
            myOffsetParam = simplified.param;
            totalOffset = targetInfo.oc + simplified.constant;
        }
    }

    // keyExpr 需要解析成 myParams[Y]
    let myKeyParam = null;
    if (t.isIdentifier(keyExpr) && myParams.includes(keyExpr.name)) {
        myKeyParam = keyExpr.name;
    }

    if (myOffsetParam && myKeyParam) {
        const oi = myParams.indexOf(myOffsetParam);
        const ki = myParams.indexOf(myKeyParam);
        if (oi >= 0 && ki >= 0) {
            return { paramCount: myParams.length, oi, oc: totalOffset, ki };
        }
    }
    return null;
}

function simplifyLinearExpr(expr, params) {
    // 解析形如 paramName +/- constant 的表达式
    if (t.isBinaryExpression(expr) && (expr.operator === '+' || expr.operator === '-')) {
        if (t.isIdentifier(expr.left) && params.includes(expr.left.name)) {
            const constVal = tryEvalNode(expr.right);
            if (constVal !== undefined) {
                return {
                    param: expr.left.name,
                    constant: expr.operator === '-' ? -constVal : constVal,
                };
            }
        }
    }
    return null;
}

// 多轮收集
collectProxyFunctions();
console.log(`✅ 直接代理: ${directProxies.size}, 总计: ${allProxies.size}`);

// ============ STEP 3: 替换所有代理函数调用 ============
console.log('\n--- Step 3: 替换代理函数调用 ---');
console.time('proxy-replace');
let proxySucc = 0, proxySkip = 0;

traverse(ast, {
    CallExpression(nodePath) {
        const callee = nodePath.node.callee;
        if (!t.isIdentifier(callee)) return;
        const info = allProxies.get(callee.name);
        if (!info) return;
        const args = nodePath.node.arguments;
        if (args.length !== info.paramCount) return;

        const oVal = tryEvalNode(args[info.oi]);
        if (oVal === undefined) { proxySkip++; return; }
        const kVal = tryEvalNode(args[info.ki]);
        if (kVal === undefined) { proxySkip++; return; }

        try {
            const decoded = _0x234f(oVal + info.oc, kVal);
            if (typeof decoded === 'string') {
                nodePath.replaceWith(t.stringLiteral(decoded));
                proxySucc++;
            }
        } catch { proxySkip++; }
    }
});
console.timeEnd('proxy-replace');
console.log(`✅ ${proxySucc} 成功, ${proxySkip} 跳过`);

// ============ STEP 4: 字符串拼接合并 ============
console.log('\n--- Step 4: 字符串拼接合并 ---');
let strConcat = 0;

function mergeStringConcat() {
    let count = 0;
    traverse(ast, {
        BinaryExpression(p) {
            if (p.node.operator !== '+') return;
            const val = evalStringConcat(p.node);
            if (val !== null) {
                p.replaceWith(t.stringLiteral(val));
                count++;
            }
        }
    });
    return count;
}

function evalStringConcat(node) {
    if (t.isStringLiteral(node)) return node.value;
    if (t.isBinaryExpression(node, { operator: '+' })) {
        const l = evalStringConcat(node.left);
        const r = evalStringConcat(node.right);
        if (l !== null && r !== null) return l + r;
    }
    return null;
}

// 多轮合并
for (let round = 0; round < 3; round++) {
    const c = mergeStringConcat();
    strConcat += c;
    if (c === 0) break;
}
console.log(`✅ ${strConcat} 处字符串拼接合并`);

// ============ STEP 5: 对象代理字典内联 (多轮) ============
console.log('\n--- Step 5: 对象代理字典内联 ---');
console.time('obj-inline');
let totalObjInlined = 0;

function inlineObjectProxies() {
    let inlined = 0;
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
                } else if (t.isNumericLiteral(prop.value)) {
                    props[key] = { type: 'num', val: prop.value.value };
                } else if (t.isBooleanLiteral(prop.value)) {
                    props[key] = { type: 'bool', val: prop.value.value };
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
                        // fn(a, b, c) => fn is first param 
                        const allArgsMatch = ret.arguments.every((arg, i) => t.isIdentifier(arg, { name: pNames[i + 1] }));
                        if (allArgsMatch && ret.arguments.length === pNames.length - 1) {
                            props[key] = { type: 'call', argCount: pNames.length - 1 };
                        }
                    } else if (t.isConditionalExpression(ret) || t.isUnaryExpression(ret)) {
                        // 更复杂的代理暂不处理
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
                        if (t.isCallExpression(gp.parent) && gp.parent.callee === memExpr) {
                            // 字符串作为被调用对象的属性名 - 跳过
                        } else {
                            gp.replaceWith(t.stringLiteral(pi.val));
                            inlined++;
                        }
                    } else if (pi.type === 'num') {
                        if (!(t.isCallExpression(gp.parent) && gp.parent.callee === memExpr)) {
                            gp.replaceWith(t.numericLiteral(pi.val));
                            inlined++;
                        }
                    } else if (pi.type === 'bool') {
                        if (!(t.isCallExpression(gp.parent) && gp.parent.callee === memExpr)) {
                            gp.replaceWith(t.booleanLiteral(pi.val));
                            inlined++;
                        }
                    } else if (pi.type === 'binop' && t.isCallExpression(gp.parent) && gp.parent.callee === memExpr && gp.parent.arguments.length === 2) {
                        gp.parentPath.replaceWith(t.binaryExpression(pi.op, gp.parent.arguments[0], gp.parent.arguments[1]));
                        inlined++;
                    } else if (pi.type === 'logop' && t.isCallExpression(gp.parent) && gp.parent.callee === memExpr && gp.parent.arguments.length === 2) {
                        gp.parentPath.replaceWith(t.logicalExpression(pi.op, gp.parent.arguments[0], gp.parent.arguments[1]));
                        inlined++;
                    } else if (pi.type === 'call' && t.isCallExpression(gp.parent) && gp.parent.callee === memExpr && gp.parent.arguments.length >= 1) {
                        const [fn, ...rest] = gp.parent.arguments;
                        gp.parentPath.replaceWith(t.callExpression(fn, rest));
                        inlined++;
                    }
                } catch { }
            }
        }
    });
    return inlined;
}

for (let round = 0; round < 5; round++) {
    const c = inlineObjectProxies();
    totalObjInlined += c;
    console.log(`  第${round + 1}轮: ${c} 处`);
    if (c === 0) break;
}
console.timeEnd('obj-inline');
console.log(`✅ 总计 ${totalObjInlined} 处对象内联`);

// ============ STEP 6: 常量折叠 ============
console.log('\n--- Step 6: 常量折叠 ---');
let totalFolded = 0;

function foldConstants() {
    let count = 0;
    // ![] => false
    traverse(ast, {
        UnaryExpression(p) {
            if (p.node.operator === '!' && t.isArrayExpression(p.node.argument) && p.node.argument.elements.length === 0) {
                p.replaceWith(t.booleanLiteral(false)); count++;
            }
        }
    });
    traverse(ast, {
        UnaryExpression(p) {
            if (p.node.operator === '!' && t.isBooleanLiteral(p.node.argument)) {
                p.replaceWith(t.booleanLiteral(!p.node.argument.value)); count++;
            }
        }
    });
    // 数值表达式折叠
    traverse(ast, {
        BinaryExpression(p) {
            const v = tryEvalNode(p.node);
            if (v !== undefined && typeof v === 'number' && isFinite(v) && Number.isInteger(v) && Math.abs(v) < 2 ** 31) {
                p.replaceWith(t.numericLiteral(v)); count++;
            }
        }
    });
    return count;
}

totalFolded = foldConstants();
console.log(`✅ ${totalFolded} 处`);

// ============ STEP 7: typeof 比较简化 ============
console.log('\n--- Step 7: typeof 比较简化 ---');
let typeofSimp = 0;
// typeof x !== "undefined" 等简化: 
// 把 "objec" + "t" => "object" 已经在 step 4 做了

// ============ STEP 8: 控制流平坦化还原 ============
console.log('\n--- Step 8: 控制流平坦化还原 ---');
let cfResolved = 0;

traverse(ast, {
    WhileStatement(whilePath) {
        const whileNode = whilePath.node;
        // while(true) { switch(arr[idx++]) { ... } break; }
        if (!t.isBooleanLiteral(whileNode.test, { value: true })) return;
        const body = whileNode.body;
        if (!t.isBlockStatement(body)) return;
        const stmts = body.body;
        // 通常最后一个是 break
        // switch 语句
        let switchStmt = null;
        for (const s of stmts) {
            if (t.isSwitchStatement(s)) { switchStmt = s; break; }
        }
        if (!switchStmt) return;

        // 判断 discriminant 是否为 arr[idx++]
        const disc = switchStmt.discriminant;
        if (!t.isMemberExpression(disc)) return;
        // arr 应该是个 split 结果的标识符
        const arrId = disc.object;
        if (!t.isIdentifier(arrId)) return;

        // 向上找 arr 的定义, 应该是类似 const arr = "2|3|0|4|1".split('|')
        const arrBinding = whilePath.scope.getBinding(arrId.name);
        if (!arrBinding || !t.isVariableDeclarator(arrBinding.path.node)) return;
        const arrInit = arrBinding.path.node.init;
        if (!t.isCallExpression(arrInit)) return;
        // 检查 "str".split('|')
        if (!t.isMemberExpression(arrInit.callee)) return;
        const splitObj = arrInit.callee.object;
        const splitProp = arrInit.callee.property;
        if (!t.isStringLiteral(splitObj)) return;
        if (!(t.isIdentifier(splitProp, { name: 'split' }) || t.isStringLiteral(splitProp, { value: 'split' }))) return;
        if (arrInit.arguments.length !== 1 || !t.isStringLiteral(arrInit.arguments[0], { value: '|' })) return;

        const order = splitObj.value.split('|');

        // 建立 case 映射
        const caseMap = {};
        for (const c of switchStmt.cases) {
            if (!c.test || !t.isStringLiteral(c.test)) continue;
            // 收集 case 里面除了 continue 和 break 的所有语句
            const caseStmts = c.consequent.filter(s => !t.isContinueStatement(s) && !t.isBreakStatement(s));
            caseMap[c.test.value] = caseStmts;
        }

        // 按顺序排列
        const orderedStmts = [];
        let valid = true;
        for (const idx of order) {
            if (!caseMap[idx]) { valid = false; break; }
            orderedStmts.push(...caseMap[idx]);
        }

        if (valid && orderedStmts.length > 0) {
            // 替换 while 语句为展开的语句
            whilePath.replaceWithMultiple(orderedStmts);
            cfResolved++;
        }
    }
});
console.log(`✅ ${cfResolved} 处控制流还原`);

// ============ STEP 9: 死代码/不可达分支消除 ============
console.log('\n--- Step 9: 死代码消除 ---');
let deadCode = 0;

traverse(ast, {
    IfStatement(ifPath) {
        const test = ifPath.node.test;

        // 字符串比较: "xxx" === "xxx" => true, "xxx" !== "xxx" => false
        if (t.isBinaryExpression(test) && t.isStringLiteral(test.left) && t.isStringLiteral(test.right)) {
            let result;
            if (test.operator === '===' || test.operator === '==') {
                result = test.left.value === test.right.value;
            } else if (test.operator === '!==' || test.operator === '!=') {
                result = test.left.value !== test.right.value;
            }
            if (result !== undefined) {
                if (result) {
                    // 保留 consequent
                    if (t.isBlockStatement(ifPath.node.consequent)) {
                        ifPath.replaceWithMultiple(ifPath.node.consequent.body);
                    } else {
                        ifPath.replaceWith(ifPath.node.consequent);
                    }
                } else {
                    // 保留 alternate
                    if (ifPath.node.alternate) {
                        if (t.isBlockStatement(ifPath.node.alternate)) {
                            ifPath.replaceWithMultiple(ifPath.node.alternate.body);
                        } else {
                            ifPath.replaceWith(ifPath.node.alternate);
                        }
                    } else {
                        ifPath.remove();
                    }
                }
                deadCode++;
            }
        }
    },
    // 条件表达式 "a" === "a" ? x : y => x
    ConditionalExpression(p) {
        const test = p.node.test;
        if (t.isBinaryExpression(test) && t.isStringLiteral(test.left) && t.isStringLiteral(test.right)) {
            let result;
            if (test.operator === '===' || test.operator === '==') {
                result = test.left.value === test.right.value;
            } else if (test.operator === '!==' || test.operator === '!=') {
                result = test.left.value !== test.right.value;
            }
            if (result !== undefined) {
                p.replaceWith(result ? p.node.consequent : p.node.alternate);
                deadCode++;
            }
        }
    }
});
console.log(`✅ ${deadCode} 处死代码消除`);

// ============ STEP 10: 第二轮字符串拼接 ============
console.log('\n--- Step 10: 第二轮字符串拼接 ---');
let strConcat2 = 0;
for (let i = 0; i < 3; i++) {
    const c = mergeStringConcat();
    strConcat2 += c;
    if (c === 0) break;
}
console.log(`✅ ${strConcat2} 处`);

// ============ STEP 11: 第二轮常量折叠 ============
console.log('\n--- Step 11: 第二轮常量折叠 ---');
const f2 = foldConstants();
totalFolded += f2;
console.log(`✅ ${f2} 处`);

// ============ STEP 12: 清理成员表达式字符串 ============
console.log('\n--- Step 12: 成员表达式清理 ---');
let memberCleaned = 0;

// obj["prop"] => obj.prop (当 prop 是有效标识符时)
traverse(ast, {
    MemberExpression(p) {
        if (p.node.computed && t.isStringLiteral(p.node.property)) {
            const name = p.node.property.value;
            if (/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(name)) {
                p.node.computed = false;
                p.node.property = t.identifier(name);
                memberCleaned++;
            }
        }
    }
});
console.log(`✅ ${memberCleaned} 处成员表达式清理`);

// ============ STEP 13: 收集并展示直接调用 _0x234f 的残余 ============
console.log('\n--- Step 13: 残余 _0x234f 调用分析 ---');
let remaining234f = 0;
traverse(ast, {
    CallExpression(p) {
        if (t.isIdentifier(p.node.callee, { name: '_0x234f' })) remaining234f++;
    }
});
console.log(`  残余 _0x234f 直接调用: ${remaining234f}`);

let remainingProxy = 0;
traverse(ast, {
    CallExpression(p) {
        if (t.isIdentifier(p.node.callee) && allProxies.has(p.node.callee.name)) remainingProxy++;
    }
});
console.log(`  残余代理函数调用: ${remainingProxy}`);

// ============ STEP 14: 生成代码 ============
console.log('\n--- Step 14: 生成代码 ---');
console.time('codegen');
const output = generate(ast, { comments: false, compact: false });
console.timeEnd('codegen');

const outFile = path.join(__dirname, 'sixyin-music-source-v1.2.1-deep.js');
fs.writeFileSync(outFile, output.code, 'utf-8');
console.log(`💾 ${(output.code.length / 1024).toFixed(1)} KB -> ${outFile}`);

// ============ 统计 ============
console.log('\n========================================');
console.log('📊 深度反混淆结果');
console.log('========================================');
console.log(`  代理函数还原: ${proxySucc}`);
console.log(`  字符串拼接合并: ${strConcat + strConcat2}`);
console.log(`  对象代理内联: ${totalObjInlined}`);
console.log(`  常量折叠: ${totalFolded}`);
console.log(`  控制流还原: ${cfResolved}`);
console.log(`  死代码消除: ${deadCode}`);
console.log(`  成员表达式清理: ${memberCleaned}`);
console.log('✅ 深度反混淆完成！');
