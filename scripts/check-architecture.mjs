#!/usr/bin/env node
/**
 * Architecture guard: file-size limits, layering rules and regression budgets.
 * Run via `npm run architecture:check` (chained with check-ipc-contract.mjs).
 */

import { readdirSync, readFileSync } from 'node:fs';
import { extname, join, posix, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

const SOURCE_ROOTS = ['src', 'src-tauri/src', 'app'];
const STYLE_ROOTS = ['app'];
const IGNORED_DIRECTORIES = new Set(['__tests__', 'target', 'generated', 'node_modules', 'out']);

const LINE_LIMITS = { '.tsx': 300, '.ts': 500, '.rs': 500 };
const CSS_LINE_LIMIT = 700;

/**
 * Regression budgets. Every number is "current actual + a small headroom", so a
 * green tree stays green while any meaningful backslide fails the build.
 * 实测基线（2026-07）：!important 3 处、内联 style={{ 13 处、最大 CSS 文件 610 行。
 */
const BUDGETS = {
  cssImportant: 6,
  inlineStyle: 18,
};

const violations = [];

const report = (file, line, message) => {
  violations.push(`${file}${line ? `:${line}` : ''}: ${message}`);
};

const toPosix = (value) => value.split('\\').join('/');

const collect = (directory, extensions) => {
  let entries;
  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries.flatMap((entry) => {
    const fullPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      return IGNORED_DIRECTORIES.has(entry.name) ? [] : collect(fullPath, extensions);
    }
    return extensions.includes(extname(entry.name)) ? [fullPath] : [];
  });
};

const readSources = (roots, extensions) =>
  roots
    .flatMap((directory) => collect(join(root, directory), extensions))
    .map((file) => ({
      path: toPosix(relative(root, file)),
      text: readFileSync(file, 'utf8'),
    }));

const sources = readSources(SOURCE_ROOTS, ['.ts', '.tsx', '.rs']);
const styles = readSources(STYLE_ROOTS, ['.css']);

// ---------------------------------------------------------------- 行数限制

for (const { path, text } of [...sources, ...styles]) {
  const limit = extname(path) === '.css' ? CSS_LINE_LIMIT : LINE_LIMITS[extname(path)];
  if (!limit) continue;
  const lines = text.split(/\r?\n/).length;
  if (lines > limit) {
    report(path, 0, `${lines} 行，超过 ${limit} 行限制，请拆分文件`);
  }
}

// ---------------------------------------------------------------- 导入解析

const MODULE_REFERENCE = /\b(?:import|export)\s+(?:(type)\s+)?(?:[^"';]*?\bfrom\s+)?(["'])([^"']+)\2/g;
const DYNAMIC_IMPORT = /\bimport\s*\(\s*(["'])([^"']+)\1/g;

const lineOf = (text, index) => text.slice(0, index).split('\n').length;

/** Resolve `@/x` and relative specifiers to a repo-relative posix path. */
const resolveSpecifier = (filePath, specifier) => {
  if (specifier.startsWith('@/')) return `src/${specifier.slice(2)}`;
  if (specifier.startsWith('.')) {
    return posix.normalize(posix.join(posix.dirname(filePath), specifier));
  }
  return null;
};

const readImports = ({ path, text }) => {
  const found = [];
  for (const match of text.matchAll(MODULE_REFERENCE)) {
    found.push({
      specifier: match[3],
      typeOnly: Boolean(match[1]),
      line: lineOf(text, match.index),
    });
  }
  for (const match of text.matchAll(DYNAMIC_IMPORT)) {
    found.push({ specifier: match[2], typeOnly: false, line: lineOf(text, match.index) });
  }
  return found.map((item) => ({ ...item, resolved: resolveSpecifier(path, item.specifier) }));
};

// ---------------------------------------------------------------- 分层规则

const featureOf = (path) => /^src\/desktop\/features\/([^/]+)(?:\/|$)/.exec(path ?? '')?.[1] ?? null;

const isReactPackage = (specifier) =>
  specifier === 'react' || specifier === 'react-dom' || /^react(-dom)?\//.test(specifier);

const IMPORT_RULES = [
  {
    scope: (path) => path.startsWith('src/core/'),
    violated: ({ specifier, resolved }) =>
      resolved?.startsWith('src/desktop/') || /(^|\/)desktop\//.test(specifier),
    message: 'src/core/** 不得依赖 src/desktop/，核心层必须独立于桌面壳',
  },
  {
    scope: (path) => path.startsWith('src/core/services/') || path.startsWith('src/core/utils/'),
    violated: ({ specifier, typeOnly }) => isReactPackage(specifier) && !typeOnly,
    message: 'src/core/services/** 与 src/core/utils/** 不得在运行时依赖 react（仅允许 import type）',
  },
  {
    scope: (path) => path.startsWith('src/core/services/') || path.startsWith('src/core/utils/'),
    violated: ({ specifier, resolved }) =>
      /(^|\/)contexts(\/|$)/.test(specifier) || /(^|\/)contexts(\/|$)/.test(resolved ?? ''),
    message: 'src/core/services/** 与 src/core/utils/** 不得依赖 contexts/，状态注入应由调用方完成',
  },
  {
    scope: (path) => !path.startsWith('src/core/ipc/'),
    violated: ({ specifier }) => specifier.startsWith('@tauri-apps/api'),
    message: '只有 src/core/ipc/** 可以直接引用 @tauri-apps/api，其余代码一律走 IPC 门面',
  },
  {
    scope: (path) => featureOf(path) !== null,
    violated: ({ resolved }, path) => {
      const target = featureOf(resolved);
      return target !== null && target !== featureOf(path);
    },
    message: 'src/desktop/features/<A>/** 不得横向依赖另一个 feature，请把共享逻辑上提到 src/core 或 src/desktop/components',
  },
];

for (const source of sources) {
  if (extname(source.path) === '.rs') continue;
  const imports = readImports(source);
  for (const rule of IMPORT_RULES) {
    if (!rule.scope(source.path)) continue;
    for (const item of imports) {
      if (rule.violated(item, source.path)) {
        report(source.path, item.line, `${rule.message}（实际引用 "${item.specifier}"）`);
      }
    }
  }
}

// ---------------------------------------------------------------- 预算断言

const countMatches = (text, pattern) => text.match(pattern)?.length ?? 0;

const importantTotal = styles.reduce(
  (total, { text }) => total + countMatches(text, /!important/g),
  0,
);
if (importantTotal > BUDGETS.cssImportant) {
  report(
    'app/**/*.css',
    0,
    `!important 共 ${importantTotal} 处，超过预算 ${BUDGETS.cssImportant} 处，请改用更精确的选择器或变量`,
  );
}

const inlineStyleTotal = sources
  .filter(({ path }) => path.startsWith('src/'))
  .reduce((total, { text }) => total + countMatches(text, /style=\{\{/g), 0);
if (inlineStyleTotal > BUDGETS.inlineStyle) {
  report(
    'src/**',
    0,
    `内联 style={{ 共 ${inlineStyleTotal} 处，超过预算 ${BUDGETS.inlineStyle} 处，静态样式请沉淀到 CSS 类`,
  );
}

// ---------------------------------------------------------------- 结果输出

if (violations.length > 0) {
  console.error('架构检查未通过：');
  for (const violation of violations) {
    console.error(`  ${violation}`);
  }
  process.exit(1);
}

console.log(
  `架构检查通过（源文件 ${sources.length}、样式 ${styles.length}、` +
    `!important ${importantTotal}/${BUDGETS.cssImportant}、` +
    `内联样式 ${inlineStyleTotal}/${BUDGETS.inlineStyle}）`,
);
