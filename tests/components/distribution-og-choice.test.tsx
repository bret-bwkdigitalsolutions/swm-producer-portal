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
    await user.click(await screen.findByRole("option", { name: "Your Dark Companion" }));

    expect(screen.getByText("The OG (members only)")).toBeInTheDocument();
    expect(screen.getByText("Public episode")).toBeInTheDocument();

    await user.click(screen.getByRole("radio", { name: /The OG \(members only\)/ }));

    expect(screen.queryByRole("button", { name: "Recorded live on YouTube" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Vimeo URL" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Upload video file" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Live stream URL/)).not.toBeInTheDocument();
    expect(
      screen.getByText(
        "Paste a Vimeo link you already uploaded. The portal publishes it on The OG page and does not change the video."
      )
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText("Video file (optional, for transcript and AI suggestions)")
    ).toBeInTheDocument();

    await user.type(
      screen.getByRole("textbox", { name: /^Vimeo URL/ }),
      "https://vimeo.com/555/abc123"
    );

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
    expect(screen.getByRole("button", { name: "Recorded live on YouTube" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Vimeo URL" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Upload video file" })).toBeEnabled();
    expect(screen.getByLabelText(/Live stream URL/)).toBeEnabled();
    expect(screen.getByRole("button", { name: /^Schedule/ })).toBeInTheDocument();
  });

  it("keeps the AI choice usable on The OG and hides controls that do not apply", async () => {
    const user = userEvent.setup();
    render(
      <DistributionForm
        shows={[{ id: "21", title: "Your Dark Companion" }]}
        premiumShows={{ "21": true }}
      />
    );

    await user.click(screen.getByRole("combobox"));
    await user.click(await screen.findByRole("option", { name: "Your Dark Companion" }));

    expect(screen.getByRole("button", { name: "Upload video file" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Recorded live on YouTube" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Vimeo URL" })).toBeEnabled();

    await user.click(screen.getByRole("radio", { name: "The OG (members only)" }));
    await user.type(
      screen.getByRole("textbox", { name: /^Vimeo URL/ }),
      "https://vimeo.com/555/abc123"
    );

    const ai = screen.getByRole("button", { name: /Get AI recommendations/ });
    expect(ai).toBeEnabled();
    expect(ai).toHaveTextContent(/Needs a video file/);

    const input = screen.getByLabelText(
      "Video file (optional, for transcript and AI suggestions)"
    );
    const openPicker = vi.spyOn(input, "click");
    await user.click(ai);
    expect(openPicker).toHaveBeenCalled();

    await user.upload(input, new File(["video"], "og.mp4", { type: "video/mp4" }));

    const aiWithFile = screen.getByRole("button", { name: /Get AI recommendations/ });
    expect(aiWithFile).toBeEnabled();
    expect(aiWithFile).toHaveTextContent("AI suggests title, description, chapters & tags");
    expect(aiWithFile).not.toHaveTextContent(/Needs a video file/);

    await user.click(screen.getByRole("button", { name: /fill in the details myself/i }));
    expect(screen.queryByLabelText(/Premium content/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/explicit\/mature/i)).not.toBeInTheDocument();
    expect(screen.queryByText("Target Platforms")).not.toBeInTheDocument();
    expect(screen.queryByText("Spotify Video")).not.toBeInTheDocument();
    expect(screen.queryByText("(Coming soon)")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Schedule/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Publish now/ })).toBeEnabled();
    expect(screen.getByRole("button", { name: /^Save as draft/ })).toBeEnabled();

    await user.click(screen.getByRole("radio", { name: "Public episode" }));
    expect(screen.getByLabelText(/Premium content/)).toBeInTheDocument();
    expect(screen.getByLabelText(/explicit\/mature/i)).toBeInTheDocument();
    expect(screen.getByText("Target Platforms")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Schedule/ })).toBeEnabled();
  });
});
