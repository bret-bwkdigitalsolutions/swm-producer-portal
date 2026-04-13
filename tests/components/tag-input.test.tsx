import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TagInput } from "@/components/forms/tag-input";

describe("TagInput", () => {
  it("renders selected tags as dismissible chips", () => {
    const onChange = vi.fn();
    render(
      <TagInput
        selectedTags={["true crime", "cold case"]}
        suggestedTags={[]}
        onChange={onChange}
      />
    );
    expect(screen.getByText("true crime")).toBeInTheDocument();
    expect(screen.getByText("cold case")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /remove tag/i })).toHaveLength(2);
  });

  it("calls onChange without the tag when × is clicked", () => {
    const onChange = vi.fn();
    render(
      <TagInput
        selectedTags={["true crime", "cold case"]}
        suggestedTags={[]}
        onChange={onChange}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Remove tag true crime" }));
    expect(onChange).toHaveBeenCalledWith(["cold case"]);
  });

  it("adds a tag on Enter and clears the input", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <TagInput selectedTags={[]} suggestedTags={[]} onChange={onChange} />
    );
    const input = screen.getByRole("textbox");
    await user.type(input, "forensics{Enter}");
    expect(onChange).toHaveBeenCalledWith(["forensics"]);
  });

  it("adds a tag on comma and clears the input", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <TagInput selectedTags={[]} suggestedTags={[]} onChange={onChange} />
    );
    const input = screen.getByRole("textbox");
    await user.type(input, "forensics,");
    expect(onChange).toHaveBeenCalledWith(["forensics"]);
  });

  it("trims and lowercases typed tags", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <TagInput selectedTags={[]} suggestedTags={[]} onChange={onChange} />
    );
    await user.type(screen.getByRole("textbox"), "  TRUE CRIME  {Enter}");
    expect(onChange).toHaveBeenCalledWith(["true crime"]);
  });

  it("does not add duplicate tags", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <TagInput
        selectedTags={["true crime"]}
        suggestedTags={[]}
        onChange={onChange}
      />
    );
    await user.type(screen.getByRole("textbox"), "true crime{Enter}");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("removes last tag on Backspace when input is empty", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <TagInput
        selectedTags={["true crime", "cold case"]}
        suggestedTags={[]}
        onChange={onChange}
      />
    );
    await user.click(screen.getByRole("textbox"));
    await user.keyboard("{Backspace}");
    expect(onChange).toHaveBeenCalledWith(["true crime"]);
  });

  it("renders suggested tags as click-to-add buttons", () => {
    render(
      <TagInput
        selectedTags={[]}
        suggestedTags={["forensics", "serial killer"]}
        onChange={vi.fn()}
      />
    );
    expect(screen.getByRole("button", { name: "+ forensics" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "+ serial killer" })).toBeInTheDocument();
  });

  it("moves a suggested tag into selected when clicked", () => {
    const onChange = vi.fn();
    render(
      <TagInput
        selectedTags={["true crime"]}
        suggestedTags={["forensics"]}
        onChange={onChange}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "+ forensics" }));
    expect(onChange).toHaveBeenCalledWith(["true crime", "forensics"]);
  });

  it("hides a suggested tag if it is already selected", () => {
    render(
      <TagInput
        selectedTags={["forensics"]}
        suggestedTags={["forensics", "cold case"]}
        onChange={vi.fn()}
      />
    );
    expect(screen.queryByRole("button", { name: "+ forensics" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "+ cold case" })).toBeInTheDocument();
  });

  it("hidden input contains comma-joined selected tags", () => {
    const { container } = render(
      <TagInput
        selectedTags={["true crime", "cold case"]}
        suggestedTags={[]}
        onChange={vi.fn()}
        name="tags"
      />
    );
    const hidden = container.querySelector('input[type="hidden"][name="tags"]') as HTMLInputElement;
    expect(hidden.value).toBe("true crime,cold case");
  });

  it("does not render suggestions section when suggestedTags is empty", () => {
    render(
      <TagInput selectedTags={[]} suggestedTags={[]} onChange={vi.fn()} />
    );
    expect(screen.queryByText("Suggestions:")).not.toBeInTheDocument();
  });

  it("input and dismiss buttons are disabled when disabled prop is true", () => {
    render(
      <TagInput
        selectedTags={["true crime"]}
        suggestedTags={["forensics"]}
        onChange={vi.fn()}
        disabled
      />
    );
    expect(screen.getByRole("textbox")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Remove tag true crime" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "+ forensics" })).toBeDisabled();
  });
});
