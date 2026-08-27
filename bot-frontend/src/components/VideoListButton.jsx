// import { useState } from "react";
// import { fetchMyVideos } from "../services/youtubeService";
// import { LuPanelTopOpen } from "react-icons/lu";
// import { MdLiveTv } from "react-icons/md";
// import styles from "../styles/videoListButton.module.css";

// const VideoListButton = () => {
//     const [videos, setVideos] = useState([]);
//     const [isOpen, setIsOpen] = useState(false);
//     const [loading, setLoading] = useState(false);

//     const handleClick = async () => {
//         if (isOpen) {
//             setIsOpen(false);
//             return;
//         }

//         setLoading(true);
//         const res = await fetchMyVideos();
//         if (res && Array.isArray(res)) {
//             setVideos(res);
//         }
//         setIsOpen(true);
//         setLoading(false);
//     };

//     return (
//         <div>
//             <button onClick={handleClick} className={`${styles.button} button`}>

//                 {isOpen ? (
//                     <div className={styles.buttonBlock}>
//                         <LuPanelTopOpen className={styles.iconButton} />
//                         <p>Hide Videos</p>
//                     </div>
//                 ) : (
//                     <div className={styles.buttonBlock}>
//                         <MdLiveTv className={styles.iconButton} />
//                         <p>Show My Videos</p>
//                     </div>
//                 )}

//             </button>

//             {loading && <p>Loading...</p>}

//             {isOpen && (
//                 <ul className={styles.videoList}>
//                     {videos.length === 0 && <li>No videos found</li>}
//                     {videos.map((video) => (
//                         <li key={video.videoId} className={styles.videoItem}>
//                             <img src={video.thumbnail} alt={video.title} className={styles.thumbnail} />
//                             <div>
//                                 <strong>{video.title}</strong><br />
//                                 {new Date(video.publishedAt).toLocaleDateString()}
//                             </div>
//                         </li>
//                     ))}
//                 </ul>
//             )}
//         </div>
//     );
// };

// export default VideoListButton;




import { useState } from "react";
import { fetchMyVideos } from "../services/youtubeService";
import { LuPanelTopOpen } from "react-icons/lu";
import { MdLiveTv } from "react-icons/md";
import { useTranslation } from "react-i18next";
import styles from "../styles/videoListButton.module.css";

const VideoListButton = () => {
    const { t } = useTranslation();
    const [videos, setVideos] = useState([]);
    const [isOpen, setIsOpen] = useState(false);
    const [loading, setLoading] = useState(false);
    const [errorMessage, setErrorMessage] = useState("");
    const [nextPageToken, setNextPageToken] = useState(null);
    const [currentPageToken, setCurrentPageToken] = useState(null);
    const [pageHistory, setPageHistory] = useState([]);
    const maxResults = 12;

    const loadVideos = async ({ pageToken = undefined, nextHistory = pageHistory } = {}) => {
        setLoading(true);
        const res = await fetchMyVideos({ pageToken, maxResults });
        if (res.success) {
            setVideos(res.videos);
            setNextPageToken(res.nextPageToken);
            setCurrentPageToken(pageToken || null);
            setPageHistory(nextHistory);
            setErrorMessage("");
        } else {
            setVideos([]);
            setNextPageToken(null);
            setCurrentPageToken(null);
            setErrorMessage(res.error?.message || "Failed to fetch videos");
        }
        setIsOpen(true);
        setLoading(false);
    };

    const handleClick = () => {
        if (isOpen) {
            setIsOpen(false);
            return;
        }

        loadVideos({ pageToken: undefined, nextHistory: [] });
    };

    const handleNextPage = () => {
        if (!nextPageToken) return;
        loadVideos({ pageToken: nextPageToken, nextHistory: [...pageHistory, currentPageToken || ""] });
    };

    const handlePreviousPage = () => {
        if (pageHistory.length === 0) return;
        const nextHistory = pageHistory.slice(0, -1);
        const pageToken = pageHistory[pageHistory.length - 1] || undefined;
        loadVideos({ pageToken, nextHistory });
    };

    return (
        <div>
            <button onClick={handleClick} className={`${styles.button} button`}>
                {isOpen ? (
                    <div className={styles.buttonBlock}>
                        <LuPanelTopOpen className={styles.iconButton} />
                        <p>{t("hide.videos")}</p>
                    </div>
                ) : (
                    <div className={styles.buttonBlock}>
                        <MdLiveTv className={styles.iconButton} />
                        <p>{t("show.videos")}</p>
                    </div>
                )}
            </button>

            {loading && <p>{t("loading")}</p>}

            {isOpen && (
                <ul className={styles.videoList}>
                    {errorMessage && <li>{errorMessage}</li>}
                    {videos.length === 0 && <li>{t("no.videos")}</li>}
                    {videos.map((video) => (
                        <li key={video.videoId} className={styles.videoItem}>
                            <img src={video.thumbnail} alt={video.title} className={styles.thumbnail} />
                            <div>
                                <strong>{video.title}</strong><br />
                                {new Date(video.publishedAt).toLocaleDateString()}
                            </div>
                        </li>
                    ))}
                </ul>
            )}
            {isOpen && !errorMessage && (pageHistory.length > 0 || nextPageToken) && (
                <div className={styles.paginationControls}>
                    <button type="button" onClick={handlePreviousPage} disabled={loading || pageHistory.length === 0}>
                        {t("previous")}
                    </button>
                    <button type="button" onClick={handleNextPage} disabled={loading || !nextPageToken}>
                        {t("next")}
                    </button>
                </div>
            )}
        </div>
    );
};

export default VideoListButton;
