import React from "react";
import { AbsoluteFill, Audio, Img, Sequence, interpolate, staticFile, useCurrentFrame, useVideoConfig, Easing } from "remotion";

// The depot board at 5am: navy, paper, hi-vis. Same tokens as the app.
const NAVY = "#0f1b2d", PAPER = "#eceeeb", HIVIS = "#ffd21f", INK = "#131a24", MUTED = "#9aa5b4", DECIDE = "#e6461c";
const FPS = 30;

type Shot = { img: string; from: { x: number; y: number; s: number }; to: { x: number; y: number; s: number }; at?: number };
export type Scene = { id: string; audio: string; seconds: number; caption: string; sub?: string; card?: { title: string; line: string }; shots?: Shot[] };

// x,y = pan offset as fraction of overshoot (0..1), s = scale (1 = fit width). Shot.at = seconds into the scene when it starts.
export const FULL_SCENES: Scene[] = [
  { id: "open", audio: "01_open.mp3", seconds: 20.2, caption: "The 5pm job", card: { title: "DayRunner", line: "Tomorrow's day, decided by 5pm." },
    shots: [{ img: "01_day_top.png", from: { x: 0, y: 0, s: 1.0 }, to: { x: 0, y: 0.05, s: 1.04 }, at: 9 }] },
  { id: "board", audio: "02_board.mp3", seconds: 13.5, caption: "Tomorrow, pulled in and allocated", sub: "4 departures · 38 guests · 1,399 km · 37.8h work time",
    shots: [{ img: "01_day_top.png", from: { x: 0, y: 0, s: 1.0 }, to: { x: 0.2, y: 0.25, s: 1.35 } }, { img: "05_allocation.png", from: { x: 0.5, y: 0.2, s: 1.15 }, to: { x: 0.5, y: 0.35, s: 1.25 }, at: 7 }] },
  { id: "exceptions", audio: "03_exceptions.mp3", seconds: 20.8, caption: "Decide before the day", sub: "Each exception comes with options. Pick one, it moves on.",
    shots: [{ img: "02_exceptions.png", from: { x: 0.1, y: 0.55, s: 1.2 }, to: { x: 0.15, y: 0.68, s: 1.3 } }, { img: "03_exception_hover.png", from: { x: 0.85, y: 0.6, s: 1.5 }, to: { x: 0.85, y: 0.6, s: 1.55 }, at: 13 }, { img: "04_exception_resolved.png", from: { x: 0.85, y: 0.6, s: 1.55 }, to: { x: 0.6, y: 0.65, s: 1.4 }, at: 16 }] },
  { id: "messages", audio: "04_messages.mp3", seconds: 12.5, caption: "Guest messages, in your voice", sub: "Nothing sends until you approve.",
    shots: [{ img: "06_messages.png", from: { x: 0.3, y: 0.75, s: 1.2 }, to: { x: 0.3, y: 0.85, s: 1.3 } }, { img: "07_messages_approved.png", from: { x: 0.3, y: 0.85, s: 1.3 }, to: { x: 0.3, y: 0.9, s: 1.35 }, at: 7 }] },
  { id: "suppliers", audio: "05_suppliers.mp3", seconds: 23.9, caption: "Suppliers, grouped like your Gmail", sub: "Meals · Activities · Accommodation · Transport, by day",
    shots: [{ img: "08_suppliers.png", from: { x: 0.2, y: 0.8, s: 1.2 }, to: { x: 0.2, y: 0.95, s: 1.3 } }, { img: "09_suppliers_whole_tour.png", from: { x: 0.2, y: 0.5, s: 1.15 }, to: { x: 0.2, y: 0.8, s: 1.25 }, at: 12 }] },
  { id: "runsheet", audio: "06_runsheet.mp3", seconds: 16.6, caption: "Every driver gets their own brief", sub: "And the guide gets the day sheet on a multi-day tour.",
    shots: [{ img: "11_runsheet_charter_briefs.png", from: { x: 0.2, y: 0.7, s: 1.2 }, to: { x: 0.2, y: 0.9, s: 1.3 } }, { img: "12_daysheet_charter.png", from: { x: 0.2, y: 0.1, s: 1.1 }, to: { x: 0.2, y: 0.5, s: 1.25 }, at: 9 }] },
  { id: "close", audio: "07_close.mp3", seconds: 20.2, caption: "Three paid pilots, New Zealand, this spring", card: { title: "Tomorrow's day, decided by 5pm.", line: "duncan@prompt6.com · duncanc82.github.io/dayrunner" },
    shots: [{ img: "01_day_top.png", from: { x: 0, y: 0.05, s: 1.04 }, to: { x: 0, y: 0, s: 1.0 } }] },
];

export const SHORT_SCENES: Scene[] = [FULL_SCENES[0], FULL_SCENES[2], FULL_SCENES[3], FULL_SCENES[6]];

export const totalFrames = (scenes: Scene[]) => scenes.reduce((a, s) => a + Math.round(s.seconds * FPS), 0);

