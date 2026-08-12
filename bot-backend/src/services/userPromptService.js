const UserPrompt = require("../models/UserPrompt");
const { generatePrompt, genderToText } = require("../config/promptConfig");
const { conflict, notFound } = require("../utils/errors");

const createUserPrompt = async (userId, channelTheme, gender) => {
    const existingPrompt = await UserPrompt.findOne({ userId });
    if (existingPrompt) {
        throw conflict("PROMPT_EXISTS", "User prompt already exists");
    }

    const generalPrompt = generatePrompt(channelTheme, gender);
    const newPrompt = new UserPrompt({ userId, channelTheme, gender, genderText: genderToText(gender), generalPrompt });

    await newPrompt.save();
    return newPrompt;
};

const updateUserPromptData = async (userId, channelTheme, gender) => {
    const current = await UserPrompt.findOne({ userId });
    const nextTheme = channelTheme || current?.channelTheme;
    const nextGender = gender || current?.gender || (current?.genderText === "You are a woman." ? "female" : "male");
    const updateData = {
        channelTheme: nextTheme,
        gender: nextGender,
        genderText: genderToText(nextGender),
        generalPrompt: generatePrompt(nextTheme, nextGender)
    };

    return await UserPrompt.findOneAndUpdate({ userId }, updateData, { upsert: true, new: true });
};

const getUserPromptData = async (userId) => {
    const prompt = await UserPrompt.findOne({ userId });
    if (!prompt) {
        throw notFound("PROMPT_NOT_FOUND", "Prompt not found");
    }
    return prompt;
};

const updateUserGenderService = async (userId, gender) => {
    const current = await getUserPromptData(userId);
    return updateUserPromptData(userId, current.channelTheme, gender);
};

module.exports = {
    createUserPrompt,
    updateUserPromptData,
    getUserPromptData,
    updateUserGenderService
};

