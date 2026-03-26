/**
 * Audio extraction from video files.
 *
 * TODO: Integrate ffmpeg for real audio extraction. For now this is a
 * placeholder that returns a mock path so the rest of the pipeline can
 * be developed and tested end-to-end.
 */

/**
 * Extract audio track from a video file.
 *
 * @param videoPath - Path (local or GCS URI) to the source video file.
 * @returns The path to the extracted audio file.
 */
export async function extractAudio(videoPath: string): Promise<string> {
  // TODO: Replace with real ffmpeg invocation, e.g.:
  //   const outputPath = videoPath.replace(/\.[^.]+$/, '.mp3');
  //   await execa('ffmpeg', ['-i', videoPath, '-q:a', '0', '-map', 'a', outputPath]);
  //   return outputPath;

  const mockAudioPath = videoPath.replace(/\.[^.]+$/, ".mp3");
  console.log(
    `[audio-extractor] Placeholder: would extract audio from "${videoPath}" -> "${mockAudioPath}"`
  );

  return mockAudioPath;
}
