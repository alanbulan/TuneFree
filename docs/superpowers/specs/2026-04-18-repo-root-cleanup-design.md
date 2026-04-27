# Repository Root Cleanup Design

## Goal

将当前 TuneFree 仓库整理为一个清晰的双项目容器仓库：

- `react/`：保留原始 React / Vite / PWA 实现
- `flutter/`：承载当前 Flutter / Android 原生主线

整理完成后，仓库根目录只保留最小公共入口：

- `.gitignore`
- `README.md`
- `react/`
- `flutter/`

## Why

当前仓库的主项目边界不清晰：

- 根目录已经变成 Flutter 项目
- 原始 React 项目仍位于 `legacy/react_app`
- 文档和目录语义仍混合着“旧 Web 主项目”和“新 Flutter 主项目”两套叙事

这会导致后续开发、启动方式、README、测试路径和协作认知持续混乱。此次整理的目的不是增加新功能，而是把仓库结构一次性校正为长期可维护状态。

## Approved Decisions

本设计基于以下已确认选择：

1. 根目录只做容器层，不再直接承载某个应用项目
2. 最终保留两个并列子目录：`react/` 和 `flutter/`
3. 根目录只保留最小公共文件：`.gitignore` 和顶层 `README.md`
4. 当前 `docs/` 移入 `flutter/docs/`
5. 只移除旧历史 Android 残留；`flutter/android/` 必须保留
6. 不拆成多仓库，不引入 submodule，不改 git 历史

## Current State Summary

当前仓库状态：

- 根目录是 Flutter 项目根
- React 原始项目位于 `legacy/react_app/`
- Flutter 重构相关 spec / plan / 技术文档位于根目录 `docs/`
- 当前 Android 分支工作已在 Flutter 项目根下完成并可打包 APK

## Target Repository Layout

目标结构如下：

```text
/
├─ .gitignore
├─ README.md
├─ react/
│  ├─ README.md
│  ├─ package.json
│  ├─ public/
│  ├─ src/
│  └─ ...
└─ flutter/
   ├─ README.md
   ├─ pubspec.yaml
   ├─ pubspec.lock
   ├─ analysis_options.yaml
   ├─ dart_test.yaml
   ├─ lib/
   ├─ test/
   ├─ android/
   ├─ ios/
   ├─ web/
   ├─ linux/
   ├─ macos/
   ├─ windows/
   ├─ docs/
   └─ ...
```

## Directory Migration Rules

### 1. Flutter root project -> `flutter/`

当前根目录中属于 Flutter 项目的内容整体下沉到 `flutter/`，包括但不限于：

- `android/`
- `ios/`
- `web/`
- `linux/`
- `macos/`
- `windows/`
- `lib/`
- `test/`
- `pubspec.yaml`
- `pubspec.lock`
- `analysis_options.yaml`
- `dart_test.yaml`
- 当前 Flutter 专用 `README.md`
- 当前 Flutter 专用 `docs/`

其中：

- `flutter/android/` 必须完整保留
- `flutter/build/` 不作为版本内容迁移，应继续忽略
- 当前根目录 Flutter README 将迁移为 `flutter/README.md`

### 2. `legacy/react_app/` -> `react/`

现有 React / Vite / PWA 项目从历史参考路径提升为正式并列子项目：

- `legacy/react_app/` 重定位为 `react/`

整理完成后：

- 不再保留 `legacy/react_app/` 作为正式入口
- React README 仍保留原项目说明，但路径要改为 `react/`
- React 项目成为仓库一级目录，不再被命名为“legacy”

### 3. `docs/` -> `flutter/docs/`

当前根目录 `docs/` 中与 Flutter 迁移、Flutter 实现、Flutter 计划有关的文档整体移入：

- `flutter/docs/`

这样文档语义与代码归属保持一致：

- Flutter 文档跟随 Flutter 子项目
- 根目录不保留实现级技术文档

### 4. Root README replacement

最终根目录 `README.md` 不再是 Flutter 项目 README，而是容器导航文档，只负责说明：

- 本仓库包含两个子项目
- `react/` 是原始 Web / PWA 实现
- `flutter/` 是当前 Android / 原生主线
- 各自的进入路径和启动方式

### 5. Root `.gitignore`

根目录 `.gitignore` 继续保留，并负责忽略：

- 容器层公共临时文件
- 本地日志
- 测试失败截图
- 本地 Android / Kotlin 缓存
- worktree / Claude 等本地开发残留

其目标是：

- 根目录保持干净
- 两个子项目的临时产物不会污染仓库状态

## What Counts as “Remove old Android leftovers”

本次“去除残留安卓”的范围仅包括：

