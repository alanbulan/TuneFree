const fs = require('fs');
const path = require('path');
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;
const generate = require('@babel/generator').default;
const t = require('@babel/types');

const source = fs.readFileSync(path.join(__dirname, 'sixyin-music-source-human.js'), 'utf-8');
const ast = parser.parse(source, { sourceType: 'script', plugins: ['bigInt'] });

let changed = true;
while (changed) {
    changed = false;
    
    // Separate comma expressions
    traverse(ast, {
        ExpressionStatement(p) {
            if (t.isSequenceExpression(p.node.expression)) {
                const exprs = p.node.expression.expressions;
                p.replaceWithMultiple(exprs.map(e => t.expressionStatement(e)));
                changed = true;
            }
        },
        VariableDeclaration(p) {
            if (p.node.declarations.length > 1) {
                const decs = p.node.declarations.map(d => t.variableDeclaration(p.node.kind, [d]));
                p.replaceWithMultiple(decs);
                changed = true;
            }
        }
    });

    // Inline object assignments
    // e.g. const v73 = {}; v73.from = ...;
    const objMap = new Map();
    traverse(ast, {
        VariableDeclarator(p) {
            if (t.isIdentifier(p.node.id) && t.isObjectExpression(p.node.init)) {
                objMap.set(p.node.id.name, { path: p, props: new Map() });
            }
        },
        AssignmentExpression(p) {
            if (t.isMemberExpression(p.node.left) && t.isIdentifier(p.node.left.object)) {
                const objName = p.node.left.object.name;
                if (objMap.has(objName)) {
                    let propName = null;
                    if (t.isIdentifier(p.node.left.property)) propName = p.node.left.property.name;
                    else if (t.isStringLiteral(p.node.left.property)) propName = p.node.left.property.value;
                    
                    if (propName) {
                        const objInfo = objMap.get(objName);
                        objInfo.props.set(propName, p.node.right);
                        
                        // remove assignment
                        if (t.isExpressionStatement(p.parent)) {
                            p.parentPath.remove();
                            changed = true;
                        } else if (t.isSequenceExpression(p.parent)) {
                            p.remove();
                            changed = true;
                        }
                    }
                }
            }
        }
    });
    
    // reconstruct objects
    for (const [objName, info] of objMap.entries()) {
        if (info.props.size > 0) {
            const properties = [];
            
            // keep existing
            for (const prop of info.path.node.init.properties) {
                properties.push(prop);
            }
            
            for (const [key, val] of info.props.entries()) {
                let existing = properties.find(p => (t.isIdentifier(p.key) && p.key.name === key) || (t.isStringLiteral(p.key) && p.key.value === key));
                if (!existing) {
                    properties.push(t.objectProperty(t.identifier(key), val));
                }
            }
            info.path.node.init.properties = properties;
            info.props.clear();
        }
    }

    // Inline variables initialized with another variable
    // const v76 = v75; -> replace v76 with v75
    const renameMap = new Map();
    traverse(ast, {
        VariableDeclarator(p) {
            if (t.isIdentifier(p.node.id) && t.isIdentifier(p.node.init)) {
                renameMap.set(p.node.id.name, p.node.init.name);
                p.remove();
                changed = true;
            }
        }
    });
    if (renameMap.size > 0) {
        traverse(ast, {
            Identifier(p) {
                if (renameMap.has(p.node.name) && p.parent.type !== 'VariableDeclarator') {
                    p.node.name = renameMap.get(p.node.name);
                    changed = true;
                }
            }
        });
    }
}

// Global semantic renaming for popular LX Music API paths
traverse(ast, {
    Identifier(p) {
        if (p.node.name === 'v71') p.node.name = 'lxUtils';
        if (p.node.name === 'v65') p.node.name = 'EVENT_NAMES';
        if (p.node.name === 'v66') p.node.name = 'lxOn';
        if (p.node.name === 'v67') p.node.name = 'lxSend';
        if (p.node.name === 'v68') p.node.name = 'lxEnv';
        if (p.node.name === 'v69') p.node.name = 'lxScriptInfo';
        if (p.node.name === 'v70') p.node.name = 'lxRequest';
        if (p.node.name === 'v72') p.node.name = 'lxVersion';
        if (p.node.name === 'v75') p.node.name = 'lxHelper';
        if (p.node.name === 'v77') p.node.name = 'requestWithTimeout';
        if (p.node.name === 'v83') p.node.name = 'aesEncryptHex';
        if (p.node.name === 'v90') p.node.name = 'md5Hex';
        if (p.node.name === 'v92') p.node.name = 'generateWycheckToken';
        if (p.node.name === 'v97') p.node.name = 'fetchFromItooiAPI';
        if (p.node.name === 'v109') p.node.name = 'verifyClientVersion';
        if (p.node.name === 'v119') p.node.name = 'USER_AGENTS';
        if (p.node.name === 'v120') p.node.name = 'getRandomUserAgent';
        if (p.node.name === 'v123') p.node.name = 'parseScriptMetadata';
        if (p.node.name === 'v131') p.node.name = 'kuwoCryptoAlgorithm';
        if (p.node.name === 'v133') p.node.name = 'KuwoLogic';
        if (p.node.name === 'v152') p.node.name = 'KugouLogic';
        if (p.node.name === 'v170') p.node.name = 'TencentLogic';
        if (p.node.name === 'v186') p.node.name = 'encryptNeteaseParams';
        if (p.node.name === 'v195') p.node.name = 'NeteaseLogic';
        if (p.node.name === 'v213') p.node.name = 'MiguLogic';
        if (p.node.name === 'v224') p.node.name = 'MusicSources';
    }
});


const output = generate(ast, { comments: false });
fs.writeFileSync(path.join(__dirname, 'sixyin-music-source-beautified.js'), output.code, 'utf-8');
console.log('Beautified code saved to sixyin-music-source-beautified.js');
