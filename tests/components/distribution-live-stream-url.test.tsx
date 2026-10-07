import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { previewLiveStreamReplacement, submitDistribution } = vi.hoisted(() => ({
  previewLiveStreamReplacement: vi.fn(),
  submitDistribution: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("@/app/dashboard/distribute/new/actions", () => ({
  submitDistribution: (...args: unknown[]) => submitDistribution(...args),
  updateDistribution: vi.fn(),
  getNextEpisodeNumber: vi.fn().mockResolvedValue({
    episodeNumber: null,
    seasonNumber: null,
    seasonScheme: "none",
  }),
  previewLiveStreamReplacement: (...args: unknown[]) =>
    previewLiveStreamReplacement(...args),
}));

import { DistributionForm } from "@/app/dashboard/distribute/new/distribution-form";

const LIVE_URL_ERROR =
  "Enter a valid YouTube URL (for example https://www.youtube.com/live/VIDEO_ID), or leave this blank.";

describe("distribution live stream URL field", () => {
  it("shows an optional live stream URL that only applies when published", () => {
    render(<DistributionForm shows={[{ id: "22", title: "The Sunset Lounge" }]} />);

    const input = screen.getByLabelText(
      "Live stream URL (if this episode was streamed live first)"
    );
    expect(input).toHaveAttribute("name", "live_stream_url");
    expect(input).not.toBeRequired();
    expect(
      screen.getByText(/only applies when the episode is published, not for drafts or scheduled posts/)
    ).toBeInTheDocument();
  });

  it("shows which live post the URL would replace", async () => {
    const user = userEvent.setup();
    previewLiveStreamReplacement.mockResolvedValue({
      status: "match",
      title: "Rusty Greer",
      date: "2026-05-20",
    });
    render(<DistributionForm shows={[{ id: "22", title: "The Sunset Lounge" }]} />);

    await user.click(screen.getByRole("combobox"));
    await user.click(screen.getByRole("option", { name: "The Sunset Lounge" }));
    await user.type(
      screen.getByLabelText(/Live stream URL/),
      "https://www.youtube.com/live/sLB7STNGACI"
    );

    expect(
      await screen.findByText("This will replace: Rusty Greer (2026-05-20)")
    ).toBeInTheDocument();
    expect(previewLiveStreamReplacement).toHaveBeenCalledWith(
      22,
      "https://www.youtube.com/live/sLB7STNGACI"
    );
  });

  it("says when no live post matches and still leaves submit available", async () => {
    const user = userEvent.setup();
    previewLiveStreamReplacement.mockResolvedValue({ status: "none" });
    render(<DistributionForm shows={[{ id: "22", title: "The Sunset Lounge" }]} />);

    await user.click(screen.getByRole("combobox"));
    await user.click(screen.getByRole("option", { name: "The Sunset Lounge" }));
    await user.type(
      screen.getByLabelText(/Live stream URL/),
      "https://www.youtube.com/live/sLB7STNGACI"
    );

    expect(await screen.findByText("No matching live post found")).toBeInTheDocument();
  });

  it("shows a lookup failure without blocking the form", async () => {
    const user = userEvent.setup();
    previewLiveStreamReplacement.mockResolvedValue({ status: "error" });
    render(<DistributionForm shows={[{ id: "22", title: "The Sunset Lounge" }]} />);

    const file = new File(["video"], "episode.mp4", { type: "video/mp4" });
    await user.upload(screen.getByLabelText(/Video File/), file);
    await user.click(screen.getByRole("combobox"));
    await user.click(screen.getByRole("option", { name: "The Sunset Lounge" }));
    await user.type(
      screen.getByLabelText(/Live stream URL/),
      "https://www.youtube.com/live/sLB7STNGACI"
    );

    expect(
      await screen.findByText("Could not check for a live post. You can still submit.")
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Get AI recommendations/ })
    ).toBeEnabled();
  });

  it("shows the live stream field error instead of only the generic message", async () => {
    const user = userEvent.setup();
    submitDistribution.mockResolvedValue({
      success: false,
      message: "Please fix the errors below.",
      errors: { live_stream_url: [LIVE_URL_ERROR] },
    });
    render(<DistributionForm shows={[{ id: "22", title: "The Sunset Lounge" }]} />);

    const file = new File(["video"], "episode.mp4", { type: "video/mp4" });
    await user.upload(screen.getByLabelText(/Video File/), file);
    await user.type(
      screen.getByLabelText(/Live stream URL/),
      "https://vimeo.com/123456"
    );
    await user.click(screen.getByRole("button", { name: /Get AI recommendations/ }));

    expect(await screen.findAllByText(LIVE_URL_ERROR)).toHaveLength(2);
    expect(screen.getByText("live stream url")).toBeInTheDocument();
    expect(screen.queryByText("Please fix the errors below.")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Get AI recommendations/ })
    ).toBeEnabled();
  });
});
