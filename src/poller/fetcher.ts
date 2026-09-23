import { parseRawNews, RawNewsItem } from "../parser/index.js";

const DEFAULT_SOURCE_URL =
  process.env.SOURCE_API_URL || "https://mutemute.com/mutenews/ajax/app-news.php";

/**
 * Fetches the latest flash news from upstream endpoint
 */
export async function fetchLiveNews(url: string = DEFAULT_SOURCE_URL): Promise<RawNewsItem[]> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    },
    body: "action=get_news&limit=50",
  });

  if (!response.ok) {
    throw new Error(`Upstream fetch failed: ${response.status} ${response.statusText}`);
  }

  const json: any = await response.json();

  if (Array.isArray(json)) {
    return json as RawNewsItem[];
  }

  // Upstream returns { content: [...] }
  if (json && typeof json === "object") {
    if (Array.isArray(json.content)) {
      return json.content as RawNewsItem[];
    }
    if (Array.isArray(json.data)) {
      return json.data as RawNewsItem[];
    }
  }

  return [];
}
