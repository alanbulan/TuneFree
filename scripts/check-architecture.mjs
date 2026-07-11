import { readdirSync, readFileSync } from 'node:fs';
import { extname, join, relative } from 'node:path';

const root = new URL('..', import.meta.url).pathname.replace(/^\/(.:)/, '$1');
const sourceRoots = ['src', 'src-tauri/src'];
const ignoredParts = new Set(['__tests__', 'target', 'generated']);

function collect(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      return ignoredParts.has(entry.name) ? [] : collect(fullPath);
    }
    return ['.rs', '.ts', '.tsx'].includes(extname(entry.name)) ? [fullPath] : [];
  });
}

const violations = sourceRoots
  .flatMap((directory) => collect(join(root, directory)))
  .map((file) => {
    const lines = readFileSync(file, 'utf8').split(/\r?\n/).length;
    const limit = extname(file) === '.tsx' ? 300 : 500;
    return { file: relative(root, file), lines, limit };
  })
  .filter(({ lines, limit }) => lines > limit);

if (violations.length > 0) {
  for (const { file, lines, limit } of violations) {
    console.error(`${file}: ${lines} 行，超过 ${limit} 行限制`);
  }
  process.exit(1);
}

console.log('架构行数检查通过');
