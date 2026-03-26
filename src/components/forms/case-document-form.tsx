"use client";

import { useState, useRef, useCallback } from "react";
import { FormShell } from "@/components/forms/form-shell";
import { RichTextEditor } from "@/components/forms/rich-text-editor";
import { ImageInput } from "@/components/forms/image-input";
import { PublishToggle, PublishState } from "@/components/forms/publish-toggle";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { submitCaseDocument } from "@/app/dashboard/case-document/actions";
import { cn } from "@/lib/utils";
import { UploadCloudIcon, FileIcon, XIcon } from "lucide-react";

interface TaxonomyOption {
  id: string;
  name: string;
}

interface Show {
  id: string;
  title: string;
}

interface CaseDocumentFormProps {
  allowedShows: Show[];
  caseSeries: TaxonomyOption[];
  docTypes: TaxonomyOption[];
}

export function CaseDocumentForm({
  allowedShows,
  caseSeries,
  docTypes,
}: CaseDocumentFormProps) {
  const [description, setDescription] = useState("");
  const [caseSeriesValue, setCaseSeriesValue] = useState("");
  const [docTypeValue, setDocTypeValue] = useState("");
  const [allowDownload, setAllowDownload] = useState(true);
  const [publishState, setPublishState] = useState<PublishState>({
    status: "publish",
  });
  const [thumbnail, setThumbnail] = useState<File | string | null>(null);
  const [documentFile, setDocumentFile] = useState<File | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      setDocumentFile(file);
    }
  }, []);

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) {
        setDocumentFile(file);
      }
    },
    []
  );

  const clearFile = useCallback(() => {
    setDocumentFile(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }, []);

  // Wrap server action to inject rich text + file data
  const actionWithData = async (
    prevState: { success?: boolean; message?: string; errors?: Record<string, string[]> },
    formData: FormData
  ) => {
    formData.set("description", description);

    // Inject document file
    if (documentFile) {
      formData.set("document_file", documentFile);
    }

    // Inject thumbnail
    if (thumbnail instanceof File) {
      formData.set("thumbnail_file", thumbnail);
    } else if (typeof thumbnail === "string" && thumbnail) {
      formData.set("thumbnail_url", thumbnail);
    }

    const result = await submitCaseDocument(prevState, formData);
    if (result.success) {
      setDescription("");
      setCaseSeriesValue("");
      setDocTypeValue("");
      setAllowDownload(true);
      setPublishState({ status: "publish" });
      setThumbnail(null);
      setDocumentFile(null);
    }
    return result;
  };

  return (
    <FormShell
      title="New Case Document"
      action={actionWithData}
      submitLabel="Submit Document"
    >
      {/* Title */}
      <div className="space-y-2">
        <Label htmlFor="title">
          Title <span className="text-destructive">*</span>
        </Label>
        <Input
          id="title"
          name="title"
          placeholder="Document title"
          required
        />
      </div>

      {/* Description (Rich Text) */}
      <div className="space-y-2">
        <Label>Description</Label>
        <RichTextEditor
          value={description}
          onChange={setDescription}
          placeholder="Document description or body content..."
        />
      </div>

      {/* Case/Series */}
      <div className="space-y-2">
        <Label htmlFor="case_series">
          Case / Series <span className="text-destructive">*</span>
        </Label>
        <Select
          value={caseSeriesValue}
          onValueChange={(val: string | null) => {
            if (val !== null) setCaseSeriesValue(val);
          }}
          name="case_series"
          required
        >
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Select a case or series" />
          </SelectTrigger>
          <SelectContent>
            {caseSeries.map((term) => (
              <SelectItem key={term.id} value={term.id}>
                {term.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <input type="hidden" name="case_series" value={caseSeriesValue} />
      </div>

      {/* Document Type */}
      <div className="space-y-2">
        <Label htmlFor="doc_type">
          Document Type <span className="text-destructive">*</span>
        </Label>
        <Select
          value={docTypeValue}
          onValueChange={(val: string | null) => {
            if (val !== null) setDocTypeValue(val);
          }}
          name="doc_type"
          required
        >
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Select document type" />
          </SelectTrigger>
          <SelectContent>
            {docTypes.map((term) => (
              <SelectItem key={term.id} value={term.id}>
                {term.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <input type="hidden" name="doc_type" value={docTypeValue} />
      </div>

      {/* File Upload */}
      <div className="space-y-2">
        <Label>
          File
        </Label>
        {documentFile ? (
          <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/30 px-3 py-2">
            <FileIcon className="size-5 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{documentFile.name}</p>
              <p className="text-xs text-muted-foreground">
                {(documentFile.size / (1024 * 1024)).toFixed(1)} MB
              </p>
            </div>
            <button
              type="button"
              onClick={clearFile}
              className="inline-flex size-6 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <XIcon className="size-4" />
            </button>
          </div>
        ) : (
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragActive(true);
            }}
            onDragLeave={() => setDragActive(false)}
            onDrop={handleFileDrop}
            onClick={() => fileInputRef.current?.click()}
            className={cn(
              "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-4 py-6 text-center transition-colors",
              dragActive
                ? "border-ring bg-accent"
                : "border-input hover:border-ring/50 hover:bg-muted/50"
            )}
          >
            <UploadCloudIcon className="size-8 text-muted-foreground" />
            <div>
              <p className="text-sm font-medium">
                Drop file here or click to browse
              </p>
              <p className="text-xs text-muted-foreground">
                PDF, DOC, DOCX, images, audio, or video
              </p>
            </div>
          </div>
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,.doc,.docx,image/*,audio/*,video/*"
          onChange={handleFileSelect}
          className="hidden"
        />
      </div>

      {/* Allow Download */}
      <div className="flex items-center justify-between">
        <Label htmlFor="allow-download" className="cursor-pointer">
          Allow download
        </Label>
        <Switch
          id="allow-download"
          checked={allowDownload}
          onCheckedChange={setAllowDownload}
        />
        <input
          type="hidden"
          name="allow_download"
          value={allowDownload ? "true" : "false"}
        />
      </div>

      {/* Thumbnail (optional) */}
      <ImageInput
        name="thumbnail"
        label="Thumbnail (optional)"
        value={thumbnail}
        onChange={setThumbnail}
      />

      <PublishToggle value={publishState} onChange={setPublishState} />
    </FormShell>
  );
}