- 不属于 `react/` 的旧 Android 迁移尝试残留
- 不属于 `flutter/` 的历史 Android 杂项目录/文件
- 已经不再服务于当前 Flutter Android 构建的废弃边角目录

明确**不删除**：

- `flutter/android/`
- Flutter 打包和运行所需的任何 Android 工程文件

## Path / Reference Fixups

目录迁移后，以下引用必须一并修正。

### Root-level docs and README references

需要统一修正：

- 根 README 中对 Flutter / React 的路径说明
- React README 中旧的 `legacy/react_app` 路径说明
- Flutter README 中新的 `flutter/` 根路径说明
- 文档中所有旧根目录相对路径

### Flutter project references

需要检查并修正：

- `flutter/test/**` 内部写死的仓库根相对路径
- golden 文件路径和测试资源路径
- Flutter docs 中的命令示例（应改为 `cd flutter` 后执行）
- 任何仍假设 Flutter 位于仓库根目录的描述或脚本

### React project references

需要检查并修正：

- `react/README.md` 内的 clone / cd / npm 命令
- 对 `legacy/react_app` 的历史路径引用
- 任何假设 React 不是一级目录的文档说明

## Build / Test Expectations After Migration

### Flutter must remain independently runnable

迁移完成后，以下命令必须在 `flutter/` 下成立：

```bash
cd flutter
flutter pub get
flutter analyze
flutter test
flutter build apk --debug
```

### React must remain independently runnable

迁移完成后，以下命令必须在 `react/` 下成立：

```bash
cd react
npm install
npm run dev
```

如果 React 项目存在锁文件或既有脚本差异，以原项目实际可运行方式为准，但最终原则不变：

- React 必须在 `react/` 下自洽运行
- Flutter 必须在 `flutter/` 下自洽运行

## Execution Strategy

为降低风险，实施顺序应固定如下：

1. 建立目标目录骨架：`react/` + `flutter/`
2. 移动 Flutter 根项目到 `flutter/`
3. 提升 `legacy/react_app` 到 `react/`
4. 移动 `docs/` 到 `flutter/docs/`
5. 替换根 `README.md` 为容器导航页
6. 修正 Flutter / React 的 README 和路径说明
7. 清理不再属于两边的旧 Android 残留
8. 修正相对路径、golden 路径、文档路径、测试引用
9. 分别验证 Flutter 和 React

## Validation Strategy

### Required Flutter validation

至少执行：

```bash
cd flutter
flutter analyze
flutter test
flutter build apk --debug
```

### Required React validation

至少执行：

```bash
cd react
npm install
npm run dev
```

如 React 项目本身已有更合适的最小验证脚本，可替换为其等价命令，但必须覆盖“能安装依赖、能启动项目”的最低目标。

## Risks and Controls

### Risk 1: File move breaks relative references

控制方式：

- 迁移后优先检查 README、docs、golden、测试资源路径
- 先修路径，再跑测试

### Risk 2: Flutter Android build breaks after subdirectory move

控制方式：

- 明确把 `flutter/` 作为新的 Flutter 根目录
- 只接受 `cd flutter && flutter build apk --debug` 成功

### Risk 3: React docs still describe the old repository shape

控制方式：

- React README 作为单独修正项处理
- 所有 `legacy/react_app` 入口说明改为 `react/`

### Risk 4: Over-deleting historical files

控制方式：

- 只删除不属于 `react/` 和 `flutter/` 的残留
- 不删除 `flutter/android/`
- 删除前先确认该目录不属于任一最终子项目

## Non-Goals

以下内容不属于本次整理范围：

- 新增产品功能
- 改造业务逻辑
- 拆成多个 git 仓库
- 引入 submodule 或 subtree
- 重写 git 历史
- 顺手做无关重构

## Acceptance Criteria

本次整理完成时，必须同时满足：

1. 根目录只保留：
   - `.gitignore`
   - `README.md`
   - `react/`
   - `flutter/`
2. Flutter 项目可在 `flutter/` 下独立分析、测试、打包 APK
3. React 项目可在 `react/` 下独立安装依赖并启动
4. 根 README 成为仓库导航页，而非某个具体应用的 README
5. 原始 React 项目不再以 `legacy/react_app` 作为正式入口
6. 与 Flutter 迁移有关的文档位于 `flutter/docs/`
7. 不再残留第三套不属于 React 或 Flutter 的旧 Android 结构

## Success Condition

整理完成后，一个新协作者进入仓库时，只需要看根目录就能立即理解：

- 这是一个容器仓库
- `react/` 是旧版 Web / PWA 参考实现
- `flutter/` 是当前 Android / 原生主线
- 两边分别怎么进入、怎么运行、怎么验证
