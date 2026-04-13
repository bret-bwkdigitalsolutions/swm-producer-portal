"use client";

import { useState, useRef, KeyboardEvent } from "react";
import { XIcon } from "lucide-react";

interface TagInputProps {
  selectedTags: string[];
  suggestedTags: string[];
  onChange: (tags: string[]) => void;
  disabled?: boolean;
  placeholder?: string;
  name?: string;
}

export function TagInput({
  selectedTags,
  suggestedTags,
  onChange,
  disabled,
  placeholder = "Add a tag...",
  name = "tags",
}: TagInputProps) {
  const [inputValue, setInputValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  function addTag(raw: string) {
    const tag = raw.trim().toLowerCase();
    if (!tag || selectedTags.includes(tag)) return;
    onChange([...selectedTags, tag]);
  }

  function removeTag(tag: string) {
    onChange(selectedTags.filter((t) => t !== tag));
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addTag(inputValue);
      setInputValue("");
    } else if (
      e.key === "Backspace" &&
      inputValue === "" &&
      selectedTags.length > 0
    ) {
      removeTag(selectedTags[selectedTags.length - 1]);
    }
  }

  const visibleSuggestions = suggestedTags.filter(
    (t) => !selectedTags.includes(t)
  );

  return (
    <div className="space-y-2">
      {/* Selected chips + inline input */}
      <div
        className="flex min-h-10 flex-wrap gap-1.5 rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2"
        onClick={() => inputRef.current?.focus()}
      >
        {selectedTags.map((tag) => (
          <span
            key={tag}
            className="flex items-center gap-1 rounded-md bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary"
          >
            {tag}
            <button
              type="button"
              disabled={disabled}
              onClick={(e) => {
                e.stopPropagation();
                removeTag(tag);
              }}
              className="rounded-sm opacity-60 hover:opacity-100 disabled:cursor-not-allowed"
              aria-label={`Remove tag ${tag}`}
            >
              <XIcon className="size-3" />
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={() => {
            if (inputValue.trim()) {
              addTag(inputValue);
              setInputValue("");
            }
          }}
          disabled={disabled}
          placeholder={selectedTags.length === 0 ? placeholder : ""}
          className="min-w-20 flex-1 bg-transparent outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed"
        />
      </div>

      {/* Suggested chips */}
      {visibleSuggestions.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-muted-foreground">Suggestions:</span>
          {visibleSuggestions.map((tag) => (
            <button
              key={tag}
              type="button"
              disabled={disabled}
              onClick={() => addTag(tag)}
              className="rounded-md border border-input px-2 py-0.5 text-xs text-muted-foreground transition-colors hover:border-primary/50 hover:bg-primary/5 hover:text-primary disabled:cursor-not-allowed disabled:opacity-50"
              aria-label={`+ ${tag}`}
            >
              + {tag}
            </button>
          ))}
        </div>
      )}

      {/* Hidden input for form submission */}
      <input type="hidden" name={name} value={selectedTags.join(",")} />
    </div>
  );
}
