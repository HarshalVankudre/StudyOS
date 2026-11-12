/**
 * Reading upload bodies without trusting their declared size.
 *
 * `request.formData()` and `request.json()` buffer the whole body first, and
 * a chunked request carries no Content-Length to refuse it by, so a route
 * that only checks the header can still be made to buffer gigabytes. These
 * helpers read the stream themselves and stop as soon as the cap is passed.
 */
import "server-only";

/** Body bytes, or null when the body (declared or actual) is larger than `maxBytes`. */
export async function readBodyCapped(
  request: Request,
  maxBytes: number,
): Promise<Uint8Array<ArrayBuffer> | null> {
  const declared = Number(request.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > maxBytes) return null;
  if (!request.body) return new Uint8Array(0);

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  const body = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    body.set(chunk, at);
    at += chunk.byteLength;
  }
  return body;
}

/**
 * Multipart form of a request whose body is at most `maxBytes`. Returns
 * "too_large" past the cap and null when the body is not a valid form.
 */
export async function readFormCapped(
  request: Request,
  maxBytes: number,
): Promise<FormData | "too_large" | null> {
  const body = await readBodyCapped(request, maxBytes);
  if (!body) return "too_large";
  try {
    return await new Response(body, {
      headers: { "content-type": request.headers.get("content-type") ?? "" },
    }).formData();
  } catch {
    return null;
  }
}
