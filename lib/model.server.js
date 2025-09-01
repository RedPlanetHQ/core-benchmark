require("dotenv").config();
const { openai } = require("@ai-sdk/openai");
const { streamText } = require("ai");

async function makeModelCall(stream, messages, onText) {
  if (stream) {
    const result = await streamText({
      model: openai("gpt-4.1-2025-04-14"),
      messages,
    });

    let fullText = "";
    for await (const textPart of result.textStream) {
      fullText += textPart;
      if (onText) onText(fullText);
    }

    return fullText;
  } else {
    const result = await streamText({
      model: openai("gpt-4.1-2025-04-14"),
      messages,
    });

    const fullText = await result.text;
    if (onText) onText(fullText);

    return fullText;
  }
}

module.exports = { makeModelCall };
