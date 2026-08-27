import { useEffect, useRef, useState } from "react";
import { MdLiveTv } from "react-icons/md";
import { useTranslation } from "react-i18next";
import { fetchMyVideos } from "../services/youtubeService";
import styles from "../styles/myVideos.module.css";

const maxResults = 12;

const dedupeVideos = (items = []) => {
    const seen = new Set();
    const videos = [];

    for (const video of items) {
        if (!video?.videoId || seen.has(video.videoId)) {
            continue;
        }

        seen.add(video.videoId);
        videos.push(video);
    }

    return videos;
};

const appendUniqueVideos = (currentVideos, nextVideos) => {
    const seen = new Set(currentVideos.map(video => video.videoId));
    const uniqueNextVideos = [];

    for (const video of nextVideos) {
        if (!video?.videoId || seen.has(video.videoId)) {
            continue;
        }

        seen.add(video.videoId);
        uniqueNextVideos.push(video);
    }

    return [...currentVideos, ...uniqueNextVideos];
};

const MyVideos = ({ selectedVideo, onSelectVideo }) => {
    const { t } = useTranslation();
    const [videos, setVideos] = useState([]);
    const [nextPageToken, setNextPageToken] = useState(null);
    const [pageInfo, setPageInfo] = useState({});
    const [loading, setLoading] = useState(true);
    const [loadingMore, setLoadingMore] = useState(false);
    const [errorMessage, setErrorMessage] = useState("");
    const pendingPageTokenRef = useRef(null);

    const loadVideos = async ({ pageToken, append = false } = {}) => {
        const requestToken = pageToken || "";
        if (append && pendingPageTokenRef.current === requestToken) {
            return;
        }

        pendingPageTokenRef.current = requestToken;

        if (append) {
            setLoadingMore(true);
        } else {
            setLoading(true);
        }
        setErrorMessage("");

        try {
            const res = await fetchMyVideos({ pageToken, maxResults });

            if (res.success) {
                const nextVideos = dedupeVideos(res.videos);
                setVideos(current => append ? appendUniqueVideos(current, nextVideos) : nextVideos);
                setNextPageToken(res.nextPageToken);
                setPageInfo(res.pageInfo || {});
            } else {
                if (!append) {
                    setVideos([]);
                    setNextPageToken(null);
                    setPageInfo({});
                }
                setErrorMessage(res.error?.message || t("videos.error"));
            }
        } finally {
            if (pendingPageTokenRef.current === requestToken) {
                pendingPageTokenRef.current = null;
            }
            setLoading(false);
            setLoadingMore(false);
        }
    };

    useEffect(() => {
        let ignore = false;

        const loadInitialVideos = async () => {
            setLoading(true);
            setErrorMessage("");
            const res = await fetchMyVideos({ maxResults });
            if (ignore) return;

            if (res.success) {
                setVideos(dedupeVideos(res.videos));
                setNextPageToken(res.nextPageToken);
                setPageInfo(res.pageInfo || {});
            } else {
                setVideos([]);
                setNextPageToken(null);
                setPageInfo({});
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
            {!loading && !errorMessage && pageInfo.totalResults != null && Number.isFinite(Number(pageInfo.totalResults)) && videos.length > 0 && (
                <p className={styles.stateText}>{t("videos.loadedCount", { loaded: videos.length, total: pageInfo.totalResults })}</p>
            )}

            {!loading && videos.length > 0 && (
                <ul className={styles.videoList}>
                    {videos.map(video => {
                        const selected = selectedVideo?.videoId === video.videoId;

                        return (
                            <li key={video.videoId}>
                                <button
                                    type="button"
                                    className={`${styles.videoItem} ${selected ? styles.selectedVideo : ""}`}
                                    onClick={() => onSelectVideo(video)}
                                    aria-pressed={selected}
                                >
                                    {video.thumbnail ? (
                                        <img src={video.thumbnail} alt="" className={styles.thumbnail} />
                                    ) : (
                                        <span className={styles.thumbnail} aria-hidden="true" />
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
