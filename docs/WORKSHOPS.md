# 铁与旧书：铁砧、砂轮与附魔书

这是 M2 的一个可玩增量。完整主世界、剩余 34 种附魔、诅咒、酿造、钓鱼、村民交易和后续维度／多人仍未完成，不能据此关闭整体功能对齐目标。

## 玩法

- **铁砧**：3 个铁块与 4 个铁锭合成。左槽放目标物品，右槽放同种装备、修复材料或附魔书；预览确认后点击结果取出，Shift 点击直接放入背包。木、石、铁、金、钻石装备分别接受现有对应材料，剪刀通过两把合并修复。
- **名称**：输入框最多 50 个 UTF-16 字符单位；留空去掉自定义名。整组可堆叠物品可以一同命名。命名箱子和熔炉放下后显示名称，拆除和保存重载保留名称及内容。
- **费用**：材料每单位修复最大耐久的四分之一（向下取整）；同类装备合并另加 12% 耐久。费用包括操作与两件输入的此前加工成本。除单纯命名外，加工使历史成本增长；生存模式达到 40 级费用不可取出，单纯命名最多 39 级。创造模式免经验但仍消费投入的物品。
- **附魔书**：单本普通书可放进附魔台，消费青金石和等级得到当前八种实现池中的附魔书。铁砧将适用的附魔转入装备，相同等级合并可以升级；时运与精准采集互斥。创造物品目录提供八种满级书。书本本身不会提供装备主动效果。
- **砂轮**：3 个石头先合成 6 个石台阶，再用 2 根木棍、1 个石台阶和 2 块木板合成。砂轮移除当前已实现的附魔并返还经验，也可合并两件相同耐久装备（另加 5% 耐久），保留左侧名称。附魔书祛魔后变回普通书。经验只在实际取出时产生。
- **方块**：铁砧支持两种轴向、三种损耗状态与下落；每次生存加工有 12% 概率损耗。砂轮可安装在地面、墙侧和天花板，支持四方向。石台阶有上下半格与双层，双层挖掘掉两块。

## 模拟与存档

工作站预览不修改输入。取出时重新检查所在方块、加载状态、距离、存活、物品、经验和接收槽容量；全部满足才一次性提交。背包放不下或鼠标持有不兼容物品时不扣材料、经验，也不磨损铁砧。重复取出不能重复产生结果。暂存槽及鼠标物品由既有检查点机制折入副本背包／掉落，关闭或死亡也归还一次。

存档版本为 **7**，生成器保持 **6**。新增 `customName`、`repairCost`、附魔书、命名容器和可选铁砧下落距离；版本 6 仍按原限制校验。旧世界升级时在同一 IndexedDB 事务保留原始备份，旧生成器不重新生成。存档校验拒绝未知附魔、非法等级、互斥组合、过长／控制字符名称、越界成本和重复下落所有权。

铁砧沿用自然更新的格子步进重力，等待未加载区域。落地伤害使用下落距离并有损耗概率；下落距离可在中途保存，恢复后只结算一次。单个系统下落货物与移动铁砧记录各自上限 128。铁砧可以叠放在另一铁砧上；未实现平滑落体和所有局部形状／水浸着陆细节，不能把此处等同完整原版物理。

## 验证状态

当前 **1010 项测试通过、1 项可选 CPU 基准跳过**，TypeScript 与 Vite/PWA 生产构建通过。主包仍有大于 500 kB 的构建提示；本轮未测 15 分钟帧率，不能复用历史 M1 性能数据。

- `workshops.test.ts`：46 项纯规则测试，材料／费用／命名／合并／祛魔／边界。
- `workshop-metadata.test.ts`：26 项元数据、128 种附魔书种子、版本隔离、数据库备份和中断回滚。
- `workshop-integration.test.ts`：20 项实际模拟路径，取出守恒、费用、失效工作站、创造书、单书槽、炉产物名称、落砧和保存距离。
- `workshop-placement.test.ts`：24 项实际射线放置与交互，全部砂轮方向、铁砧轴向、石台阶合并及命名容器重载／掉落。
- `workshop-visuals.test.ts`：17 项几何、图标、配方和界面桥接检查。

浏览器整合、实际页面重载及最终生产 PWA 的本轮结果将在同文件下记录；自动化用例不自动证明原生全屏、实际安装或跨浏览器完整旅程。

## 参照来源与实现边界

固定参照为 Java 1.21.1。官方 [Java 1.21 更新说明](https://feedback.minecraft.net/hc/en-us/articles/27547857163917-Minecraft-Java-Edition-1-21-Tricky-Trials)说明附魔支持物品、主要物品、互斥集合及成本数据结构；[铁砧介绍](https://www.minecraft.net/fr-ca/article/taking-inventory--anvil)用于功能概述。

算法细节核对的是固定提交 `414d16968de22d168f6b636a9e8d1f80401161d7` 的第三方反编译副本，并非 Mojang 官方托管源码。本项目独立实现 TypeScript 规则，不分发该 Java 源码，不声明字节或漏洞兼容：

- [AnvilScreenHandler](https://github.com/Soumeh/1.21.1-Deobfuscated/blob/414d16968de22d168f6b636a9e8d1f80401161d7/minecraft/src/net/minecraft/screen/AnvilScreenHandler.java)：修复、合并、命名、费用与取出消费。
- [GrindstoneScreenHandler](https://github.com/Soumeh/1.21.1-Deobfuscated/blob/414d16968de22d168f6b636a9e8d1f80401161d7/minecraft/src/net/minecraft/screen/GrindstoneScreenHandler.java)：修复、祛魔与经验范围。
- [EnchantmentScreenHandler](https://github.com/Soumeh/1.21.1-Deobfuscated/blob/414d16968de22d168f6b636a9e8d1f80401161d7/minecraft/src/net/minecraft/screen/EnchantmentScreenHandler.java)：书本附魔转换和多项结果随机移除一项。
- [FallingBlockEntity](https://github.com/Soumeh/1.21.1-Deobfuscated/blob/414d16968de22d168f6b636a9e8d1f80401161d7/minecraft/src/net/minecraft/entity/FallingBlockEntity.java)、[PlayerEntity](https://github.com/Soumeh/1.21.1-Deobfuscated/blob/414d16968de22d168f6b636a9e8d1f80401161d7/minecraft/src/net/minecraft/entity/player/PlayerEntity.java)与 [LivingEntity](https://github.com/Soumeh/1.21.1-Deobfuscated/blob/414d16968de22d168f6b636a9e8d1f80401161d7/minecraft/src/net/minecraft/entity/LivingEntity.java)：落砧伤害、头盔额外损耗和减伤。没有通过原版运行验证同次碎甲的精确属性更新时间，不从方法顺序推断已对齐该时序。
- [1.21.1-data 附魔数据](https://github.com/misode/mcmeta/tree/1.21.1-data/data/minecraft/enchantment)：社区从游戏提取的 `anvil_cost` 与附魔等级成本，非另一个官方文档页面。

明确差异：当前只有八种非诅咒附魔；后续加入诅咒时砂轮必须保留诅咒并重建加工成本。界面在费用不足时仍显示不可取出的结果预览。文本额外过滤 C1 控制字符，不支持任意数据组件。创造模式可给普通物品存附魔元数据，生存主动效果仍按已实现物品适配规则执行。
