import { getMinimaxEmbeddings } from "../src/services/embedding.js";

async function run() {
  console.log("=== Testing MiniMax Embedding API Integration ===");
  try {
    const sampleTexts = [
      "美聯儲宣布最新利率決議，市場預期年內可能再降息25個點子。",
      "騰訊控股在香港市場發行美元優先票據。"
    ];

    console.log(`Requesting embeddings for ${sampleTexts.length} items (type: 'db')...`);
    const vectors = await getMinimaxEmbeddings(sampleTexts, "db");

    console.log("Success! Received vectors count:", vectors.length);
    console.log("Vector 0 length:", vectors[0].length);
    console.log("Vector 1 length:", vectors[1].length);
    console.log("Sample vector snippet (first 5 dimensions):", vectors[0].slice(0, 5));

    console.log("\nTesting query embedding (type: 'query')...");
    const [queryVec] = await getMinimaxEmbeddings(["息口前景走勢如何？"], "query");
    console.log("Query vector length:", queryVec.length);
    console.log("Sample query vector snippet:", queryVec.slice(0, 5));
    console.log("\nAll MiniMax Embedding tests passed!");
  } catch (err: any) {
    console.error("Test failed:", err.message);
  }
}

run();
