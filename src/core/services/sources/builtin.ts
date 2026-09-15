import { nativeProvider } from './nativeProvider';
import { platformSearchProvider } from './platformSearchProvider';
/**
 * 内置 provider 清单。
 *
 * 注册顺序即搜索页平台选项的展示顺序（netease/qq/kuwo → kugou/migu）；
 * 解析与歌词的先后由各 provider 的 `priority` / `lyricsPriority` 决定。
 *
 * GD 音乐台已改写成内置脚本（`builtin/gdMusicScript.ts`），它的 provider 由
 * 音源管理器在启动时注册（`setBuiltinScriptProviders`），不在这个静态清单里。
 */
export const BUILTIN_PROVIDERS = [nativeProvider, platformSearchProvider];
