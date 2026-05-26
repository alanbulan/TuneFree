import 'package:flutter/material.dart';

import '../../core/network/music_url_normalizer.dart';

class MusicNetworkImage extends StatelessWidget {
  const MusicNetworkImage(
    this.url, {
    super.key,
    this.width,
    this.height,
    this.fit,
    this.errorBuilder,
  });

  final String url;
  final double? width;
  final double? height;
  final BoxFit? fit;
  final Widget Function(
    BuildContext context,
    Object error,
    StackTrace? stackTrace,
  )?
  errorBuilder;

  @override
  Widget build(BuildContext context) {
    return Image.network(
      url,
      width: width,
      height: height,
      fit: fit,
      headers: musicImageRequestHeaders(url),
      errorBuilder: (context, error, stackTrace) {
        final proxyUrl = musicImageProxyUrl(url);
        if (proxyUrl == null) {
          return _buildError(context, error, stackTrace);
        }
        return Image.network(
          proxyUrl,
          width: width,
          height: height,
          fit: fit,
          errorBuilder: _buildError,
        );
      },
    );
  }

  Widget _buildError(
    BuildContext context,
    Object error,
    StackTrace? stackTrace,
  ) {
    return errorBuilder?.call(context, error, stackTrace) ??
        const SizedBox.shrink();
  }
}
