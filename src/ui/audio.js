// Optional effects start only after a user gesture. The domain never imports audio.
export function createAudio({ volume }) {
  let context;
  const active = new Set();
  async function ready() {
    const Constructor =
      globalThis.AudioContext ?? globalThis.webkitAudioContext;
    if (!Constructor) return null;
    context ??= new Constructor();
    if (context.state === "suspended") await context.resume();
    return context;
  }
  function tone(frequency, duration, delay = 0, type = "sine") {
    if (!context || context.state !== "running") return;
    const oscillator = context.createOscillator(),
      gain = context.createGain();
    const start = context.currentTime + delay;
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, start);
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(volume, start + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(start);
    oscillator.stop(start + duration);
    active.add(oscillator);
    oscillator.onended = () => {
      active.delete(oscillator);
      oscillator.disconnect();
      gain.disconnect();
    };
  }
  return {
    ready,
    stop() {
      for (const oscillator of active) {
        try {
          oscillator.stop();
        } catch {
          /* already ended */
        }
      }
      active.clear();
    },
    tick() {
      tone(740, 0.045, 0, "triangle");
    },
    pick() {
      tone(520, 0.14);
      tone(780, 0.2, 0.07);
    },
    collect() {
      tone(880, 0.13);
      tone(1320, 0.2, 0.08);
    },
    reel(index) {
      tone(180 + index * 90, 0.15, 0, "triangle");
    },
    win() {
      [523, 659, 784, 1047].forEach((frequency, i) =>
        tone(frequency, 0.35, i * 0.09),
      );
    },
    fire() {
      [220, 330, 440, 660].forEach((frequency, i) =>
        tone(frequency, 0.3, i * 0.12, "triangle"),
      );
    },
  };
}
