"""Package verified simulator and device builds without Apple credentials."""

import argparse
import hashlib
import json
from pathlib import Path
import plistlib
import shutil
import subprocess


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', type=Path, default=Path('build/ios-preview/assets'))
    args = parser.parse_args()
    root = Path(__file__).resolve().parent.parent
    version_line = next(line for line in (root / 'pubspec.yaml').read_text().splitlines()
                        if line.startswith('version: '))
    version, build_number = version_line.removeprefix('version: ').split('+')
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    metadata = {}
    for platform, mode, source in [
        ('simulator', 'debug', root / 'build/ios/iphonesimulator/Runner.app'),
        ('device', 'release-unsigned', root / 'build/ios/iphoneos/Runner.app'),
    ]:
        if not source.is_dir():
            raise SystemExit(f'Missing {platform} build: {source}')
        with (source / 'Info.plist').open('rb') as stream:
            info = plistlib.load(stream)
        for key, expected in [
            ('CFBundleIdentifier', 'com.alanbulan.tunefree'),
            ('CFBundleShortVersionString', version),
            ('CFBundleVersion', build_number),
        ]:
            if info.get(key) != expected:
                raise SystemExit(f'{platform}: unexpected {key}: {info.get(key)}')
        supported_platform = 'iPhoneSimulator' if platform == 'simulator' else 'iPhoneOS'
        if supported_platform not in info.get('CFBundleSupportedPlatforms', []):
            raise SystemExit(f'{platform}: wrong supported platform')
        if not info.get('UIApplicationSceneManifest', {}).get('UISceneConfigurations'):
            raise SystemExit(f'{platform}: missing UIScene configuration')
        name = f'tunefree-ios-{platform}-{version}-{mode}.app.zip'
        subprocess.run(['ditto', '-c', '-k', '--sequesterRsrc', '--keepParent',
                        str(source), str(output / name)], check=True)
        metadata[platform] = {
            'asset': name, 'bundle': info['CFBundleIdentifier'],
            'version': version, 'build': build_number,
            'sdk': info.get('DTSDKName'), 'minimumOS': info.get('MinimumOSVersion'),
            'mode': mode,
        }
    note = root / 'docs/ios-preview.md'
    shutil.copyfile(note, output / 'IOS-PREVIEW.md')
    (output / 'ios-build-info.json').write_text(
        json.dumps(metadata, ensure_ascii=False, indent=2) + '\n')
    files = sorted(p for p in output.iterdir() if p.is_file() and p.name != 'IOS-SHA256SUMS')
    (output / 'IOS-SHA256SUMS').write_text(''.join(
        f'{hashlib.file_digest(p.open("rb"), "sha256").hexdigest()}  {p.name}\n'
        for p in files))
    print(json.dumps(metadata, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
