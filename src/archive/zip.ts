import JSZip from 'jszip';
import { assertSafeArchivePath } from '../shared/paths';

const PRECOMPRESSED = /\.(png|jpe?g|gif|webp|avif|heic|mp4|webm|mov|mp3|m4a|ogg|zip|pdf|docx|xlsx|pptx)$/i;

/** Creates the ZIP. Every path is re-validated here as the last line of defense. */
export async function createZip(files: Map<string, string | Blob>, onProgress?: (percent: number) => void): Promise<Blob> {
  const zip = new JSZip();
  for (const [path, content] of files) {
    assertSafeArchivePath(path);
    // Blobs are handed over as ArrayBuffer promises: JSZip's Blob path needs FileReader,
    // which is not reliably available in an extension service worker.
    const data = typeof content === 'string' ? content : content.arrayBuffer();
    zip.file(path, data, { compression: PRECOMPRESSED.test(path) ? 'STORE' : 'DEFLATE', createFolders: false });
  }
  return zip.generateAsync(
    { type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 }, streamFiles: true, mimeType: 'application/zip' },
    (meta) => onProgress?.(meta.percent),
  );
}
