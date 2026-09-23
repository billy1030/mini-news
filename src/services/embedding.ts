import * as dotenv from "dotenv";
dotenv.config();

const DEFAULT_URL = "https://api.minimaxi.com/v1/embeddings";
const DEFAULT_MODEL = "embo-01";

export interface MinimaxEmbeddingResponse {
  vectors?: number[][];
  total_tokens?: number;
  base_resp?: {
    status_code: number;
    status_msg: string;
  };
}

/**
 * Generates 1536-dimensional embeddings using MiniMax's embo-01 model.
 * 
 * @param texts Array of string contents to embed.
 * @param type "db" for documents to be indexed in the vector store; "query" for user/agent search questions.
 */
export async function getMinimaxEmbeddings(
  texts: string[],
  type: "db" | "query" = "db"
): Promise<number[][]> {
  const apiKey = process.env.MINIMAX_API_KEY;
  const endpoint = process.env.MINIMAX_EMBEDDING_URL || DEFAULT_URL;
  const model = process.env.MINIMAX_EMBEDDING_MODEL || DEFAULT_MODEL;

  if (!apiKey) {
    throw new Error("[MiniMax] MINIMAX_API_KEY is not defined in environment variables.");
  }

  if (!texts || texts.length === 0) {
    return [];
  }

  // Truncate each text to safe length (e.g. 4000 characters)
  const sanitizedTexts = texts.map((t) => (t || "").trim().slice(0, 4000));

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      texts: sanitizedTexts,
      type,
    }),
  });

  if (!response.ok) {
    throw new Error(`[MiniMax] HTTP ${response.status} ${response.statusText}`);
  }

  const data = (await response.json()) as MinimaxEmbeddingResponse;

  if (data.base_resp && data.base_resp.status_code !== 0) {
    throw new Error(`[MiniMax] API Error (${data.base_resp.status_code}): ${data.base_resp.status_msg}`);
  }

  if (!data.vectors || data.vectors.length === 0) {
    throw new Error("[MiniMax] Empty vector response returned from API.");
  }

  return data.vectors;
}
