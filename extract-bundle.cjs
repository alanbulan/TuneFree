const fs = require('fs');
const path = require('path');
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;
const generate = require('@babel/generator').default;
const t = require('@babel/types');

const source = fs.readFileSync(path.join(__dirname, 'sixyin-music-source-smart.js'), 'utf-8');
const ast = parser.parse(source, { sourceType: 'script', plugins: ['bigInt'] });

let targetNode = null;
traverse(ast, {
    ExpressionStatement(p) {
        if (targetNode) return;
        
        let expr = p.node.expression;
        if (t.isSequenceExpression(expr)) {
            expr = expr.expressions[expr.expressions.length - 1];
        }
        
        if (t.isCallExpression(expr) && (t.isArrowFunctionExpression(expr.callee) || t.isFunctionExpression(expr.callee))) {
            let isWebpack = false;
            if (t.isBlockStatement(expr.callee.body)) {
                for (const stmt of expr.callee.body.body) {
                    if (t.isVariableDeclaration(stmt)) {
                        for (const decl of stmt.declarations) {
                            if (t.isObjectExpression(decl.init)) {
                                if (decl.init.properties.some(prop => t.isNumericLiteral(prop.key) && prop.key.value === 124)) {
                                    isWebpack = true;
                                }
                            }
                        }
                    }
                }
            }
            if (isWebpack) {
                targetNode = expr;
            }
        }
    }
});

if (targetNode) {
    ast.program.body = [t.expressionStatement(targetNode)];
}

// Deobfuscate some common properties and arguments to make it cleaner
traverse(ast, {
    Identifier(p) {
        if (p.node.name === '_0x376ee0') p.node.name = '__webpack_require__';
        if (p.node.name === '_0x304177') p.node.name = '__webpack_modules__';
    }
});

const output = generate(ast, { comments: false });
fs.writeFileSync(path.join(__dirname, 'sixyin-music-source-clean.js'), output.code, 'utf-8');
console.log('Cleaned code saved to sixyin-music-source-clean.js');
