# Repository Guidelines

## New thread title

### 自动规范当前任务标题

这是每个在本项目中新建 Codex 任务的**首条用户消息启动步骤**，不是仅在用户提及“标题”时才执行的建议。它只能约束 Agent 开始执行后的行为，无法改变 Codex 在任务创建时已由平台生成的初始标题。

在处理用户请求、执行仓库命令或发送实质性回复前，必须先通过 Codex 任务工具读取**当前任务**的 `title` 和 `createdAt`（必要时先定位当前 active task，再用 `read_thread` 读取）。随后立即按下列规则判断并处理标题；仅发送“我会检查标题”之类的说明不算完成这一步。

如果标题不符合 `MMDD｜类型｜主题` 格式，且已经能够可靠判断任务主要目标，则立即使用 Codex 的任务标题修改能力更新当前任务标题。本操作仅修改当前任务标题，已获得授权，不需要另行询问用户确认。

如果标题已经正确，则不要重复修改。
如果无法读取当前任务的 `createdAt`，或者第一条消息不足以判断主题，则保留现有标题，不得猜测。

不得因为用户未提及标题、任务目标很简单、当前请求只是提问、或标题看似可用而跳过上述检查。该检查只作用于当前任务；不得借此批量改名、移动、置顶或归档任何任务。

如果产品要求任务**初始标题**就符合此格式，必须由 Codex 的任务创建入口支持标题模板，或在创建任务的同一事务中提供其实际创建时间并传入已计算的 `title`；仅依赖本文件无法实现创建前命名。对由 Agent 创建的任务，只有创建方能取得该实际创建时间时才可在 `create_thread` 请求中设置标题；否则仍须在任务启动后按本规则复核。

标题规则：

- 格式固定为 `MMDD｜类型｜主题`。
- 日期只能取当前任务的 `createdAt`，转换为 `Asia/Shanghai` 后生成四位 `MMDD`。
- 禁止使用 `updatedAt`、当前日期或标题中已有的日期代替。
- 类型只能是：`功能`、`设计`、`修复`、`优化`、`发布`、`探索`、`文档`、`研究`。
- 类型根据任务的主要交付目标判断，不根据偶然出现的关键词判断。
- 主题根据第一条用户消息和当前任务目标提炼，要求简洁、具体、便于侧边栏识别。
- 主题不要重复项目名称。
- API、GitHub、Skill 等技术名称保留通行写法。
- 只允许修改任务标题，不得修改项目名称、归属、排序、置顶、归档状态或其他元数据。

这项自动规则只适用于当前新建任务。批量整理、历史任务改名或修改其他任务标题时，仍然必须先提供改名预览并等待用户确认。

## Project Structure & Module Organization

This browser voxel sandbox uses React, TypeScript, Three.js, and Vite.

- `src/engine/`: seeded terrain generation, chunk workers, meshing, physics, and raycasting.
- `src/game/`: simulation, registries, recipes, inventory, persistence, rendering, and audio. Keep gameplay rules separate from presentation.
- `src/ui/`, `src/App.tsx`, and `src/styles.css`: Chinese menus, HUD, inventory, and styling.
- `public/assets/`: production texture atlases; document asset changes in `docs/ASSETS.md`.
- `tests/`: automated regression tests. `scripts/` contains browser acceptance and performance harnesses.
- `docs/`: feature scope, validation evidence, screenshots, and example saves.

## Build, Test, and Development Commands

Use Node.js 22.12+ and the declared package manager, `pnpm@9.11.0`.

- `pnpm install`: install dependencies; keep `pnpm-lock.yaml` synchronized.
- `pnpm dev`: start Vite on localhost, normally port 5173.
- `pnpm build`: run TypeScript checks and generate `dist/`.
- `pnpm preview`: serve the production build locally.
- `pnpm test`: run the Vitest regression suite.
- `pnpm test:watch`: rerun tests while developing.
- `pnpm test:benchmark`: run the optional CPU terrain/mesh benchmark; this does not measure browser FPS.

## Coding Style & Naming Conventions

Use strict TypeScript, ES modules, and explicit `import type` declarations. Follow existing two-space indentation, double quotes, semicolons, and trailing commas. Use PascalCase for components, classes, and their files, camelCase for functions and variables, and descriptive lowercase utility filenames such as `checkpoint-writer.ts`.

Prettier is installed; format changed files with `pnpm exec prettier --write <file>`. No ESLint configuration or lint script exists. Preserve Chinese player-facing text.

## Testing Guidelines

Name tests `tests/<system>.test.ts` and use Vitest `describe`/`it` with behavioral assertions. Storage tests use `fake-indexeddb`; terrain tests should use reproducible seeds. No numeric coverage threshold is configured. Add regression tests for changed gameplay, persistence, or engine behavior, then run `pnpm test` and `pnpm build`.

Verify UI and rendering changes in a browser and record evidence and limitations in `docs/VALIDATION.md`. Run the acceptance harness only in a fresh, empty survival world; it modifies the world.

## Commit & Pull Request Guidelines

History currently contains only `first commit`, so no established commit convention exists. Use concise imperative subjects, for example, `Fix furnace checkpoint recovery`.

PRs should explain the behavior changed, link relevant issues, report validation results, and include screenshots for visual changes. Update affected feature or asset documentation. Exclude generated builds, caches, and unrelated edits.

## 任务完成后的自动提交与发布

以下规则适用于本项目中产生仓库变更的任务，属于用户对常规收尾操作的持续授权，无需每次重新询问；用户明确要求只读、仅本地修改或暂不提交/发布时，以当次要求为准。

1. **自动提交并推送**：完成任务并通过相关验证后，检查差异，只暂存本任务的变更，创建描述清晰的 Git commit，然后推送到当前分支已配置的远端上游。不得夹带其他任务的未完成修改、提交凭据或强制推送。没有新增变更时不创建空 commit。
2. **自动发布至 Sites**：提交并推送成功后，使用 Sites 插件的 `sites-hosting` 流程，将该提交对应且构建通过的版本自动发布。工作区存在其他任务的未提交修改时，使用隔离检出构建，确保发布内容与推送的提交一致。优先复用 `.openai/hosting.json` 中的站点；首次发布按插件流程创建并保存关联。沿用已授权的访问范围，新站点默认仅本人可见，不擅自扩大访问权限。等待部署状态明确成功后再报告发布完成。

收尾回复应给出提交与推送结果、Sites 发布链接及验证结论。若发布目标不明确，或远端、认证、构建、部署失败，明确报告已完成步骤和具体阻塞，不将尝试或排队状态当作成功；涉及插件强制要求的额外授权时再请求用户处理。
