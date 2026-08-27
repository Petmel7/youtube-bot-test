
const { createBotRun, getOwnedBotRun, getBotRunCreditEstimate } = require("../services/botRunService");
const { toBotRunDto } = require("../utils/dto");
const {
    assertObjectBody,
    validateVideoId,
    validatePrompt,
    validateIdempotencyKey
} = require("../utils/validators");

const startBotController = async (req, res) => {
    assertObjectBody(req.body);

    const videoId = validateVideoId(req.body.videoId);
    const prompt = validatePrompt(req.body.prompt);
    const idempotencyKey = validateIdempotencyKey(req.body.idempotencyKey);
    const { run, created } = await createBotRun({ user: req.user, videoId, prompt, idempotencyKey });

    res.status(created ? 202 : 200).json({
        success: true,
        runId: String(run._id),
        status: run.status,
        run: toBotRunDto(run)
    });
};

const getBotRunController = async (req, res) => {
    const run = await getOwnedBotRun(req.user._id, req.params.runId);
    res.json({ success: true, run: toBotRunDto(run) });
};

const getBotCostEstimateController = async (req, res) => {
    assertObjectBody(req.body);

    const prompt = validatePrompt(req.body.prompt);
    const estimate = await getBotRunCreditEstimate({ user: req.user, prompt });

    res.json({
        success: true,
        cost: estimate
    });
};

module.exports = { startBotController, getBotRunController, getBotCostEstimateController };

