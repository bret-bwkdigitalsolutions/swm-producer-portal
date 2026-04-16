export interface CustomBlogInput {
  wpShowId: number;
  customPrompt: string;
  jobId?: string;
}

export type ValidationResult =
  | { ok: true }
  | { ok: false; message: string };

export function validateCustomBlogInput(
  input: CustomBlogInput
): ValidationResult {
  if (!Number.isInteger(input.wpShowId) || input.wpShowId <= 0) {
    return { ok: false, message: "Please pick a show." };
  }
  if (!input.customPrompt || input.customPrompt.trim().length === 0) {
    return { ok: false, message: "Please enter a blog brief." };
  }
  if (input.jobId !== undefined && input.jobId.trim().length === 0) {
    return { ok: false, message: "Invalid episode selection." };
  }
  return { ok: true };
}
