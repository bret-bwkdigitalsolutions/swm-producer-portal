"use client";

import { useState, useMemo } from "react";
import { FormShell } from "@/components/forms/form-shell";
import { ShowSelect } from "@/components/forms/show-select";
import { ImageInput } from "@/components/forms/image-input";
import { RichTextEditor } from "@/components/forms/rich-text-editor";
import { PublishToggle, type PublishState } from "@/components/forms/publish-toggle";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { submitReview } from "@/app/dashboard/review/actions";

interface Show {
  id: string;
  title: string;
  hosts: string[];
}

interface ReviewFormProps {
  shows: Show[];
}

export function ReviewForm({ shows }: ReviewFormProps) {
  const [showId, setShowId] = useState("");
  const [reviewerName, setReviewerName] = useState("");
  const [category, setCategory] = useState("");
  const [posterImage, setPosterImage] = useState<File | string | null>(null);
  const [reviewBody, setReviewBody] = useState("");
  const [publishState, setPublishState] = useState<PublishState>({
    status: "publish",
  });

  // Get hosts for the selected show
  const selectedShow = useMemo(
    () => shows.find((s) => s.id === showId),
    [shows, showId]
  );
  const hostOptions = useMemo(() => {
    const hosts = selectedShow?.hosts ?? [];
    return [...hosts, "other"];
  }, [selectedShow]);

  const isOtherReviewer = reviewerName === "other";

  // Build the form action that includes client-managed state in FormData
  const action = async (
    prevState: { success?: boolean; message?: string; errors?: Record<string, string[]> },
    formData: FormData
  ) => {
    // Inject client-managed rich text + image data into FormData
    formData.set("review_body", reviewBody);

    if (posterImage instanceof File) {
      formData.set("poster_image_file", posterImage);
    } else if (typeof posterImage === "string" && posterImage) {
      formData.set("poster_image_url", posterImage);
    }

    return submitReview(prevState, formData);
  };

  return (
    <FormShell title="Submit a Review" action={action} submitLabel="Publish Review">
      {/* Show */}
      <ShowSelect
        allowedShows={shows}
        value={showId}
        onValueChange={(val) => {
          setShowId(val);
          setReviewerName(""); // Reset reviewer when show changes
        }}
      />

      {/* Reviewer Name */}
      <div className="space-y-2">
        <Label htmlFor="reviewer_name">
          Reviewer<span className="text-destructive"> *</span>
        </Label>
        <Select
          value={reviewerName}
          onValueChange={(val) => {
            if (val !== null) setReviewerName(val);
          }}
          name="reviewer_name"
          required
        >
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Select a reviewer" />
          </SelectTrigger>
          <SelectContent>
            {hostOptions.map((host) => (
              <SelectItem key={host} value={host}>
                {host === "other" ? "Other (enter name)" : host}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <input type="hidden" name="reviewer_name" value={reviewerName} />
      </div>

      {/* Other Reviewer free text */}
      {isOtherReviewer && (
        <div className="space-y-2">
          <Label htmlFor="reviewer_custom">Reviewer Name</Label>
          <Input
            id="reviewer_custom"
            name="reviewer_custom"
            type="text"
            placeholder="Enter the reviewer's name"
            required
          />
        </div>
      )}

      {/* Category */}
      <div className="space-y-2">
        <Label htmlFor="category">
          Category<span className="text-destructive"> *</span>
        </Label>
        <Select
          value={category}
          onValueChange={(val) => {
            if (val !== null) setCategory(val);
          }}
          name="category"
          required
        >
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Select a category" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="movie_review">Movie Review</SelectItem>
            <SelectItem value="stage_review">Stage Review</SelectItem>
          </SelectContent>
        </Select>
        <input type="hidden" name="category" value={category} />
      </div>

      {/* Movie Title */}
      <div className="space-y-2">
        <Label htmlFor="movie_title">
          Movie / Show Title<span className="text-destructive"> *</span>
        </Label>
        <Input
          id="movie_title"
          name="movie_title"
          type="text"
          placeholder="Enter the movie or show title"
          required
        />
      </div>

      {/* Poster Image */}
      <ImageInput
        name="poster_image"
        label="Poster Image"
        value={posterImage}
        onChange={setPosterImage}
      />

      {/* Rating */}
      <div className="space-y-2">
        <Label htmlFor="rating">Rating (1-10)</Label>
        <Input
          id="rating"
          name="rating"
          type="number"
          min={1}
          max={10}
          placeholder="Optional"
        />
      </div>

      {/* Review Body */}
      <div className="space-y-2">
        <Label>
          Review Body<span className="text-destructive"> *</span>
        </Label>
        <RichTextEditor
          value={reviewBody}
          onChange={setReviewBody}
          placeholder="Write your review..."
        />
      </div>

      {/* Publish Toggle */}
      <PublishToggle value={publishState} onChange={setPublishState} />
    </FormShell>
  );
}
