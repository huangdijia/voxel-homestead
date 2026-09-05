# 功能覆盖与分阶段路线

参照版本：Minecraft Java 1.21.1。对齐层级为玩法和功能，不要求精确时序、原版漏洞、存档格式或模组兼容。

**本文件是功能域覆盖基线，不是 Java 1.21.1 全部物品、方块、生物、群系和结构的逐项全量清单。** 本轮另建立了 [逐项内容审计基线](parity/README.md)，其中保留固定来源、缺域和待验状态；内容记录与局部实现映射不等于功能完成。当前不能据此宣称整体功能对齐完成。

## 状态与证据约定

- **已实现／待浏览器全面验收**：已有对应实现；表内列出当前自动化用例或明确指出覆盖缺口。仍需完成真实浏览器操作、完整生存旅程与视觉验收，不能把代码存在、单元测试或一张截图视为该功能全部通过。
- **已实现／Chrome 指定场景通过**：仅对应已记录的 Chrome 性能环境和自动飞行场景，不外推到其他浏览器或全部玩法。
- **待实现**：后续阶段目标。表中的验收目标是完成条件，不是已获得的验证结果。
- **部分已实现／待浏览器全面验收**：该功能域仅有明确列出的子集，其他部分仍待实现；不能用局部交付关闭整个阶段。
- ID 用于后续问题、测试与验收记录关联，保留稳定；新增条目分配新 ID，不复用删除条目的 ID。
- 下列测试文件和用例名是可定位的覆盖映射，执行结果以实际测试报告为准。CPU 基准、模拟时间推进与真实浏览器连续游玩是三种不同证据。Chrome 的 900 秒指定场景已达到目标，结果单独标注；Edge 核心操作仍未实测。
- 本轮真实浏览器环境：macOS 27.0（26A5425a），Chrome 152.0.7977.82、Safari 27.0。各环境实际完成范围见 [验证记录](VALIDATION.md)；版本已识别不等于该浏览器全部验收通过。
- M1 基线 `pnpm test` 为 134 项通过、1 项跳过（8 个文件通过、1 个文件跳过），当时的 `pnpm build` 通过；这些统计和 900 秒性能结果不包含本轮 M2 农牧增量。新增规则、视觉和存档测试映射见 M2 表，本轮最终测试统计及真实浏览器结果待主控汇总。

## M1：铁器生存闭环 + 创造模式

