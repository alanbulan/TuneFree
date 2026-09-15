import { GD_MUSIC_SCRIPT } from './gdMusicScript';

/**
 * 随应用分发的内置音源脚本。
 *
 * 它们与用户导入的洛雪脚本共用同一套沙箱与协议，只是永远存在、不可删除；
 * 平台的解析、歌词、封面、搜索因此全部来自脚本声明，而不是 TS 里的分支。
 */
export interface BuiltinScriptDefinition {
  /** 稳定标识，也是沙箱与 provider id 的一部分。 */
  id: string;
  code: string;
  /** 该脚本产出的 provider 在内置链路中的解析优先级（数字小者优先）。 */
  priority: number;
  /** 歌词优先级：GD 歌词排在原生之后，与既有行为一致。 */
  lyricsPriority: number;
  /** 是否占用 GD 音乐台公开接口频次（界面提示用）。 */
  gdStudioQuota?: boolean;
  /** 歌词和封面是否依赖同一首歌的 musicUrl 调用，默认沿用 LX 脚本行为。 */
  metadataRequiresUrl?: boolean;
}

export const BUILTIN_SCRIPTS: readonly BuiltinScriptDefinition[] = [
  { id: 'builtin:gd', code: GD_MUSIC_SCRIPT, priority: 10, lyricsPriority: 20,
    gdStudioQuota: true, metadataRequiresUrl: false },
];
