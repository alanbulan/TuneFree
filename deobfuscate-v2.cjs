/**
 * 深度 AST 反混淆 v2 - 全面处理嵌套代理链 + 对象字典
 * 
 * 核心改进:
 * 1. 不限层级收集所有代理函数 (FunctionDeclaration + FunctionExpression + 内嵌)
 * 2. 多轮递归解析代理链 (A → B → C → _0x234f)
 * 3. 先解代理函数 → 再解对象字典 → 多轮迭代直到收敛
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
    if (t.isUnaryExpression(node, { operator: '+' }) && t.isNumericLiteral(node.argument))
        return node.argument.value;
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

// ============ STEP 2: 全量代理函数收集(多轮) ============
console.log('\n--- Step 2: 全量代理函数收集 ---');
console.time('proxy-collect');

// 存储代理函数信息: { paramCount, oi(offset参数索引), oc(offset常量), ki(key参数索引) }
const proxyMap = new Map();

function extractProxyInfo(funcNode) {
    // funcNode 是 FunctionDeclaration 或 FunctionExpression
    if (!funcNode.body || !funcNode.body.body || funcNode.body.body.length !== 1) return null;
    const stmt = funcNode.body.body[0];
    if (!t.isReturnStatement(stmt) || !stmt.argument) return null;
    if (!t.isCallExpression(stmt.argument)) return null;

    const callee = stmt.argument.callee;
    if (!t.isIdentifier(callee)) return null;

    const params = funcNode.params.map(p => {
        if (t.isIdentifier(p)) return p.name;
        return null;
    });
    if (params.some(p => p === null)) return null;

    const callArgs = stmt.argument.arguments;
    const calleeName = callee.name;

    // 直接调用 _0x234f
    if (calleeName === '_0x234f' && callArgs.length === 2) {
        return parseDirectProxy(params, callArgs);
    }

    // 调用已知的代理函数
    if (proxyMap.has(calleeName)) {
        const target = proxyMap.get(calleeName);
        return resolveChain(params, callArgs, target);
    }

    return null;
}

function parseDirectProxy(params, callArgs) {
    const offsetArg = callArgs[0];
    const keyArg = callArgs[1];

    // 解析 offset: 可能是 param, param + const, param - const
    const offsetInfo = parseLinearExpr(offsetArg, params);
    if (!offsetInfo) return null;

    // 解析 key: 必须是一个参数
    const keyInfo = parseLinearExpr(keyArg, params);
    if (!keyInfo || keyInfo.constant !== 0) return null;  // key 只能是纯参数

    return {
        paramCount: params.length,
        oi: offsetInfo.paramIndex,
        oc: offsetInfo.constant,
        ki: keyInfo.paramIndex
    };
}

function parseLinearExpr(node, params) {
    // 返回 { paramIndex, constant } 或 null
    if (t.isIdentifier(node)) {
        const idx = params.indexOf(node.name);
        if (idx >= 0) return { paramIndex: idx, constant: 0 };
        return null;
    }
    if (t.isBinaryExpression(node) && (node.operator === '+' || node.operator === '-')) {
        // param +/- const
        if (t.isIdentifier(node.left)) {
            const idx = params.indexOf(node.left.name);
            if (idx < 0) return null;
            const constVal = tryEvalNode(node.right);
            if (constVal === undefined) return null;
            return {
                paramIndex: idx,
                constant: node.operator === '-' ? -constVal : constVal
            };
        }
        // const + param (less common but possible)
        if (t.isIdentifier(node.right) && node.operator === '+') {
            const idx = params.indexOf(node.right.name);
            if (idx < 0) return null;
            const constVal = tryEvalNode(node.left);
            if (constVal === undefined) return null;
            return { paramIndex: idx, constant: constVal };
        }
    }
    return null;
}

function resolveChain(myParams, callArgs, targetInfo) {
    if (callArgs.length !== targetInfo.paramCount) return null;

    // 获取传给 target 的参数
    const offsetExpr = callArgs[targetInfo.oi];
    const keyExpr = callArgs[targetInfo.ki];

    // 解析 offsetExpr = myParams[X] + someConst
    const offsetInfo = parseLinearExpr(offsetExpr, myParams);
    if (!offsetInfo) return null;

    // 解析 keyExpr = myParams[Y]
    const keyInfo = parseLinearExpr(keyExpr, myParams);
    if (!keyInfo) return null;

    // key 参数只允许直接传递(不加常量)
    if (keyInfo.constant !== 0) return null;

    return {
        paramCount: myParams.length,
        oi: offsetInfo.paramIndex,
        oc: targetInfo.oc + offsetInfo.constant,
        ki: keyInfo.paramIndex
    };
}

// 多轮收集，直到没有新的代理函数
let totalCollected = 0;
for (let round = 0; round < 20; round++) {
    let newCount = 0;

    traverse(ast, {
        // FunctionDeclaration
        FunctionDeclaration(nodePath) {
            const node = nodePath.node;
            if (!node.id || !node.id.name) return;
            if (proxyMap.has(node.id.name)) return;
            const info = extractProxyInfo(node);
            if (info) {
                proxyMap.set(node.id.name, info);
                newCount++;
            }
        },
        // FunctionExpression assigned to variable
        VariableDeclarator(nodePath) {
            const node = nodePath.node;
            if (!t.isIdentifier(node.id)) return;
            if (proxyMap.has(node.id.name)) return;
            if (!t.isFunctionExpression(node.init)) return;
            const info = extractProxyInfo(node.init);
            if (info) {
                proxyMap.set(node.id.name, info);
                newCount++;
            }
        }
    });

    totalCollected += newCount;
    if (newCount === 0) {
        console.log(`  第 ${round + 1} 轮: +0 (收敛)`);
        break;
    }
    console.log(`  第 ${round + 1} 轮: +${newCount} 代理函数`);
}
console.timeEnd('proxy-collect');
console.log(`✅ 总计收集 ${proxyMap.size} 个代理函数`);

// ============ STEP 3: 替换所有代理函数调用 (多轮) ============
console.log('\n--- Step 3: 替换代理函数调用 ---');
console.time('proxy-replace');
let totalProxyReplaced = 0;
let totalProxySkipped = 0;

for (let round = 0; round < 10; round++) {
    let replaced = 0, skipped = 0;

    traverse(ast, {
        CallExpression(nodePath) {
            const callee = nodePath.node.callee;
            if (!t.isIdentifier(callee)) return;
            const info = proxyMap.get(callee.name);
            if (!info) return;
            const args = nodePath.node.arguments;
            if (args.length !== info.paramCount) return;

            const oVal = tryEvalNode(args[info.oi]);
            if (oVal === undefined) { skipped++; return; }
            const kVal = tryEvalNode(args[info.ki]);
            if (kVal === undefined) { skipped++; return; }

            try {
                const decoded = _0x234f(oVal + info.oc, kVal);
                if (typeof decoded === 'string') {
                    nodePath.replaceWith(t.stringLiteral(decoded));
                    replaced++;
                }
            } catch { skipped++; }
        }
    });

    totalProxyReplaced += replaced;
    totalProxySkipped = skipped;  // 只记录最后一轮
    console.log(`  第 ${round + 1} 轮: ${replaced} 替换, ${skipped} 跳过`);
    if (replaced === 0) break;
}
console.timeEnd('proxy-replace');
console.log(`✅ 总计 ${totalProxyReplaced} 次代理调用替换`);

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

for (let round = 0; round < 5; round++) {
    const c = mergeStringConcat();
    strConcat += c;
    if (c === 0) break;
}
console.log(`✅ ${strConcat} 处字符串拼接合并`);

// ============ STEP 5: 常量折叠 ============
console.log('\n--- Step 5: 常量折叠 ---');
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

// ============ STEP 6: 成员表达式清理 (先做一轮) ============
console.log('\n--- Step 6: 成员表达式清理 ---');
let memberCleaned = 0;

function cleanMemberExpressions() {
    let count = 0;
    traverse(ast, {
        MemberExpression(p) {
            if (p.node.computed && t.isStringLiteral(p.node.property)) {
                const name = p.node.property.value;
                if (/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(name)) {
                    p.node.computed = false;
                    p.node.property = t.identifier(name);
                    count++;
                }
            }
        }
    });
    return count;
}

memberCleaned = cleanMemberExpressions();
console.log(`✅ ${memberCleaned} 处`);

// ============ STEP 7: 对象代理字典内联 ============
console.log('\n--- Step 7: 对象代理字典内联 ---');
console.time('obj-inline');
let totalObjInlined = 0;

// 用 WeakSet 标记已处理过的节点，避免循环
const processedNodes = new WeakSet();

function collectObjectProps(objExpr) {
    const props = {};
    for (const prop of objExpr.properties) {
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
        } else if (t.isNullLiteral(prop.value)) {
            props[key] = { type: 'null' };
        } else if (t.isFunctionExpression(prop.value) && prop.value.body.body.length === 1 && t.isReturnStatement(prop.value.body.body[0])) {
            const ret = prop.value.body.body[0].argument;
            const pNames = prop.value.params.map(p => t.isIdentifier(p) ? p.name : null);
            if (pNames.some(n => n === null)) continue;

            if (ret && t.isBinaryExpression(ret) && pNames.length === 2 &&
                t.isIdentifier(ret.left, { name: pNames[0] }) && t.isIdentifier(ret.right, { name: pNames[1] })) {
                props[key] = { type: 'binop', op: ret.operator };
            } else if (ret && t.isLogicalExpression(ret) && pNames.length === 2 &&
                t.isIdentifier(ret.left, { name: pNames[0] }) && t.isIdentifier(ret.right, { name: pNames[1] })) {
                props[key] = { type: 'logop', op: ret.operator };
            } else if (ret && t.isCallExpression(ret) && t.isIdentifier(ret.callee)) {
                if (pNames.length >= 1 && ret.callee.name === pNames[0]) {
                    const allArgsMatch = ret.arguments.every((arg, i) => t.isIdentifier(arg, { name: pNames[i + 1] }));
                    if (allArgsMatch && ret.arguments.length === pNames.length - 1) {
                        props[key] = { type: 'call', argCount: pNames.length - 1 };
                    }
                }
            } else if (ret && t.isUnaryExpression(ret) && pNames.length === 1 &&
                t.isIdentifier(ret.argument, { name: pNames[0] })) {
                props[key] = { type: 'unary', op: ret.operator };
            }
        }
    }
    return props;
}

function inlineObjectProxies() {
    let inlined = 0;
    
    traverse(ast, {
        VariableDeclarator(vdPath) {
            if (!t.isObjectExpression(vdPath.node.init) || !t.isIdentifier(vdPath.node.id)) return;
            const objName = vdPath.node.id.name;
            const props = collectObjectProps(vdPath.node.init);

            if (Object.keys(props).length < 3) return;

            const binding = vdPath.scope.getBinding(objName);
            if (!binding) return;
            if (binding.constantViolations && binding.constantViolations.length > 0) return;

            // 复制引用列表，因为替换会改变它
            const refs = [...binding.referencePaths];
            for (const ref of refs) {
                try {
                    // 跳过已处理的节点
                    if (processedNodes.has(ref.node)) continue;
                    processedNodes.add(ref.node);

                    const memExpr = ref.parent;
                    if (!t.isMemberExpression(memExpr) || memExpr.object !== ref.node) continue;
                    
                    let propKey;
                    if (t.isStringLiteral(memExpr.property)) {
                        propKey = memExpr.property.value;
                    } else if (!memExpr.computed && t.isIdentifier(memExpr.property)) {
                        propKey = memExpr.property.name;
                    } else {
                        continue;
                    }

                    if (!props[propKey]) continue;

                    const pi = props[propKey];
                    const gp = ref.parentPath; // MemberExpression path

                    if (pi.type === 'str') {
                        const gpParent = gp.parent;
                        if (!(t.isCallExpression(gpParent) && gpParent.callee === memExpr)) {
                            gp.replaceWith(t.stringLiteral(pi.val));
                            inlined++;
                        }
                    } else if (pi.type === 'num') {
                        const gpParent = gp.parent;
                        if (!(t.isCallExpression(gpParent) && gpParent.callee === memExpr)) {
                            gp.replaceWith(t.numericLiteral(pi.val));
                            inlined++;
                        }
                    } else if (pi.type === 'bool') {
                        const gpParent = gp.parent;
                        if (!(t.isCallExpression(gpParent) && gpParent.callee === memExpr)) {
                            gp.replaceWith(t.booleanLiteral(pi.val));
                            inlined++;
                        }
                    } else if (pi.type === 'null') {
                        const gpParent = gp.parent;
                        if (!(t.isCallExpression(gpParent) && gpParent.callee === memExpr)) {
                            gp.replaceWith(t.nullLiteral());
                            inlined++;
                        }
                    } else if (pi.type === 'binop') {
                        const gpParent = gp.parent;
                        if (t.isCallExpression(gpParent) && gpParent.callee === memExpr && gpParent.arguments.length === 2) {
                            gp.parentPath.replaceWith(t.binaryExpression(pi.op, gpParent.arguments[0], gpParent.arguments[1]));
                            inlined++;
                        }
                    } else if (pi.type === 'logop') {
                        const gpParent = gp.parent;
                        if (t.isCallExpression(gpParent) && gpParent.callee === memExpr && gpParent.arguments.length === 2) {
                            gp.parentPath.replaceWith(t.logicalExpression(pi.op, gpParent.arguments[0], gpParent.arguments[1]));
                            inlined++;
                        }
                    } else if (pi.type === 'call') {
                        const gpParent = gp.parent;
                        if (t.isCallExpression(gpParent) && gpParent.callee === memExpr && gpParent.arguments.length >= 1) {
                            const [fn, ...rest] = gpParent.arguments;
                            gp.parentPath.replaceWith(t.callExpression(fn, rest));
                            inlined++;
                        }
                    } else if (pi.type === 'unary') {
                        const gpParent = gp.parent;
                        if (t.isCallExpression(gpParent) && gpParent.callee === memExpr && gpParent.arguments.length === 1) {
                            gp.parentPath.replaceWith(t.unaryExpression(pi.op, gpParent.arguments[0]));
                            inlined++;
                        }
                    }
                } catch { }
            }
        }
    });
    return inlined;
}

// 单轮对象内联
const oi1 = inlineObjectProxies();
totalObjInlined += oi1;
console.log(`  第 1 轮: ${oi1} 处`);
console.timeEnd('obj-inline');
console.log(`✅ 总计 ${totalObjInlined} 处对象内联`);

// ============ STEP 8-12: 主迭代循环 ============
function eliminateDeadCode() {
    let count = 0;
    traverse(ast, {
        IfStatement(ifPath) {
            const test = ifPath.node.test;
            let result = evaluateCondition(test);
            if (result !== undefined) {
                if (result) {
                    if (t.isBlockStatement(ifPath.node.consequent)) {
                        ifPath.replaceWithMultiple(ifPath.node.consequent.body);
                    } else {
                        ifPath.replaceWith(ifPath.node.consequent);
                    }
                } else {
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
                count++;
            }
        },
        ConditionalExpression(p) {
            const test = p.node.test;
            let result = evaluateCondition(test);
            if (result !== undefined) {
                p.replaceWith(result ? p.node.consequent : p.node.alternate);
                count++;
            }
        }
    });
    return count;
}

function evaluateCondition(test) {
    if (t.isBinaryExpression(test) && t.isStringLiteral(test.left) && t.isStringLiteral(test.right)) {
        if (test.operator === '===' || test.operator === '==') return test.left.value === test.right.value;
        if (test.operator === '!==' || test.operator === '!=') return test.left.value !== test.right.value;
    }
    if (t.isBinaryExpression(test)) {
        const l = tryEvalNode(test.left), r = tryEvalNode(test.right);
        if (l !== undefined && r !== undefined && typeof l === typeof r) {
            if (test.operator === '===' || test.operator === '==') return l === r;
            if (test.operator === '!==' || test.operator === '!=') return l !== r;
            if (test.operator === '<') return l < r;
            if (test.operator === '>') return l > r;
            if (test.operator === '<=') return l <= r;
            if (test.operator === '>=') return l >= r;
        }
    }
    if (t.isBooleanLiteral(test)) return test.value;
    return undefined;
}

function resolveControlFlow() {
    let resolved = 0;
    traverse(ast, {
        WhileStatement(whilePath) {
            const whileNode = whilePath.node;
            if (!t.isBooleanLiteral(whileNode.test, { value: true })) return;
            const body = whileNode.body;
            if (!t.isBlockStatement(body)) return;
            let switchStmt = null;
            for (const s of body.body) {
                if (t.isSwitchStatement(s)) { switchStmt = s; break; }
            }
            if (!switchStmt) return;
            const disc = switchStmt.discriminant;
            if (!t.isMemberExpression(disc) || !t.isIdentifier(disc.object)) return;
            const arrBinding = whilePath.scope.getBinding(disc.object.name);
            if (!arrBinding || !t.isVariableDeclarator(arrBinding.path.node)) return;
            const arrInit = arrBinding.path.node.init;
            if (!t.isCallExpression(arrInit) || !t.isMemberExpression(arrInit.callee)) return;
            const splitObj = arrInit.callee.object;
            const splitProp = arrInit.callee.property;
            if (!t.isStringLiteral(splitObj)) return;
            if (!(t.isIdentifier(splitProp, { name: 'split' }) || t.isStringLiteral(splitProp, { value: 'split' }))) return;
            if (arrInit.arguments.length !== 1 || !t.isStringLiteral(arrInit.arguments[0], { value: '|' })) return;
            const order = splitObj.value.split('|');
            const caseMap = {};
            for (const c of switchStmt.cases) {
                if (!c.test || !t.isStringLiteral(c.test)) continue;
                caseMap[c.test.value] = c.consequent.filter(s => !t.isContinueStatement(s) && !t.isBreakStatement(s));
            }
            const orderedStmts = [];
            let valid = true;
            for (const idx of order) {
                if (!caseMap[idx]) { valid = false; break; }
                orderedStmts.push(...caseMap[idx]);
            }
            if (valid && orderedStmts.length > 0) {
                whilePath.replaceWithMultiple(orderedStmts);
                resolved++;
            }
        }
    });
    return resolved;
}

console.log('\n--- Step 8: 主迭代循环 (代理→对象→清理) ---');
let deadCode = 0, cfResolved = 0;

for (let masterRound = 0; masterRound < 10; masterRound++) {
    let roundTotal = 0;
    
    // 8a: 再次尝试代理调用替换（对象内联后新暴露的常量参数）
    let proxyR = 0;
    traverse(ast, {
        CallExpression(nodePath) {
            const callee = nodePath.node.callee;
            if (!t.isIdentifier(callee)) return;
            const info = proxyMap.get(callee.name);
            if (!info) return;
            const args = nodePath.node.arguments;
            if (args.length !== info.paramCount) return;
            const oVal = tryEvalNode(args[info.oi]);
            if (oVal === undefined) return;
            const kVal = tryEvalNode(args[info.ki]);
            if (kVal === undefined) return;
            try {
                const decoded = _0x234f(oVal + info.oc, kVal);
                if (typeof decoded === 'string') {
                    nodePath.replaceWith(t.stringLiteral(decoded));
                    proxyR++;
                }
            } catch { }
        }
    });
    totalProxyReplaced += proxyR;
    roundTotal += proxyR;
    
    // 8b: 字符串拼接
    let sc = mergeStringConcat();
    strConcat += sc;
    roundTotal += sc;
    
    // 8c: 常量折叠
    let fc = foldConstants();
    totalFolded += fc;
    roundTotal += fc;
    
    // 8d: 成员表达式清理
    let mc = cleanMemberExpressions();
    memberCleaned += mc;
    roundTotal += mc;
    
    // 8e: 对象内联
    let oi = inlineObjectProxies();
    totalObjInlined += oi;
    roundTotal += oi;
    
    // 8f: 死代码消除
    let dc = eliminateDeadCode();
    deadCode += dc;
    roundTotal += dc;
    
    // 8g: 控制流还原
    let cf = resolveControlFlow();
    cfResolved += cf;
    roundTotal += cf;
    
    console.log(`  迭代 ${masterRound + 1}: 代理=${proxyR} 拼接=${sc} 折叠=${fc} 成员=${mc} 对象=${oi} 死码=${dc} 控流=${cf}`);
    if (roundTotal === 0) break;
}

// ============ STEP 13: 删除代理函数定义 ============
console.log('\n--- Step 13: 清理代理函数定义 ---');
let proxyFuncRemoved = 0;

traverse(ast, {
    FunctionDeclaration(nodePath) {
        if (!nodePath.node.id) return;
        const name = nodePath.node.id.name;
        if (!proxyMap.has(name)) return;
        
        // 检查是否还有引用
        const binding = nodePath.scope.getBinding(name);
        if (binding && binding.referencePaths.length === 0) {
            nodePath.remove();
            proxyFuncRemoved++;
        }
    },
    VariableDeclarator(nodePath) {
        if (!t.isIdentifier(nodePath.node.id)) return;
        const name = nodePath.node.id.name;
        if (!proxyMap.has(name)) return;
        if (!t.isFunctionExpression(nodePath.node.init)) return;

        const binding = nodePath.scope.getBinding(name);
        if (binding && binding.referencePaths.length === 0) {
            nodePath.remove();
            proxyFuncRemoved++;
        }
    }
});
console.log(`✅ ${proxyFuncRemoved} 个代理函数定义已清理`);

// ============ STEP 14: 删除空属性对象 ============
console.log('\n--- Step 14: 清理空对象字典 ---');
let emptyObjRemoved = 0;

// 删除属性全被内联后剩余的空对象
// (需要小心，不能删除仍有引用的对象)

// ============ STEP 15: 残余分析 ============
console.log('\n--- Step 15: 残余分析 ---');
let remaining234f = 0;
traverse(ast, {
    CallExpression(p) {
        if (t.isIdentifier(p.node.callee, { name: '_0x234f' })) remaining234f++;
    }
});
console.log(`  残余 _0x234f 直接调用: ${remaining234f}`);

// 残余代理函数调用
let remainingProxyCall = 0;
traverse(ast, {
    CallExpression(p) {
        if (t.isIdentifier(p.node.callee) && proxyMap.has(p.node.callee.name)) remainingProxyCall++;
    }
});
console.log(`  残余代理函数调用: ${remainingProxyCall}`);

// 残余 _0x 风格的对象字典引用
let remainingObjDict = 0;
traverse(ast, {
    MemberExpression(p) {
        if (t.isIdentifier(p.node.object) && p.node.object.name.startsWith('_0x')) {
            const binding = p.scope.getBinding(p.node.object.name);
            if (binding && t.isVariableDeclarator(binding.path.node) && t.isObjectExpression(binding.path.node.init)) {
                const propCount = binding.path.node.init.properties.length;
                if (propCount > 10) {
                    remainingObjDict++;
                }
            }
        }
    }
});
console.log(`  残余大型对象字典引用: ${remainingObjDict}`);

// ============ STEP 16: 生成代码 ============
console.log('\n--- Step 16: 生成代码 ---');
console.time('codegen');
const output = generate(ast, { comments: false, compact: false });
console.timeEnd('codegen');

const outFile = path.join(__dirname, 'sixyin-music-source-v1.2.1-deep.js');
fs.writeFileSync(outFile, output.code, 'utf-8');
console.log(`💾 ${(output.code.length / 1024).toFixed(1)} KB -> ${outFile}`);

// ============ 统计 ============
console.log('\n========================================');
console.log('📊 深度反混淆 v2 结果');
console.log('========================================');
console.log(`  代理函数收集: ${proxyMap.size}`);
console.log(`  代理调用替换: ${totalProxyReplaced}`);
console.log(`  字符串拼接合并: ${strConcat}`);
console.log(`  常量折叠: ${totalFolded}`);
console.log(`  对象代理内联: ${totalObjInlined}`);
console.log(`  控制流还原: ${cfResolved}`);
console.log(`  死代码消除: ${deadCode}`);
console.log(`  成员表达式清理: ${memberCleaned}`);
console.log(`  代理函数清理: ${proxyFuncRemoved}`);
console.log('========================================');
console.log(`  残余 _0x234f: ${remaining234f}`);
console.log(`  残余代理调用: ${remainingProxyCall}`);
console.log(`  残余对象字典引用: ${remainingObjDict}`);
console.log('✅ 深度反混淆 v2 完成！');
