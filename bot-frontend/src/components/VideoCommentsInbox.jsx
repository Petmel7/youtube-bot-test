import { useCallback, useEffect, useRef, useState } from "react";
import { FaComments } from "react-icons/fa";
import { useTranslation } from "react-i18next";
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

const VideoCommentsInbox = ({ selectedVideo }) => {
    const { t } = useTranslation();
    const [statusFilter, setStatusFilter] = useState("all");
    const [comments, setComments] = useState([]);
    const [nextPageToken, setNextPageToken] = useState(null);
    const [loading, setLoading] = useState(false);
    const [loadingMore, setLoadingMore] = useState(false);
    const [errorMessage, setErrorMessage] = useState("");
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
                    {comments.map(comment => (
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
                        </li>
                    ))}
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