| ID | 阶段 | 功能与当前内容 | 状态 | 当前自动化映射 | 浏览器验收目标／尚缺覆盖 |
| --- | --- | --- | --- | --- | --- |
| M1-WORLD-01 | M1 | 种子地形：平原、森林、丘陵、树木、洞穴、煤铁矿与池塘 | 已实现／待浏览器全面验收 | [engine.test.ts](../tests/engine.test.ts)：`deterministic terrain` 下的安全出生点、可进入矿洞、不同种子与负坐标复现用例 | 创建多个种子；从出生点走入矿洞，确认矿物可见、可到达，地形与重进后的同种子世界一致。 |
| M1-STREAM-01 | M1 | 分块生成、加载与卸载，区块边界编辑 | 已实现／待浏览器全面验收 | [engine.test.ts](../tests/engine.test.ts)：`uses the adjacent chunk snapshot to cull chunk-border faces`；[engine-world.test.ts](../tests/engine-world.test.ts)：`bounds queued chunks during fast exploration and ignores unloaded results` | 跨区块挖掘、放置、往返探索，无边缘裂缝、旧网格闪回或持续累积的已卸载资源。 |
| M1-WORKER-01 | M1 | Worker 世界标识、版本检查、任务优先级和有界等待队列 | 已实现／待浏览器全面验收 | [engine-world.test.ts](../tests/engine-world.test.ts)：`rejects stale worker geometry after an edit and applies only the new revision`、`prioritizes a nearby edit over distant initial loading after the current job completes` | 初始加载时连续编辑近处方块，并切换存档；过期任务不得覆盖新编辑或另一世界。自动化当前使用 Worker 替身，仍需真实 Worker 集成检查。 |
| M1-RENDER-01 | M1 | 原创像素图集、合并暴露面、不透明／半透明分层、云和手持物 | 已实现／待浏览器全面验收 | [engine.test.ts](../tests/engine.test.ts)：`merges cubes into one layer and excludes their common face`、`separates water and torch glow while retaining partial slab height` | 检查方块贴图、透明排序、手持物遮挡与不同画质；素材视觉检查见 [ASSETS.md](ASSETS.md)。网格测试不证明最终画面质量。 |
| M1-LIGHT-01 | M1 | 昼夜变化、天空竖直遮挡、近处火把照明 | 已实现／待浏览器全面验收 | [engine.test.ts](../tests/engine.test.ts)：`darkens a surface covered by a roof and restores sky exposure when that roof is removed`；[engine-world.test.ts](../tests/engine-world.test.ts)：`preserves independent changes and torch light across construction and cleanup` | 对比白天、夜间、封闭房屋、拆顶和放置／拆除火把的画面；检查夜间庇护效果。当前不是完整方块光传播。 |
| M1-MOVE-01 | M1 | WASD、跳跃、疾跑、潜行、重力、AABB、台阶、梯子和射线选取 | 已实现／待浏览器全面验收 | [engine.test.ts](../tests/engine.test.ts)：`voxel collision and interaction` 下的墙体防穿越、半格台阶、地面／天花板、门、水与细形状射线用例 | 实际键鼠走、跑、跳、蹲、攀爬和进入未加载区域；Chrome／Safari 标准鼠标锁定、IAB 拒绝后实际启用拖动视角已有操作证据；灵敏度、梯子移动及全部键位仍需全面浏览器验收。 |
| M1-WATER-01 | M1 | 静态水体、游泳、上浮、氧气恢复与溺水 | 已实现／待浏览器全面验收 | [engine.test.ts](../tests/engine.test.ts)：`distinguishes closed doors and open leaves and ignores water collision`；[survival-systems.test.ts](../tests/survival-systems.test.ts)：`water, breathing and swimming`，覆盖氧气耗尽前免伤、周期溺水、跳跃上浮、浅水呼吸、出水恢复及创造免罚 | 入水、持续潜水耗尽氧气、受到伤害、浮出水面恢复；氧气 HUD 与保存重进后的状态一致。水流传播不属于 M1。 |
| M1-MINE-01 | M1 | 长按挖掘、挖掘进度、工具效率／耐久、矿物工具等级和掉落拾取 | 已实现／待浏览器全面验收 | [simulation.test.ts](../tests/simulation.test.ts)：`requires the correct pickaxe tier for ore drops`、`harvests wood, crafts a workbench, mines stone, makes charcoal light, smelts ore and crafts an iron tool` | 对比空手、木镐、石镐与铁镐；确认挖掘提示、耐久消耗、工具破损和错误工具不掉矿物，拾取数量守恒。 |
| M1-BUILD-01 | M1 | 基础方块、玻璃、门、梯子、半格台阶、火把和双格床 | 已实现／待浏览器全面验收 | [engine.test.ts](../tests/engine.test.ts)：半格高度、门碰撞、梯子射线用例；[simulation.test.ts](../tests/simulation.test.ts)：`places a door as two halves and toggles them together`、`places both halves of a bed, sleeps, then removes both halves with one drop`；[world-limits.test.ts](../tests/world-limits.test.ts)：`multi-block placement is atomic across world boundaries` | 用首期材料建造完整房屋；检查放置支撑、身体重叠、跨区块编辑、多格物品拆除及各自视觉形状。并非每个方块都有独立交互测试。 |
| M1-ITEM-01 | M1 | 36 格库存、9 格快捷栏、装备栏、堆叠、拆分、交换与 Shift 快移 | 已实现／待浏览器全面验收 | [rules.test.ts](../tests/rules.test.ts)：`inventory atomicity and item conservation`；[simulation.test.ts](../tests/simulation.test.ts)：`moves stacks between hotbar, bag and chest without duplication`、`equips a held armor item when aiming into empty sky` | 真实左／右键、数字键、滚轮和 Shift 操作；满背包、鼠标携带物、耐久工具与护甲交换后不复制、不丢失。 |
| M1-CRAFT-01 | M1 | 2×2／3×3 合成、配方偏移和镜像、结果取出、配方手册直接制作 | 已实现／待浏览器全面验收 | [rules.test.ts](../tests/rules.test.ts)：`matches and consumes %s exactly once` 对注册配方参数化，另有偏移／镜像、额外材料、容量检查；[simulation.test.ts](../tests/simulation.test.ts)：`refuses a workbench recipe from a personal crafting grid`、`takes crafting output only once and preserves source stack counts` | 手动摆料和点击配方分别制作；缺材料、背包满、错误工作站时不扣材料；关闭背包正确归还网格和鼠标物品。 |
| M1-PROGRESS-01 | M1 | 空背包→木工具→石工具→粗铁→铁锭→铁工具／铁甲；木炭照明、食物和制床依赖 | 已实现／待浏览器全面验收 | [simulation.test.ts](../tests/simulation.test.ts)：`empty-inventory survival progression`；[rules.test.ts](../tests/rules.test.ts)：`has a coal-free light chain, food chain, full tool/armor chain` | 不使用调试发物品，从零制作铁工具和铁甲、建屋、照明、制床、睡眠，保存重进后继续游玩。真实Game/VoxelWorld的加速夹具已完成4铁工具和全套铁甲，见 [验收记录](VALIDATION.md)；不代表手动整条浏览器旅程已验收。 |
| M1-FURNACE-01 | M1 | 铁、木炭、玻璃、石头、猪肉和羊肉熔炼，燃料、进度和输出限制 | 已实现／待浏览器全面验收 | [simulation.test.ts](../tests/simulation.test.ts)：`finishes one iron after ten seconds and retains progress across save/load`、`stops consuming input and fuel when the output cannot accept the product`、`never permits placing a carried item into the output slot`、`routes shift transfers only into matching furnace input/fuel slots` | 熔炉面板内进度持续更新；逐一操作六种熔炼配方、补燃料、取成品、输出堵塞与中途退出重进。自动化时间推进不代替面板运行验证。 |
| M1-CHEST-01 | M1 | 27 格箱子、容器快移、拆除／爆炸时掉落容器物品 | 已实现／待浏览器全面验收 | [simulation.test.ts](../tests/simulation.test.ts)：`moves stacks between hotbar, bag and chest without duplication`、`explodes blocks and a filled container without duplicating content or destroying bedrock` | 箱子存取后重载；填满箱子再拆除或引爆，核对内部物品、方块物品和拾回数量。 |
| M1-SURVIVAL-01 | M1 | 生命、饥饿、进食回血、取消进食、跌落、护甲减伤与耐久 | 已实现／待浏览器全面验收 | [simulation.test.ts](../tests/simulation.test.ts)：`consumes the selected food after finishing the eating action`、`cancels eating on changing selected food, preserving both stacks`；[survival-systems.test.ts](../tests/survival-systems.test.ts)：`hunger, regeneration and exertion`、`armor protection and wear`，覆盖回血阈值／上限、饥饿留 1 血、疾跑耗饥饿、铁甲减伤与受击冷却、爆炸、跌落／溺水不受护甲保护及破甲移除 | 狩猎、烹饪、进食、换物品中断进食；比较有／无护甲伤害、跌落高度和饥饿恢复。上述首期数值已有专用规则测试；仍需真实操作确认伤害反馈、HUD 和自然场景中的完整生存过程。 |
| M1-ENTITY-01 | M1 | 猪、白羊、僵尸、爬行者，游走、追逐、简单跳障碍和掉落 | 已实现／待浏览器全面验收 | [simulation.test.ts](../tests/simulation.test.ts)：`still permits an unobstructed zombie attack and creeper ignition`；[survival-systems.test.ts](../tests/survival-systems.test.ts)：`killing a $kind produces its meat/materials exactly once, then preserves them through pickup and save`，对猪／羊参数化，覆盖近战冷却、武器耐久、肉／羊毛掉落、拾取延迟和存档守恒 | 逐一遇到四类生物，检查昼夜生成、移动、受击、死亡和掉落；猪肉可烹饪、羊毛可制床。猪羊的战斗至保存链已有参数化测试；四类生物的自然生成、游走和完整生命周期仍需全面验收。 |
| M1-COMBAT-01 | M1 | 近战、僵尸攻击、爬行者引爆、方块爆炸与庇护遮挡 | 已实现／待浏览器全面验收 | [simulation.test.ts](../tests/simulation.test.ts)：`shelter blocks hostile interactions` 下的无遮挡攻击、墙后不引爆、关闭门后不攻击用例；另有容器爆炸守恒用例 | 日落后在野外受攻击，再进入封闭且照明的房屋；确认攻击距离、墙／门遮挡、爆炸损伤、掉落及保存恢复。 |
| M1-BED-01 | M1 | 双格白床、夜间睡眠、重生点、怪物阻止睡眠、拆床失效 | 已实现／待浏览器全面验收 | [simulation.test.ts](../tests/simulation.test.ts)：`places both halves of a bed, sleeps, then removes both halves with one drop`、`refuses sleep while a nearby hostile is alive` | 放床过夜后重生于床边；拆掉床任一半后死亡返回安全出生点；附近有怪物时有明确提示。 |
| M1-DEATH-01 | M1 | 死亡界面、装备／背包／临时物品只掉落一次，安全重生与拾回 | 已实现／待浏览器全面验收 | [simulation.test.ts](../tests/simulation.test.ts)：`drops bag, cursor, crafting and armor exactly once on death and permits pickup after respawn`、`finds a safe nearby spawn if construction has obstructed the original spawn`；[storage.test.ts](../tests/storage.test.ts)：`accepts death and an invalidated bed location as gameplay state` | 死亡、保存、重进、重生并回收物品；确认死亡界面可操作，无穿入建造方块或重复掉落。 |
| M1-CREATIVE-01 | M1 | 首期物品搜索／分类、合法整组领取、无限建造、飞行、可拆基岩 | 已实现／待浏览器全面验收 | [simulation.test.ts](../tests/simulation.test.ts)：`creative gives every implemented item with legal stack count and durability`、`lets creative players remove a placed bedrock block while survival cannot mine it`；[survival-systems.test.ts](../tests/survival-systems.test.ts)：`does not apply underwater survival penalties in creative mode` | 创建创造世界；逐类搜索领取物品、飞行升降、放置与即时破坏，验证生命饥饿豁免。搜索与飞行按键暂无专用端到端测试。 |
| M1-MANAGE-01 | M1 | 世界创建、继续、删除、独立 JSON 导入导出 | 已实现／待浏览器全面验收 | [storage.test.ts](../tests/storage.test.ts)：`saves, lists, reloads and deletes a complete independent world`、`imports under a new id and never overwrites the source`、`rejects bad JSON or future versions without writing` | 已通过 Chrome 生产版实时导出→实际文件落盘→IAB 文件选择导入，生成独立世界；IAB 另已恢复铁器工坊进度。IAB 自身下载与 Chrome UI 文件导入未完成通道验证，详见 [验证记录](VALIDATION.md)。 |
| M1-SAVE-01 | M1 | 5 秒检查点、正常退出等待写入、IndexedDB 事务、存档校验、失败提示与重试、暂停菜单直接导出内存进度 | 已实现／待浏览器全面验收 | [storage.test.ts](../tests/storage.test.ts)：活动熔炉／箱子／掉落往返、事务中止、配额失败及 `live checkpoint downloads`（存储不可用时直接下载当前数据、异常清理）；[checkpoint-writer.test.ts](../tests/checkpoint-writer.test.ts)：有界合并写入、退出等待最新持久化、末次写入失败与重试；[simulation.test.ts](../tests/simulation.test.ts)：`temporary inventory and save conservation` | 在熔炼、取放物、死亡及拆床后自动保存／退出／重进；保存失败不得显示成功或直接退出；暂停菜单可直接下载内存快照，不依赖最近一次落盘成功。生产版实时导出按钮已在 Chrome 实际生成文件，并通过 IAB 导入回读。IndexedDB 故障下可导出的证据是替身注入测试，浏览器实际配额故障恢复仍需验收。 |
| M1-UI-01 | M1 | 中文主菜单、HUD、背包、工作台、箱子、熔炉、暂停、死亡和低高度滚动 | 已实现／待浏览器全面验收 | 真实状态截图见 [世界列表](screenshots/ui-worlds.png)、[创建](screenshots/ui-create.png)、[生存背包](screenshots/iron-inventory.png)；目前无自动化 UI 端到端测试文件 | Chrome、Edge、Safari 分别完成核心操作；检查夜间、死亡、物品鼠标栈、窄屏／矮屏的文字与操作可达性。已有截图仅代表各捕获状态；铁器背包已在布局修复后重新捕获，IAB 生产版已实际完成拖动视角、背包开关、暂停／保存及文件导入。 |
| M1-SETTINGS-01 | M1 | 视距、音量、灵敏度、视野、画质，本机设置保存；鼠标锁定失败提示 | 已实现／待浏览器全面验收 | [设置截图](screenshots/ui-settings.png)、[锁定失败提示截图](screenshots/ui-pause.png)；实现见 `App.tsx` 与 `Game.ts`，暂无专用设置持久化端到端测试 | 调整各设置并重开应用，核对渲染与交互效果；IAB 生产版已实测锁定失败后启动拖动视角，并开关背包、暂停／保存；其他设置效果及失焦恢复仍按浏览器逐项验收。 |
| M1-PERF-01 | M1 | 帧率／区块状态采集、有界区块任务与检查点写入 | 已实现／Chrome 指定场景通过 | [engine-world.test.ts](../tests/engine-world.test.ts)：`keeps a bounded loaded set across a simulated 15-minute walk with all jobs completing`；[engine-benchmark.test.ts](../tests/engine-benchmark.test.ts)：可选 CPU 基准 `measures 676 streamed chunks and repeated nearby edits`（无渲染器） | [Chrome 900 秒实测](browser-performance.json)：本机 M1／16GB、1440×900、DPR 1、中等画质、视距 6，平均 59.99887 FPS、p95 18.2 ms，满足 ≥55 FPS／≤33 ms；返回后区块／几何体／贴图数量稳定。资源约每 15 秒采样，范围不等于绝对峰值；自动飞行不替代手动控制或其他浏览器验收。 |

