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

改编代码：`src-tauri/src/app/platform_accounts/qq_sign.rs`、`playback/qq.rs`。Vkey Cookie 依照上游 `credential_cookie()` 同步音乐身份和密钥；uin 在播放公参中保持十进制字符串，并补齐账号鉴权字段。保留签名算法常量和上游向量；HTTP 实现改为项目 reqwest 客户端，接入类型化错误、会话 revision、12 秒预算、拒绝失败链接和固定 CDN。曲库只保存 song MID / media MID，授权 URL 不持久化。相关文件明确标注改编来源。上游署名 `Copyright 2026 LingyunStudio (RustMusic)` 与完整许可保留在 [Apache-2.0 副本](licenses/platform-accounts/RustMusic-Apache-2.0.txt)；固定提交顶层无独立 NOTICE 文件。

[chongya369/qqmusic-api-py](https://github.com/chongya369/qqmusic-api-py/tree/cfb72427b0173be544abcb6b050111b4be98c85a)，提交 `cfb72427b0173be544abcb6b050111b4be98c85a`，实际 LICENSE 为 GPL-3.0。

[apis/user.py](https://github.com/chongya369/qqmusic-api-py/blob/cfb72427b0173be544abcb6b050111b4be98c85a/qqmusic/apis/user.py) 和 songlist 接口仅用于交叉核对 module / method / 字段格式，没有直接复制其 Python 实现，也没有作为依赖加入。协议适配代码独立实现；不能将该仓库标为 MIT。核对副本：[GPL-3.0](licenses/platform-accounts/qqmusic-api-py-GPL-3.0.txt)。

### QQ 账号头像协议（2026-11-15）

登录校验的 `GetLoginUserInfo` 可以返回 `info.nick` 而不返回头像。现按官网补查 `userInfo.BaseUserInfoServer / get_user_baseinfo_v2`，传入 `vec_uin: [当前音乐账号 ID]`，读取 `data.map_userinfo[ID].headurl`，同时校验 data code 和返回的 uin。不能从其他用户条目取图，也不能把微信音乐 ID 当作 QQ 号码拼头像 URL。

- [znc15/MusicForUrl lib/qqmusic.js](https://github.com/znc15/MusicForUrl/blob/a098cec07918c71041f3cd7fdbf060c8251882eb/lib/qqmusic.js) 的账号资料接口使用相同 module、method、`map_userinfo[uin].headurl` 字段。固定提交和 MIT 许可同下方酷我参考，仅核对协议；TuneFree 保留独立登录校验、HTTPS 归一化和可选资料请求。
- [L-1124/QQMusicApi](https://github.com/L-1124/QQMusicApi/tree/c046788dd1f11daacc74da487cbbf1bcd8ac6f33)，固定提交 `c046788dd1f11daacc74da487cbbf1bcd8ac6f33`，GPL-3.0。[modules/user.py](https://github.com/L-1124/QQMusicApi/blob/c046788dd1f11daacc74da487cbbf1bcd8ac6f33/qqmusic_api/modules/user.py) 与 [models/user.py](https://github.com/L-1124/QQMusicApi/blob/c046788dd1f11daacc74da487cbbf1bcd8ac6f33/qqmusic_api/models/user.py) 交叉核对备用 `music.UnifiedHomepage.UnifiedHomepageSrv / GetHomepageHeader` 的 `Info.BaseInfo.Avatar` 与 `EncryptedUin`。只核对接口和数据格式，没有复制 Python 实现或加入依赖。许可核对副本：[GPL-3.0](licenses/platform-accounts/L-1124-QQMusicApi-GPL-3.0.txt)。
- [QQ 官网公共脚本](https://y.qq.com/ryqq/js/common.chunk.5b378f933e2203b7da48.js?max_age=2592000) 的 `get_user_baseinfo_v2`、`map_userinfo` 与页面 `base.headurl` 链路同样吻合；本次下载 SHA-256：`c6c5e7c652a9133779bec192a3fd79515c4ab5462e8d9d6f6d5e8cc75a470f5d`。脚本只作核对，没有纳入项目。

本次匿名查询两个公开账号，顶层 code、req code、data code 均为 0，返回头像字段 `headurl`；其中返回的 HTTP `thirdqq.qlogo.cn` 图片升为 HTTPS 后，实测 200 / image/jpeg。备用资料查询最多等待 5 秒，失败不会让已经通过独立校验的登录失败。此公共协议证据另于本人验收：2026-11-15 开发版恢复本人保存的账号后，已观察到 QQ 头像正常显示并保留至重启。


### QQ 播放兼容核对（2026-11-15）

固定 [L-1124/QQMusicApi song.py](https://github.com/L-1124/QQMusicApi/blob/c046788dd1f11daacc74da487cbbf1bcd8ac6f33/qqmusic_api/modules/song.py) 的 `get_song_urls` 对有 media MID 的文件使用 `prefix + media_mid + extension`；TuneFree 将此格式与 RustMusic 的 `media_mid + song_mid` 放入同一音质候选请求，并按档位保留降级顺序。仅核对公开字段格式，没有移植 GPL Python 算法或引入该库。

本人保存账号的真实请求在官方 `musics.fcg` 返回 HTTP 200、顶层及请求 code 为 0；《两只老虎》320K 候选拒绝、128K 候选 `result=0`，播放器实际播放并显示「QQ 音乐账号 · 128K」。原生诊断只记录协议数值、候选数量和身份一致性，不记录 Cookie、账号标识或 Vkey URL。临时会员探针已从最终代码移除。会员授权、高音质和酷我本人播放仍需要相应账号验收。

## 酷我音乐

[MOPELotus/TuneWeave](https://github.com/MOPELotus/TuneWeave/tree/84bc7b34935198caa40f612876f4624a17b40221)，提交 `84bc7b34935198caa40f612876f4624a17b40221`，MIT OR Apache-2.0，本项目选择 MIT。

- [provider-kuwo/client.rs](https://github.com/MOPELotus/TuneWeave/blob/84bc7b34935198caa40f612876f4624a17b40221/crates/tuneweave-provider-kuwo/src/client.rs)：官网 Secret 算法、`playUrl` 参数和当前网页音频格式。
- [client/login.rs](https://github.com/MOPELotus/TuneWeave/blob/84bc7b34935198caa40f612876f4624a17b40221/crates/tuneweave-provider-kuwo/src/client/login.rs)：uid / sid 与 `checkLogin` 会话校验。

改编代码为 `platform_accounts/kuwo.rs` 与 `playback/kuwo.rs`，包括 Cookie 多层编码、Secret、独立登录校验、官方音频请求、实际格式判断。选择官方完整授权结果，排除试听并限制 CDN；缺少码率的 MP3 使用当前网页 128K 档标识。许可副本：[MIT](licenses/platform-accounts/TuneWeave-MIT.txt)。

[canxin121/music_api](https://github.com/canxin121/music_api/tree/fb888fc5041c1c39b046b4502fca1f15d04d4e68)，提交 `fb888fc5041c1c39b046b4502fca1f15d04d4e68`，MIT OR Apache-2.0，本项目选择 MIT。

[web_api/playlist.rs](https://github.com/canxin121/music_api/blob/fb888fc5041c1c39b046b4502fca1f15d04d4e68/src/server/kuwo/web_api/playlist.rs) 用于 `pl.svc` 的歌单 / 曲目参数和响应字段核对。TuneFree 独立实现登录校验、20 首预览和完整导入，明确不把真实响应中可能为零的 validtotal 当作下架数量。许可副本：[MIT](licenses/platform-accounts/music_api-MIT.txt)。

[znc15/MusicForUrl](https://github.com/znc15/MusicForUrl/tree/a098cec07918c71041f3cd7fdbf060c8251882eb)，提交 `a098cec07918c71041f3cd7fdbf060c8251882eb`，MIT。

[kuwo-login.js](https://github.com/znc15/MusicForUrl/blob/a098cec07918c71041f3cd7fdbf060c8251882eb/cloudflare/src/upstream/kuwo-login.js) 用于酷我 QQ / 微信登录 Cookie 和回调路由核对。没有引入 Cloudflare Worker；原生 WebView 保留官网 opener，只有指定 `i.kuwo.cn` HTTP 回调升级 HTTPS。许可副本：[MIT](licenses/platform-accounts/MusicForUrl-MIT.txt)。

### 酷我账号头像协议（2026-11-15）

上面的固定 `kuwo-login.js` 从官网返回的 cookies 映射读取 `uname3 / username` 与 `pic3`。本次重新下载的 [酷我官网脚本](https://h5s.kuwo.cn/www/kw-www/dcc6cd7.js) 同样用 `userInfo.pic3`、`decodeURIComponent()` 渲染头像，登录成功后的 `data.cookies` 写入 Cookie 与 userInfo；SHA-256：`9a70f06c5e82bc866f7877a766914718efb9fba0db2470b13c167dd5ffa17aae`。`checkLogin` 是 uid / sid 登录确认，不假设其确认结果必含头像。

TuneFree 保留官网 `pic3` 主字段和旧会话 `pic` 回退，每个候选先解码 `%uXXXX` / 多层 `%XX`，再校验图片 URL。修复无效 `pic3` 抢先命中后遮住有效 `pic` 的问题；也避免空白 `uname3` 遮住有效 `username`。原生 HTTPS 回归保留独立 uid / sid 校验，头像回归覆盖双层编码、UTF-16、协议相对链接和无效主字段。没有本人酷我登录实测时不声称真实账号头像已经验证。

### 已保存资料的更新

对本机凭据恢复的 QQ / 酷我账号，缺失头像时每次运行只在后台补查一次，先显示保存资料；完成后通知账号页。检查连接成功后也将完整更新资料验证写回系统凭据，保留原连接时间和会话，不要求重新扫码。暂时取不到头像时保留该会话当前已有头像；退出或重新登录后的旧请求不能写回。页面图片加载失败时显示统一占位，检查连接可重试相同地址。

## 原生登录与验证边界

使用项目已锁定的 [Tauri 2.12.5 WebviewWindowBuilder](https://github.com/tauri-apps/tauri/blob/tauri-v2.12.5/crates/tauri/src/webview/webview_window.rs) 的 `on_new_window / window_features / cookies`。`window_features` 保留官网 popup 的 WKWebView 配置 / WebView2 环境，避免自建独立窗口丢失 opener 或登录会话。Cookie 从后台线程读取；平台登录窗口不拥有主窗口的应用 IPC 权限。

来源和测试向量证明参考了现有实现；远端接口兼容性仍取决于平台当前响应。模拟 HTTPS / IPC、签名端点的匿名请求及隔离启动检查，都不计作本人账号 Vkey、会员音质或三平台真实播放验收。真实扫码、协议授权、验证码和系统权限由账号持有人完成。
