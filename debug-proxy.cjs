const fs = require('fs');
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;
const generate = require('@babel/generator').default;
const t = require('@babel/types');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, 'sixyin-music-source-smart.js'), 'utf-8');
const ast = parser.parse(source, { sourceType: 'script', plugins: ['bigInt'] });

let inlined = 0;
traverse(ast, {
    VariableDeclarator(vdPath) {
        if (!t.isObjectExpression(vdPath.node.init) || !t.isIdentifier(vdPath.node.id)) return;
        const objName = vdPath.node.id.name;
        if (objName !== '_0x4cd356' && objName !== '_0x47d913') return;
        
        console.log(`Found object ${objName}`);
        const binding = vdPath.scope.getBinding(objName);
        console.log(`Binding for ${objName}: ${!!binding}`);
        if (!binding) return;
        console.log(`References: ${binding.referencePaths.length}`);

        const props = {};
        for (const prop of vdPath.node.init.properties) {
            if (!t.isObjectProperty(prop)) continue;
            const key = t.isStringLiteral(prop.key) ? prop.key.value : (!prop.computed && t.isIdentifier(prop.key)) ? prop.key.name : null;
            if (!key) continue;

            if (t.isStringLiteral(prop.value)) props[key] = { type: 'str', val: prop.value.value };
            else if (t.isNumericLiteral(prop.value)) props[key] = { type: 'num', val: prop.value.value };
            else if (t.isBooleanLiteral(prop.value)) props[key] = { type: 'bool', val: prop.value.value };
            else if ((t.isFunctionExpression(prop.value) || t.isArrowFunctionExpression(prop.value)) && t.isBlockStatement(prop.value.body) && prop.value.body.body.length === 1 && t.isReturnStatement(prop.value.body.body[0])) {
                const ret = prop.value.body.body[0].argument;
                const pNames = prop.value.params.map(p => p.name);
                if (t.isBinaryExpression(ret) && pNames.length === 2 && t.isIdentifier(ret.left, { name: pNames[0] }) && t.isIdentifier(ret.right, { name: pNames[1] })) {
                    props[key] = { type: 'binop', op: ret.operator };
                } else if (t.isLogicalExpression(ret) && pNames.length === 2 && t.isIdentifier(ret.left, { name: pNames[0] }) && t.isIdentifier(ret.right, { name: pNames[1] })) {
                    props[key] = { type: 'logop', op: ret.operator };
                } else if (t.isCallExpression(ret) && t.isIdentifier(ret.callee) && pNames.length >= 1 && ret.callee.name === pNames[0]) {
                    const allArgsMatch = ret.arguments.every((arg, i) => t.isIdentifier(arg, { name: pNames[i + 1] }));
                    if (allArgsMatch && ret.arguments.length === pNames.length - 1) {
                        props[key] = { type: 'call', argCount: pNames.length - 1 };
                    }
                } else if (t.isCallExpression(ret) && t.isIdentifier(ret.callee) && !pNames.includes(ret.callee.name)) {
                    const allArgsMatch = ret.arguments.every((arg, i) => t.isIdentifier(arg, { name: pNames[i] }));
                    if (allArgsMatch && ret.arguments.length === pNames.length) {
                         props[key] = { type: 'call_external', target: ret.callee.name };
                    }
                } else {
                    console.log(`Unsupported return expression type for ${key}: ${ret.type}`);
                }
            } else {
                 if (t.isFunctionExpression(prop.value) || t.isArrowFunctionExpression(prop.value)) {
                      console.log(`Function not simple enough for ${key}: body length ${prop.value.body.body?.length}`);
                 }
            }
        }
        console.log(`Keys extracted: ${Object.keys(props).length}`);
        
        for (const ref of binding.referencePaths) {
            const memExpr = ref.parent;
            if (!t.isMemberExpression(memExpr) || memExpr.object !== ref.node) continue;
            const propKey = t.isStringLiteral(memExpr.property) ? memExpr.property.value : (!memExpr.computed && t.isIdentifier(memExpr.property)) ? memExpr.property.name : null;
            if (!propKey || !props[propKey]) {
                console.log(`Unknown key: ${propKey}`);
                continue;
            }

            const pi = props[propKey];
            const gp = ref.parentPath;
            
            try {
                if (pi.type === 'str') {
                    if (!(t.isCallExpression(gp.parent) && gp.parent.callee === memExpr)) {
                        gp.replaceWith(t.stringLiteral(pi.val)); inlined++;
                    }
                } else if (pi.type === 'binop' && t.isCallExpression(gp.parent) && gp.parent.callee === memExpr && gp.parent.arguments.length === 2) {
                    gp.parentPath.replaceWith(t.binaryExpression(pi.op, gp.parent.arguments[0], gp.parent.arguments[1]));
                    inlined++;
                }
            } catch (e) { console.error(e) }
        }
    }
});

console.log(`Total inlined: ${inlined}`);
