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
  stacked?: boolean;
  valueSuffix?: string; // e.g. "%" — appended to tooltip values
}

export default function BarChart({
  data,
  xKey,
  series,
  layout = "vertical",
  height = 300,
  stacked = false,
  valueSuffix,
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
              tick={{ fontSize: 12, fill: "hsl(var(--foreground))" }}
            />
            <YAxis
              type="category"
              dataKey={xKey}
              tick={{ fontSize: 12, fill: "hsl(var(--foreground))" }}
              width={100}
            />
          </>
        ) : (
          <>
            <XAxis
              dataKey={xKey}
              tick={{ fontSize: 12, fill: "hsl(var(--foreground))" }}
            />
            <YAxis
              tick={{ fontSize: 12, fill: "hsl(var(--foreground))" }}
            />
          </>
        )}
        <Tooltip
          contentStyle={{
            backgroundColor: "hsl(var(--card))",
            border: "1px solid hsl(var(--border))",
            borderRadius: 8,
            color: "hsl(var(--foreground))",
          }}
          labelStyle={{ color: "hsl(var(--foreground))", fontWeight: 600 }}
          itemStyle={{ color: "hsl(var(--foreground))" }}
          {...(valueSuffix ? {
            formatter: (value: unknown) => {
              const n = Number(value);
              return Number.isFinite(n) ? `${Math.round(n * 10) / 10}${valueSuffix}` : String(value);
            },
          } : {})}
        />
        {(series.length > 1 || stacked) && <Legend />}
        {series.map((s) => (
          <Bar
            key={s.dataKey}
            dataKey={s.dataKey}
            name={s.name}
            fill={s.color}
            {...(stacked ? { stackId: "stack" } : {})}
          />
        ))}
      </RechartsBarChart>
    </ResponsiveContainer>
  );
}