M1 基线注册表曾包含 28 个方块状态、48 个物品定义、27 个合成配方、6 个熔炉配方和 4 种生物；这是首期范围记录，不是当前总量。本轮 M2 农牧新增干湿耕地、28 个作物生长状态、草丛及 9 个堆肥桶状态，并增加种植、食物和农具定义。具体当前条目以 `src/game/registry.ts`、`src/game/recipes.ts` 及 [内容审计基线](parity/README.md) 为准。

## 已知首期近似与边界

- 世界高度 -16…95，水平地形按种子按需生成；修改数据按玩家改动规模增长。
- 水可游泳与溺水，暂不传播；沙砾暂不下落。
- 门、梯子、床固定朝向；火把支持对方块表面放置，但墙面火把暂使用同一竖直模型。
- 树叶暂不衰减；猪羊已支持喂食繁殖、幼体成长和剪毛产出，其他生物的繁殖、驯养及坐骑仍待实现；生物寻路为简单避碰／跳障碍。
- 光照是天空竖直遮挡加近处点光，不是原版完整方块光传播；方块光强估计可能穿墙。
- 饥饿与护甲遵循首期简化规则，尚未包含饱和度、所有伤害来源与全部数值。
- 只支持生存普通难度和创造；先支持电脑键鼠，移动端展示菜单但不提供触控游玩。
- 当前写入存档版本 2，读取时仍兼容版本 1；首次升级保存与保留旧检查点在同一 IndexedDB 事务内完成。旧世界保留生成器版本 1，新世界使用生成器版本 2；未知未来版本被拒绝。世界列表提供升级前备份导出，迁移故障和备份守恒已有专用用例，浏览器实际农牧迁移仍待验收。

