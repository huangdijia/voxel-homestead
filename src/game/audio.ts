/** Small original, synthesized game sounds; no network or licensed recordings. */
export class GameAudio {
  private context: AudioContext | null = null;
  volume = 0.5;
  unlock() {
    try {
      this.context ??= new AudioContext();
      if (this.context.state === "suspended") void this.context.resume();
    } catch {
      /* audio is optional */
    }
  }
  play(kind: string) {
    const ctx = this.context;
    if (!ctx || ctx.state !== "running" || this.volume <= 0) return;
    const at = ctx.currentTime,
      gain = ctx.createGain();
    gain.connect(ctx.destination);
    const presets: Record<string, [number, number, number, OscillatorType]> = {
      pickup: [620, 990, 0.09, "sine"],
      craft: [390, 780, 0.15, "triangle"],
      place: [170, 95, 0.08, "triangle"],
      dig: [100, 60, 0.045, "square"],
      break: [140, 45, 0.09, "sawtooth"],
      step: [80, 45, 0.03, "triangle"],
      hurt: [160, 50, 0.18, "sawtooth"],
      hit: [110, 40, 0.09, "square"],
      door: [190, 110, 0.12, "triangle"],
      eat: [200, 160, 0.1, "square"],
      equip: [420, 720, 0.13, "triangle"],
      sleep: [330, 660, 0.5, "sine"],
      explode: [70, 15, 0.5, "sawtooth"],
    };
    const [start, end, duration, type] = presets[kind] ?? presets.place;
    gain.gain.setValueAtTime(
      this.volume * (kind === "step" ? 0.05 : kind === "dig" ? 0.035 : 0.1),
      at,
    );
    gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(start, at);
    osc.frequency.exponentialRampToValueAtTime(end, at + duration);
    osc.connect(gain);
    osc.start(at);
    osc.stop(at + duration);
    osc.onended = () => {
      osc.disconnect();
      gain.disconnect();
    };
  }
  dispose() {
    void this.context?.close();
    this.context = null;
  }
}
