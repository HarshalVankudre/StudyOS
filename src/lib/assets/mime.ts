/**
 * The inbound artifact boundary. A sandbox-produced file is UNTRUSTED: bound its
 * size and restrict its type before it is ever stored or served. Only image
 * types we will render via <img> (where even SVG is inert) are allowed.
 */
export const ALLOWED_ARTIFACT_MIME = {
  "image/png": "png",
  "image/svg+xml": "svg",
} as const;

export type AllowedMime = keyof typeof ALLOWED_ARTIFACT_MIME;

/** 5 MB — generous for a rendered page, tiny relative to an attack. */
export const MAX_ASSET_BYTES = 5_000_000;

export class ArtifactRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ArtifactRejectedError";
  }
}

export function extForMime(mime: AllowedMime): string {
  return ALLOWED_ARTIFACT_MIME[mime];
}

const EXT_TO_MIME: Record<string, AllowedMime> = {
  png: "image/png",
  svg: "image/svg+xml",
};

/** Resolve an allowed mime from a declared output path's extension, else null. */
export function mimeForOutputPath(path: string): AllowedMime | null {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return EXT_TO_MIME[ext] ?? null;
}

export function assertAllowedArtifact(
  bytes: Uint8Array,
  mime: string,
): asserts mime is AllowedMime {
  if (!(mime in ALLOWED_ARTIFACT_MIME)) {
    throw new ArtifactRejectedError(`artifact mime "${mime}" is not allowed`);
  }
  if (bytes.byteLength > MAX_ASSET_BYTES) {
    throw new ArtifactRejectedError(
      `artifact is ${bytes.byteLength} bytes, over the ${MAX_ASSET_BYTES}-byte limit`,
    );
  }
}
