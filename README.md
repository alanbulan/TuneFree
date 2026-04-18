# TuneFree Monorepo

This repository now contains two parallel app projects:

- [`react/`](./react) — the original React + Vite + PWA implementation
- [`flutter/`](./flutter) — the current Flutter + Android native-first implementation

## Which project should I use?

- If you want the original web/PWA version, go to `react/`
- If you want the current Android/native client, go to `flutter/`

## Quick start

### React

```bash
cd react
npm install
npm run dev
```

### Flutter

```bash
cd flutter
flutter pub get
flutter analyze
flutter test
flutter build apk --debug
```