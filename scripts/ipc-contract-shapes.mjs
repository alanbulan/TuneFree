/** 检查项目当前使用的 IPC 签名语法；遇到无法解析的声明直接失败。 */
const compact = (value) => value.replace(/\s/g, '');
const camel = (value) => value.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
const canonical = (value) => splitTopLevel(compact(value), '|').sort().join('|');

export function splitTopLevel(text, separator) {
  const result = [];
  let start = 0;
  let depth = 0;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if ('{([<'.includes(character)) depth += 1;
    else if ('})]>'.includes(character)) depth -= 1;
    else if (character === separator && depth === 0) {
      result.push(text.slice(start, index).trim());
      start = index + 1;
    }
  }
  if (depth !== 0) throw new Error('IPC 类型声明括号不匹配');
  result.push(text.slice(start).trim());
  return result.filter(Boolean);
}

export function balanced(text, openIndex, open = '{', close = '}') {
  let depth = 0;
  for (let index = openIndex; index < text.length; index += 1) {
    if (text[index] === open) depth += 1;
    else if (text[index] === close && --depth === 0) return text.slice(openIndex + 1, index);
  }
  throw new Error('IPC 声明未闭合');
}

const interfaceBody = (text, name) => {
  const match = new RegExp(`export\\s+interface\\s+${name}\\s*\\{`).exec(text);
  if (!match) throw new Error(`找不到前端接口 ${name}`);
  return balanced(text, match.index + match[0].length - 1);
};

const tsFields = (body) => new Map(splitTopLevel(body, ';').map((field) => {
  const match = /^(\w+)(\?)?\s*:\s*([\s\S]+)$/.exec(field);
  if (!match) throw new Error(`无法解析 TypeScript 字段: ${field}`);
  return [match[1], { type: canonical(match[3]), optional: !!match[2] }];
}));

const aliases = { RecSong: 'Song', DownloadedFile: 'DownloadedFileResult', DownloadMetaEntry: 'OfflineDownloadMeta' };
const rustType = (raw, context) => {
  const value = compact(raw);
  const generic = /^(Option|Vec|CommandResult)<(.+)>$/.exec(value);
  if (generic) {
    const inner = rustType(generic[2], context);
    if (generic[1] === 'Option') return canonical(`${inner}|null`);
    if (generic[1] === 'Vec') return `${inner}[]`;
    return inner;
  }
  if (value === '()') return 'void';
  if (value === 'String') return 'string';
  if (value === 'bool') return 'boolean';
  if (/^(u|i|f)(8|16|32|64|128|size)$/.test(value)) return 'number';
  // 下载记录保留完整 Song JSON（含离线歌词），身份由 Rust validate() 验证。
  if (value === 'serde_json::Value') return context.endsWith('.song') ? 'Song' : 'unknown';
  if (!/^\w+$/.test(value)) throw new Error(`无法解析 Rust IPC 类型: ${raw}`);
  return aliases[value] ?? value;
};

function compareFields(front, back, direction, context) {
  if ([...front.keys()].sort().join(',') !== [...back.keys()].sort().join(',')) {
    throw new Error(`${context} 字段不一致: TS [${[...front.keys()]}], Rust [${[...back.keys()]}]`);
  }
  for (const [name, field] of front) {
    const expected = back.get(name);
    const compatibleType = field.type === expected.type || (direction === 'input' && expected.optional &&
      (field.type === expected.type.replace(/(^|\|)null(?=\||$)/, '').replace(/^\||\|$/g, '') || field.type === 'unknown'));
    if (!compatibleType || (direction === 'input' && field.optional && !expected.optional)) {
      throw new Error(`${context}.${name} 不一致: TS ${field.type}${field.optional ? '?' : ''}, Rust ${expected.type}`);
    }
  }
}

export function checkCommandShapes(rustSource, commandSource, typeSource, names) {
  const commands = tsFields(interfaceBody(commandSource, 'CommandMap'));
  for (const name of names) {
    const match = new RegExp(`\\bfn\\s+${name}\\s*\\(`).exec(rustSource);
    if (!match) throw new Error(`找不到 Rust 命令实现 ${name}`);
    const open = match.index + match[0].length - 1;
    const parameters = balanced(rustSource, open, '(', ')');
    const returnMatch = /^\s*->\s*([^{}]+)\{/.exec(rustSource.slice(open + parameters.length + 2));
    if (!returnMatch) throw new Error(`无法解析命令返回类型 ${name}`);
    const args = new Map();
    for (const parameter of splitTopLevel(parameters, ',')) {
      const field = /^(\w+)\s*:\s*(.+)$/s.exec(parameter);
      if (!field) throw new Error(`无法解析命令参数 ${name}: ${parameter}`);
      const type = compact(field[2]);
      if (/^(tauri::)?(State<|AppHandle$|WebviewWindow$)/.test(type)) continue;
      args.set(camel(field[1]), { type: rustType(type, `${name}.${field[1]}`), optional: type.startsWith('Option<') });
    }
    const front = tsFields(commands.get(name).type.slice(1, -1));
    const frontArgs = front.get('args').type;
    compareFields(frontArgs === 'void' ? new Map() : tsFields(frontArgs.slice(1, -1)), args, 'input', name);
    if (front.get('result').type !== rustType(returnMatch[1], `${name}.result`)) {
      throw new Error(`${name} 返回类型不一致: TS ${front.get('result').type}, Rust ${returnMatch[1].trim()}`);
    }
  }

  const models = [
    ['DownloadMetadataInput', 'input'], ['DownloadedFile', 'output'],
    ['DownloadMetaEntry', 'output'], ['ResolvedPlayback', 'output'],
    ['RecommendationJob', 'output'], ['LibrarySnapshot', 'input'], ['LibraryDelta', 'input'],
    ['LlmConfigInput', 'input'], ['LlmConfigView', 'output'], ['LocalServerInfo', 'output'],
  ];
  for (const [name, direction] of models) {
    const match = new RegExp(`((?:#\\[[^\\]]+\\]\\s*)+)(?:pub(?:\\([^)]*\\))?\\s+)?struct\\s+${name}\\s*\\{`).exec(rustSource);
    if (!match) throw new Error(`找不到 Rust 数据结构 ${name}`);
    const useCamel = match[1].includes('rename_all = "camelCase"');
    const body = balanced(rustSource, match.index + match[0].length - 1);
    const fields = new Map(splitTopLevel(body, ',').map((field) => {
      const optional = /#\[serde\([^\]]*default/.test(field);
      const clean = field.replace(/#\[[^\]]+\]/g, '').trim();
      const parsed = /^(?:pub(?:\([^)]*\))?\s+)?(\w+)\s*:\s*(.+)$/s.exec(clean);
      if (!parsed) throw new Error(`无法解析 ${name}: ${field}`);
      const key = useCamel ? camel(parsed[1]) : parsed[1];
      return [key, { type: rustType(parsed[2], `${name}.${key}`), optional: optional || compact(parsed[2]).startsWith('Option<') }];
    }));
    compareFields(tsFields(interfaceBody(typeSource, aliases[name] ?? name)), fields, direction, name);
  }
  return models.length;
}
