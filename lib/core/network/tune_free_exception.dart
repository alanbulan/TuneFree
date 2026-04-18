class TuneFreeException implements Exception {
  TuneFreeException(this.message);

  final String message;

  @override
  String toString() => 'TuneFreeException($message)';
}
