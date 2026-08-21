import React, { useId } from "react";

interface MiniSparklineProps {
  data?: number[];
  color?: "emerald" | "rose";
  strokeColor?: string;
  strokeWidth?: number;
  areaOpacity?: number;
  verticalPadding?: number;
  height?: number;
  className?: string;
}

/**
 * Generates Catmull-Rom smooth cubic bezier SVG path
 */
function getSplinePath(points: { x: number; y: number }[]): string {
  if (points.length === 0) return "";
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;
  if (points.length === 2) {
    return `M ${points[0].x} ${points[0].y} L ${points[1].x} ${points[1].y}`;
  }

  let path = `M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`;

  for (let i = 0; i < points.length - 1; i++) {
    const p0 = i > 0 ? points[i - 1] : points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = i != points.length - 2 ? points[i + 2] : p2;

    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;

    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;

    path += ` C ${cp1x.toFixed(1)} ${cp1y.toFixed(1)}, ${cp2x.toFixed(1)} ${cp2y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
  }

  return path;
}

export function MiniSparkline({
  data = [15, 25, 20, 35, 28, 42, 38, 50],
  color = "emerald",
  strokeColor,
  strokeWidth = 2.2,
  areaOpacity = 0.22,
  verticalPadding = 6,
  height = 48,
  className = "w-full h-12",
}: MiniSparklineProps) {
  const uniqueId = useId().replace(/:/g, "-");
  const gradientId = `sparkline-grad-${color}-${uniqueId}`;

  const width = 160;
  const paddingY = Math.min(verticalPadding, Math.max((height - 1) / 2, 0));
  const effectiveHeight = height - paddingY * 2;

  const min = Math.min(...data);
  const max = Math.max(...data);
  const hasRange = max !== min;
  const range = hasRange ? max - min : 1;

  const points = data.map((val, idx) => {
    const x = (idx / (data.length - 1)) * width;
    const normalizedY = hasRange ? (val - min) / range : 0.5;
    // Invert Y so highest value is near top
    const y = paddingY + (1 - normalizedY) * effectiveHeight;
    return { x, y };
  });

  const linePath = getSplinePath(points);
  const lastPoint = points[points.length - 1];
  const firstPoint = points[0];
  const areaPath = `${linePath} L ${lastPoint.x.toFixed(1)} ${height} L ${firstPoint.x.toFixed(1)} ${height} Z`;

  const primaryStroke = strokeColor || (color === "emerald" ? "#10B981" : "#F43F5E");
  const stopColor = strokeColor || (color === "emerald" ? "#10B981" : "#F43F5E");

  return (
    <div className={`relative overflow-hidden ${className}`}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        className="w-full h-full block overflow-visible"
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={stopColor} stopOpacity={areaOpacity} />
            <stop offset="85%" stopColor={stopColor} stopOpacity={Math.min(areaOpacity * 0.1, 0.02)} />
            <stop offset="100%" stopColor={stopColor} stopOpacity="0.0" />
          </linearGradient>
        </defs>

        {/* Fading area underneath spline */}
        <path d={areaPath} fill={`url(#${gradientId})`} />

        {/* Smooth spline wave line */}
        <path
          d={linePath}
          fill="none"
          stroke={primaryStroke}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}

export default MiniSparkline;