## M2：完整主世界生存

本轮实现 **农业与猪羊养殖子集**，不代表 M2 完成。所有新增浏览器结果仍待主控实际执行和归档；[browser-agriculture.mjs](../scripts/browser-agriculture.mjs) 会先检查空白生存世界，明确记录工具／原料／动物／平台夹具，通过业务断言后才追加展示农田，不能把该脚本等同于无辅助的手动生存旅程。

| ID | 阶段 | 本轮功能与边界 | 状态 | 当前自动化映射 | 浏览器验收目标／尚缺覆盖 |
| --- | --- | --- | --- | --- | --- |
| M2-FARM-01 | M2 | 木／石／铁锄翻耕；15/16 高耕地、干湿外观、邻近水分与空地干旱恢复 | 已实现／待浏览器全面验收 | [agriculture-integration.test.ts](../tests/agriculture-integration.test.ts)：`tills, plants, irrigates, fertilizes and harvests through actual interaction commands`；[farming.test.ts](../tests/farming.test.ts)：`irrigation, drought and growth`；[agriculture-audit.test.ts](../tests/agriculture-audit.test.ts)：草丛上翻耕只扣一次耐久、手持锄仍能打开箱子 | 实际合成三种锄、翻耕、播种、撤水和重新灌溉，核对耐久、外观和物品消耗。踩踏耕地、雨水灌溉与原版精确随机刻仍待实现。 |
| M2-FARM-02 | M2 | 小麦／胡萝卜／马铃薯各 8 阶段，甜菜 4 阶段；光照生长、骨粉、成熟产出和种子返还 | 已实现／待浏览器全面验收 | [farming.test.ts](../tests/farming.test.ts)：`crop registry and harvest results`、`light, obstruction and exactly-once removal`、`bone meal`；[agriculture-integration.test.ts](../tests/agriculture-integration.test.ts)：实际翻耕至采收、建造替换作物只掉落一次 | 观察各阶段，在日光／夜间火把／遮光环境种植并采收；检查成熟时骨粉不扣除、移除支撑与覆盖时只掉落一次。其他作物、树木生长和完整生态待实现。 |
| M2-FARM-03 | M2 | 草丛取小麦种子、树叶等堆肥、满桶熟成取骨粉、骨粉长草；僵尸稀有掉落胡萝卜／马铃薯 | 部分已实现／待浏览器全面验收 | [agriculture-integration.test.ts](../tests/agriculture-integration.test.ts)：`creates grass only for generator 2, leaving all version-1 terrain unchanged`、`composts gathered leaves, resumes maturation after save, and uses the bone meal on grass`；[agriculture-storage.test.ts](../tests/agriculture-storage.test.ts)：堆肥进度往返 | 从新世界草丛或旧世界树叶→堆肥→骨粉→草丛取得小麦种子，并自然获得两种根菜。**甜菜种子目前仅创造可用，没有自然生存获取途径**；村庄农田、战利品来源仍待实现。 |
| M2-WATER-01 | M2 | 铁桶收取／放置水源，堆叠空桶转换为水桶，再用于灌溉 | 已实现／待浏览器全面验收 | [agriculture-integration.test.ts](../tests/agriculture-integration.test.ts)：`transfers a source into a stacked bucket and places it without creating extra buckets`、`blocks water collection through a wall and preserves buckets in unloaded land` | 真实右键搬运一格水，灌溉 4 格范围耕地；确认桶数量守恒、墙后及未加载水源不可操作。**水仍静态，不传播、不生成无限水源**；该项不关闭 M2-NATURE-01。 |
| M2-FOOD-01 | M2 | 小麦制面包、马铃薯烤熟、甜菜汤与碗；毒马铃薯独立掉落和简化中毒伤害 | 已实现／待浏览器全面验收 | [rules.test.ts](../tests/rules.test.ts)：注册配方材料扣除；[farming.test.ts](../tests/farming.test.ts)：成熟马铃薯独立 2% 毒薯掉落及保存随机序列；[agriculture-integration.test.ts](../tests/agriculture-integration.test.ts)：`returns an empty bowl after eating soup, including with a full inventory` | 真实 UI 合成／熔炼／食用，核对饥饿、成品和余留碗。甜菜汤的生存原料来源受 M2-FARM-03 限制；毒薯效果不是原版持续中毒系统。 |
| M2-HUSBANDRY-01 | M2 | 猪羊食物吸引、喂食进入繁殖、同类配对、幼崽、父母冷却、幼体成长和喂养加速 | 已实现／待浏览器全面验收 | [agriculture-integration.test.ts](../tests/agriculture-integration.test.ts)：`feeds a pair, creates exactly one baby, persists cooldowns, and accelerates baby growth`、隔墙／跨物种不繁殖、草丛不阻挡喂食；[agriculture-audit.test.ts](../tests/agriculture-audit.test.ts)：未加载动物不扣食物、实体墙近角遮挡 | 分别给两只成年羊喂小麦、两只成年猪喂根菜，观察爱心、约 3 秒靠近配对、半尺寸幼崽与 5 分钟冷却；保存重进后继续成长。其他动物、驯养、坐骑与原版完整寻路待实现。 |
| M2-HUSBANDRY-02 | M2 | 成年白羊剪毛、重复剪毛保护、草地长毛、幼体不掉成年资源 | 已实现／待浏览器全面验收 | [agriculture-integration.test.ts](../tests/agriculture-integration.test.ts)：`shears only once, regrows wool after grazing, and drops no adult resources from babies`；[agriculture-visuals.test.ts](../tests/agriculture-visuals.test.ts)：羊毛层切换、幼体模型与材料资源复用 | 用剪刀获得 1–3 个羊毛并消耗一次耐久；剪过毛的羊／幼羊不能重复产出，累计在草方块吃草约 30 秒后恢复。染色羊和其他剪刀用途待实现。 |
| M2-SAVE-01 | M2 | 保存水分／生长／随机状态、幼体／繁殖／剪毛状态、堆肥熟成；版本 1→2 原子备份与导入导出 | 已实现／待浏览器全面验收 | [agriculture-storage.test.ts](../tests/agriculture-storage.test.ts)：`version 2 agriculture and livestock validation`、`legacy migration and original checkpoint backups`、`agricultural import and export`；[farming.test.ts](../tests/farming.test.ts)：保存生长调度与随机状态；[agriculture-audit.test.ts](../tests/agriculture-audit.test.ts)：60 Hz 快照校验、最长世界名备份可重新导入 | 在作物生长、堆肥熟成、幼崽出生、刚剪毛时保存重载，核对数量和剩余时间；验证旧世界原地形、升级前备份和故障回滚。替身事务测试不能替代浏览器实际故障验收。 |
| M2-VISUAL-01 | M2 | 各阶段立体细茎／叶／麦穗，干湿沟垄，堆肥填料，幼体／剪毛羊／爱心及农牧像素图标 | 已实现／待浏览器全面验收 | [agriculture-visuals.test.ts](../tests/agriculture-visuals.test.ts)：全部植物模型非退化／范围有界、可选取而无碰撞、cutout 层、15/16 耕地、0.875 堆肥桶、资源复用和 20 项独立 SVG；[farming.test.ts](../tests/farming.test.ts)：`bounded scheduling and saved deterministic state` | 真实世界与背包辨认四类成熟作物、所有阶段、幼体和剪毛状态；密集农田和养殖场需新增实际帧率／资源检查，不复用 M1 的 900 秒结论。 |

