import { useCallback, useEffect, useRef, useState } from "react";
import { FaComments } from "react-icons/fa";
import { useTranslation } from "react-i18next";
import {
    fetchCancelCommentDraft,
    fetchEditPostedCommentReply,
    fetchGenerateCommentDraft,
    fetchPublishCommentReply,
    fetchReplyToComment,
    fetchUpdateCommentDraft
} from "../services/botService";
import { fetchVideoComments } from "../services/youtubeService";
import styles from "../styles/videoCommentsInbox.module.css";

const commentPageLimit = 20;
const statusFilters = ["all", "unanswered", "drafted", "replied", "failed", "skipped"];

const appendUniqueComments = (currentComments, nextComments) => {
    const seen = new Set(currentComments.map(comment => comment.commentId));
    const uniqueNextComments = [];

    for (const comment of nextComments) {
        if (!comment?.commentId || seen.has(comment.commentId)) {
            continue;
        }

        seen.add(comment.commentId);
        uniqueNextComments.push(comment);
    }

    return [...currentComments, ...uniqueNextComments];
};

const getCommentsErrorMessage = (error, t) => {
    switch (error?.code) {
        case "YOUTUBE_COMMENTS_FAILED":
            return t("comments.errors.load");
        case "YOUTUBE_QUOTA_EXCEEDED":
            return t("videos.quotaExceeded");
        case "YOUTUBE_AUTH_FAILED":
            return t("videos.authFailed");
        case "VIDEO_FORBIDDEN":
            return t("comments.errors.forbidden");
        case "VIDEO_NOT_FOUND":
            return t("comments.errors.notFound");
        default:
            return error?.message || t("comments.errors.load");
    }
};

const getReplyErrorMessage = (error, t) => {
    switch (error?.code) {
        case "INSUFFICIENT_CREDITS":
            return t("bot.insufficientCreditsDetailed", {
                required: error.details?.requiredCredits ?? "-",
                available: error.details?.availableCredits ?? "-"
            });
        case "COMMENT_ALREADY_REPLIED":
            return t("comments.errors.alreadyReplied");
        case "DRAFT_NOT_FOUND":
            return t("comments.errors.draftNotFound");
        case "COMMENT_VIDEO_MISMATCH":
            return t("comments.errors.commentMismatch");
        case "YOUTUBE_REPLY_FAILED":
            return t("comments.errors.replyPostFailed");
        case "YOUTUBE_REPLY_EDIT_FAILED":
            return t("comments.errors.replyEditFailed");
        case "YOUTUBE_REPLY_EDIT_FORBIDDEN":
            return t("comments.errors.replyEditForbidden");
        case "YOUTUBE_AUTH_FAILED":
            return t("videos.authFailed");
        case "YOUTUBE_REPLY_NOT_FOUND":
            return t("comments.errors.replyNotFound");
        case "YOUTUBE_REPLY_TEXT_TOO_LONG":
            return t("comments.errors.replyTooLong");
        case "YOUTUBE_REPLY_ID_MISSING":
            return t("comments.errors.replyEditUnavailable");
        case "GEMINI_TIMEOUT":
            return t("bot.aiTimeout");
        case "GEMINI_REPLY_INCOMPLETE":
            return t("bot.aiIncomplete");
        case "GEMINI_RATE_LIMIT":
            return t("bot.aiRateLimited");
        case "GEMINI_PROVIDER_UNAVAILABLE":
            return t("bot.aiUnavailable");
        case "GEMINI_PROVIDER_ERROR":
            return t("bot.aiProviderError");
        case "GEMINI_AUTH_FAILED":
        case "GEMINI_INVALID_MODEL":
            return t("bot.aiConfigError");
        default:
            return error?.message || t("comments.errors.reply");
    }
};

const canReplyToStatus = (status) => ["unanswered", "failed", "skipped"].includes(status);

const getStatusClassName = (status) => {
    switch (status) {
        case "replied":
            return styles.statusReplied;
        case "drafted":
            return styles.statusDrafted;
        case "failed":
            return styles.statusFailed;
        case "skipped":
            return styles.statusSkipped;
        default:
            return styles.statusUnanswered;
    }
};

