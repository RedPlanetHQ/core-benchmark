const { z } = require("zod");
const { makeModelCall } = require("../lib/model.server");

const EvaluateBodyRequest = z.object({
  question: z.string(),
  standard_answer: z.string(),
  generated_answer: z.string(),
});

async function evaluateAnswer(body) {
  // Validate input
  const { question, standard_answer, generated_answer } = EvaluateBodyRequest.parse(body);

  const evaluationPrompt = `Your task is to label an answer to a question as 'CORRECT' or 'WRONG'. You will be given the following data:
    (1) a question (posed by one user to another user),
    (2) a 'gold' (ground truth) answer,
    (3) a generated answer
which you will score as CORRECT/WRONG.

The point of the question is to ask about something one user should know about the other user based on their prior conversations.
The gold answer will usually be a concise and short answer that includes the referenced topic, for example:
Question: Do you remember what I got the last time I went to Hawaii?
Gold answer: A shell necklace
The generated answer might be much longer, but you should be generous with your grading - as long as it touches on the same topic as the gold answer, it should be counted as CORRECT.

For time related questions, the gold answer will be a specific date, month, year, etc. The generated answer might be much longer or use relative time references (like "last Tuesday" or "next month"), but you should be generous with your grading - as long as it refers to the same date or time period as the gold answer, it should be counted as CORRECT. Even if the format differs (e.g., "May 7th" vs "7 May"), consider it CORRECT if it's the same date.

Now it's time for the real question:
Question: ${question}
Gold answer: ${standard_answer}
Generated answer: ${generated_answer}

First, provide a short (one sentence) explanation of your reasoning, then finish with CORRECT or WRONG.
Do NOT include both CORRECT and WRONG in your response, or it will break the evaluation script.

Just return the label CORRECT or WRONG in a json format with the key as "label".`;

  try {
    // Use the LLM to evaluate the answer
    const llmResponse = await makeModelCall(
      false, // Don't stream
      [{ role: "user", content: evaluationPrompt }],
      (text) => {
        // onText callback - we can log if needed
      }
    );

    // Parse the LLM response to extract the label
    const response = llmResponse.trim();
    let label = "WRONG";
    let reasoning = response;

    // Try to parse as JSON first
    try {
      const jsonResponse = JSON.parse(response);
      if (jsonResponse.label && (jsonResponse.label === "CORRECT" || jsonResponse.label === "WRONG")) {
        label = jsonResponse.label;
        reasoning = jsonResponse.reasoning || response;
      }
    } catch (jsonError) {
      // If not JSON, look for CORRECT/WRONG in the text
      if (response.includes("CORRECT") && !response.includes("WRONG")) {
        label = "CORRECT";
      } else if (response.includes("WRONG") && !response.includes("CORRECT")) {
        label = "WRONG";
      }
      // Extract reasoning (everything before the final CORRECT/WRONG)
      const parts = response.split(/(CORRECT|WRONG)$/);
      if (parts.length > 1) {
        reasoning = parts[0].trim();
      }
    }

    // Calculate match ratio for additional metrics
    const generatedLower = generated_answer.toLowerCase();
    const standardLower = standard_answer.toString().toLowerCase();
    const standardWords = standardLower.split(/\s+/).filter(word => word.length > 2);
    const matchingWords = standardWords.filter(word => generatedLower.includes(word));
    const matchRatio = standardWords.length > 0 ? matchingWords.length / standardWords.length : 0;

    return {
      label: label,
      reasoning: reasoning,
      matchRatio: matchRatio,
      method: "llm"
    };

  } catch (error) {
    console.error("Error in LLM evaluation:", error);
    
    // Fallback to heuristic evaluation
    const generatedLower = generated_answer.toLowerCase();
    const standardLower = standard_answer.toString().toLowerCase();
    
    const standardWords = standardLower.split(/\s+/).filter(word => word.length > 2);
    const matchingWords = standardWords.filter(word => generatedLower.includes(word));
    const matchRatio = standardWords.length > 0 ? matchingWords.length / standardWords.length : 0;
    
    const isCorrect = matchRatio > 0.3; // If 30% of important words match
    
    return {
      label: isCorrect ? "CORRECT" : "WRONG",
      reasoning: `Generated answer ${isCorrect ? 'contains' : 'does not contain'} sufficient matching content with the gold standard (${matchRatio.toFixed(2)} match ratio)`,
      matchRatio: matchRatio,
      method: "heuristic_fallback"
    };
  }
}

module.exports = { evaluateAnswer, EvaluateBodyRequest };