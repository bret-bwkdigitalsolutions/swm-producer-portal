import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// The inline checkbox calls the real admin server action; mock it so we can
// assert the PATCH payload without hitting WordPress.
const setShirtShipped = vi.fn(
  async (_prev: unknown, _formData: FormData) => ({
    success: true,
    message: "ok",
  })
);
vi.mock("../actions", () => ({
  setShirtShipped: (prev: unknown, formData: FormData) =>
    setShirtShipped(prev, formData),
}));

import { ShirtShippedCheckbox } from "../shirt-shipped-checkbox";

describe("ShirtShippedCheckbox", () => {
  beforeEach(() => {
    setShirtShipped.mockClear();
  });

  it("renders an unchecked 'Ship' control when not yet shipped", () => {
    render(<ShirtShippedCheckbox id={42} shipped={false} />);
    const box = screen.getByRole("checkbox", { name: /shipped/i });
    expect(box).not.toBeChecked();
    expect(screen.getByText("Ship")).toBeInTheDocument();
  });

  it("renders a checked 'Shipped' control when already shipped", () => {
    render(<ShirtShippedCheckbox id={42} shipped={true} />);
    const box = screen.getByRole("checkbox", { name: /shipped/i });
    expect(box).toBeChecked();
    expect(screen.getByText("Shipped")).toBeInTheDocument();
  });

  it("marks the subscriber shipped with its id when toggled on", async () => {
    const user = userEvent.setup();
    render(<ShirtShippedCheckbox id={42} shipped={false} />);

    await user.click(screen.getByRole("checkbox", { name: /shipped/i }));

    await waitFor(() => expect(setShirtShipped).toHaveBeenCalledTimes(1));
    const formData = setShirtShipped.mock.calls[0][1];
    expect(formData.get("id")).toBe("42");
    expect(formData.get("shipped")).toBe("true");
  });

  it("clears shipped (shipped=false) when toggled off", async () => {
    const user = userEvent.setup();
    render(<ShirtShippedCheckbox id={7} shipped={true} />);

    await user.click(screen.getByRole("checkbox", { name: /shipped/i }));

    await waitFor(() => expect(setShirtShipped).toHaveBeenCalledTimes(1));
    const formData = setShirtShipped.mock.calls[0][1];
    expect(formData.get("id")).toBe("7");
    expect(formData.get("shipped")).toBe("false");
  });
});
