
const { createGeminiProvider, validateGeneratedReply } = require("./ai/providers/geminiProvider");

const geminiProvider = createGeminiProvider();

const generateResponse = async (comment, userPrompt) => {
    const result = await geminiProvider.generateReply({ comment, prompt: userPrompt });
    return result.text;
};

module.exports = { generateResponse, validateGeneratedReply };
