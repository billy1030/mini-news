import { NewFlashNews } from "../db/schema.js";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";
import timezone from "dayjs/plugin/timezone.js";

dayjs.extend(utc);
dayjs.extend(timezone);

const HKT_TIMEZONE = "Asia/Hong_Kong";

export interface RawNewsItem {
  id?: string | number;
  time?: string | number;
  createdAt?: string | number;
  updatedAt?: string | number;
  title?: string;
  content?: string;
  importance?: number | string;
  category?: string;
  tags?: string;
  is_alert?: boolean | number;
  [key: string]: unknown;
}

/**
 * Common financial ticker and keyword detection regex
 */
const TICKER_REGEX = /\$([A-Z]{1,6})\b|\b([A-Z]{2,5})\.(US|HK|SS|SZ)\b|\b(BTC|ETH|SOL|NVDA|AAPL|TSLA|MSFT|GOOGL|AMZN|META)\b/gi;

/**
 * Directional sentiment detection keywords
 */
const UP_KEYWORDS = ["大漲", "走高", "拉升", "上漲", "飆升", "上行", "高開", "漲停", "surge", "jump", "rally", "gain", "bullish"];
const DOWN_KEYWORDS = ["大跌", "跳水", "走低", "重挫", "下挫", "暴跌", "下行", "低開", "跌停", "plunge", "drop", "slump", "fall", "bearish"];

/**
 * Extracts recognized tickers from news text
 */
export function extractTickers(text: string): string[] {
  const matches = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = TICKER_REGEX.exec(text)) !== null) {
    const ticker = match[1] || match[2] || match[4];
    if (ticker) {
      matches.add(ticker.toUpperCase());
    }
  }
  return Array.from(matches);
}

/**
 * Detects market direction sentiment
 */
export function detectDirection(text: string): "UP" | "DOWN" | "FLAT" {
  const lower = text.toLowerCase();
  for (const word of UP_KEYWORDS) {
    if (text.includes(word) || lower.includes(word)) return "UP";
  }
  for (const word of DOWN_KEYWORDS) {
    if (text.includes(word) || lower.includes(word)) return "DOWN";
  }
  return "FLAT";
}

/**
 * Normalizes raw incoming news into clean NewFlashNews entity
 */
export function parseRawNews(item: RawNewsItem): NewFlashNews {
  const idStr = String(item.id || item.createdAt || Date.now());
  const rawText = (item.content || item.title || "").trim();

  // Upstream returns createdAt / updatedAt as UNIX seconds
  const rawTimestamp = item.createdAt || item.updatedAt || item.time;
  let timestampObj: dayjs.Dayjs;
  if (typeof rawTimestamp === "number") {
    timestampObj = rawTimestamp > 10000000000 ? dayjs(rawTimestamp) : dayjs.unix(rawTimestamp);
  } else if (typeof rawTimestamp === "string" && !isNaN(Number(rawTimestamp))) {
    const num = Number(rawTimestamp);
    timestampObj = num > 10000000000 ? dayjs(num) : dayjs.unix(num);
  } else {
    timestampObj = dayjs();
  }

  // Calculate precise HKT time
  const hktObj = timestampObj.tz(HKT_TIMEZONE);
  const dateHkt = hktObj.format("YYYY-MM-DD");
  const timeHkt = hktObj.format("HH:mm:ss");

  const importanceNum = Number(item.importance) || 0;
  const isAlert = Boolean(item.is_alert) || importanceNum >= 3;
  const category = (item.category as string) || "general";
  const tickers = extractTickers(rawText);
  const direction = detectDirection(rawText);

  return {
    id: idStr,
    createdAt: timestampObj.toDate(),
    dateHkt,
    timeHkt,
    importance: importanceNum,
    isAlert,
    category,
    rawContent: rawText,
    tickers,
    direction,
  };
}
