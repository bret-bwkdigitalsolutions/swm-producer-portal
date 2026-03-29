import { requireAuth } from "@/lib/auth-guard";
import AnalyticsNav from "@/components/analytics/analytics-nav";
import DateRangeProvider from "@/components/analytics/date-range-provider";
import DateRangePicker from "@/components/analytics/date-range-picker";

export default async function AnalyticsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireAuth();

  return (
    <DateRangeProvider>
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">Analytics</h1>
          <DateRangePicker />
        </div>
        <AnalyticsNav />
        {children}
      </div>
    </DateRangeProvider>
  );
}
