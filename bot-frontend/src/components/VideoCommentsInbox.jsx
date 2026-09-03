import { useCallback, useEffect, useRef, useState } from "react";
import { FaComments } from "react-icons/fa";
import { useTranslation } from "react-i18next";
import { fetchReplyToComment } from "../services/botService";
import { fetchVideoComments } from "../services/youtubeService";
import styles from "../styles/videoCommentsInbox.module.css";

const commentPageLimit = 20;
const statusFilters = ["all", "unanswered", "replied", "failed", "skipped"];

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
        case "YOUTUBE_REPLY_FAILED":
            return t("comments.errors.replyPostFailed");
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
                    runId: result.runId || null,
                    updatedAt: result.updatedAt || new Date().toISOString()
                } : comment.latestResult
            };
        }));
    };

    const handleReplyToComment = async (comment) => {
        if (!videoId || !comment?.commentId || replyingCommentIds[comment.commentId]) return;

        setReplyingCommentIds(current => ({ ...current, [comment.commentId]: true }));
        setCommentErrors(current => ({ ...current, [comment.commentId]: "" }));

        try {
            const response = await fetchReplyToComment({
                videoId,
                commentId: comment.commentId,
                prompt: botPrompt?.generalPrompt || ""
            });

            if (response.result) {
                updateCommentWithResult(comment.commentId, response.result);
            }
            onReplyComplete?.(response.run || null);
        } catch (error) {
            if (error.details?.result) {
                updateCommentWithResult(comment.commentId, error.details.result);
            }
            setCommentErrors(current => ({
                ...current,
                [comment.commentId]: getReplyErrorMessage(error, t)
            }));
        } finally {
            setReplyingCommentIds(current => {
                const next = { ...current };
                delete next[comment.commentId];
                return next;
            });
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
                        const isReplying = Boolean(replyingCommentIds[comment.commentId]);
                        const rowError = commentErrors[comment.commentId];

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
                                    <span>{t("comments.latestReply")}</span>
                                    <p>{comment.latestResult.replyTextSnapshot}</p>
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
                                    <button
                                        type="button"
                                        className={styles.replyButton}
                                        onClick={() => handleReplyToComment(comment)}
                                        disabled={isReplying}
                                    >
                                        {isReplying
                                            ? t("comments.replying")
                                            : comment.status === "failed"
                                                ? t("comments.retry")
                                                : t("comments.reply")}
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