const KenBurns: React.FC<{ shot: Shot; durationFrames: number }> = ({ shot, durationFrames }) => {
  const frame = useCurrentFrame();
  const t = interpolate(frame, [0, durationFrames], [0, 1], { extrapolateRight: "clamp", easing: Easing.inOut(Easing.cubic) });
  const s = shot.from.s + (shot.to.s - shot.from.s) * t;
  const x = shot.from.x + (shot.to.x - shot.from.x) * t;
  const y = shot.from.y + (shot.to.y - shot.from.y) * t;
  // Image is 1440x900 logical rendered to 1920 wide; overshoot = (s-1) * size
  const W = 1920, H = 1200; // 1440x900 scaled to 1920 wide = 1920x1200; frame is 1080 tall
  const overshootX = W * s - 1920, overshootY = H * s - 1080;
  const fade = interpolate(frame, [0, 10], [0, 1], { extrapolateRight: "clamp" });
  return (
    <AbsoluteFill style={{ opacity: fade, overflow: "hidden" }}>
      <Img src={staticFile(`shots/${shot.img}`)} style={{ position: "absolute", width: W * s, height: H * s, left: -overshootX * x, top: -overshootY * y }} />
    </AbsoluteFill>
  );
};

const Card: React.FC<{ title: string; line: string; durationFrames: number }> = ({ title, line, durationFrames }) => {
  const frame = useCurrentFrame();
  const inA = interpolate(frame, [0, 18], [0, 1], { extrapolateRight: "clamp" });
  const rule = interpolate(frame, [10, 40], [0, 1], { extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) });
  const outA = interpolate(frame, [durationFrames - 15, durationFrames], [1, 0], { extrapolateLeft: "clamp" });
  return (
    <AbsoluteFill style={{ background: NAVY, color: "#fff", justifyContent: "center", padding: "0 160px", opacity: Math.min(inA, outA), fontFamily: "'IBM Plex Sans', system-ui, sans-serif" }}>
      <div style={{ fontFamily: "'Barlow Condensed', 'Arial Narrow', sans-serif", fontWeight: 800, fontSize: 132, lineHeight: 0.95, textTransform: "uppercase", letterSpacing: "0.005em", maxWidth: 1400 }}>{title}</div>
      <div style={{ width: 240 * rule, height: 10, background: HIVIS, margin: "34px 0" }} />
      <div style={{ fontSize: 40, color: "#c5ccd6", maxWidth: 1200 }}>{line}</div>
      <div style={{ position: "absolute", left: 160, bottom: 90, fontFamily: "'IBM Plex Mono', monospace", fontSize: 24, letterSpacing: "0.14em", textTransform: "uppercase", color: MUTED }}>DayRunner · day-of operations</div>
    </AbsoluteFill>
  );
};

const CaptionBar: React.FC<{ caption: string; sub?: string; durationFrames: number }> = ({ caption, sub, durationFrames }) => {
  const frame = useCurrentFrame();
  const y = interpolate(frame, [4, 22], [60, 0], { extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) });
  const a = interpolate(frame, [4, 22], [0, 1], { extrapolateRight: "clamp" });
  const outA = interpolate(frame, [durationFrames - 10, durationFrames], [1, 0], { extrapolateLeft: "clamp" });
  return (
    <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, transform: `translateY(${y}px)`, opacity: Math.min(a, outA), display: "flex", alignItems: "stretch", fontFamily: "'IBM Plex Sans', system-ui, sans-serif" }}>
      <div style={{ width: 16, background: HIVIS }} />
      <div style={{ background: NAVY, color: "#fff", padding: "22px 40px 26px", minWidth: 900, maxWidth: 1400 }}>
        <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 46, textTransform: "uppercase", letterSpacing: "0.02em", lineHeight: 1 }}>{caption}</div>
        {sub && <div style={{ fontSize: 26, color: "#c5ccd6", marginTop: 8 }}>{sub}</div>}
      </div>
    </div>
  );
};

const SceneView: React.FC<{ scene: Scene; durationFrames: number }> = ({ scene, durationFrames }) => {
  const shots = scene.shots ?? [];
  // A card scene shows the card for the first ~9s (open) or the last part (close), then the shot.
  const cardFrames = scene.card ? (scene.id === "close" ? durationFrames : Math.round(9 * FPS)) : 0;
  return (
    <AbsoluteFill style={{ background: PAPER }}>
      {shots.map((sh, i) => {
        const start = Math.round((sh.at ?? 0) * FPS);
        const next = shots[i + 1] ? Math.round((shots[i + 1].at ?? 0) * FPS) : durationFrames;
        return (
          <Sequence key={i} from={start} durationInFrames={Math.max(1, next - start)} layout="none">
            <KenBurns shot={sh} durationFrames={next - start} />
          </Sequence>
        );
      })}
      {scene.id !== "close" && <CaptionBar caption={scene.caption} sub={scene.sub} durationFrames={durationFrames} />}
      {scene.card && scene.id === "open" && <Sequence from={0} durationInFrames={cardFrames} layout="none"><Card title={scene.card.title} line={scene.card.line} durationFrames={cardFrames} /></Sequence>}
      {scene.card && scene.id === "close" && <Sequence from={Math.round(6 * FPS)} durationInFrames={durationFrames - Math.round(6 * FPS)} layout="none"><Card title={scene.card.title} line={scene.card.line} durationFrames={durationFrames - Math.round(6 * FPS)} /></Sequence>}
      <Audio src={staticFile(`narration/${scene.audio}`)} />
    </AbsoluteFill>
  );
};

const FONTS = "@import url('https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@700;800&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=block');";

export const Walkthrough: React.FC<{ scenes: Scene[] }> = ({ scenes }) => {
  let cursor = 0;
  return (
    <AbsoluteFill style={{ background: NAVY }}>
      <style>{FONTS}</style>
      {scenes.map((sc) => {
        const d = Math.round(sc.seconds * FPS); const from = cursor; cursor += d;
        return <Sequence key={sc.id} from={from} durationInFrames={d}><SceneView scene={sc} durationFrames={d} /></Sequence>;
      })}
    </AbsoluteFill>
  );
};
