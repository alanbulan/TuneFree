final class MusicSource {
  const MusicSource._(this.wireValue);

  factory MusicSource(String wireValue) => MusicSourceWire.fromWire(wireValue);

  final String wireValue;

  static const MusicSource netease = MusicSource._('netease');
  static const MusicSource qq = MusicSource._('qq');
  static const MusicSource kuwo = MusicSource._('kuwo');
  static const MusicSource joox = MusicSource._('joox');
  static const MusicSource bilibili = MusicSource._('bilibili');
  static const MusicSource unknown = MusicSource._('unknown');

  @override
  bool operator ==(Object other) =>
      identical(this, other) || other is MusicSource && other.wireValue == wireValue;

  @override
  int get hashCode => wireValue.hashCode;

  @override
  String toString() => 'MusicSource($wireValue)';
}

extension MusicSourceWire on MusicSource {
  static const Map<String, MusicSource> _knownByWireValue = <String, MusicSource>{
    'netease': MusicSource.netease,
    'qq': MusicSource.qq,
    'kuwo': MusicSource.kuwo,
    'joox': MusicSource.joox,
    'bilibili': MusicSource.bilibili,
    'unknown': MusicSource.unknown,
  };

  static MusicSource fromWire(String value) => _knownByWireValue[value] ?? MusicSource._(value);
}
