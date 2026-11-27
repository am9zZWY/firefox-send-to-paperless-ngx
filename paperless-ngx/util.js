/**
 * Whether bytes are a PDF ("%PDF-" magic), whatever the URL or the
 * Content-Type claimed: a login page served in place of the PDF must not be
 * uploaded.
 * @param {ArrayBuffer} buffer
 * @returns {boolean}
 */
export function isPdf(buffer) {
  const head = new Uint8Array(buffer, 0, Math.min(5, buffer.byteLength));
  return String.fromCharCode(...head) === "%PDF-";
}

/**
 * Filename for a PDF fetched from a URL: its last path segment, ending in
 * ".pdf" so Paperless-ngx keeps the type.
 * @param {string} url
 * @returns {string}
 */
export function pdfFilename(url) {
  let name = "";
  try {
    name = new URL(url).pathname.split("/").filter(Boolean).pop() || "";
  } catch {}
  name = name || "document";
  return name.toLowerCase().endsWith(".pdf") ? name : `${name}.pdf`;
}

/**
 * Remove trailingslash if it exists
 * @param {string} s - Any string
 * @return {string} - String with removed trailingslash
 */
export function cleanURL(s) {
  let cleanedString = s.trim();
  if (cleanedString.endsWith("/")) {
    cleanedString = cleanedString.slice(0, -1);
  }
  return cleanedString.toLowerCase();
}

/**
 * Execute a function lazily
 * @param {*} fn
 * @param {*} delay
 * @returns
 */
export function debounce(fn, delay = 300) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), delay);
  };
}
