import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("@/app/dashboard/distribute/new/actions", () => ({
  submitDistribution: vi.fn(),
  updateDistribution: vi.fn(),
  getNextEpisodeNumber: vi.fn().mockResolvedValue({
    episodeNumber: null,
    seasonNumber: null,
    seasonScheme: "none",
  }),
}));

import { DistributionForm } from "@/app/dashboard/distribute/new/distribution-form";

describe("distribution live stream URL field", () => {
  it("shows an optional live stream URL with help text", () => {
    render(
      <DistributionForm
        shows={[{ id: "22", title: "The Sunset Lounge" }]}
      />
    );

    const input = screen.getByLabelText(
      "Live stream URL (if this episode was streamed live first)"
    );
    expect(input).toHaveAttribute("name", "live_stream_url");
    expect(input).not.toBeRequired();
    expect(
      screen.getByText(
        /Paste the YouTube URL of the live stream when this cut was streamed live first/
      )
    ).toBeInTheDocument();
  });
});
