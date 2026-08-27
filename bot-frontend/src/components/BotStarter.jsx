
import styles from "../styles/dashboard.module.css";
import { SiProbot } from "react-icons/si";
import { useTranslation } from "react-i18next";

const formatCount = (value) => {
    if (value === null || value === undefined || value === "") return "-";
    const number = Number(value);
    return Number.isFinite(number) ? number.toLocaleString() : value;
};

const BotStarter = ({ error, selectedVideo, startBot, isBotRunning, notice, canStartBot }) => {

    const { t } = useTranslation();
    const description = selectedVideo?.description || "";
    const descriptionExcerpt = description.length > 220 ? `${description.slice(0, 220)}...` : description;

    return (
        <div className={styles.botContainer}>
            <section className={styles.videoDetailPanel}>
                <h2>{t("video.details")}</h2>

                {selectedVideo ? (
                    <div className={styles.videoDetailContent}>
                        {selectedVideo.thumbnail ? (
                            <img src={selectedVideo.thumbnail} alt="" className={styles.videoDetailThumbnail} />
                        ) : (
                            <div className={styles.videoDetailThumbnail} aria-hidden="true" />
                        )}
                        <div className={styles.videoDetailInfo}>
                            <h3>{selectedVideo.title}</h3>
                            <p>{selectedVideo.publishedAt ? new Date(selectedVideo.publishedAt).toLocaleDateString() : t("videos.noDate")}</p>
                            <div className={styles.videoStats}>
                                <span>{t("videos.views")}: <strong>{formatCount(selectedVideo.views)}</strong></span>
                                <span>{t("videos.likes")}: <strong>{formatCount(selectedVideo.likes)}</strong></span>
                                <span>{t("videos.comments")}: <strong>{formatCount(selectedVideo.comments)}</strong></span>
                            </div>
                            {descriptionExcerpt && <p className={styles.videoDescription}>{descriptionExcerpt}</p>}
                        </div>
                    </div>
                ) : (
                    <p className={`${styles.selectVideoPrompt} ${error.selectedVideo ? styles.error : ""}`}>
                        {t("select.video.to.reply")}
                    </p>
                )}
            </section>

            <button
                className="button"
                onClick={startBot}
                disabled={isBotRunning || !canStartBot}
            >
                <SiProbot className={styles.botIcon} />
                {isBotRunning ? t("bot.replying") : t("reply.to.comments")}
            </button>
            {notice && <p className={styles.notice}>{notice}</p>}
        </div>
    );
};

export default BotStarter;