### M2 尚未完成的功能域

| ID | 阶段 | 功能域／后续内容 | 状态 | 验收目标 |
| --- | --- | --- | --- | --- |
| M2-CATALOG-01 | M2 | 主世界群系、结构、植物、方块、矿物与装备内容扩展 | 部分已实现／待浏览器全面验收 | 已有独立内容审计基线和本轮少量农牧定义；继续补齐缺域、自然生成／获取链、交互与存档用例。审计清单存在不表示主世界内容扩展完成。 |
| M2-ECOLOGY-01 | M2 | 更多生物、农业、生长、繁殖、驯养和坐骑 | 部分已实现／待浏览器全面验收 | 本轮仅四类作物及猪羊子集，详见上表；继续打通甜菜自然来源、其余作物、生物、驯养／坐骑及跨区块生命周期。 |
| M2-VILLAGE-01 | M2 | 村民、职业与交易 | 待实现 | 建立完整交易条件、商品和价格状态、补货与限制；消费和产出守恒，离开区域及重载后状态一致。 |
| M2-PROGRESS-01 | M2 | 钻石等装备、经验、附魔、酿造和钓鱼 | 待实现 | 对每条成长链验证材料来源、配方／操作、效果、耐久或消耗、经验变化和存档；不能只验证物品目录。 |
| M2-NATURE-01 | M2 | 天气、动态流体、重力方块、树叶更新与完整照明 | 待实现 | 验证天气转换、跨区块传播、遮挡、连续更新、保存重载及性能；对 M1 静态近似逐项替换并回归。 |

