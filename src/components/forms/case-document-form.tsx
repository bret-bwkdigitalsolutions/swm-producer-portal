"use client";

import { useState, useRef, useCallback, useActionState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardFooter,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { submitCaseDocumentBulk } from "@/app/dashboard/case-document/actions";
import { cn } from "@/lib/utils";
import {
  UploadCloudIcon,
  FileIcon,
  XIcon,
  Loader2Icon,
  CheckCircle2Icon,
  AlertCircleIcon,
} from "lucide-react";

interface TaxonomyOption {
  id: string;
  name: string;
}

interface Show {
  id: string;
  title: string;
}

interface FileEntry {
  file: File;
  title: string;
  docType: string;
  allowDownload: boolean;
}

interface CaseDocumentFormProps {
  allowedShows: Show[];
  caseSeries: TaxonomyOption[];
  docTypes: TaxonomyOption[];
}

function titleFromFilename(filename: string): string {
  return filename
    .replace(/\.[^.]+$/, "") // remove extension
    .replace(/[-_]/g, " ") // replace dashes/underscores with spaces
    .replace(/\s+/g, " ") // collapse whitespace
    .trim();
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function CaseDocumentForm({
  caseSeries,
  docTypes,
}: CaseDocumentFormProps) {
  const [caseSeriesValue, setCaseSeriesValue] = useState("");
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const addFiles = useCallback(
    (newFiles: FileList | File[]) => {
      const entries: FileEntry[] = Array.from(newFiles).map((file) => ({
        file,
        title: titleFromFilename(file.name),
        docType: "",
        allowDownload: true,
      }));
      setFiles((prev) => [...prev, ...entries]);
    },
    []
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragActive(false);
      if (e.dataTransfer.files.length) {
        addFiles(e.dataTransfer.files);
      }
    },
    [addFiles]
  );

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files?.length) {
        addFiles(e.target.files);
      }
      // Reset so same files can be re-selected
      e.target.value = "";
    },
    [addFiles]
  );

  const removeFile = useCallback((index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const updateFile = useCallback(
    (index: number, updates: Partial<FileEntry>) => {
      setFiles((prev) =>
        prev.map((entry, i) => (i === index ? { ...entry, ...updates } : entry))
      );
    },
    []
  );

  // Build FormData from state and submit
  const submitAction = async (
    prevState: { success?: boolean; message?: string; errors?: Record<string, string[]> },
    _formData: FormData
  ) => {
    const fd = new FormData();
    fd.set("case_series", caseSeriesValue);
    fd.set("file_count", String(files.length));

    for (let i = 0; i < files.length; i++) {
      const entry = files[i];
      fd.set(`file_${i}`, entry.file);
      fd.set(`title_${i}`, entry.title);
      fd.set(`doc_type_${i}`, entry.docType);
      fd.set(`allow_download_${i}`, entry.allowDownload ? "true" : "false");
    }

    const result = await submitCaseDocumentBulk(prevState, fd);
    if (result.success) {
      setFiles([]);
      setCaseSeriesValue("");
    }
    return result;
  };

  const [state, formAction, isPending] = useActionState(submitAction, {});

  const canSubmit = caseSeriesValue && files.length > 0;

  return (
    <Card className="mx-auto w-full max-w-3xl">
      <CardHeader>
        <CardTitle className="text-lg">Upload Case Documents</CardTitle>
        <p className="text-sm text-muted-foreground">
          Select a case/series, then drop your files. Titles are auto-populated
          from filenames — edit them inline before submitting.
        </p>
      </CardHeader>

      <form action={formAction}>
        <CardContent className="space-y-6">
          {/* Success / Error messages */}
          {state.success && state.message && (
            <div className="flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">
              <CheckCircle2Icon className="size-4 shrink-0" />
              {state.message}
            </div>
          )}
          {state.success === false && state.message && (
            <div className="flex items-center gap-2 rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              <AlertCircleIcon className="size-4 shrink-0" />
              {state.message}
            </div>
          )}

          {/* Case/Series selector */}
          <div className="space-y-2">
            <Label>
              Case / Series <span className="text-destructive">*</span>
            </Label>
            <Select
              value={caseSeriesValue}
              onValueChange={(val: string | null) => {
                if (val !== null) setCaseSeriesValue(val);
              }}
            >
              <SelectTrigger className="w-full max-w-sm">
                <SelectValue placeholder="Select a case or series" />
              </SelectTrigger>
              <SelectContent>
                {caseSeries.length === 0 && (
                  <SelectItem value="__none" disabled>
                    No cases/series configured in WordPress
                  </SelectItem>
                )}
                {caseSeries.map((term) => (
                  <SelectItem key={term.id} value={term.id}>
                    {term.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {caseSeries.length === 0 && (
              <p className="text-xs text-muted-foreground">
                Case/series taxonomy not yet configured in WordPress. Documents
                will be uploaded without a case assignment.
              </p>
            )}
          </div>

          {/* Drop zone */}
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragActive(true);
            }}
            onDragLeave={() => setDragActive(false)}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            className={cn(
              "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-4 py-8 text-center transition-colors",
              dragActive
                ? "border-ring bg-accent"
                : "border-input hover:border-ring/50 hover:bg-muted/50"
            )}
          >
            <UploadCloudIcon className="size-10 text-muted-foreground" />
            <div>
              <p className="text-sm font-medium">
                Drop files here or click to browse
              </p>
              <p className="text-xs text-muted-foreground">
                PDF, DOC, DOCX, images, audio, or video — multiple files OK
              </p>
            </div>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.doc,.docx,image/*,audio/*,video/*"
            onChange={handleFileSelect}
            multiple
            className="hidden"
          />

          {/* File list / review table */}
          {files.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium">
                  {files.length} file{files.length !== 1 ? "s" : ""} ready
                </p>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setFiles([])}
                  className="text-muted-foreground"
                >
                  Clear all
                </Button>
              </div>

              <div className="space-y-2">
                {files.map((entry, i) => (
                  <div
                    key={`${entry.file.name}-${i}`}
                    className="rounded-lg border border-border bg-muted/20 p-3 space-y-2"
                  >
                    {/* File info + remove */}
                    <div className="flex items-center gap-2">
                      <FileIcon className="size-4 shrink-0 text-muted-foreground" />
                      <span className="flex-1 truncate text-xs text-muted-foreground">
                        {entry.file.name}{" "}
                        <span className="text-muted-foreground/60">
                          ({formatFileSize(entry.file.size)})
                        </span>
                      </span>
                      <button
                        type="button"
                        onClick={() => removeFile(i)}
                        className="inline-flex size-5 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
                      >
                        <XIcon className="size-3" />
                      </button>
                    </div>

                    {/* Inline edit row */}
                    <div className="grid gap-2 sm:grid-cols-[1fr_auto_auto]">
                      <Input
                        value={entry.title}
                        onChange={(e) =>
                          updateFile(i, { title: e.target.value })
                        }
                        placeholder="Document title"
                        className="h-8 text-sm"
                      />
                      <Select
                        value={entry.docType}
                        onValueChange={(val: string | null) =>
                          updateFile(i, { docType: val ?? "" })
                        }
                      >
                        <SelectTrigger className="h-8 w-[160px] text-xs">
                          <SelectValue placeholder="Doc type" />
                        </SelectTrigger>
                        <SelectContent>
                          {docTypes.map((term) => (
                            <SelectItem key={term.id} value={term.id}>
                              {term.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <div className="flex items-center gap-1.5">
                        <Switch
                          size="sm"
                          checked={entry.allowDownload}
                          onCheckedChange={(checked: boolean) =>
                            updateFile(i, { allowDownload: checked })
                          }
                        />
                        <span className="text-xs text-muted-foreground whitespace-nowrap">
                          Download
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>

        <CardFooter>
          <Button
            type="submit"
            disabled={isPending || !canSubmit}
            size="lg"
            className="w-full"
          >
            {isPending && <Loader2Icon className="size-4 animate-spin" />}
            {isPending
              ? `Uploading ${files.length} document${files.length !== 1 ? "s" : ""}...`
              : `Upload ${files.length || ""} Document${files.length !== 1 ? "s" : ""}`}
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}
