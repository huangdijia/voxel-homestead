/** DEV-only deterministic integration fixture. Run only in the named fresh test world.
 * Uses actual Game/Simulation/VoxelWorld and browser IndexedDB, accelerated 60 Hz.
 * All terrain, inventory and position grants are declared; this is not a manual
 * survival playthrough or an FPS benchmark. Does not open/control a browser.
 */
export async function runBrowserNatural() {
  const game = window.__voxelGame;
  const report = { version: 1, passed: false, startedAt: new Date().toISOString(), stages: [], checkpoints: [], errors: [], advancedSeconds: 0,
    fixtureGrants: ['Creative test world; elevated platform and lined fluid channels at y=40', 'Water/lava sources, sand/gravel, soil and saplings placed through Simulation.setBlock', 'Player position and hotbar developer fixtures; fixed steps accelerated at 60 Hz'],
    limitations: ['Programmatic game rule integration, not manual survival acquisition or a frame-rate benchmark', 'Page reload and screenshots are recorded separately by the browser operator'] };
  window.__naturalAcceptance = report;
  const assert = (value, message) => { if (!value) throw new Error(message); };
  const canonical = v => JSON.stringify(v, (_k, value) => value && typeof value === 'object' && !Array.isArray(value) ? Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b))) : value);
  try {
    assert(game?.simulation.manifest.name === '溪流与橡树 · 动态验收' && game.simulation.manifest.seed === 'M2-natural-20260905', 'Requires the named dedicated world');
    assert(game.world.getChanges().length === 0, 'Requires a fresh empty test world');
    game.setPaused(true);
    const sim = game.simulation, world = game.world;
    const storage = await import('/src/game/storage.ts');
    sim.player.position = { x: .5, y: 47, z: 12.5 }; sim.player.velocity = { x: 0, y: 0, z: 0 }; sim.player.flying = true;
    const set = (x,y,z,id) => assert(sim.setBlock(x,y,z,id), `Failed block edit ${x},${y},${z}`);
    const stage = (name, details = {}) => report.stages.push({ name, passed: true, ...details });
    const advance = async seconds => {
      for (let i=0;i<seconds*60;i++) {
        sim.step(1/60, {forward:0,right:0,jump:false,sprint:false,sneak:false});
        report.advancedSeconds += 1/60;
        if (i%30===0) await new Promise(resolve => requestAnimationFrame(resolve));
      }
    };
    const checkpoint = async name => {
      const before = storage.validateSave(sim.snapshot());
      await storage.saveWorld(before); const after = await storage.loadWorld(before.manifest.id);
      assert(canonical(before) === canonical(after), `Checkpoint mismatch ${name}`);
      report.checkpoints.push({name, same:true, worldId:before.manifest.id, fluidTasks:before.fluids.tasks.length, naturalQueue:before.natural.queue.length, changes:before.changes.length});
    };
    const start = performance.now();
    while (![[-14,-10],[14,10]].every(([x,z])=>world.isReady(x,z))) {
      assert(performance.now()-start<20000,'Loading timeout');
      await new Promise(resolve=>requestAnimationFrame(resolve));
    }
    stage('preflight', {mode:sim.manifest.mode, saveVersion:sim.manifest.version, generator:sim.manifest.generatorVersion});
    for(let x=-14;x<=14;x++) for(let z=-10;z<=10;z++) {
      set(x,40,z,11); for(let y=41;y<=47;y++) if(world.getBlock(x,y,z)) set(x,y,z,0);
    }
    for(const [left,right] of [[-12,-2],[1,11]]) for(let x=left;x<=right;x++) for(let z=-8;z<=-4;z++) {
      set(x,40,z,12);
      if(x===left||x===right||z===-8||z===-4) for(let y=41;y<=43;y++) set(x,y,z,12);
    }
    set(-10,43,-6,6); set(3,43,-6,76);
    await advance(.5); await checkpoint('spreading');
    await advance(12);
    const waterCells=world.getChanges().filter(c=>c.x>=-11&&c.x<=-3&&c.z>=-7&&c.z<=-5&&(c.id===6||c.id>=68&&c.id<=75));
    const lavaCells=world.getChanges().filter(c=>c.x>=2&&c.x<=10&&c.z>=-7&&c.z<=-5&&c.id>=76&&c.id<=80);
    assert(waterCells.some(c=>c.id===75)&&waterCells.some(c=>c.id>=68&&c.id<=74),'Waterfall or horizontal flow missing');
    assert(lavaCells.some(c=>c.id===80)&&lavaCells.some(c=>c.id>=77&&c.id<=79),'Lava flow missing');
    stage('propagation',{waterCells:waterCells.length,lavaCells:lavaCells.length});
    set(-10,43,-6,0); await advance(12);
    assert(!world.getChanges().some(c=>c.x>=-11&&c.x<=-3&&c.z>=-7&&c.z<=-5&&(c.id===6||c.id>=68&&c.id<=75)),'Water did not drain after removing source');
    stage('source-removal'); set(-10,43,-6,6);
    for(let x=-2;x<=2;x++) for(let z=1;z<=5;z++) if(Math.abs(x)===2||z===1||z===5) set(x,41,z,12);
    set(-1,41,3,6); set(0,41,3,76); await advance(2);
    assert(world.getBlock(0,41,3)===81,'Lava source did not become obsidian'); stage('contact-obsidian');
    set(-7,46,3,4); set(-7,47,3,5); await advance(3);
    assert(world.getBlock(-7,41,3)===4&&world.getBlock(-7,42,3)===5,'Sand/gravel column not conserved'); stage('gravity');
    set(8,40,4,2); set(8,41,4,83);
    assert(sim.natural.fertilize({x:8,y:41,z:4},15),'Sapling did not grow');
    assert(world.getBlock(8,41,4)===7&&world.getBlock(8,46,4)===8,'Tree model missing trunk/leaves');
    assert(!sim.drops.some(d=>d.stack.id==='oak_sapling'),'Growing tree duplicated sapling');
    set(-10,46,6,8); set(-11,46,6,82); await advance(12);
    assert(world.getBlock(-10,46,6)===0&&world.getBlock(-11,46,6)===82,'Natural/permanent leaf decay wrong'); stage('tree-growth-and-leaf-decay');
    await checkpoint('settled-world');
    const pausedState=canonical({f:sim.fluids.snapshot(),n:sim.natural.snapshot(),t:sim.time});
    await new Promise(resolve=>setTimeout(resolve,350));
    assert(pausedState===canonical({f:sim.fluids.snapshot(),n:sim.natural.snapshot(),t:sim.time}),'Paused simulation advanced'); stage('pause-freezes-updates');
    sim.player.position={x:.5,y:47,z:15.5};sim.player.yaw=0;sim.player.pitch=-.53;
    for(const [i,id] of ['water_bucket','lava_bucket','sand','gravel','oak_sapling','bone_meal','obsidian','leaves','iron_pickaxe'].entries()) sim.player.inventory[i]={id,count:1,...(id==='iron_pickaxe'?{durability:250}:{})};
    sim.player.selected=0; sim.time=4500;
    await checkpoint('visual-fixture');
    report.passed=true; report.saveId=sim.manifest.id; report.viewport={width:innerWidth,height:innerHeight,dpr:devicePixelRatio};
    game.publish();
  } catch(error) {report.errors.push(String(error));}
  report.finishedAt=new Date().toISOString();
  return report;
}
