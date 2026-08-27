import { useCallback, useEffect, useRef, useState } from "react";
import { MdLiveTv } from "react-icons/md";
import { useTranslation } from "react-i18next";
import { fetchMyVideos } from "../services/youtubeService";
import styles from "../styles/myVideos.module.css";

const maxResults = 12;
const minSearchLength = 2;
const searchDebounceMs = 400;

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

const getVideoErrorMessage = (error, t) => {
    switch (error?.code) {
        case "YOUTUBE_SEARCH_FAILED":
            return t("videos.searchFailed");
        case "YOUTUBE_QUOTA_EXCEEDED":
            return t("videos.quotaExceeded");
        case "YOUTUBE_AUTH_FAILED":
            return t("videos.authFailed");
        case "YOUTUBE_VIDEO_DETAILS_FAILED":
            return t("videos.detailsFailed");
        case "YOUTUBE_VIDEOS_FAILED":
            return t("videos.listFailed");
        default:
            return error?.message || t("videos.error");
    }
};

const MyVideos = ({ selectedVideo, onSelectVideo }) => {
    const { t } = useTranslation();
    const [searchInput, setSearchInput] = useState("");
    const [debouncedSearchQuery, setDebouncedSearchQuery] = useState("");
    const [videos, setVideos] = useState([]);
    const [nextPageToken, setNextPageToken] = useState(null);
    const [pageInfo, setPageInfo] = useState({});
    const [loading, setLoading] = useState(true);
    const [loadingMore, setLoadingMore] = useState(false);
    const [errorMessage, setErrorMessage] = useState("");
    const pendingPageTokenRef = useRef(null);
    const requestIdRef = useRef(0);

    const trimmedSearchInput = searchInput.trim();
    const isSearching = debouncedSearchQuery.length >= minSearchLength;
    const showSearchHint = trimmedSearchInput.length > 0 && trimmedSearchInput.length < minSearchLength;

    const loadVideos = useCallback(async ({ pageToken, append = false, searchQuery = debouncedSearchQuery } = {}) => {
        const requestKey = `${searchQuery || ""}:${pageToken || ""}`;
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
            const res = await fetchMyVideos({
                pageToken,
                maxResults,
                query: searchQuery || undefined
            });

            if (requestId !== requestIdRef.current) {
                return;
            }

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
                setErrorMessage(getVideoErrorMessage(res.error, t));
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
    }, [debouncedSearchQuery, t]);

    useEffect(() => {
        const timeoutId = setTimeout(() => {
            const nextSearchQuery = trimmedSearchInput.length >= minSearchLength ? trimmedSearchInput : "";
            setDebouncedSearchQuery(nextSearchQuery);
        }, searchDebounceMs);

        return () => {
            clearTimeout(timeoutId);
        };
    }, [trimmedSearchInput]);

    useEffect(() => {
        pendingPageTokenRef.current = null;
        setVideos([]);
        setNextPageToken(null);
        setPageInfo({});
        setLoadingMore(false);
        loadVideos({ searchQuery: debouncedSearchQuery });
    }, [debouncedSearchQuery, loadVideos]);

    const handleClearSearch = () => {
        setSearchInput("");
    };

    return (
        <section className={styles.myVideos}>
            <div className={styles.header}>
                <div className={styles.heading}>
                    <MdLiveTv className={styles.icon} />
                    <h2>{t("my.videos")}</h2>
                </div>
            </div>

            <div className={styles.searchBar}>
                <label className={styles.searchLabel} htmlFor="my-videos-search">
                    {t("videos.search")}
                </label>
                <div className={styles.searchControl}>
                    <input
                        id="my-videos-search"
                        className={styles.searchInput}
                        type="search"
                        value={searchInput}
                        onChange={(event) => setSearchInput(event.target.value)}
                        placeholder={t("videos.search")}
                    />
                    {searchInput && (
                        <button
                            type="button"
                            className={styles.clearSearchButton}
                            onClick={handleClearSearch}
                        >
                            {t("videos.clearSearch")}
                        </button>
                    )}
                </div>
                {showSearchHint && (
                    <p className={styles.searchHint}>{t("videos.minSearchLength")}</p>
                )}
            </div>

            {loading && <p className={styles.stateText}>{isSearching ? t("videos.searching") : t("loading")}</p>}
            {!loading && errorMessage && <p className={styles.error}>{errorMessage}</p>}
            {!loading && !errorMessage && videos.length === 0 && (
                <p className={styles.stateText}>{isSearching ? t("videos.noSearchResults") : t("no.videos")}</p>
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
                    onClick={() => loadVideos({ pageToken: nextPageToken, append: true, searchQuery: debouncedSearchQuery })}
                    disabled={loadingMore}
                >
                    {loadingMore ? t("loading") : t("load.more")}
                </button>
            )}
        </section>
    );
};

export default MyVideos;
