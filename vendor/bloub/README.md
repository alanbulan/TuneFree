# bloub 上游动画核心

来源：[jeremy-prt/bloub](https://github.com/jeremy-prt/bloub)，版本 `0.1.1`，提交
`b4bb3c1b5f93c7b87a2e8d620f667c4093d97749`（2026-08-17）。许可证见 [LICENSE](LICENSE)。

关于页使用的版本和来源信息记录在 [source.json](source.json)，更新上游源码时同步维护。

上游没有 React 组件，也没有发布 npm 包。官方架构明确把 `src/bot/` 设计为无框架、
无时钟的 TypeScript 核心；`BotEngine.sample(t)` 输出 SVG 所需的一帧数据。
本应用直接保留并复用这部分源码，没有引入 Vue、编辑器、导出器或其他演示界面。

`src/bot/` 中的文件保持上游原样。`src/ui/gaze.ts` 只将 `@/bot/` 导入改为相对路径。
测量数据、形变、眼神、状态定义、轨道与粒子几何均由官方核心提供。

`src/desktop/components/BloubAvatar.tsx` 是本项目维护的 React 适配层，参照同一提交的
[BloubBot.vue](https://github.com/jeremy-prt/bloub/blob/b4bb3c1b5f93c7b87a2e8d620f667c4093d97749/src/components/BloubBot.vue)
保留 SVG 层序、眼睛遮罩、背景遮挡、渐变和粒子渲染，以及 64ms 时钟步长上限和指针规则。
它不是官方发布的 React 组件。音乐与推荐状态直接驱动引擎，不运行演示时间线。
右键伙伴或打开动作面板可体验上游完整的 15 种动作、16 种表情和 8 种外形，
所有选项直接枚举官方目录，并通过 `setState`、`setExpression` 和 `setShape` 连续形变。
表情预览期间暂停指针跟随，保留上游表情的头部姿态；一次性动作播放后自动回到音乐状态。

适配层在卸载时清理动画帧、指针事件和主题观察器；页面隐藏、窄屏或打开全屏播放器时不挂载动画，
系统开启减少动态时只绘制静止帧。深色模式使用官方 `creme` 配色。

MIT 许可涵盖仓库代码，不涵盖其模仿的第三方视觉设计；本项目与 x.ai 无关联。
