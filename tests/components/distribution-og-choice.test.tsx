import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

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
  previewLiveStreamReplacement: vi.fn(),
}));

import { DistributionForm } from "@/app/dashboard/distribute/new/distribution-form";

describe("DistributionForm OG choice", () => {
  it("offers The OG only for Your Dark Companion and hides public platforms", async () => {
    const user = userEvent.setup();
    render(
      <DistributionForm
        shows={[
          { id: "42", title: "The Clubhouse" },
          { id: "21", title: "Your Dark Companion" },
        ]}
      />
    );

    expect(screen.queryByText("The OG (members only)")).not.toBeInTheDocument();

    await user.click(screen.getByRole("combobox"));
    await user.click(screen.getByRole("option", { name: "Your Dark Companion" }));

    expect(screen.getByText("The OG (members only)")).toBeInTheDocument();
    expect(screen.getByText("Public episode")).toBeInTheDocument();

    await user.click(screen.getByRole("radio", { name: /The OG \(members only\)/ }));

    const file = new File(["video"], "The_OG__27.mp4", { type: "video/mp4" });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, file);
    await user.click(screen.getByRole("button", { name: /fill in the details myself/i }));

    expect(screen.getByText(/published only to the members page/i)).toBeInTheDocument();
    expect(screen.queryByText("Target Platforms")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Schedule/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Publish now/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Publish to The OG" })).toBeInTheDocument();

    await user.click(screen.getByRole("radio", { name: "Public episode" }));
    expect(screen.getByRole("button", { name: /^Schedule/ })).toBeInTheDocument();
  });
});
