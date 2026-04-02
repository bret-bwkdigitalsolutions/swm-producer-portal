"use client";

import {
  ResponsiveContainer,
  BarChart as RechartsBarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";

interface Series {
  dataKey: string;
  name: string;
  color: string;
}

interface BarChartProps {
  data: Record<string, unknown>[];
  xKey: string;
  series: Series[];
  layout?: "horizontal" | "vertical";
  height?: number;
}

export default function BarChart({
  data,
  xKey,
  series,
  layout = "vertical",
  height = 300,
}: BarChartProps) {
  const isHorizontal = layout === "horizontal";

  return (
    <ResponsiveContainer width="100%" height={height}>
      <RechartsBarChart
        data={data}
        layout={isHorizontal ? "vertical" : "horizontal"}
      >
        <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
        {isHorizontal ? (
          <>
            <XAxis
              type="number"
              tick={{ fontSize: 12 }}
              className="text-muted-foreground"
            />
            <YAxis
              type="category"
              dataKey={xKey}
              tick={{ fontSize: 12 }}
              className="text-muted-foreground"
              width={100}
            />
          </>
        ) : (
          <>
            <XAxis
              dataKey={xKey}
              tick={{ fontSize: 12 }}
              className="text-muted-foreground"
            />
            <YAxis
              tick={{ fontSize: 12 }}
              className="text-muted-foreground"
            />
          </>
        )}
        <Tooltip
          contentStyle={{
            backgroundColor: "hsl(var(--card))",
            border: "1px solid hsl(var(--border))",
            borderRadius: 8,
          }}
        />
        {series.length > 1 && <Legend />}
        {series.map((s) => (
          <Bar
            key={s.dataKey}
            dataKey={s.dataKey}
            name={s.name}
            fill={s.color}
          />
        ))}
      </RechartsBarChart>
    </ResponsiveContainer>
  );
}
