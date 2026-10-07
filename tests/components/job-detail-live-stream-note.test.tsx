import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/app/dashboard/distribute/[id]/actions", () => ({
  updateAiSuggestion: vi.fn(),
  retryPlatform: vi.fn(),
  deleteJob: vi.fn(),
}));

import { JobDetailView } from "@/app/dashboard/distribute/[id]/job-detail-view";

const job = {
  id: "job-1",
  title: "Friday Night Live",
  showName: "Your Dark Companion",
  status: "completed",
  isPremium: false,
  errorMessage: null,
  metadata: { description: "Archived cut.", supersedesLivePostId: 55 },
  createdAt: "2026-05-20T19:00:00-05:00",
  updatedAt: "2026-05-20T20:00:00-05:00",
  platforms: [
    {
      id: "plat-web",
      platform: "website",
      status: "completed",
      error: null,
      externalId: "900",
      externalUrl: "https://example.com/episode",
      completedAt: "2026-05-20T20:00:00-05:00",
    },
  ],
  aiSuggestions: [],
};

beforeEach(() => {
  // Leave the status poll pending so assertions see the server-rendered job,
  // not a later poll overwriting it.
  vi.stubGlobal("fetch", vi.fn().mockImplementation(() => new Promise(() => {})));
});

describe("JobDetailView live-stream replacement", () => {
  it("shows which live stream post the episode replaces", () => {
    render(<JobDetailView job={job} />);
    expect(screen.getAllByText("Replaces live stream post #55")).toHaveLength(2);
  });

  it("omits the note when no live post was superseded", () => {
    render(
      <JobDetailView
        job={{ ...job, metadata: { description: "Archived cut." } }}
      />
    );
    expect(screen.queryByText(/Replaces live stream post/)).not.toBeInTheDocument();
  });
});
