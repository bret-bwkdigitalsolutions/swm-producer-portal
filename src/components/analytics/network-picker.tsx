import Link from "next/link";
import type { Network } from "@/lib/analytics/networks";

interface NetworkPickerProps {
  networks: Network[];
}

export default function NetworkPicker({ networks }: NetworkPickerProps) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      {networks.map((network) => (
        <Link
          key={network.slug}
          href={`/dashboard/analytics/network/${network.slug}`}
          className="group rounded-lg border bg-card p-6 transition-colors hover:bg-muted"
        >
          <h3 className="text-lg font-semibold group-hover:text-primary">
            {network.name}
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">
            {network.wpShowIds.length}{" "}
            {network.wpShowIds.length === 1 ? "show" : "shows"}
          </p>
        </Link>
      ))}
    </div>
  );
}
