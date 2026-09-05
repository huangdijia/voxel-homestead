import { useEffect, useRef, useState } from "react";
import { isStandalone, observeInstallation, registerOfflineShell } from "../pwa/client";
import type { InstallPromptEvent, OfflineState } from "../pwa/client";
import "./install-app.css";

/** Keep mounted with visible={false} during gameplay so install events are retained. */
export function InstallApp({ visible = true }: { visible?: boolean }) {
  const deferred = useRef<InstallPromptEvent | null>(null);
  const alive = useRef(false);
  const [canInstall, setCanInstall] = useState(false);
  const [installed, setInstalled] = useState(false);
  const [standalone, setStandalone] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [help, setHelp] = useState(false);
  const [message, setMessage] = useState("");
  const [offline, setOffline] = useState<OfflineState>("preparing");
  useEffect(() => {
    alive.current = true;
    setStandalone(isStandalone());
    const stopInstall = observeInstallation({
      available: (event) => { deferred.current = event; setCanInstall(true); },
      installed: () => { deferred.current = null; setCanInstall(false); setInstalled(true); setInstalling(false); setMessage(""); },
      displayChanged: () => setStandalone(isStandalone()),
    });
    const stopOffline = registerOfflineShell(setOffline);
    return () => { alive.current = false; deferred.current = null; stopInstall(); stopOffline(); };
  }, []);
  const install = async () => {
    const event = deferred.current;
    if (!event) { setHelp((open) => !open); return; }
    deferred.current = null; setCanInstall(false); setInstalling(true); setMessage("");
    try {
      await event.prompt();
      const choice = await event.userChoice;
      if (alive.current) setMessage(choice.outcome === "accepted" ? "已提交安装请求，请等待浏览器完成。" : "已取消安装，仍可在浏览器里继续玩。");
    } catch {
      if (alive.current) { setMessage("未能打开安装窗口，请使用浏览器菜单安装。"); setHelp(true); }
    } finally { if (alive.current) setInstalling(false); }
  };
  if (!visible) return null;
  const readyText = offline === "ready" ? "离线资源已准备好" : offline === "update-waiting" ? "新版本已就绪" : offline === "development" ? "开发预览不启用离线缓存" : offline === "unavailable" ? "离线资源尚未准备好，请联网重试" : "正在准备离线资源…";
  return (
    <section className="install-app" aria-label="安装方块纪行应用">
      <div className="install-app-heading">
        <img src={`${import.meta.env.BASE_URL}icons/icon-192.png`} alt="" width="40" height="40" />
        <div><strong>{standalone ? "方块纪行应用" : "把这片世界带到桌面"}</strong><span>{readyText}</span></div>
        {!standalone && !installed && <button type="button" onClick={() => void install()} disabled={installing}>{installing ? "请在浏览器中确认…" : canInstall ? "安装应用" : "安装说明"}</button>}
        {installed && !standalone && <span className="install-app-confirmed">浏览器已确认安装</span>}
      </div>
      {message && !installed && <p className="install-app-message" role="status">{message}</p>}
      {offline === "update-waiting" && <p className="install-app-message" role="status">保存游戏并关闭本应用的所有窗口，再重新打开即可更新。当前游戏会继续运行。</p>}
      {help && !standalone && <div className="install-app-help">
        <p><b>Chrome / Edge：</b>使用地址栏的安装图标，或浏览器菜单中的“安装应用”。没有安装提示时，说明浏览器尚未提供安装入口。</p>
        <p><b>Safari（Mac）：</b>打开“文件 → 添加到程序坞”，或分享菜单中的同名选项。</p>
        <p>首次请联网打开应用，等待离线资源准备完成。存档保存在当前浏览器环境；Safari 桌面应用可能使用独立数据，迁移前先导出存档，再在应用内导入。</p>
        <button type="button" onClick={() => setHelp(false)}>收起说明</button>
      </div>}
    </section>
  );
}
export default InstallApp;
