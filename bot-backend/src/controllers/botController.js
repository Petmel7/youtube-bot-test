
const { createBotRun, createSingleCommentReply, getOwnedBotRun, getBotRunCreditEstimate } = require("../services/botRunService");
const { toBotRunDto, toBotRunResultDto } = require("../utils/dto");
const {
    assertObjectBody,
    validateVideoId,
    validateYoutubeCommentId,
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

const replyToSingleCommentController = async (req, res) => {
    assertObjectBody(req.body);

    const commentId = validateYoutubeCommentId(req.params.commentId);
    const videoId = validateVideoId(req.body.videoId);
    const prompt = validatePrompt(req.body.prompt);
    const idempotencyKey = validateIdempotencyKey(req.body.idempotencyKey);
    const { run, result, created } = await createSingleCommentReply({
        user: req.user,
        videoId,
        commentId,
        prompt,
        idempotencyKey
    });

    res.status(created ? 201 : 200).json({
        success: true,
        run: toBotRunDto(run),
        result: toBotRunResultDto(result)
    });
};

module.exports = {
    startBotController,
    getBotRunController,
    getBotCostEstimateController,
    replyToSingleCommentController
};
