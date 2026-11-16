/**
 * The inbound artifact boundary. A sandbox-produced file is UNTRUSTED: bound its
 * size and restrict its type before it is ever stored or served. Only image
 * types we will render via <img> (where even SVG is inert) are allowed.
 */
export const ALLOWED_ARTIFACT_MIME = {
  "image/png": "png",
  "image/svg+xml": "svg",
  // Photos from a student's own upload (the Notion import, which identifies
  // them by their bytes). Sandbox outputs never get these: they resolve by
  // file extension through EXT_TO_MIME below, which stays PNG and SVG.
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
} as const;

export type AllowedMime = keyof typeof ALLOWED_ARTIFACT_MIME;

/** Raster types an uploaded image may be stored as (never SVG: that comes only from the sandbox). */
export const UPLOAD_IMAGE_MIME = ["image/png", "image/jpeg", "image/gif", "image/webp"] as const satisfies readonly AllowedMime[];

export type UploadImageMime = (typeof UPLOAD_IMAGE_MIME)[number];

export function isUploadImageMime(mime: string): mime is UploadImageMime {
  return (UPLOAD_IMAGE_MIME as readonly string[]).includes(mime);
}

/** 5 MB — generous for a rendered page, tiny relative to an attack. */
export const MAX_ASSET_BYTES = 5_000_000;

export class ArtifactRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ArtifactRejectedError";
  }
}

/** A stored object larger than its reader allows (AssetStore.read). */
export class AssetTooLargeError extends Error {
  constructor(maxBytes: number) {
    super(`asset is over the ${maxBytes}-byte read limit`);
    this.name = "AssetTooLargeError";
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
