"use client";

import { useState } from "react";
import BarChart from "@/components/analytics/charts/bar-chart";
import DonutChart from "@/components/analytics/charts/donut-chart";
import ScrapedDataBadge from "@/components/analytics/scraped-data-badge";
import type {
  ScrapedGeoEntry,
  ScrapedAppEntry,
  ScrapedDeviceEntry,
} from "@/app/dashboard/analytics/actions";

type Tab = "geography" | "apps" | "devices";

interface ListenersSectionProps {
  geo: { data: ScrapedGeoEntry[]; scrapedAt: string | null };
  apps: { data: ScrapedAppEntry[]; scrapedAt: string | null };
  devices: { data: ScrapedDeviceEntry[]; scrapedAt: string | null };
  loading?: boolean;
}

export default function ListenersSection({
  geo,
  apps,
  devices,
  loading,
}: ListenersSectionProps) {
  const [activeTab, setActiveTab] = useState<Tab>("geography");

  const tabs: { key: Tab; label: string }[] = [
    { key: "geography", label: "Geography" },
    { key: "apps", label: "Apps" },
    { key: "devices", label: "Devices" },
  ];

  const hasAnyData =
    geo.data.length > 0 || apps.data.length > 0 || devices.data.length > 0;

  if (!hasAnyData && !loading) {
    return null;
  }

  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-base font-semibold">Listeners</h2>
        <ScrapedDataBadge
          scrapedAt={
            activeTab === "geography"
              ? geo.scrapedAt
              : activeTab === "apps"
                ? apps.scrapedAt
                : devices.scrapedAt
          }
        />
      </div>

      {/* Tab bar */}
      <div className="mb-4 flex gap-1 rounded-lg bg-muted p-1">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              activeTab === tab.key
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="h-[300px] animate-pulse rounded bg-muted" />
      ) : (
        <>
          {activeTab === "geography" && <GeoView data={geo.data} />}
          {activeTab === "apps" && <AppsView data={apps.data} />}
          {activeTab === "devices" && <DevicesView data={devices.data} />}
        </>
      )}
    </div>
  );
}

function GeoView({ data }: { data: ScrapedGeoEntry[] }) {
  if (data.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        No geographic data available.
      </p>
    );
  }

  const top10 = data.slice(0, 10);
  const chartData = top10.map((d) => ({
    name: d.country,
    downloads: d.downloads,
  }));

  return (
    <div className="space-y-4">
      <BarChart
        data={chartData as unknown as Record<string, unknown>[]}
        xKey="name"
        series={[{ dataKey: "downloads", name: "Downloads", color: "#6366f1" }]}
        layout="horizontal"
        height={Math.max(200, top10.length * 36)}
      />
      <div className="max-h-64 overflow-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-muted-foreground">
              <th className="pb-2 font-medium">Country</th>
              <th className="pb-2 text-right font-medium">Downloads</th>
              <th className="pb-2 text-right font-medium">%</th>
            </tr>
          </thead>
          <tbody>
            {data.map((row, i) => (
              <tr key={i} className="border-b last:border-0">
                <td className="py-1.5">
                  {row.country}
                  {row.region ? `, ${row.region}` : ""}
                </td>
                <td className="py-1.5 text-right">
                  {row.downloads.toLocaleString()}
                </td>
                <td className="py-1.5 text-right text-muted-foreground">
                  {row.percentage != null
                    ? `${row.percentage.toFixed(1)}%`
                    : "\u2014"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function AppsView({ data }: { data: ScrapedAppEntry[] }) {
  if (data.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        No app data available.
      </p>
    );
  }

  const donutData = data.slice(0, 8).map((d) => ({
    name: d.appName,
    value: d.downloads,
  }));

  return (
    <div className="space-y-4">
      <DonutChart data={donutData} />
      <div className="max-h-64 overflow-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-muted-foreground">
              <th className="pb-2 font-medium">App</th>
              <th className="pb-2 text-right font-medium">Downloads</th>
              <th className="pb-2 text-right font-medium">%</th>
            </tr>
          </thead>
          <tbody>
            {data.map((row, i) => (
              <tr key={i} className="border-b last:border-0">
                <td className="py-1.5">{row.appName}</td>
                <td className="py-1.5 text-right">
                  {row.downloads.toLocaleString()}
                </td>
                <td className="py-1.5 text-right text-muted-foreground">
                  {row.percentage != null
                    ? `${row.percentage.toFixed(1)}%`
                    : "\u2014"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function DevicesView({ data }: { data: ScrapedDeviceEntry[] }) {
  if (data.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        No device data available.
      </p>
    );
  }

  const donutData = data.slice(0, 8).map((d) => ({
    name: d.deviceName ?? d.deviceType,
    value: d.downloads,
  }));

  return (
    <div className="space-y-4">
      <DonutChart data={donutData} />
      <div className="max-h-64 overflow-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-muted-foreground">
              <th className="pb-2 font-medium">Device</th>
              <th className="pb-2 text-right font-medium">Type</th>
              <th className="pb-2 text-right font-medium">Downloads</th>
              <th className="pb-2 text-right font-medium">%</th>
            </tr>
          </thead>
          <tbody>
            {data.map((row, i) => (
              <tr key={i} className="border-b last:border-0">
                <td className="py-1.5">{row.deviceName ?? "\u2014"}</td>
                <td className="py-1.5 text-right text-muted-foreground">
                  {row.deviceType}
                </td>
                <td className="py-1.5 text-right">
                  {row.downloads.toLocaleString()}
                </td>
                <td className="py-1.5 text-right text-muted-foreground">
                  {row.percentage != null
                    ? `${row.percentage.toFixed(1)}%`
                    : "\u2014"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
