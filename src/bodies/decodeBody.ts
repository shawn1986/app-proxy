import { brotliDecompressSync, gunzipSync, inflateSync } from "node:zlib";

export function isPreviewableContentType(contentType: string | undefined) {
  return /^application\/json|^text\//.test(contentType ?? "");
}

function createUtf8Preview(text: string, maxPreviewBytes: number) {
  let preview = "";
  let previewBytes = 0;

  for (const char of text) {
    const charBytes = Buffer.byteLength(char, "utf8");
    if (previewBytes + charBytes > maxPreviewBytes) {
      break;
    }

    preview += char;
    previewBytes += charBytes;
  }

  return {
    preview,
    truncated: Buffer.byteLength(text, "utf8") > maxPreviewBytes,
  };
}

export function decodeBody(input: {
  payload: Buffer;
  contentEncoding: string | undefined;
  contentType: string | undefined;
  maxPreviewBytes: number;
}) {
  let decoded = input.payload;

  if (input.contentEncoding === "gzip") {
    decoded = gunzipSync(decoded);
  } else if (input.contentEncoding === "br") {
    decoded = brotliDecompressSync(decoded);
  } else if (input.contentEncoding === "deflate") {
    decoded = inflateSync(decoded);
  }

  const text = decoded.toString("utf8");
  const preview = createUtf8Preview(text, input.maxPreviewBytes);
  return {
    preview: preview.preview,
    truncated: preview.truncated,
    previewable: isPreviewableContentType(input.contentType),
  };
}
