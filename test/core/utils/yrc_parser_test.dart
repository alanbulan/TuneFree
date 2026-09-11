import 'package:flutter_test/flutter_test.dart';
import 'package:tunefree/core/utils/yrc_parser.dart';

void main() {
  test('解析计时行与逐字时间', () {
    final document = parseYrcDocument(
      '[830,4980](830,380,0)夢(1210,330,0)な(1540,200,0)ら',
    );

    expect(document.lines, hasLength(1));
    final line = document.lines.single;
    expect(line.time, closeTo(0.83, 1e-9));
    expect(line.text, '夢なら');

    final words = document.wordsByTime[yrcTimeKey(line.time)]!;
    expect(words, hasLength(3));
    expect(words[0].text, '夢');
    expect(words[0].start, closeTo(0.83, 1e-9));
    expect(words[0].duration, closeTo(0.38, 1e-9));
    expect(words[1].text, 'な');
    expect(words[1].start, closeTo(1.21, 1e-9));
    expect(words[2].text, 'ら');
    expect(words[2].end, closeTo(1.74, 1e-9));
  });

  test('词时间是相对行首的偏移时还原成绝对时间', () {
    // 少数 yrc 里词时间从 0 起算而不是跟随行首。行首 10s、第一个词写 0，
    // 明显早于行首，按偏移处理。
    final document = parseYrcDocument('[10000,2000](0,500,0)あ(500,500,0)い');

    final words = document.wordsByTime[10000]!;
    expect(words[0].start, closeTo(10.0, 1e-9));
    expect(words[1].start, closeTo(10.5, 1e-9));
  });

  test('行首为 0 时不做偏移还原', () {
    // 行首是 0 时「绝对」与「相对」等价，不能因为 start < lineStart 就加一遍。
    final document = parseYrcDocument('[0,3000](0,400,0)あ(400,400,0)い');

    final words = document.wordsByTime[0]!;
    expect(words[0].start, closeTo(0, 1e-9));
    expect(words[1].start, closeTo(0.4, 1e-9));
  });

  test('开头的 JSON 元数据行还原成普通歌词行', () {
    final document = parseYrcDocument(
      '{"t":0,"c":[{"tx":"作词: "},{"tx":"米津玄師","li":"http://x/1.jpg"}]}\n'
      '{"t":552,"c":[{"tx":"编曲: "},{"tx":"室屋光一郎"}]}\n'
      '[830,4980](830,380,0)夢',
    );

    expect(document.lines.map((line) => line.text), [
      '作词: 米津玄師',
      '编曲: 室屋光一郎',
      '夢',
    ]);
    expect(document.lines[0].time, closeTo(0, 1e-9));
    expect(document.lines[1].time, closeTo(0.552, 1e-9));
    // 元数据行不唱，没有逐字时间。
    expect(document.wordsByTime.containsKey(0), isFalse);
    expect(document.wordsByTime.containsKey(yrcTimeKey(0.552)), isFalse);
  });

  test('认不出来的行被跳过，不影响其余行', () {
    final document = parseYrcDocument(
      '\n'
      '***歌詞來自第三方***\n'
      '{"t":0}\n'
      '{"这不是 JSON"\n'
      '[830,4980](830,380,0)夢\n'
      '[99999,1000](99999,100,0)  \n',
    );

    // `{"t":0}` 缺 c 字段、裸文本行没有计时、最后一行词面全空白 —— 都不产出歌词行。
    expect(document.lines.map((line) => line.text), ['夢']);
  });

  test('空输入返回空文档', () {
    expect(parseYrcDocument(null).isEmpty, isTrue);
    expect(parseYrcDocument('').isEmpty, isTrue);
    expect(parseYrcDocument('   \n  ').isEmpty, isTrue);
    expect(parseYrcDocument('随便一行没有计时的文本').isEmpty, isTrue);
  });

  test('行文本去掉计时标记，多行结果按时间排序', () {
    final document = parseYrcDocument(
      '[6370,4890](6370,280,0)未(6650,630,0)だ\n'
      '[830,4980](830,380,0)夢(1210,330,0)な',
    );

    expect(document.lines.map((line) => line.text), ['夢な', '未だ']);
    expect(document.lines[0].time, lessThan(document.lines[1].time));
    expect(document.hasWords, isTrue);
  });

  test('词面里的多余空白被压成单个空格', () {
    final document = parseYrcDocument('[0,3000](0,400,0)so  (400,400,0)  la');

    final words = document.wordsByTime[0]!;
    expect(words[0].text, 'so ');
    expect(words[1].text, ' la');
    // 行文本由词面拼回，空白同样会被压平。
    expect(document.lines.single.text, 'so la');
  });

  test('只有计时行没有词时才不算逐字', () {
    // 有行首行尾但没有词前缀：行还是要解析出来，只是没有字级数据。
    final document = parseYrcDocument('[830,4980]纯文本行');

    expect(document.lines.single.text, '纯文本行');
    expect(document.wordsByTime, isEmpty);
    expect(document.hasWords, isFalse);
  });
}
