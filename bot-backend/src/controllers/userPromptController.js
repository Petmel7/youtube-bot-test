
const { createUserPrompt, updateUserPromptData, getUserPromptData, updateUserGenderService } = require("../services/userPromptService");
const { toPromptDto } = require("../utils/dto");
const { assertObjectBody, validateChannelTheme, validateGender } = require("../utils/validators");

const addUserPrompt = async (req, res) => {
    assertObjectBody(req.body);
    const channelTheme = validateChannelTheme(req.body.channelTheme);
    const gender = validateGender(req.body.gender);
    const userId = req.user._id;

    const newPrompt = await createUserPrompt(userId, channelTheme, gender);
    res.json({ success: true, prompt: toPromptDto(newPrompt) });
};

const updateUserPrompt = async (req, res) => {
    assertObjectBody(req.body);
    const channelTheme = req.body.channelTheme === undefined ? undefined : validateChannelTheme(req.body.channelTheme);
    const gender = req.body.gender === undefined ? undefined : validateGender(req.body.gender);
    const userId = req.user._id;

    const updatedPrompt = await updateUserPromptData(userId, channelTheme, gender);
    res.json({ success: true, prompt: toPromptDto(updatedPrompt) });
};

const getUserPrompt = async (req, res) => {
    const userId = req.user._id;
    try {
        const prompt = await getUserPromptData(userId);
        res.json({ success: true, prompt: toPromptDto(prompt) });
    } catch (error) {
        if (error?.code === "PROMPT_NOT_FOUND") {
            res.json({ success: true, prompt: null });
            return;
        }

        throw error;
    }
};

const updateUserGender = async (req, res) => {
    assertObjectBody(req.body);
    const userId = req.user._id;
    const gender = validateGender(req.body.gender);

    const updatedPrompt = await updateUserGenderService(userId, gender);
    res.json({ success: true, prompt: toPromptDto(updatedPrompt) });
};

module.exports = {
    addUserPrompt,
    updateUserPrompt,
    getUserPrompt,
    updateUserGender
};
