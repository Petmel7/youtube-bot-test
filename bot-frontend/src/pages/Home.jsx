
import { useAuthStatus } from "../hooks/useAuthStatus";
import { FaYoutube } from "react-icons/fa";
import { useTranslation } from "react-i18next";
import LanguageSwitcher from "../components/LanguageSwitcher";
import Loading from "../components/Loading";
import config from "../config/config";
import styles from "../styles/home.module.css";

const Home = () => {
    const isConnected = useAuthStatus("/dashboard");
    const { t } = useTranslation();

    if (isConnected === null) {
        return <Loading />;
    }

    return (
        <div className={styles.home}>

            <LanguageSwitcher />

            <div className={styles.youTubeConteaner}>
                <FaYoutube className={styles.youTubeIcon} />
                <h1>{t('title')}</h1>
            </div>
            <p>{t('description')}</p>
            <a href={`${config.backendUrl}/auth/google`}>
                <button className="button">{t('connect')}</button>
            </a>

            <footer className={styles.privacyPolicy}>
                <a href="privacy-policy">{t("privacy.policy")}</a>
            </footer>
        </div>
    );
};

export default Home;