## M3：自动化与探险

| ID | 阶段 | 功能域／后续内容 | 状态 | 验收目标 |
| --- | --- | --- | --- | --- |
| M3-REDSTONE-01 | M3 | 红石信号、开关、逻辑组合与活塞 | 待实现 | 以可搭建电路逐项验证输入、输出、组合行为、更新顺序、跨区块与保存恢复；不要求原版漏洞和精确时序。 |
| M3-AUTOMATION-01 | M3 | 漏斗及物品自动输送、生产组合 | 待实现 | 验证多容器流转、堵塞、过滤／方向规则、加载卸载和存档；长时间运行不复制或丢失物品。 |
| M3-TRANSPORT-01 | M3 | 对应版本的交通运输系统 | 待实现 | 建立所含载具与设施逐项清单；验证乘坐、运行、碰撞、物品交互及离开区块后的恢复。 |
| M3-DIMENSION-01 | M3 | 下界、末地与传送门 | 待实现 | 验证维度生成、传送条件、坐标对应、双向返回，以及玩家、实体、容器和世界时间的保存一致性。 |
| M3-ADVENTURE-01 | M3 | Boss、特殊结构与版本对应探险内容 | 待实现 | 为每条探险链建立可重复的寻找／进入、战斗、奖励、后续进程及重载验收，回归已有维度和生存功能。 |

