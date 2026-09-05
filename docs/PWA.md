# 安装为桌面应用与离线游玩

生产版本支持安装为独立窗口的 PWA。先在支持的浏览器中联网打开游戏，等待菜单安装卡片显示“离线资源已准备好”，再使用安装入口。首次访问尚未完成缓存、浏览器限制存储或主动清除网站数据时，离线资源可能不可用；安装本身不代表资源已经缓存完毕。

## Chrome / Edge

如果菜单出现“安装应用”，点击后在浏览器自己的窗口中确认。也可使用地址栏的安装图标或浏览器菜单中的安装应用入口；Edge 的入口见 [微软安装说明](https://learn.microsoft.com/en-us/microsoft-edge/progressive-web-apps/ux)。

没有收到浏览器的 `beforeinstallprompt` 时，游戏只显示“安装说明”，不会模拟安装或报告成功。浏览器可能因已安装、策略限制、用户刚取消、隐私模式或尚未满足安装条件而不提供提示；具体原因由浏览器决定。[安装提示事件说明](https://developer.mozilla.org/en-US/docs/Web/API/Window/beforeinstallprompt_event)

点击确认只会显示“已提交安装请求”；只有实际收到 `appinstalled` 事件才显示“浏览器已确认安装”。取消或失败后仍可以继续网页游戏。

## Safari（Mac）

macOS Sonoma 14 及更新版本中，用 Safari 打开生产地址，选择 **文件 → 添加到程序坞**，也可使用分享菜单中的同名选项。Safari 不依赖页面内的安装提示按钮。[Apple 官方说明](https://support.apple.com/en-us/104996)

Safari 桌面应用与 Safari 浏览器使用独立的网站数据环境。迁移前先在原窗口导出世界，再进入桌面应用导入；不要把“安装应用”理解为已经复制存档。首次进入桌面应用也应联网等待资源准备完成。[Apple 关于独立网站数据的说明](https://support.apple.com/en-us/104996)

## 离线与更新

- 生产 Service Worker 预缓存页面、CSS、游戏 JS、地形 Worker、两张原创图集、manifest 和图标。世界地形在本机生成，已有世界仍从当前环境的 IndexedDB 读取；存档不会上传或被写入应用缓存。
- 更新只下载下一版应用资源。旧游戏窗口继续使用当前版本，不自动刷新、抢占控制权或强制激活新版。
- 看到“新版本已就绪”后，先保存，关闭这个网站及已安装应用的所有窗口，再重新打开。新版本会按浏览器正常生命周期生效；保留一个旧窗口会使更新继续等待。
- 更新清理的是 Workbox 管理的旧版应用资源，不会删除或清空 IndexedDB，也不改动世界存档、升级备份和浏览器设置。
- 浏览器“清除网站数据”可能同时删除世界存档；PWA 安装不代替 JSON 导出备份。

更新策略依据 [Vite PWA 的策略文档](https://vite-pwa-org.netlify.app/guide/service-worker-strategies-and-behaviors)，配置为 `registerType: "prompt"`、`skipWaiting: false`、`clientsClaim: false`；当前 UI 不发送 `SKIP_WAITING`，也没有自动刷新代码。

## 开发与部署

```sh
pnpm build
node scripts/check-pwa-build.mjs
pnpm preview --port 4173
```

本地生产验证地址为 `http://127.0.0.1:4173/`；正式部署使用 HTTPS。开发服务 `pnpm dev` 不注册 Service Worker，`devOptions.enabled=false`，不缓存开发模块。请将开发端口与生产预览端口分开，避免浏览器中此前已安装的生产 Service Worker 干扰开发入口。

当前游戏资源使用 `/assets/...`，因此 Vite base、manifest 的 `id/start_url/scope`、Service Worker 注册路径和导航回退统一为网站根路径 `/`。本次不宣称支持子目录部署；若要部署到 `/game/` 等子路径，必须同时改游戏资源 URL、PWA scope/base/导航路由，再跑离线验收。

部署必须包含整个 `dist/`，包括 `sw.js`、`workbox-*.js`、`manifest.webmanifest`、图标、Worker 和图集。建议对 `sw.js` 和 manifest 使用重新验证的缓存策略，对带内容哈希的 JS/CSS 使用长期缓存。不要只上传入口 JS 或漏掉两张图集。

固定新增依赖为 `vite-plugin-pwa@1.3.0`，已核对其发布的 peerDependencies 支持 Vite 8；传递依赖由 `pnpm-lock.yaml` 固定。没有加入运行时在线服务。构建缓存单文件上限设为 5 MiB，避免 2.33 MB 的 terrain atlas 被 Workbox 默认上限排除。

## 图标来源

`public/icons/icon.svg` 是本项目直接绘制的原创矢量图：深绿色背景、种植方块与金色植株，延续项目原有方块 favicon 的配色和几何语言，没有使用原版 Minecraft 图标或材质。用本机 `rsvg-convert` 导出四个 PNG：

```sh
rsvg-convert -w 192 -h 192 public/icons/icon.svg -o public/icons/icon-192.png
rsvg-convert -w 512 -h 512 public/icons/icon.svg -o public/icons/icon-512.png
rsvg-convert -w 512 -h 512 public/icons/icon.svg -o public/icons/icon-maskable-512.png
rsvg-convert -w 180 -h 180 public/icons/icon.svg -o public/icons/apple-touch-icon.png
```

图标使用不透明满幅背景；核心方块和植株位于遮罩安全区域内，外围太阳和背景属于可裁切装饰。已实际查看 512×512 PNG，确认内容清晰、无文字伪影；构建检查会验证 PNG 文件头与声明尺寸。

## 自动化与接入

`src/ui/InstallApp.tsx` 自带 `src/ui/install-app.css`，通过 `<InstallApp visible={!game} />` 始终挂载并在游玩时隐藏。它负责安装事件与生产注册；不需要修改游戏循环。组件卸载会清理 `beforeinstallprompt`、`appinstalled`、display-mode、SW updatefound 与 worker statechange 监听，包括异步注册尚未完成时的清理。

```sh
pnpm exec vitest run tests/pwa.test.ts
node scripts/check-pwa-build.mjs
```

PWA 专用测试覆盖开发禁用、不安全上下文、初次安装完成、等待更新、异步卸载、安装事件和媒体监听清理、无支持事件。构建检查读取真实生成的 manifest/SW，确认首页、CSS/JS、Worker、两张图集和图标全部进入预缓存，检查路径安全、PNG 尺寸、导航回退及不强制更新策略。

这些测试不能替代真实浏览器安装、离线启动与存档恢复；真实浏览器结果由本轮主控验证记录承载。不要把浏览器安装事件的测试替身当作实际桌面应用已经安装。
