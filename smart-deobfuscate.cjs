const fs = require('fs');
const path = require('path');
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;
const generate = require('@babel/generator').default;
const t = require('@babel/types');

const encryptFile = path.join(__dirname, 'sixyin-music-source-v1.2.1-encrypt.js');
const origSource = fs.readFileSync(encryptFile, 'utf-8');

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

const decodedFile = path.join(__dirname, 'sixyin-music-source-v1.2.1-decoded.js');
let source = fs.readFileSync(decodedFile, 'utf-8');
let ast = parser.parse(source, { sourceType: 'script', plugins: ['bigInt'] });

const proxyMap = new Map();
function isPossibleProxy(name) {
    return name && (name.startsWith('_0x') || name.length <= 4 || name === '_0x234f');
}

traverse(ast, {
    FunctionDeclaration(p) {
        if (!p.node.id || !isPossibleProxy(p.node.id.name)) return;
        checkAndAddProxy(p.node.id.name, p.node);
    },
    VariableDeclarator(p) {
        if (!t.isIdentifier(p.node.id) || !isPossibleProxy(p.node.id.name)) return;
        if (t.isFunctionExpression(p.node.init) || t.isArrowFunctionExpression(p.node.init)) {
            checkAndAddProxy(p.node.id.name, p.node.init);
        }
    }
});

function checkAndAddProxy(name, fnNode) {
    if (!t.isBlockStatement(fnNode.body)) return;
    if (fnNode.body.body.length !== 1) return;
    const stmt = fnNode.body.body[0];
    if (!t.isReturnStatement(stmt)) return;
    let expr = stmt.argument;
    if (t.isSequenceExpression(expr)) expr = expr.expressions[expr.expressions.length - 1];
    if (!t.isCallExpression(expr)) return;
    if (!t.isIdentifier(expr.callee)) return;
    if (!isPossibleProxy(expr.callee.name)) return;
    proxyMap.set(name, {
        params: fnNode.params.map(p => p.name || ''),
        returnCall: expr
    });
}

function evalExpr(node, params, argValues) {
    if (t.isNumericLiteral(node)) return node.value;
    if (t.isStringLiteral(node)) return node.value;
    if (t.isUnaryExpression(node, {operator: '-'}) && t.isNumericLiteral(node.argument)) return -node.argument.value;
    if (t.isIdentifier(node)) {
        const idx = params.indexOf(node.name);
        if (idx !== -1) return argValues[idx];
    }
    if (t.isBinaryExpression(node)) {
        const l = evalExpr(node.left, params, argValues);
        const r = evalExpr(node.right, params, argValues);
        if (l !== undefined && r !== undefined) {
             switch (node.operator) {
                 case '+': return l + r; case '-': return l - r;
                 case '*': return l * r; case '/': return l / r;
                 case '|': return l | r; case '&': return l & r;
                 case '^': return l ^ r;
             }
        }
    }
    return undefined;
}

function resolveProxyCall(name, argValues, depth = 0) {
    if (depth > 50) return undefined;
    if (name === '_0x234f') {
        try { return _0x234f(argValues[0], argValues[1]); } catch (e) { return undefined; }
    }
    const fnDef = proxyMap.get(name);
    if (!fnDef) return undefined;
    const nextArgValues = fnDef.returnCall.arguments.map(argNode => evalExpr(argNode, fnDef.params, argValues));
    if (nextArgValues.includes(undefined)) return undefined;
    return resolveProxyCall(fnDef.returnCall.callee.name, nextArgValues, depth + 1);
}

traverse(ast, {
    CallExpression(p) {
        if (!t.isIdentifier(p.node.callee)) return;
        const calleeName = p.node.callee.name;
        if (calleeName === '_0x234f' || proxyMap.has(calleeName)) {
            const argValues = p.node.arguments.map(argNode => evalExpr(argNode, [], []));
            if (!argValues.includes(undefined)) {
                const res = resolveProxyCall(calleeName, argValues);
                if (typeof res === 'string') p.replaceWith(t.stringLiteral(res));
            }
        }
    }
});

traverse(ast, {
    FunctionDeclaration(p) { if (p.node.id && proxyMap.has(p.node.id.name)) p.remove(); },
    VariableDeclarator(p) { if (t.isIdentifier(p.node.id) && proxyMap.has(p.node.id.name)) p.remove(); }
});

source = generate(ast, { comments: false }).code;
ast = parser.parse(source, { sourceType: 'script', plugins: ['bigInt'] });

