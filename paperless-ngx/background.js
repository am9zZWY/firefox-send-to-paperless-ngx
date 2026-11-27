import { isPdf, pdfFilename, cleanURL } from "./util.js";

/**
 * Fetches a URL with the cookies of a cookie store: the container or private
 * window of the tab the URL comes from. The extension's own requests always
 * go out with the default container's cookies, so a PDF behind a login done
 * in a container tab (or a private window) would come back as the site's
 * login page. The store's cookies are added by a blocking webRequest
 * listener, as fetch() cannot set a Cookie header itself; credentials are
 * omitted so neither the default container's cookies go out nor a Set-Cookie
 * in the response lands in the default container.
 * @param {string} url
 * @param {string | undefined} cookieStoreId - tab.cookieStoreId
 * @returns {Promise<Response>}
 */
async function fetchWithCookieStore(url, cookieStoreId) {
  if (!cookieStoreId || cookieStoreId === "firefox-default") {
    return fetch(url, { credentials: "include", cache: "no-store" });
  }
  const ownOrigin = browser.runtime.getURL("");
  const useStoreCookies = async (details) => {
    // Only this extension's own requests (no tab), redirects included.
    if (details.tabId !== -1 || !(details.originUrl || "").startsWith(ownOrigin)) return {};
    const cookies = await browser.cookies.getAll({ url: details.url, storeId: cookieStoreId });
    const requestHeaders = details.requestHeaders.filter((h) => h.name.toLowerCase() !== "cookie");
    if (cookies.length) {
      requestHeaders.push({
        name: "Cookie",
        value: cookies.map((c) => `${c.name}=${c.value}`).join("; "),
      });
    }
    return { requestHeaders };
  };
  browser.webRequest.onBeforeSendHeaders.addListener(useStoreCookies, { urls: ["<all_urls>"] }, [
    "blocking",
    "requestHeaders",
  ]);
  try {
    // no-store: the HTTP cache is not split by cookie store, so a PDF cached
    // for another container's session must not be reused.
    return await fetch(url, { credentials: "omit", cache: "no-store" });
  } finally {
    browser.webRequest.onBeforeSendHeaders.removeListener(useStoreCookies);
  }
}

/**
 * Fetches a URL and returns its bytes only if they are a PDF.
 * @param {string} url
 * @param {string | undefined} cookieStoreId - tab.cookieStoreId
 * @returns {Promise<{buffer: ArrayBuffer, filename: string} | null>}
 */
async function fetchPdf(url, cookieStoreId) {
  if (!/^(https?|file):/i.test(url || "")) return null;
  let response;
  try {
    response = await fetchWithCookieStore(url, cookieStoreId);
  } catch (err) {
    console.warn("Cannot fetch", url, err);
    return null;
  }
  if (!response.ok) return null;
  const buffer = await response.arrayBuffer();
  if (!isPdf(buffer)) return null;
  return { buffer, filename: pdfFilename(url) };
}

/**
 * Fetches the Paperless configuration from browser storage.
 * @returns {Promise<{paperlessUrl: string, apiKey: string}>} - The configuration object.
 */
async function getConfig() {
  const { paperlessUrl = "", apiKey = "" } = await browser.storage.local.get([
    "paperlessUrl",
    "apiKey",
  ]);
  return { paperlessUrl, apiKey };
}

/**
 * Actual request to Paperless-ngx API
 * Expects URL and API Key already loaded in the config
 *
 * @param {*} pdfBlob
 * @param {*} filename
 */
async function upload(pdfBlob, filename) {
  let { paperlessUrl, apiKey } = await getConfig();
  if (!paperlessUrl || !apiKey) throw new Error("Paperless-ngx is not configured.");

  const formData = new FormData();
  formData.append("document", pdfBlob, filename);

  paperlessUrl = cleanURL(paperlessUrl);
  apiKey = apiKey.trim();

  return fetch(`${paperlessUrl}/api/documents/post_document/`, {
    method: "POST",
    headers: { Authorization: `Token ${apiKey}` },
    body: formData,
  });
}

async function uploadFromUrl(pdfUrl, cookieStoreId) {
  try {
    const pdf = await fetchPdf(pdfUrl, cookieStoreId);
    if (!pdf) return { success: false, notPdf: true, error: "Not a PDF" };

    const pdfBlob = new Blob([pdf.buffer], { type: "application/pdf" });
    const { filename } = pdf;

    const uploadResponse = await upload(pdfBlob, filename);
    if (!uploadResponse.ok) throw new Error(await uploadResponse.text());

    return { success: true, filename };
  } catch (err) {
    console.error("Upload error:", err);
    return { success: false, error: err.message };
  }
}

/**
 * Uploads from a blob
 * @param {*} pdfUrl
 * @returns
 */
async function uploadFromBlob({ buffer, filename }) {
  try {
    if (!isPdf(buffer)) throw new Error("Not a PDF");
    const pdfBlob = new Blob([buffer], { type: "application/pdf" });

    const uploadResponse = await upload(pdfBlob, filename);
    if (!uploadResponse.ok) throw new Error(await uploadResponse.text());

    return { success: true, filename };
  } catch (err) {
    console.error("Upload error:", err);
    return { success: false, error: err.message };
  }
}

browser.runtime.onMessage.addListener((request) => {
  if (request.action === "uploadFromUrl") {
    return uploadFromUrl(request.url, request.cookieStoreId);
  }
  if (request.action === "uploadFromBlob") return uploadFromBlob(request);
});

browser.browserAction.onClicked.addListener(async (tab) => {
  if (tab.url) await uploadFromUrl(tab.url, tab.cookieStoreId);
});

// Create context menu item
browser.contextMenus.create({
  id: "send-to-paperless",
  title: "Send to Paperless-ngx",
  contexts: ["link", "page"],
});

// Handle context menu clicks
browser.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== "send-to-paperless") return;

  await uploadFromUrl(info.linkUrl || tab.url, tab.cookieStoreId);
});
