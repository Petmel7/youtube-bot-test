import { useEffect, useState } from "react";
import { MdLiveTv } from "react-icons/md";
import { useTranslation } from "react-i18next";
import { fetchMyVideos } from "../services/youtubeService";
import styles from "../styles/myVideos.module.css";

const maxResults = 12;

const MyVideos = () => {
    const { t } = useTranslation();
    const [videos, setVideos] = useState([]);
    const [selectedVideoId, setSelectedVideoId] = useState("");
    const [nextPageToken, setNextPageToken] = useState(null);
    const [loading, setLoading] = useState(true);
    const [loadingMore, setLoadingMore] = useState(false);
    const [errorMessage, setErrorMessage] = useState("");

    const loadVideos = async ({ pageToken, append = false } = {}) => {
        if (append) {
            setLoadingMore(true);
        } else {
            setLoading(true);
        }
        setErrorMessage("");

        const res = await fetchMyVideos({ pageToken, maxResults });

        if (res.success) {
            setVideos(current => append ? [...current, ...res.videos] : res.videos);
            setNextPageToken(res.nextPageToken);
        } else {
            if (!append) {
                setVideos([]);
                setNextPageToken(null);
            }
            setErrorMessage(res.error?.message || t("videos.error"));
        }

        setLoading(false);
        setLoadingMore(false);
    };

    useEffect(() => {
        let ignore = false;

        const loadInitialVideos = async () => {
            setLoading(true);
            setErrorMessage("");
            const res = await fetchMyVideos({ maxResults });
            if (ignore) return;

            if (res.success) {
                setVideos(res.videos);
                setNextPageToken(res.nextPageToken);
            } else {
                setVideos([]);
                setNextPageToken(null);
                setErrorMessage(res.error?.message || t("videos.error"));
            }
            setLoading(false);
        };

        loadInitialVideos();

        return () => {
            ignore = true;
        };
    }, [t]);

    return (
        <section className={styles.myVideos}>
            <div className={styles.header}>
                <div className={styles.heading}>
                    <MdLiveTv className={styles.icon} />
                    <h2>{t("my.videos")}</h2>
                </div>
            </div>

            {loading && <p className={styles.stateText}>{t("loading")}</p>}
            {!loading && errorMessage && <p className={styles.error}>{errorMessage}</p>}
            {!loading && !errorMessage && videos.length === 0 && (
                <p className={styles.stateText}>{t("no.videos")}</p>
            )}

            {!loading && videos.length > 0 && (
                <ul className={styles.videoList}>
                    {videos.map(video => {
                        const selected = selectedVideoId === video.videoId;

                        return (
                            <li key={video.videoId}>
                                <button
                                    type="button"
                                    className={`${styles.videoItem} ${selected ? styles.selectedVideo : ""}`}
                                    onClick={() => setSelectedVideoId(video.videoId)}
                                    aria-pressed={selected}
                                >
                                    {video.thumbnail && (
                                        <img src={video.thumbnail} alt="" className={styles.thumbnail} />
                                    )}
                                    <span className={styles.videoInfo}>
                                        <strong>{video.title}</strong>
                                        <span>{video.publishedAt ? new Date(video.publishedAt).toLocaleDateString() : t("videos.noDate")}</span>
                                    </span>
                                </button>
                            </li>
                        );
                    })}
                </ul>
            )}

            {!loading && !errorMessage && nextPageToken && (
                <button
                    type="button"
                    className={styles.loadMoreButton}
                    onClick={() => loadVideos({ pageToken: nextPageToken, append: true })}
                    disabled={loadingMore}
                >
                    {loadingMore ? t("loading") : t("load.more")}
                </button>
            )}
        </section>
    );
};

export default MyVideos;