let anyChanged = true;
while (anyChanged) {
    anyChanged = false;

    // String concat
    traverse(ast, {
        BinaryExpression(p) {
            if (p.node.operator !== '+') return;
            const evalStringConcat = (node) => {
                if (t.isStringLiteral(node)) return node.value;
                if (t.isBinaryExpression(node, { operator: '+' })) {
                    const l = evalStringConcat(node.left), r = evalStringConcat(node.right);
                    if (l !== null && r !== null) return l + r;
                }
                return null;
            };
            const val = evalStringConcat(p.node);
            if (val !== null) { p.replaceWith(t.stringLiteral(val)); anyChanged = true; }
        }
    });

    // Strip empty statments
    traverse(ast, { EmptyStatement(p) { p.remove(); } });

    // Object Proxy Inline
    traverse(ast, {
        VariableDeclarator(vdPath) {
            if (!t.isObjectExpression(vdPath.node.init) || !t.isIdentifier(vdPath.node.id)) return;
            const objName = vdPath.node.id.name;
            const props = {};
            for (const prop of vdPath.node.init.properties) {
                if (!t.isObjectProperty(prop)) continue;
                const key = t.isStringLiteral(prop.key) ? prop.key.value : (!prop.computed && t.isIdentifier(prop.key)) ? prop.key.name : null;
                if (!key) continue;

                if (t.isStringLiteral(prop.value)) props[key] = { type: 'str', val: prop.value.value };
                else if (t.isNumericLiteral(prop.value)) props[key] = { type: 'num', val: prop.value.value };
                else if (t.isBooleanLiteral(prop.value)) props[key] = { type: 'bool', val: prop.value.value };
                else if ((t.isFunctionExpression(prop.value) || t.isArrowFunctionExpression(prop.value)) && t.isBlockStatement(prop.value.body)) {
                    let retStmts = prop.value.body.body.filter(s => t.isReturnStatement(s));
                    let otherStmts = prop.value.body.body.filter(s => !t.isReturnStatement(s) && !t.isFunctionDeclaration(s) && !t.isEmptyStatement(s));
                    if (retStmts.length === 1 && otherStmts.length === 0) {
                        const ret = retStmts[0].argument;
                        const pNames = prop.value.params.map(p => p.name);
                        if (t.isBinaryExpression(ret) && pNames.length === 2 && t.isIdentifier(ret.left, { name: pNames[0] }) && t.isIdentifier(ret.right, { name: pNames[1] })) props[key] = { type: 'binop', op: ret.operator };
                        else if (t.isLogicalExpression(ret) && pNames.length === 2 && t.isIdentifier(ret.left, { name: pNames[0] }) && t.isIdentifier(ret.right, { name: pNames[1] })) props[key] = { type: 'logop', op: ret.operator };
                        else if (t.isCallExpression(ret) && t.isIdentifier(ret.callee) && pNames.length >= 1 && ret.callee.name === pNames[0]) {
                            const allArgsMatch = ret.arguments.every((arg, i) => t.isIdentifier(arg, { name: pNames[i + 1] }));
                            if (allArgsMatch && ret.arguments.length === pNames.length - 1) props[key] = { type: 'call', argCount: pNames.length - 1 };
                        } else if (t.isCallExpression(ret) && t.isIdentifier(ret.callee) && !pNames.includes(ret.callee.name)) {
                            const allArgsMatch = ret.arguments.every((arg, i) => t.isIdentifier(arg, { name: pNames[i] }));
                            if (allArgsMatch && ret.arguments.length === pNames.length) props[key] = { type: 'call_external', target: ret.callee.name };
                        }
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
                    const propKey = t.isStringLiteral(memExpr.property) ? memExpr.property.value : (!memExpr.computed && t.isIdentifier(memExpr.property)) ? memExpr.property.name : null;
                    if (!propKey || !props[propKey]) continue;

                    const pi = props[propKey];
                    const gp = ref.parentPath;
                    if (pi.type === 'str') {
                        if (!(t.isCallExpression(gp.parent) && gp.parent.callee === memExpr)) {
                            gp.replaceWith(t.stringLiteral(pi.val)); anyChanged = true;
                        }
                    } else if (pi.type === 'num') {
                        if (!(t.isCallExpression(gp.parent) && gp.parent.callee === memExpr)) {
                            gp.replaceWith(t.numericLiteral(pi.val)); anyChanged = true;
                        }
                    } else if (pi.type === 'bool') {
                        if (!(t.isCallExpression(gp.parent) && gp.parent.callee === memExpr)) {
                            gp.replaceWith(t.booleanLiteral(pi.val)); anyChanged = true;
                        }
                    } else if (pi.type === 'binop' && t.isCallExpression(gp.parent) && gp.parent.callee === memExpr && gp.parent.arguments.length === 2) {
                        gp.parentPath.replaceWith(t.binaryExpression(pi.op, gp.parent.arguments[0], gp.parent.arguments[1])); anyChanged = true;
                    } else if (pi.type === 'logop' && t.isCallExpression(gp.parent) && gp.parent.callee === memExpr && gp.parent.arguments.length === 2) {
                        gp.parentPath.replaceWith(t.logicalExpression(pi.op, gp.parent.arguments[0], gp.parent.arguments[1])); anyChanged = true;
                    } else if (pi.type === 'call' && t.isCallExpression(gp.parent) && gp.parent.callee === memExpr && gp.parent.arguments.length >= 1) {
                        const [fn, ...rest] = gp.parent.arguments;
                        gp.parentPath.replaceWith(t.callExpression(fn, rest)); anyChanged = true;
                    } else if (pi.type === 'call_external' && t.isCallExpression(gp.parent) && gp.parent.callee === memExpr) {
                         gp.parentPath.replaceWith(t.callExpression(t.identifier(pi.target), gp.parent.arguments)); anyChanged = true;
                    }
                } catch { }
            }
        }
    });

    // CFG
    traverse(ast, {
        WhileStatement(whilePath) {
            const whileNode = whilePath.node;
            if (!t.isBooleanLiteral(whileNode.test, { value: true })) return;
            const body = whileNode.body;
            if (!t.isBlockStatement(body)) return;
            let switchStmt = null;
            for (const s of body.body) { if (t.isSwitchStatement(s)) { switchStmt = s; break; } }
            if (!switchStmt) return;
            const disc = switchStmt.discriminant;
            if (!t.isMemberExpression(disc)) return;
            const arrId = disc.object;
            if (!t.isIdentifier(arrId)) return;
            const arrBinding = whilePath.scope.getBinding(arrId.name);
            if (!arrBinding || !t.isVariableDeclarator(arrBinding.path.node)) return;
            const arrInit = arrBinding.path.node.init;
            if (!t.isCallExpression(arrInit)) return;
            if (!t.isMemberExpression(arrInit.callee)) return;
            const splitObj = arrInit.callee.object;
            if (!t.isStringLiteral(splitObj)) return;
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
                anyChanged = true;
            }
        }
    });
    
    // Unused member / IF
    traverse(ast, {
        MemberExpression(p) {
            if (p.node.computed && t.isStringLiteral(p.node.property)) {
                const name = p.node.property.value;
                if (/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(name) && !['default', 'throw', 'catch', 'finally', 'try', 'var', 'let', 'const', 'while', 'for', 'if', 'else', 'return', 'function', 'class'].includes(name)) {
                    p.node.computed = false;
                    p.node.property = t.identifier(name);
                    anyChanged = true;
                }
            }
        },
        IfStatement(ifPath) {
            const test = ifPath.node.test;
            if (t.isBinaryExpression(test) && t.isStringLiteral(test.left) && t.isStringLiteral(test.right)) {
                let result;
                if (test.operator === '===' || test.operator === '==') result = test.left.value === test.right.value;
                else if (test.operator === '!==' || test.operator === '!=') result = test.left.value !== test.right.value;
                if (result !== undefined) {
                    if (result) {
                        if (t.isBlockStatement(ifPath.node.consequent)) ifPath.replaceWithMultiple(ifPath.node.consequent.body);
                        else ifPath.replaceWith(ifPath.node.consequent);
                    } else {
                        if (ifPath.node.alternate) {
                            if (t.isBlockStatement(ifPath.node.alternate)) ifPath.replaceWithMultiple(ifPath.node.alternate.body);
                            else ifPath.replaceWith(ifPath.node.alternate);
                        } else {
                            ifPath.remove();
                        }
                    }
                    anyChanged = true;
                }
            }
        },
        ConditionalExpression(p) {
            const test = p.node.test;
            if (t.isBinaryExpression(test) && t.isStringLiteral(test.left) && t.isStringLiteral(test.right)) {
                let result;
                if (test.operator === '===' || test.operator === '==') result = test.left.value === test.right.value;
                else if (test.operator === '!==' || test.operator === '!=') result = test.left.value !== test.right.value;
                if (result !== undefined) {
                    if (result) p.replaceWith(p.node.consequent);
                    else p.replaceWith(p.node.alternate);
                    anyChanged = true;
                }
            }
        }
    });

    if (anyChanged) {
       source = generate(ast, { comments: false }).code;
       ast = parser.parse(source, { sourceType: 'script', plugins: ['bigInt'] });
    }
}

// Final pass removing now definitely unused proxy dictionaries (like _0x4cd356)
traverse(ast, {
    VariableDeclarator(vdPath) {
        if (!t.isObjectExpression(vdPath.node.init) || !t.isIdentifier(vdPath.node.id)) return;
        const objName = vdPath.node.id.name;
        const binding = vdPath.scope.getBinding(objName);
        if (binding && binding.referencePaths.length === 0) {
            vdPath.remove();
        }
    }
});

const output = generate(ast, { comments: false });
fs.writeFileSync(path.join(__dirname, 'sixyin-music-source-smart.js'), output.code, 'utf-8');
console.log('Saved to sixyin-music-source-smart.js');
