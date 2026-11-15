# 平台账号：开源参考与许可

核对日期：2026-11-15。引用使用固定 Git 提交，通过 GitHub API 核对提交和仓库 LICENSE。TuneFree 在原生 Rust 层适配已有协议；没有引入第三方登录服务或单独运行 API 服务。

## 网易云音乐

[NeteaseCloudMusicApiEnhanced/api-enhanced](https://github.com/NeteaseCloudMusicApiEnhanced/api-enhanced/tree/75bf2e5ca209f4f1b3f822fa65d9f7b67e4b53ec)，提交 `75bf2e5ca209f4f1b3f822fa65d9f7b67e4b53ec`，MIT。

- [song_url_v1.js](https://github.com/NeteaseCloudMusicApiEnhanced/api-enhanced/blob/75bf2e5ca209f4f1b3f822fa65d9f7b67e4b53ec/module/song_url_v1.js)：URL v1 的 level 与 encodeType 参数。
- [crypto.js](https://github.com/NeteaseCloudMusicApiEnhanced/api-enhanced/blob/75bf2e5ca209f4f1b3f822fa65d9f7b67e4b53ec/util/crypto.js)：EAPI path / payload / MD5 / AES 协议。
- [user_account.js](https://github.com/NeteaseCloudMusicApiEnhanced/api-enhanced/blob/75bf2e5ca209f4f1b3f822fa65d9f7b67e4b53ec/module/user_account.js) 与 [user_playlist.js](https://github.com/NeteaseCloudMusicApiEnhanced/api-enhanced/blob/75bf2e5ca209f4f1b3f822fa65d9f7b67e4b53ec/module/user_playlist.js)：账号资料和个人列表格式。

本项目复用现有 EAPI 加密函数，新增 URL v1 账号调用、逐档音质、试听排除、CDN 与会话 revision 校验。登录保留官网 WebView 流程，未移植 Node 服务或扫码轮询模块。许可副本：[MIT](licenses/platform-accounts/NeteaseCloudMusicApiEnhanced-MIT.txt)。

## QQ 音乐

[LingyunStudio/RustMusic](https://github.com/LingyunStudio/RustMusic/tree/7494317847edcdb2f9fb46edb6a34a4b7530ac37)，提交 `7494317847edcdb2f9fb46edb6a34a4b7530ac37`，Apache-2.0。

- [qq/mod.rs](https://github.com/LingyunStudio/RustMusic/blob/7494317847edcdb2f9fb46edb6a34a4b7530ac37/src-tauri/src/qq/mod.rs)：`zzc` SHA-1 / 下标 / XOR / Base64 签名和 `musics.fcg`。
- [qq/url.rs](https://github.com/LingyunStudio/RustMusic/blob/7494317847edcdb2f9fb46edb6a34a4b7530ac37/src-tauri/src/qq/url.rs)：`CgiGetTrackInfo` 真实 file MID / 文件大小，`UrlGetVkey` 批量音质及凭据参数。

改编代码：`src-tauri/src/app/platform_accounts/qq_sign.rs`、`playback/qq.rs`。保留签名算法常量和上游向量；HTTP 实现改为项目 reqwest 客户端，接入类型化错误、会话 revision、12 秒预算、拒绝失败链接和固定 CDN。曲库只保存 song MID / media MID，授权 URL 不持久化。相关文件明确标注改编来源。上游署名 `Copyright 2026 LingyunStudio (RustMusic)` 与完整许可保留在 [Apache-2.0 副本](licenses/platform-accounts/RustMusic-Apache-2.0.txt)；固定提交顶层无独立 NOTICE 文件。

[chongya369/qqmusic-api-py](https://github.com/chongya369/qqmusic-api-py/tree/cfb72427b0173be544abcb6b050111b4be98c85a)，提交 `cfb72427b0173be544abcb6b050111b4be98c85a`，实际 LICENSE 为 GPL-3.0。

[apis/user.py](https://github.com/chongya369/qqmusic-api-py/blob/cfb72427b0173be544abcb6b050111b4be98c85a/qqmusic/apis/user.py) 和 songlist 接口仅用于交叉核对 module / method / 字段格式，没有直接复制其 Python 实现，也没有作为依赖加入。协议适配代码独立实现；不能将该仓库标为 MIT。核对副本：[GPL-3.0](licenses/platform-accounts/qqmusic-api-py-GPL-3.0.txt)。

## 酷我音乐

[MOPELotus/TuneWeave](https://github.com/MOPELotus/TuneWeave/tree/84bc7b34935198caa40f612876f4624a17b40221)，提交 `84bc7b34935198caa40f612876f4624a17b40221`，MIT OR Apache-2.0，本项目选择 MIT。

- [provider-kuwo/client.rs](https://github.com/MOPELotus/TuneWeave/blob/84bc7b34935198caa40f612876f4624a17b40221/crates/tuneweave-provider-kuwo/src/client.rs)：官网 Secret 算法、`playUrl` 参数和当前网页音频格式。
- [client/login.rs](https://github.com/MOPELotus/TuneWeave/blob/84bc7b34935198caa40f612876f4624a17b40221/crates/tuneweave-provider-kuwo/src/client/login.rs)：uid / sid 与 `checkLogin` 会话校验。

改编代码为 `platform_accounts/kuwo.rs` 与 `playback/kuwo.rs`，包括 Cookie 多层编码、Secret、独立登录校验、官方音频请求、实际格式判断。选择官方完整授权结果，排除试听并限制 CDN；缺少码率的 MP3 使用当前网页 128K 档标识。许可副本：[MIT](licenses/platform-accounts/TuneWeave-MIT.txt)。

[canxin121/music_api](https://github.com/canxin121/music_api/tree/fb888fc5041c1c39b046b4502fca1f15d04d4e68)，提交 `fb888fc5041c1c39b046b4502fca1f15d04d4e68`，MIT OR Apache-2.0，本项目选择 MIT。

[web_api/playlist.rs](https://github.com/canxin121/music_api/blob/fb888fc5041c1c39b046b4502fca1f15d04d4e68/src/server/kuwo/web_api/playlist.rs) 用于 `pl.svc` 的歌单 / 曲目参数和响应字段核对。TuneFree 独立实现登录校验、20 首预览和完整导入，明确不把真实响应中可能为零的 validtotal 当作下架数量。许可副本：[MIT](licenses/platform-accounts/music_api-MIT.txt)。

[znc15/MusicForUrl](https://github.com/znc15/MusicForUrl/tree/a098cec07918c71041f3cd7fdbf060c8251882eb)，提交 `a098cec07918c71041f3cd7fdbf060c8251882eb`，MIT。

[kuwo-login.js](https://github.com/znc15/MusicForUrl/blob/a098cec07918c71041f3cd7fdbf060c8251882eb/cloudflare/src/upstream/kuwo-login.js) 用于酷我 QQ / 微信登录 Cookie 和回调路由核对。没有引入 Cloudflare Worker；原生 WebView 保留官网 opener，只有指定 `i.kuwo.cn` HTTP 回调升级 HTTPS。许可副本：[MIT](licenses/platform-accounts/MusicForUrl-MIT.txt)。

## 原生登录与验证边界

使用项目已锁定的 [Tauri 2.12.5 WebviewWindowBuilder](https://github.com/tauri-apps/tauri/blob/tauri-v2.12.5/crates/tauri/src/webview/webview_window.rs) 的 `on_new_window / window_features / cookies`。`window_features` 保留官网 popup 的 WKWebView 配置 / WebView2 环境，避免自建独立窗口丢失 opener 或登录会话。Cookie 从后台线程读取；平台登录窗口不拥有主窗口的应用 IPC 权限。

来源和测试向量证明参考了现有实现；远端接口兼容性仍取决于平台当前响应。模拟 HTTPS / IPC、签名端点的匿名请求及隔离启动检查，都不计作本人账号 Vkey、会员音质或三平台真实播放验收。真实扫码、协议授权、验证码和系统权限由账号持有人完成。
