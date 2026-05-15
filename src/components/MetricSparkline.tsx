import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { MetricSample } from "../types/domain";
import { formatClock } from "../lib/time";

interface MetricSparklineProps {
  samples: MetricSample[];
  extract: (sample: MetricSample) => number | undefined;
  label: string;
  currentValue?: number;
  format: (value: number) => string;
  color: string;
  height?: number;
  stoppedAt?: string;
  nowMs?: number;
  yMin?: (max: number) => number;
  yMax?: (max: number) => number;
}

const WINDOW_MS = 10 * 60 * 1000;
const PADDING_X = 6;
const PADDING_Y = 6;

function findNearestIndex(points: { x: number; sampleIndex: number }[], x: number): number {
  if (points.length === 0) return -1;
  let lo = 0;
  let hi = points.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (points[mid].x < x) lo = mid + 1;
    else hi = mid;
  }
  if (lo > 0) {
    const prev = points[lo - 1];
    const curr = points[lo];
    if (Math.abs(prev.x - x) < Math.abs(curr.x - x)) return prev.sampleIndex;
  }
  return points[lo].sampleIndex;
}

function MetricSparklineImpl({
  samples,
  extract,
  label,
  currentValue,
  format,
  color,
  height = 120,
  stoppedAt,
  nowMs,
  yMax
}: MetricSparklineProps) {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  useLayoutEffect(() => {
    const node = wrapperRef.current;
    if (!node) return;
    setWidth(node.clientWidth);
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const next = Math.floor(entry.contentRect.width);
        setWidth((prev) => (prev === next ? prev : next));
      }
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const now = nowMs ?? Date.now();
  const tMin = now - WINDOW_MS;
  const innerWidth = Math.max(0, width - PADDING_X * 2);
  const innerHeight = Math.max(0, height - PADDING_Y * 2);

  const data = useMemo(() => {
    if (innerWidth <= 0) return { points: [] as { x: number; y: number; sampleIndex: number; value: number }[], yMaxValue: 0 };
    if (!Array.isArray(samples)) return { points: [], yMaxValue: 0 };
    const filtered: { value: number; sampleIndex: number; t: number }[] = [];
    for (let i = 0; i < samples.length; i += 1) {
      const sample = samples[i];
      if (!sample || typeof sample.timestamp !== "string") continue;
      let value: number | undefined;
      try {
        value = extract(sample);
      } catch {
        continue;
      }
      if (typeof value !== "number" || Number.isNaN(value)) continue;
      const t = Date.parse(sample.timestamp);
      if (Number.isNaN(t) || t < tMin || t > now) continue;
      filtered.push({ value, sampleIndex: i, t });
    }
    if (filtered.length === 0) return { points: [], yMaxValue: 0 };
    const rawMax = filtered.reduce((acc, p) => Math.max(acc, p.value), 0);
    const computedMax = yMax ? yMax(rawMax) : Math.max(1, rawMax * 1.1);
    const points = filtered.map(({ value, sampleIndex, t }) => {
      const xRatio = (t - tMin) / WINDOW_MS;
      const yRatio = computedMax > 0 ? value / computedMax : 0;
      return {
        x: PADDING_X + xRatio * innerWidth,
        y: PADDING_Y + (1 - yRatio) * innerHeight,
        sampleIndex,
        value
      };
    });
    return { points, yMaxValue: computedMax };
  }, [samples, extract, innerWidth, innerHeight, tMin, now, yMax]);

  useEffect(() => {
    if (hoverIndex === null) return;
    const sample = samples[hoverIndex];
    if (!sample) {
      setHoverIndex(null);
      return;
    }
    let value: number | undefined;
    try {
      value = extract(sample);
    } catch {
      value = undefined;
    }
    if (value === undefined) {
      setHoverIndex(null);
    }
  }, [samples, hoverIndex, extract]);

  const polylinePoints = data.points.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(" ");
  const areaPath = data.points.length
    ? `M ${data.points[0].x.toFixed(2)} ${(height - PADDING_Y).toFixed(2)} L ` +
      data.points.map((p) => `${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(" L ") +
      ` L ${data.points[data.points.length - 1].x.toFixed(2)} ${(height - PADDING_Y).toFixed(2)} Z`
    : "";

  const hoverPoint = hoverIndex !== null ? data.points.find((p) => p.sampleIndex === hoverIndex) : undefined;
  const hoverSample = hoverIndex !== null ? samples[hoverIndex] : undefined;

  const onMouseMove = (event: React.MouseEvent<SVGSVGElement>) => {
    if (data.points.length === 0) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const localX = event.clientX - rect.left;
    const nearest = findNearestIndex(
      data.points.map((p) => ({ x: p.x, sampleIndex: p.sampleIndex })),
      localX
    );
    if (nearest >= 0) setHoverIndex(nearest);
  };

  const onMouseLeave = () => setHoverIndex(null);

  const stoppedX = (() => {
    if (!stoppedAt) return null;
    const t = Date.parse(stoppedAt);
    if (Number.isNaN(t) || t < tMin || t > now) return null;
    return PADDING_X + ((t - tMin) / WINDOW_MS) * innerWidth;
  })();

  const tooltipLeft = (() => {
    if (!hoverPoint) return 0;
    if (width === 0) return 0;
    const desired = hoverPoint.x;
    return Math.max(8, Math.min(width - 8, desired));
  })();

  const headerValue = typeof currentValue === "number" ? format(currentValue) : "—";

  return (
    <div className="metric-sparkline" ref={wrapperRef}>
      <header>
        <span className="metric-sparkline-label">{label}</span>
        <strong className="metric-sparkline-value mono-value">{headerValue}</strong>
      </header>
      <div className="metric-sparkline-chart" style={{ height }}>
        {data.points.length === 0 ? (
          <div className="metric-sparkline-empty">No metrics yet</div>
        ) : (
          <svg
            width={width || 0}
            height={height}
            preserveAspectRatio="none"
            onMouseMove={onMouseMove}
            onMouseLeave={onMouseLeave}
          >
            {areaPath ? <path d={areaPath} fill={color} opacity={0.16} /> : null}
            <polyline points={polylinePoints} fill="none" stroke={color} strokeWidth={1.4} strokeLinejoin="round" strokeLinecap="round" />
            {stoppedX !== null ? (
              <line
                x1={stoppedX}
                x2={stoppedX}
                y1={PADDING_Y}
                y2={height - PADDING_Y}
                stroke="var(--muted)"
                strokeWidth={1}
                strokeDasharray="3 3"
              />
            ) : null}
            {hoverPoint ? (
              <>
                <line
                  x1={hoverPoint.x}
                  x2={hoverPoint.x}
                  y1={PADDING_Y}
                  y2={height - PADDING_Y}
                  stroke="var(--text-soft)"
                  strokeWidth={1}
                  strokeOpacity={0.55}
                />
                <circle cx={hoverPoint.x} cy={hoverPoint.y} r={3} fill={color} stroke="var(--surface-2)" strokeWidth={1.2} />
              </>
            ) : null}
          </svg>
        )}
        {hoverPoint && hoverSample ? (
          <div
            className="metric-sparkline-tooltip"
            style={{
              left: tooltipLeft,
              transform: tooltipLeft > width - 100 ? "translate(-100%, 0)" : "translate(0, 0)"
            }}
          >
            <strong>{format(hoverPoint.value)}</strong>
            <span>{formatClock(hoverSample.timestamp)}</span>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export const MetricSparkline = memo(MetricSparklineImpl);
