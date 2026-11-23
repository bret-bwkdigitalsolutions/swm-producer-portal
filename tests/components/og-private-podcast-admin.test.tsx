import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/app/admin/credentials/actions", () => ({
  saveCredential: vi.fn(),
}));

vi.mock("@/app/admin/shows/actions", () => ({
  updateOgTransistorShow: vi.fn(),
}));

import { CredentialForm } from "@/app/admin/credentials/[showId]/credential-form";
import { OgPrivateShowEditor } from "@/app/admin/shows/og-private-show-editor";

describe("Vimeo credential form", () => {
  it("offers the token field only for Your Dark Companion and never displays a stored token", async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <CredentialForm wpShowId={22} existingCredentials={[]} />
    );
    expect(screen.queryByRole("option", { name: /Vimeo/ })).not.toBeInTheDocument();

    rerender(
      <CredentialForm
        wpShowId={21}
        includeVimeo
        existingCredentials={[
          {
            id: "cred-1",
            platform: "vimeo",
            credentialType: "api_key",
            accessToken: "",
            refreshToken: "",
            apiKey: "********",
            tokenExpiresAt: "",
          },
        ]}
      />
    );

    await user.selectOptions(screen.getByLabelText("Platform"), "vimeo");
    expect(screen.getByText(/public, private, and video_files/i)).toBeInTheDocument();
    expect(screen.queryByText(/private, edit/i)).not.toBeInTheDocument();
    expect(screen.getByText(/does not change the video/i)).toBeInTheDocument();
    expect(screen.queryByRole("radio", { name: "OAuth" })).not.toBeInTheDocument();

    const token = screen.getByLabelText("Personal access token");
    expect(token).toHaveAttribute("type", "password");
    expect(token).toHaveValue("");
    expect(token).toHaveAttribute("name", "apiKey");
    expect(token).toHaveAttribute("placeholder", "Paste a new token to replace the current one");
  });
});

describe("OG private show editor", () => {
  it("explains the one-time Transistor dashboard step", () => {
    render(<OgPrivateShowEditor wpShowId={21} ogTransistorShowId="44120" />);
    expect(screen.getByText(/cannot create a show/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Numeric show ID or slug")).toHaveValue("44120");
    expect(screen.getByText(/not the public Your Dark Companion show/i)).toBeInTheDocument();
  });
});
