import { useEffect, useRef, useState } from "react";
import "./app.css";
import { bubbleSortOps, mergeSortOps, quickSortOps } from "./algorithms";
import { createThreeLaneViz } from "./threeLaneViz";
import { initAudio, setMuted, destroyAudio } from "./audio";

function makeRandomArray(n: number) {
  // values 1..n shuffled
  const a = Array.from({ length: n }, (_, i) => i + 1);
  for (let i = a.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export default function App() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const vizRef = useRef<ReturnType<typeof createThreeLaneViz> | null>(null);

  const size = 48;
  const [seed, setSeed] = useState(() => makeRandomArray(size));
  const [speed, setSpeed] = useState(1.0); // multiplier
  const [muted, setMutedState] = useState(false);

  const [status, setStatus] = useState<"idle" | "running" | "paused">("idle");

  useEffect(() => {
    if (!containerRef.current) return;
    vizRef.current = createThreeLaneViz(containerRef.current, seed, size);

    return () => {
      vizRef.current?.destroy();
      vizRef.current = null;
      destroyAudio();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    vizRef.current?.reset(seed);
  }, [seed]);

  const controlsDisabled = status === "running" || status === "paused";

  async function start() {
    if (!vizRef.current) return;
    if (vizRef.current.isRunning()) return;

    // Init audio context (requires user gesture)
    initAudio();

    // Reset lane visuals back to the seed before starting
    vizRef.current.reset(seed);

    setStatus("running");

    // Each lane gets its own generator from the same seed
    const bubble = bubbleSortOps(seed);
    const merge = mergeSortOps(seed);
    const quick = quickSortOps(seed);

    // speed multiplier: lower is faster, higher is slower
    // (we invert slider semantics below for intuitive UI)
    await vizRef.current.runAll(bubble, merge, quick, speed);

    setStatus("idle");
  }

  function togglePause() {
    if (!vizRef.current) return;
    if (status === "running") {
      vizRef.current.pause();
      setStatus("paused");
    } else if (status === "paused") {
      vizRef.current.resume();
      setStatus("running");
    }
  }

  function toggleMute() {
    const next = !muted;
    setMutedState(next);
    setMuted(next);
  }

  function reset() {
    setSeed(makeRandomArray(size));
    setStatus("idle");
  }

  return (
    <div className="page">
      <header className="top">
        <div className="title">
          <div className="h1">3D Sorting Race</div>
          <div className="sub">
            Bubble (slow) vs Merge (mid) vs Quick (fast) — highlighted compares / swaps / overwrites
          </div>
        </div>

        <div className="controls">
          <button onClick={start} disabled={controlsDisabled}>
            Start
          </button>
          <button onClick={togglePause} disabled={status === "idle"}>
            {status === "paused" ? "Resume" : "Pause"}
          </button>
          <button onClick={reset}>
            Reset
          </button>
          <button onClick={toggleMute}>
            {muted ? "Unmute" : "Mute"}
          </button>

          <div className="slider">
            <label>
              Slow-motion: <span className="mono">{speed.toFixed(2)}×</span>
            </label>
            <input
              type="range"
              min={0.3}
              max={3.0}
              step={0.05}
              value={speed}
              onChange={(e) => setSpeed(parseFloat(e.target.value))}
              disabled={controlsDisabled}
            />
          </div>

          <div className={`pill ${status}`}>
            {status === "running" ? "Running" : status === "paused" ? "Paused" : "Ready"}
          </div>
        </div>
      </header>

      <main className="main">
        <div ref={containerRef} className="canvasWrap" />
      </main>
    </div>
  );
}