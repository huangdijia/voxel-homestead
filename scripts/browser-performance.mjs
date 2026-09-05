/** DEV-only automated flight through the real renderer, chunk worker, simulation,
 * entities and autosaves. Fixed wall-clock duration, not a simulated CPU test.
 * Run in a NEW creative world after bringing the browser to the foreground.
 * This intentionally moves that test world's player along a square route.
 */
export function startBrowserBenchmark({ durationSeconds = 900 } = {}) {
  const game = window.__voxelGame;
  if (!game || game.simulation.manifest.mode !== "creative")
    throw new Error("Open a dedicated creative performance world first.");
  if (window.__voxelBenchmark?.status === "running")
    throw new Error("Benchmark already running.");
  const sim = game.simulation;
  game.updateSettings({
    renderDistance: 6,
    volume: 0,
    sensitivity: 1,
    fov: 75,
    quality: "medium",
  });
  game.startMouseFallback();
  sim.player.flying = true;
  const report = (window.__voxelBenchmark = {
    status: "warming",
    method:
      "900 wall-clock seconds, automated 4 blocks/s flight; real renderer, worker, simulation and autosave. Camera position is a development fixture, not manual control.",
    durationSeconds,
    viewport: {
      width: innerWidth,
      height: innerHeight,
      dpr: devicePixelRatio,
      renderDpr: game.renderer.getPixelRatio(),
    },
    settings: { renderDistance: 6, quality: "medium", fov: 75 },
    world: sim.manifest.name,
    samples: [],
    hiddenFrames: 0,
    pausedFrames: 0,
    start: null,
    end: null,
  });
  let start = 0,
    sampleAt = 0,
    warmup = performance.now(),
    raf = 0;
  const side = durationSeconds;
  const sample = (seconds) => ({
    seconds: Math.round(seconds * 100) / 100,
    position: { ...sim.player.position },
    ...game.getMetrics(),
    heapBytes: performance.memory?.usedJSHeapSize ?? null,
  });
  const move = (seconds) => {
    const phase = Math.min(3, Math.floor(seconds / (durationSeconds / 4)));
    const fraction = Math.min(
      1,
      (seconds - phase * (durationSeconds / 4)) / (durationSeconds / 4),
    );
    const x =
      phase === 0
        ? side * fraction
        : phase === 1
          ? side
          : phase === 2
            ? side * (1 - fraction)
            : 0;
    const z =
      phase === 0
        ? 0
        : phase === 1
          ? side * fraction
          : phase === 2
            ? side
            : side * (1 - fraction);
    sim.player.position = {
      x: x + 0.5,
      y: game.world.getSurface(x, z) + 9,
      z: z + 0.5,
    };
    sim.player.yaw = [-Math.PI / 2, Math.PI, Math.PI / 2, 0][phase];
    sim.player.pitch = -0.24;
  };
  const frame = (now) => {
    if (!start) {
      move(0);
      if (
        !game.world.ready ||
        game.world.stats.pending ||
        now - warmup < 5000
      ) {
        raf = requestAnimationFrame(frame);
        return;
      }
      start = now;
      sampleAt = now;
      report.status = "running";
      report.start = new Date().toISOString();
      game.resetMetrics();
      report.samples.push(sample(0));
    }
    const seconds = (now - start) / 1000;
    if (document.hidden) report.hiddenFrames++;
    if (game.paused) report.pausedFrames++;
    move(Math.min(seconds, durationSeconds));
    if (now - sampleAt >= 15000) {
      report.samples.push(sample(seconds));
      sampleAt = now;
    }
    if (seconds >= durationSeconds) {
      report.status = "complete";
      report.end = new Date().toISOString();
      report.elapsedSeconds = seconds;
      report.final = sample(seconds);
      report.samples.push(report.final);
      game.setPaused(true);
      game.onOverlay?.("pause");
      void game.save().catch((e) => {
        report.saveError = String(e);
      });
      return;
    }
    raf = requestAnimationFrame(frame);
  };
  report.stop = () => {
    cancelAnimationFrame(raf);
    report.status = "cancelled";
    game.setPaused(true);
    game.onOverlay?.("pause");
  };
  raf = requestAnimationFrame(frame);
  return { status: report.status, durationSeconds, viewport: report.viewport };
}
