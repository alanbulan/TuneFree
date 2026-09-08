// happy-dom 的 WAAPI 尚无真实合成，并会为未读取的 finished Promise 抛出取消错误。
// 单元测试使用 Motion 支持的 JS 动画路径；WebView2 的原生动画另在 Tauri 窗口验收。
if (typeof Element !== 'undefined') Reflect.deleteProperty(Element.prototype, 'animate');
