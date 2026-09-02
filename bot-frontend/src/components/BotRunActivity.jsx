import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import styles from "../styles/dashboard.module.css";

const getCount = (value) => {
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
};

const getStatusClassName = (status) => {
    switch (status) {
        case "completed":
        case "replied":
            return styles.botRunStatusSuccess;
        case "partial":
        case "skipped":
            return styles.botRunStatusWarning;
        case "failed":
            return styles.botRunStatusError;
        case "cancelled":
            return styles.botRunStatusMuted;
        default:
            return styles.botRunStatusActive;
    }
};

const BotRunActivity = ({ run, videoTitle, getErrorMessage }) => {
    const { t } = useTranslation();
    const results = Array.isArray(run?.results) ? run.results : [];
    const processed = getCount(run?.processedCount);
    const replied = getCount(run?.successCount);
    const failed = getCount(run?.failureCount);
    const skipped = getCount(run?.skippedCount);
    const totalKnown = Math.max(processed, replied + failed + skipped);
    const progressPercent = totalKnown > 0 ? Math.min(100, Math.round((processed / totalKnown) * 100)) : 0;
    const runError = useMemo(() => getErrorMessage?.(run), [getErrorMessage, run]);

    if (!run) return null;

    return (
        <section className={styles.botRunActivity} aria-live="polite">
            <div className={styles.botRunHeader}>
                <div className={styles.botRunTitleGroup}>
                    <span className={styles.botRunEyebrow}>{t("bot.activity.title")}</span>
                    <h2>{videoTitle || run.videoId}</h2>
                </div>
                <span className={`${styles.botRunBadge} ${getStatusClassName(run.status)}`}>
                    {t(`bot.activity.statuses.${run.status}`, run.status)}
                </span>
            </div>

            {(run.status === "queued" || run.status === "running") && (
                <p className={styles.botRunLiveText}>{t("bot.activity.running")}</p>
            )}

            <div className={styles.botRunProgressTrack} aria-hidden="true">
                <span style={{ width: `${progressPercent}%` }} />
            </div>

            <div className={styles.botRunCounters}>
                <div>
                    <span>{t("bot.activity.processed")}</span>
                    <strong>{processed}</strong>
                </div>
                <div>
                    <span>{t("bot.activity.replied")}</span>
                    <strong>{replied}</strong>
                </div>
                <div>
                    <span>{t("bot.activity.failed")}</span>
                    <strong>{failed}</strong>
                </div>
                <div>
                    <span>{t("bot.activity.skipped")}</span>
                    <strong>{skipped}</strong>
                </div>
            </div>

            {(run.errorCode || run.topErrorCode) && runError && (
                <p className={styles.botRunError}>{runError}</p>
            )}

            <div className={styles.botRunResults}>
                <h3>{t("bot.activity.results")}</h3>
                {results.length > 0 ? (
                    <ul className={styles.botRunResultList}>
                        {results.map((result, index) => (
                            <li key={`${result.commentId || "comment"}-${index}`} className={styles.botRunResultItem}>
                                <div className={styles.botRunResultHeader}>
                                    <span className={`${styles.botRunBadge} ${getStatusClassName(result.status)}`}>
                                        {t(`bot.activity.resultStatuses.${result.status}`, result.status)}
                                    </span>
                                    <span className={styles.botRunCommentId}>{result.commentId}</span>
                                </div>

                                {result.commentTextSnapshot ? (
                                    <div className={styles.botRunTextBlock}>
                                        <span>{t("bot.activity.viewerComment")}</span>
                                        <p>{result.commentTextSnapshot}</p>
                                    </div>
                                ) : (
                                    <p className={styles.botRunMuted}>{t("bot.activity.noCommentSnapshot")}</p>
                                )}

                                {result.replyTextSnapshot ? (
                                    <div className={styles.botRunTextBlock}>
                                        <span>{t("bot.activity.botReply")}</span>
                                        <p>{result.replyTextSnapshot}</p>
                                    </div>
                                ) : result.status === "replied" ? (
                                    <p className={styles.botRunMuted}>{t("bot.activity.noReply")}</p>
                                ) : null}

                                {result.status === "failed" && (
                                    <p className={styles.botRunResultError}>
                                        {result.errorMessage || result.errorCode || t("bot.activity.error")}
                                    </p>
                                )}
                            </li>
                        ))}
                    </ul>
                ) : (
                    <p className={styles.botRunMuted}>{t("bot.activity.noResultsYet")}</p>
                )}
            </div>
        </section>
    );
};

export default BotRunActivity;
