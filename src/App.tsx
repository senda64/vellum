import { useRef, useState, type CSSProperties } from "react";
import "./App.css";

type Blot = {
  id: number;
  x: number;
  y: number;
  size: number;
  hue: number;
};

let blotId = 0;

export default function App() {
  const sheetRef = useRef<HTMLDivElement>(null);
  const [blots, setBlots] = useState<Blot[]>([]);

  function addBlot(clientX: number, clientY: number) {
    const sheet = sheetRef.current;
    if (!sheet) return;
    const rect = sheet.getBoundingClientRect();
    setBlots((prev) => [
      ...prev.slice(-24),
      {
        id: ++blotId,
        x: ((clientX - rect.left) / rect.width) * 100,
        y: ((clientY - rect.top) / rect.height) * 100,
        size: 12 + Math.random() * 28,
        hue: 200 + Math.random() * 40,
      },
    ]);
  }

  return (
    <div className="page">
      <div
        ref={sheetRef}
        className="sheet"
        onPointerDown={(e) => {
          if ((e.target as HTMLElement).closest("button")) return;
          addBlot(e.clientX, e.clientY);
        }}
      >
        <div className="grain" aria-hidden />
        {blots.map((blot) => (
          <span
            key={blot.id}
            className="blot"
            style={
              {
                "--x": `${blot.x}%`,
                "--y": `${blot.y}%`,
                "--size": `${blot.size}vmin`,
                "--hue": blot.hue,
              } as CSSProperties
            }
          />
        ))}

        <header className="hero">
          <p className="brand">Vellum</p>
          <h1>紙の上に、インクを落としてみる。</h1>
          <p className="lede">
            画面をタップするとインクが広がります。質感だけの小さなデモです。
          </p>
          <div className="actions">
            <button type="button" className="primary" onClick={() => addBlot(
              (sheetRef.current?.getBoundingClientRect().left ?? 0) +
                (sheetRef.current?.clientWidth ?? 0) * (0.35 + Math.random() * 0.3),
              (sheetRef.current?.getBoundingClientRect().top ?? 0) +
                (sheetRef.current?.clientHeight ?? 0) * (0.45 + Math.random() * 0.25),
            )}>
              インクを落とす
            </button>
            <button
              type="button"
              className="ghost"
              onClick={() => setBlots([])}
              disabled={blots.length === 0}
            >
              消す
            </button>
          </div>
        </header>
      </div>
    </div>
  );
}