## M4：多人及功能收尾

| ID | 阶段 | 功能域／后续内容 | 状态 | 验收目标 |
| --- | --- | --- | --- | --- |
| M4-SERVER-01 | M4 | 权威服务器与共享模拟规则 | 待实现 | 客户端提交动作，服务端决定方块、掉落、库存和伤害；验证非法或重复请求不能创建资源，单机规则可复用。 |
| M4-ROOM-01 | M4 | 好友房间、加入退出与断线重连 | 待实现 | 多个真实客户端创建／加入同一世界，断线重连恢复同一角色状态；房主离线与房间结束行为有明确验收。 |
| M4-SYNC-01 | M4 | 世界／实体／容器同步及多人存档 | 待实现 | 并发挖掘、拾取、交易和容器争用无复制；延迟、乱序、重连与服务端重启后状态一致。 |
| M4-PERMISSION-01 | M4 | 房间权限、管理和操作边界 | 待实现 | 权限授予与撤销立即生效，未授权客户端不能修改受限状态；权限与世界存档一致恢复。 |
| M4-MODE-01 | M4 | 命令、其他游戏模式及剩余功能域 | 待实现 | 按固定参照版本补建命令与模式清单，逐项验证语义、权限、模式切换及保存兼容；新增模式不破坏 M1。 |
| M4-PARITY-01 | M4 | 全量内容清单补齐、覆盖追踪和整体收尾 | 待实现 | 完成 Java 1.21.1 逐项清单，将每项目标关联实现与验收记录，明确近似或排除项；只有所有约定目标验收通过，才标记整体功能对齐完成。 |

后续每阶段须回归 M1 规则、存档和真实浏览器主流程。阶段完成状态与测试证据分别记录；未验收项不得因实现存在或其他阶段通过而自动变为完成。