const formatDate = (value, fallback) => {
    if (!value) return fallback;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? fallback : date.toLocaleString();
};

const VideoCommentsInbox = ({ selectedVideo, botPrompt, onReplyComplete }) => {
    const { t } = useTranslation();
    const [statusFilter, setStatusFilter] = useState("all");
    const [comments, setComments] = useState([]);
    const [nextPageToken, setNextPageToken] = useState(null);
    const [loading, setLoading] = useState(false);
    const [loadingMore, setLoadingMore] = useState(false);
    const [errorMessage, setErrorMessage] = useState("");
    const [replyingCommentIds, setReplyingCommentIds] = useState({});
    const [draftTextByCommentId, setDraftTextByCommentId] = useState({});
    const [editTextByCommentId, setEditTextByCommentId] = useState({});
    const [editModeByCommentId, setEditModeByCommentId] = useState({});
    const [manualModeByCommentId, setManualModeByCommentId] = useState({});
    const [commentErrors, setCommentErrors] = useState({});
    const requestIdRef = useRef(0);
    const pendingPageTokenRef = useRef(null);

    const videoId = selectedVideo?.videoId;

    const loadComments = useCallback(async ({ pageToken, append = false, status = statusFilter } = {}) => {
        if (!videoId) {
            setComments([]);
            setNextPageToken(null);
            return;
        }

        const requestKey = `${videoId}:${status}:${pageToken || ""}`;
        if (append && pendingPageTokenRef.current === requestKey) {
            return;
        }

        pendingPageTokenRef.current = requestKey;
        const requestId = ++requestIdRef.current;

        if (append) {
            setLoadingMore(true);
        } else {
            setLoading(true);
        }
        setErrorMessage("");

        try {
            const result = await fetchVideoComments({
                videoId,
                pageToken,
                limit: commentPageLimit,
                status
            });

            if (requestId !== requestIdRef.current) return;

            if (result.success) {
                setComments(current => append ? appendUniqueComments(current, result.comments) : result.comments);
                setNextPageToken(result.nextPageToken);
            } else {
                if (!append) {
                    setComments([]);
                    setNextPageToken(null);
                }
                setErrorMessage(getCommentsErrorMessage(result.error, t));
            }
        } finally {
            if (pendingPageTokenRef.current === requestKey) {
                pendingPageTokenRef.current = null;
            }
            if (requestId === requestIdRef.current) {
                setLoading(false);
                setLoadingMore(false);
            }
        }
    }, [statusFilter, t, videoId]);

    useEffect(() => {
        pendingPageTokenRef.current = null;
        setComments([]);
        setNextPageToken(null);
        setErrorMessage("");
        setDraftTextByCommentId({});
        setEditTextByCommentId({});
        setEditModeByCommentId({});
        setManualModeByCommentId({});
        setCommentErrors({});
        loadComments({ status: statusFilter });
    }, [loadComments, statusFilter, videoId]);

    const handleStatusChange = (event) => {
        setStatusFilter(event.target.value);
    };

    const updateCommentWithResult = (commentId, result) => {
        setComments(current => current.map(comment => {
            if (comment.commentId !== commentId) {
                return comment;
            }

            return {
                ...comment,
                status: result?.status || comment.status,
                latestResult: result ? {
                    status: result.status,
                    errorCode: result.errorCode || null,
                    errorMessage: result.errorMessage || null,
                    replyTextSnapshot: result.replyTextSnapshot || null,
                    draftReplyText: result.draftReplyText || null,
                    youtubeReplyId: result.youtubeReplyId || null,
                    taskId: result.taskId || comment.latestResult?.taskId || null,
                    canEditPostedReply: Boolean(result.canEditPostedReply),
                    editDisabledReason: result.editDisabledReason || null,
                    editCount: result.editCount ?? comment.latestResult?.editCount ?? 0,
                    lastEditedAt: result.lastEditedAt || comment.latestResult?.lastEditedAt || null,
                    generatedByAi: result.generatedByAi,
                    runId: result.runId || null,
                    updatedAt: result.updatedAt || new Date().toISOString()
                } : comment.latestResult
            };
        }));
    };

    const setCommentLoading = (commentId, value) => {
        setReplyingCommentIds(current => {
            const next = { ...current };
            if (value) {
                next[commentId] = value;
            } else {
                delete next[commentId];
            }
            return next;
        });
    };

    const applyCommentResult = (commentId, result) => {
        if (result) {
            updateCommentWithResult(commentId, result);
            if (result.draftReplyText) {
                setDraftTextByCommentId(current => ({ ...current, [commentId]: result.draftReplyText }));
            }
            if (result.status === "replied" || result.status === "unanswered") {
                setManualModeByCommentId(current => {
                    const next = { ...current };
                    delete next[commentId];
                    return next;
                });
                setDraftTextByCommentId(current => {
                    const next = { ...current };
                    delete next[commentId];
                    return next;
                });
                setEditModeByCommentId(current => {
                    const next = { ...current };
                    delete next[commentId];
                    return next;
                });
                setEditTextByCommentId(current => {
                    const next = { ...current };
                    delete next[commentId];
                    return next;
                });
            }
        }
    };

    const handleReplyToComment = async (comment) => {
        if (!videoId || !comment?.commentId || replyingCommentIds[comment.commentId]) return;

        setCommentLoading(comment.commentId, "reply");
        setCommentErrors(current => ({ ...current, [comment.commentId]: "" }));

        try {
            const response = await fetchReplyToComment({
                videoId,
                commentId: comment.commentId,
                prompt: botPrompt?.generalPrompt || ""
            });

            if (response.result) {
                applyCommentResult(comment.commentId, response.result);
            }
            onReplyComplete?.(response.run || null);
        } catch (error) {
            if (error.details?.result) {
                applyCommentResult(comment.commentId, error.details.result);
            }
            setCommentErrors(current => ({
                ...current,
                [comment.commentId]: getReplyErrorMessage(error, t)
            }));
        } finally {
            setCommentLoading(comment.commentId, null);
        }
    };

    const handleGenerateDraft = async (comment) => {
        if (!videoId || !comment?.commentId || replyingCommentIds[comment.commentId]) return;

        setCommentLoading(comment.commentId, "draft");
        setCommentErrors(current => ({ ...current, [comment.commentId]: "" }));

        try {
            const response = await fetchGenerateCommentDraft({
                videoId,
                commentId: comment.commentId,
                prompt: botPrompt?.generalPrompt || ""
            });
            applyCommentResult(comment.commentId, response.result);
            onReplyComplete?.(response.run || null);
        } catch (error) {
            if (error.details?.result) {
                applyCommentResult(comment.commentId, error.details.result);
            }
            setCommentErrors(current => ({
                ...current,
                [comment.commentId]: getReplyErrorMessage(error, t)
            }));
        } finally {
            setCommentLoading(comment.commentId, null);
        }
    };

    const handleSaveDraft = async (comment) => {
        const draftReplyText = draftTextByCommentId[comment.commentId] || "";
        if (!videoId || !comment?.commentId || replyingCommentIds[comment.commentId] || !draftReplyText.trim()) return;

        setCommentLoading(comment.commentId, "save");
        setCommentErrors(current => ({ ...current, [comment.commentId]: "" }));

        try {
            const response = await fetchUpdateCommentDraft({
                videoId,
                commentId: comment.commentId,
                draftReplyText
            });
            applyCommentResult(comment.commentId, response.result);
        } catch (error) {
            setCommentErrors(current => ({
                ...current,
                [comment.commentId]: getReplyErrorMessage(error, t)
            }));
        } finally {
            setCommentLoading(comment.commentId, null);
        }
    };

    const handlePublishReply = async (comment, source) => {
        const replyText = draftTextByCommentId[comment.commentId] || "";
        if (!videoId || !comment?.commentId || replyingCommentIds[comment.commentId] || !replyText.trim()) return;

        setCommentLoading(comment.commentId, "publish");
        setCommentErrors(current => ({ ...current, [comment.commentId]: "" }));

        try {
            const response = await fetchPublishCommentReply({
                videoId,
                commentId: comment.commentId,
                replyText,
                source
            });
            applyCommentResult(comment.commentId, response.result);
            onReplyComplete?.(response.run || null);
        } catch (error) {
            if (error.details?.result) {
                applyCommentResult(comment.commentId, error.details.result);
            }
            setCommentErrors(current => ({
                ...current,
                [comment.commentId]: getReplyErrorMessage(error, t)
            }));
        } finally {
            setCommentLoading(comment.commentId, null);
        }
    };

    const handleCancelDraft = async (comment) => {
        if (!videoId || !comment?.commentId || replyingCommentIds[comment.commentId]) return;

        if (manualModeByCommentId[comment.commentId] && comment.status !== "drafted") {
            setManualModeByCommentId(current => {
                const next = { ...current };
                delete next[comment.commentId];
                return next;
            });
            setDraftTextByCommentId(current => {
                const next = { ...current };
                delete next[comment.commentId];
                return next;
            });
            return;
        }

        setCommentLoading(comment.commentId, "cancel");
        setCommentErrors(current => ({ ...current, [comment.commentId]: "" }));

        try {
            const response = await fetchCancelCommentDraft({ videoId, commentId: comment.commentId });
            applyCommentResult(comment.commentId, response.result);
        } catch (error) {
            setCommentErrors(current => ({
                ...current,
                [comment.commentId]: getReplyErrorMessage(error, t)
            }));
        } finally {
            setCommentLoading(comment.commentId, null);
        }
    };

    const handleManualReply = (comment) => {
        setManualModeByCommentId(current => ({ ...current, [comment.commentId]: true }));
        setDraftTextByCommentId(current => ({
            ...current,
            [comment.commentId]: comment.latestResult?.draftReplyText || ""
        }));
        setCommentErrors(current => ({ ...current, [comment.commentId]: "" }));
    };

    const handleStartEditPostedReply = (comment) => {
        setEditModeByCommentId(current => ({ ...current, [comment.commentId]: true }));
        setEditTextByCommentId(current => ({
            ...current,
            [comment.commentId]: comment.latestResult?.replyTextSnapshot || ""
        }));
        setCommentErrors(current => ({ ...current, [comment.commentId]: "" }));
    };

    const handleCancelEditPostedReply = (comment) => {
        setEditModeByCommentId(current => {
            const next = { ...current };
            delete next[comment.commentId];
            return next;
        });
        setEditTextByCommentId(current => {
            const next = { ...current };
            delete next[comment.commentId];
            return next;
        });
        setCommentErrors(current => ({ ...current, [comment.commentId]: "" }));
    };

    const handleSavePostedReplyEdit = async (comment) => {
        const replyText = editTextByCommentId[comment.commentId] || "";
        const taskId = comment.latestResult?.taskId;
        if (!videoId || !comment?.commentId || !taskId || replyingCommentIds[comment.commentId] || !replyText.trim()) return;

        setCommentLoading(comment.commentId, "edit");
        setCommentErrors(current => ({ ...current, [comment.commentId]: "" }));

        try {
            const response = await fetchEditPostedCommentReply({
                videoId,
                commentId: comment.commentId,
                taskId,
                replyText
            });
            applyCommentResult(comment.commentId, response.result);
        } catch (error) {
            setCommentErrors(current => ({
                ...current,
                [comment.commentId]: getReplyErrorMessage(error, t)
            }));
        } finally {
            setCommentLoading(comment.commentId, null);
        }
    };

    if (!selectedVideo) {
        return null;
    }

    return (
        <section className={styles.inbox}>
            <div className={styles.header}>
                <div className={styles.heading}>
                    <FaComments className={styles.icon} />
                    <div>
                        <h2>{t("comments.title")}</h2>
                        <p>{selectedVideo.title}</p>
                    </div>
                </div>
                <button
                    type="button"
                    className={styles.refreshButton}
                    onClick={() => loadComments({ status: statusFilter })}
                    disabled={loading || loadingMore}
                >
                    {t("comments.refresh")}
                </button>
            </div>

            <div className={styles.toolbar}>
                <label htmlFor="comment-status-filter">{t("comments.filter")}</label>
                <select
                    id="comment-status-filter"
                    className={styles.filterSelect}
                    value={statusFilter}
                    onChange={handleStatusChange}
                    disabled={loading}
                >
                    {statusFilters.map(status => (
                        <option key={status} value={status}>
                            {t(`comments.filters.${status}`)}
                        </option>
                    ))}
                </select>
            </div>

            {loading && <p className={styles.stateText}>{t("comments.loading")}</p>}
            {!loading && errorMessage && <p className={styles.error}>{errorMessage}</p>}
            {!loading && !errorMessage && comments.length === 0 && (
                <p className={styles.stateText}>{t("comments.empty")}</p>
            )}

            {!loading && !errorMessage && comments.length > 0 && (
                <ul className={styles.commentList}>
                    {comments.map(comment => {
                        const actionLoading = replyingCommentIds[comment.commentId];
                        const isBusy = Boolean(actionLoading);
                        const rowError = commentErrors[comment.commentId];
                        const draftValue = draftTextByCommentId[comment.commentId]
                            ?? comment.latestResult?.draftReplyText
                            ?? "";
                        const isDraftEditorOpen = comment.status === "drafted" || Boolean(manualModeByCommentId[comment.commentId]);
                        const publishSource = comment.status === "drafted" ? "draft" : "manual";
                        const isEditingPostedReply = Boolean(editModeByCommentId[comment.commentId]);
                        const editValue = editTextByCommentId[comment.commentId]
                            ?? comment.latestResult?.replyTextSnapshot
                            ?? "";
                        const canEditPostedReply = Boolean(comment.latestResult?.canEditPostedReply);

                        return (
                        <li key={comment.commentId} className={styles.commentCard}>
                            <div className={styles.commentHeader}>
                                <div className={styles.author}>
                                    {comment.authorProfileImageUrl ? (
                                        <img src={comment.authorProfileImageUrl} alt="" />
                                    ) : (
                                        <span aria-hidden="true" />
                                    )}
                                    <div>
                                        <strong>{comment.authorDisplayName || t("comments.unknownAuthor")}</strong>
                                        <small>{formatDate(comment.updatedAt || comment.publishedAt, t("videos.noDate"))}</small>
                                    </div>
                                </div>
                                <span className={`${styles.statusBadge} ${getStatusClassName(comment.status)}`}>
                                    {t(`comments.statuses.${comment.status}`, comment.status)}
                                </span>
                            </div>

                            <p className={styles.commentText}>{comment.text}</p>

                            <div className={styles.metaRow}>
                                <span>{t("comments.likes")}: <strong>{comment.likeCount ?? 0}</strong></span>
                                <span title={comment.commentId}>{comment.commentId}</span>
                            </div>

                            {comment.latestResult?.replyTextSnapshot && (
                                <div className={styles.resultBlock}>
                                    <div className={styles.resultHeader}>
                                        <span>{t("comments.latestReply")}</span>
                                        {comment.latestResult.lastEditedAt && (
                                            <small>
                                                {t("comments.lastEdited", {
                                                    date: formatDate(comment.latestResult.lastEditedAt, t("videos.noDate"))
                                                })}
                                            </small>
                                        )}
                                    </div>
                                    <p>{comment.latestResult.replyTextSnapshot}</p>
                                </div>
                            )}

                            {isEditingPostedReply && (
                                <div className={styles.draftEditor}>
                                    <label htmlFor={`comment-edit-${comment.commentId}`}>
                                        {t("comments.editPostedReplyLabel")}
                                    </label>
                                    <textarea
                                        id={`comment-edit-${comment.commentId}`}
                                        value={editValue}
                                        onChange={(event) => setEditTextByCommentId(current => ({
                                            ...current,
                                            [comment.commentId]: event.target.value
                                        }))}
                                        disabled={isBusy}
                                        rows={4}
                                    />
                                    <div className={styles.editorActions}>
                                        <button
                                            type="button"
                                            className={styles.replyButton}
                                            onClick={() => handleSavePostedReplyEdit(comment)}
                                            disabled={isBusy || !editValue.trim()}
                                        >
                                            {actionLoading === "edit" ? t("comments.savingChanges") : t("comments.saveChanges")}
                                        </button>
                                        <button
                                            type="button"
                                            className={styles.secondaryButton}
                                            onClick={() => handleCancelEditPostedReply(comment)}
                                            disabled={isBusy}
                                        >
                                            {t("comments.cancelEdit")}
                                        </button>
                                    </div>
                                </div>
                            )}

                            {isDraftEditorOpen && (
                                <div className={styles.draftEditor}>
                                    <label htmlFor={`comment-draft-${comment.commentId}`}>
                                        {comment.status === "drafted"
                                            ? t("comments.draftLabel")
                                            : t("comments.manualReplyLabel")}
                                    </label>
                                    <textarea
                                        id={`comment-draft-${comment.commentId}`}
                                        value={draftValue}
                                        onChange={(event) => setDraftTextByCommentId(current => ({
                                            ...current,
                                            [comment.commentId]: event.target.value
                                        }))}
                                        disabled={isBusy}
                                        rows={4}
                                    />
                                    <div className={styles.editorActions}>
                                        {comment.status === "drafted" && (
                                            <button
                                                type="button"
                                                className={styles.secondaryButton}
                                                onClick={() => handleSaveDraft(comment)}
                                                disabled={isBusy || !draftValue.trim()}
                                            >
                                                {actionLoading === "save" ? t("comments.saving") : t("comments.saveDraft")}
                                            </button>
                                        )}
                                        <button
                                            type="button"
                                            className={styles.replyButton}
                                            onClick={() => handlePublishReply(comment, publishSource)}
                                            disabled={isBusy || !draftValue.trim()}
                                        >
                                            {actionLoading === "publish" ? t("comments.publishing") : t("comments.publish")}
                                        </button>
                                        <button
                                            type="button"
                                            className={styles.secondaryButton}
                                            onClick={() => handleCancelDraft(comment)}
                                            disabled={isBusy}
                                        >
                                            {actionLoading === "cancel"
                                                ? t("comments.clearing")
                                                : comment.status === "drafted"
                                                    ? t("comments.cancelDraft")
                                                    : t("comments.clear")}
                                        </button>
                                    </div>
                                </div>
                            )}

                            {comment.status === "failed" && comment.latestResult && (
                                <p className={styles.resultError}>
                                    {comment.latestResult.errorMessage || comment.latestResult.errorCode || t("comments.error")}
                                </p>
                            )}

                            {rowError && <p className={styles.resultError}>{rowError}</p>}

                            {canReplyToStatus(comment.status) && (
                                <div className={styles.actions}>
                                    {comment.status === "failed" && (
                                        <button
                                            type="button"
                                            className={styles.secondaryButton}
                                            onClick={() => handleReplyToComment(comment)}
                                            disabled={isBusy}
                                        >
                                            {actionLoading === "reply" ? t("comments.replying") : t("comments.retry")}
                                        </button>
                                    )}
                                    <button
                                        type="button"
                                        className={styles.replyButton}
                                        onClick={() => handleGenerateDraft(comment)}
                                        disabled={isBusy}
                                    >
                                        {actionLoading === "draft" ? t("comments.generatingDraft") : t("comments.generateDraft")}
                                    </button>
                                    <button
                                        type="button"
                                        className={styles.secondaryButton}
                                        onClick={() => handleManualReply(comment)}
                                        disabled={isBusy}
                                    >
                                        {t("comments.manualReply")}
                                    </button>
                                </div>
                            )}

                            {(comment.status === "replied" || comment.status === "posted") && !isEditingPostedReply && (
                                <div className={styles.actions}>
                                    <button
                                        type="button"
                                        className={styles.secondaryButton}
                                        onClick={() => handleStartEditPostedReply(comment)}
                                        disabled={isBusy || !canEditPostedReply}
                                        title={!canEditPostedReply ? t("comments.editUnavailable") : undefined}
                                    >
                                        {t("comments.editPostedReply")}
                                    </button>
                                </div>
                            )}
                        </li>
                        );
                    })}
                </ul>
            )}

            {!loading && !errorMessage && nextPageToken && (
                <button
                    type="button"
                    className={styles.loadMoreButton}
                    onClick={() => loadComments({ pageToken: nextPageToken, append: true, status: statusFilter })}
                    disabled={loadingMore}
                >
                    {loadingMore ? t("loading") : t("load.more")}
                </button>
            )}
        </section>
    );
};

export default VideoCommentsInbox;
