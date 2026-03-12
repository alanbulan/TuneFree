const fs = require('fs');
const path = require('path');
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;
const generate = require('@babel/generator').default;

const source = fs.readFileSync(path.join(__dirname, 'sixyin-music-source-clean.js'), 'utf-8');
const ast = parser.parse(source, { sourceType: 'script', plugins: ['bigInt'] });

let varCounter = 1;
const nameMap = new Map();

function getNewName(oldName) {
    if (!oldName.startsWith('_0x')) return oldName;
    if (!nameMap.has(oldName)) {
        nameMap.set(oldName, 'v' + varCounter++);
    }
    return nameMap.get(oldName);
}

traverse(ast, {
    Identifier(p) {
        if (p.node.name.startsWith('_0x')) {
            p.node.name = getNewName(p.node.name);
        }
    }
});

const output = generate(ast, { comments: false });
fs.writeFileSync(path.join(__dirname, 'sixyin-music-source-human.js'), output.code, 'utf-8');
console.log('Renamed identifiers, saved to sixyin-music-source-human.js');
