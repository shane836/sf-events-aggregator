import { ImageResponse } from "next/og";

export const runtime = "edge";
export const alt = "SF Events — a San Francisco calendar.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: "#09090b",
          color: "#f4f4f5",
          padding: "64px 80px",
          fontFamily: "system-ui, -apple-system, sans-serif",
        }}
      >
        <div
          style={{
            fontSize: 24,
            letterSpacing: "0.4em",
            color: "#a1a1aa",
            textTransform: "uppercase",
          }}
        >
          sf events
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div
            style={{
              fontSize: 92,
              fontWeight: 600,
              lineHeight: 1.05,
              letterSpacing: "-0.02em",
            }}
          >
            Music. Comedy. Lectures.
          </div>
          <div
            style={{
              fontSize: 92,
              fontWeight: 600,
              lineHeight: 1.05,
              letterSpacing: "-0.02em",
            }}
          >
            Dancing. Food.
          </div>
          <div
            style={{
              fontSize: 32,
              color: "#a1a1aa",
              marginTop: 12,
            }}
          >
            A daily calendar of what&apos;s happening across San Francisco.
          </div>
        </div>

        <div style={{ display: "flex", gap: 28, alignItems: "center" }}>
          <Dot color="#38bdf8" label="MUSIC" />
          <Dot color="#fb923c" label="COMEDY" />
          <Dot color="#a78bfa" label="LECTURES" />
          <Dot color="#f87171" label="DANCING" />
          <Dot color="#34d399" label="FOOD" />
        </div>
      </div>
    ),
    size,
  );
}

function Dot({ color, label }: { color: string; label: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <div
        style={{
          width: 14,
          height: 14,
          borderRadius: 999,
          background: color,
        }}
      />
      <span
        style={{
          fontSize: 20,
          letterSpacing: "0.3em",
          color: "#d4d4d8",
        }}
      >
        {label}
      </span>
    </div>
  );
}
