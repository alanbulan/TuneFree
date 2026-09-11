import '../models/lyric_timeline.dart';

/// 逐字时间轴的取用函数，移植自 Tauri 的 `src/core/utils/lyricWordState.ts`。
///
/// 只移植了**进度**那一个：桌面端还导出 `getLyricWordState`（pending/active/done
/// 三态），但它的消费者是桌面歌词窗的按词变色，Flutter 侧没有对应物 ——
/// 整行填充只关心比例，三态信息是冗余的。等真的接上真·逐字源需要按词上色时再补。

/// 当前位置处单个词已唱的比例，0..1。
///
/// `duration == 0` 退化为「到点即满」，与 Tauri 一致：真·逐字源里偶尔会出现
/// 零时长的词，除零会得到 Infinity / NaN，进而污染整行的比例。
double lyricWordProgress(
  double start,
  double duration,
  double currentTime,
) {
  if (duration == 0) {
    return currentTime < start ? 0 : 1;
  }
  final raw = (currentTime - start) / duration;
  if (raw.isNaN) {
    return 0;
  }
  return raw.clamp(0, 1);
}

/// 整行已经唱到的比例，0..1。
///
/// 按词的时长加权汇总，而不是简单地用 `(now - start) / (end - start)`：
/// 这样逐字数据里若出现**空隙**（真·逐字源里换气、拖腔都可能留空），
/// 空隙期间比例会停住而不是匀速爬过去。
double lyricLineProgress(List<LyricWord> words, double currentTime) {
  if (words.isEmpty) {
    return 0;
  }

  var total = 0.0;
  var filled = 0.0;
  for (final word in words) {
    total += word.duration;
    filled += word.duration * lyricWordProgress(
      word.start,
      word.duration,
      currentTime,
    );
  }

  if (total <= 0) {
    return 0;
  }
  return (filled / total).clamp(0, 1);
}
