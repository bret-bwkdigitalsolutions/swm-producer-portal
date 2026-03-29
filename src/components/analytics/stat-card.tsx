interface StatCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  loading?: boolean;
}

export default function StatCard({
  title,
  value,
  subtitle,
  loading,
}: StatCardProps) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <p className="text-sm text-muted-foreground">{title}</p>
      {loading ? (
        <div className="mt-1 h-8 w-24 animate-pulse rounded bg-muted" />
      ) : (
        <p className="mt-1 text-2xl font-bold">{value}</p>
      )}
      {subtitle && (
        <p className="mt-1 text-xs text-muted-foreground">{subtitle}</p>
      )}
    </div>
  );
}
