"""Deterministic HTTP/audio fixture for the iOS simulator smoke test."""

import argparse
import hashlib
import io
import json
from pathlib import Path
import struct
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse
import wave


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=8765)
    parser.add_argument('--log', type=Path, default=Path('build/ios-fixture.jsonl'))
    args = parser.parse_args()
    args.log.parent.mkdir(parents=True, exist_ok=True)
    cover = (Path(__file__).resolve().parent.parent /
             'android/app/src/main/res/mipmap-xxxhdpi/ic_launcher.png').read_bytes()
    buffer = io.BytesIO()
    with wave.open(buffer, 'wb') as output:
        output.setnchannels(1)
        output.setsampwidth(2)
        output.setframerate(16000)
        output.writeframes(struct.pack('<h', 0) * (16000 * 45))
    audio = buffer.getvalue()

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_args):
            pass

        def do_GET(self):
            self.handle_request()

        def do_POST(self):
            self.handle_request()

        def handle_request(self):
            parsed = urlparse(self.path)
            parameters = parse_qs(parsed.query)
            if self.command == 'POST':
                parameters.update(parse_qs(self.rfile.read(
                    int(self.headers.get('Content-Length', '0'))).decode()))
            parameters = {key: value[-1] for key, value in parameters.items()}
            with args.log.open('a') as log:
                log.write(json.dumps({'time': time.time(), 'method': self.command,
                                     'path': parsed.path, 'parameters': parameters},
                                     ensure_ascii=False) + '\n')
            base = f'http://127.0.0.1:{args.port}'
            content_type = 'application/json'
            status = 200
            if parsed.path.endswith('/time'):
                content = str(time.time()).encode()
                content_type = 'text/plain'
            elif parsed.path in ('/v1/api.php', '/v2/api.php'):
                version = 'A' if parsed.path.startswith('/v1') else 'B'
                song = {'id': 'ios-fixture-song', 'name': f'iOS 音源测试 {version}',
                        'artist': ['TuneFree Test'], 'album': 'iOS 原生播放验证',
                        'pic_id': 'ios-cover', 'url_id': 'ios-stream',
                        'lyric_id': 'ios-lyrics'}
                payload = {
                    'search': [song],
                    'url': {'url': base + f'/audio.wav?version={version}'},
                    'pic': {'url': base + '/cover.png'},
                    'lyric': {'lyric': '[00:00.00]听见更多好音乐\n'
                             '[00:03.00]iOS 原生播放验证\n'
                             '[00:06.00]自定义音源与离线音乐'},
                }.get(parameters.get('types'), {'error': 'unknown type'})
                content = json.dumps(payload, ensure_ascii=False).encode()
            elif parsed.path == '/api/v1/methods/netease/playlist':
                content = json.dumps({'code': 0, 'data': {
                    'url': base + '/playlist', 'method': 'GET'}}).encode()
            elif parsed.path == '/audio.wav':
                content, content_type = audio, 'audio/wav'
            elif parsed.path == '/cover.png':
                content, content_type = cover, 'image/png'
            else:
                content, status = b'{}', 404
            full_length = len(content)
            requested_range = self.headers.get('Range')
            if parsed.path == '/audio.wav' and requested_range:
                start_text, end_text = requested_range.removeprefix('bytes=').split('-', 1)
                start = int(start_text or 0)
                end = min(int(end_text) if end_text else full_length - 1, full_length - 1)
                content, status = content[start:end + 1], 206
            self.send_response(status)
            self.send_header('Content-Type', content_type)
            self.send_header('Content-Length', str(len(content)))
            self.send_header('Accept-Ranges', 'bytes')
            if status == 206:
                self.send_header('Content-Range', f'bytes {start}-{end}/{full_length}')
            self.end_headers()
            try:
                self.wfile.write(content)
            except (BrokenPipeError, ConnectionResetError):
                pass

    print(f'iOS fixture listening on 127.0.0.1:{args.port}', flush=True)
    print(f'Test audio SHA-256: {hashlib.sha256(audio).hexdigest()}', flush=True)
    ThreadingHTTPServer(('127.0.0.1', args.port), Handler).serve_forever()


if __name__ == '__main__':
    main()
