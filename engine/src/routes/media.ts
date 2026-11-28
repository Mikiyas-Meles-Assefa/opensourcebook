/**
 * `POST /v1/uploads`, `GET /v1/uploads/types` and `GET /v1/assets/:id`.
 *
 * Uploads: raw body, at most 25 MB, a supported content-type, optional
 * `x-upload-filename`; 201 { upload } with a fresh random id. A body sent
 * with no type, or as `application/octet-stream`, takes the type its file
 * name's ending says, when the list has one. `GET /v1/uploads/types` is
 * that list, so a client walking a folder keeps only what Open Sourcebook takes. Assets:
 * content-addressed and immutable, so public with a one-year cache; image
 * renderers fetch them without credentials.
 */
import { assetKeyForId } from "../assets";
import { authenticate, errorResponse, json, notFound } from "../http";
import { contentTypeForName, folderExtensions, MAX_UPLOAD_BYTES, normalizeUploadContentType, sanitizeUploadFilename, UPLOAD_TYPES } from "../uploads";
import type { EngineDeps } from "../wiring";

export async function createUpload(request: Request, deps: EngineDeps): Promise<Response> {
  const auth = await authenticate(request, deps.clientToken);
  if ("response" in auth) return auth.response;
  if (!deps.bucket) return errorResponse("uploads_disabled", "File uploads are not enabled on this Worker", 503);
  const filename = sanitizeUploadFilename(request.headers.get("x-upload-filename"));
  const declaredType = request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() ?? "";
  const named = !declaredType || declaredType === "application/octet-stream" ? contentTypeForName(filename) : undefined;
  const contentType = normalizeUploadContentType(named ?? declaredType);
  if (!contentType) return errorResponse("unsupported_media_type", `${filename ? `${filename}: ` : ""}Open Sourcebook doesn't read this kind of file. It takes ${groupsInWords()}.`, 415);
  const tooLarge = () => errorResponse("upload_too_large", `${filename ? `${filename}: ` : ""}This file is bigger than ${MAX_UPLOAD_BYTES / (1024 * 1024)} MB, the most one upload can be.`, 413);
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_UPLOAD_BYTES) return tooLarge();
  const bytes = await request.arrayBuffer();
  if (bytes.byteLength > MAX_UPLOAD_BYTES) return tooLarge();
  const upload = await deps.uploads.putUpload(bytes, contentType, filename);
  if (!upload) return errorResponse("uploads_disabled", "File uploads are not enabled on this Worker", 503);
  return json({ upload }, 201);
}

/**
 * `GET /v1/uploads/types`: what `POST /v1/uploads` takes, by type, file name ending and group, and the endings a
 * linked folder's files are taken by (`folderExtensions`, which the launcher's watching of a folder goes by).
 */
export async function uploadTypes(request: Request, deps: EngineDeps): Promise<Response> {
  const auth = await authenticate(request, deps.clientToken);
  if ("response" in auth) return auth.response;
  return json({ maxBytes: MAX_UPLOAD_BYTES, types: UPLOAD_TYPES.map((type) => ({ contentType: type.contentType, extensions: [...type.extensions], group: type.group })), folderExtensions: folderExtensions() });
}

/** The groups of the list, in its order, as one plain phrase ("PDF, slides, docs and audio"). */
function groupsInWords(): string {
  const groups = [...new Set(UPLOAD_TYPES.map((type) => type.group))];
  return groups.length > 1 ? `${groups.slice(0, -1).join(", ")} and ${groups.at(-1)}` : (groups[0] ?? "nothing");
}

/**
 * An asset, whole or one byte range of it (`Range: bytes=…`), so a video
 * can be seeked in a browser or on the phone (engine/docs/api.md, "Assets").
 * Storage is asked for only the bytes sent, and they are streamed, never
 * read whole first: a browser plays a video with many range requests, and
 * each would otherwise cost the whole file. An open range (`bytes=N-`) is
 * the rest of the file, as asked; a browser that wants less stops reading
 * and the stream stops with it.
 */
export async function getAsset(id: string, deps: EngineDeps, rangeHeader?: string | null): Promise<Response> {
  if (!deps.bucket) return notFound("Asset not found");
  const key = assetKeyForId(id);
  const head = await deps.bucket.head(key);
  if (!head) return notFound("Asset not found");
  const size = head.size ?? 0;
  const contentType = head.httpMetadata?.contentType ?? "application/octet-stream";
  const headers: Record<string, string> = {
    "content-type": contentType,
    "cache-control": "public, max-age=31536000, immutable",
    "access-control-allow-origin": "*",
    "access-control-expose-headers": "content-range, content-length, accept-ranges",
    "accept-ranges": "bytes",
    ...assetSafetyHeaders(contentType),
  };
  const range = rangeHeader ? byteRange(rangeHeader, size) : "ignore";
  if (range === "unsatisfiable") {
    return new Response(null, { status: 416, headers: { ...headers, "content-range": `bytes */${size}` } });
  }
  const whole = range === "ignore";
  const length = whole ? size : range.end - range.start + 1;
  const object = whole ? await deps.bucket.get(key) : await deps.bucket.get(key, { range: { offset: range.start, length } });
  if (!object) return notFound("Asset not found");
  const body = object.body ?? (await object.arrayBuffer());
  headers["content-length"] = String(length);
  if (whole) return new Response(body, { status: 200, headers });
  return new Response(body, {
    status: 206,
    headers: { ...headers, "content-range": `bytes ${range.start}-${range.end}/${size}` },
  });
}

/** Pictures, sound and video a browser shows in place; anything else an asset holds is saved, not opened. */
const SHOWN_IN_PLACE = /^(?:image\/(?:png|jpeg|gif|webp|avif)|audio\/[\w.+-]+|video\/[\w.+-]+)$/;

/**
 * An asset's content type came from the server it was read from
 * (extract/web.ts keeps any `image/*`), so its address is never a page of
 * its own: the type is not guessed, nothing in it may run or load anything
 * (`sandbox`, `default-src 'none'`), and an SVG or any other type a browser
 * would open as a document is a download when opened directly. An `<img>`
 * of an SVG never runs its script, so cards still show one.
 */
export function assetSafetyHeaders(contentType: string): Record<string, string> {
  const type = contentType.split(";")[0]!.trim().toLowerCase();
  return {
    "x-content-type-options": "nosniff",
    "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    ...(SHOWN_IN_PLACE.test(type) ? {} : { "content-disposition": "attachment" }),
  };
}

/**
 * One `bytes=` range, inclusive. Several ranges, other units or a malformed
 * header are ignored (the whole asset is sent), as RFC 9110 allows.
 */
export function byteRange(header: string, size: number): { start: number; end: number } | "ignore" | "unsatisfiable" {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match || (match[1] === "" && match[2] === "")) return "ignore";
  if (match[1] === "") {
    const suffix = Number(match[2]);
    if (suffix === 0 || size === 0) return "unsatisfiable";
    return { start: Math.max(0, size - suffix), end: size - 1 };
  }
  const start = Number(match[1]);
  const end = match[2] === "" ? size - 1 : Math.min(Number(match[2]), size - 1);
  if (start >= size || end < start) return "unsatisfiable";
  return { start, end };
}
