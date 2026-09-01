
import { FaPlayCircle } from "react-icons/fa";
import ThemeInput from "./ThemeInput";
import Tooltip from "./Tooltip";
import useTooltip from "../hooks/useTooltip";
import { useTranslation } from "react-i18next";
import styles from "../styles/dashboard.module.css";

const Theme = ({
    isEditingTheme,
    error,
    channelTheme,
    setChannelTheme,
    savedTheme,
    saveTheme,
    setIsEditingTheme
}) => {

    const { isTooltipOpen, showTooltip, hideTooltip } = useTooltip();
    const { t } = useTranslation();

    return (
        <>
            {isEditingTheme ? (
                <div onMouseEnter={showTooltip} onMouseLeave={hideTooltip} className={styles.inputContainer}>
                    <ThemeInput channelTheme={channelTheme} setChannelTheme={setChannelTheme} error={error} />

                    <Tooltip isTooltipOpen={isTooltipOpen}>
                        <button className={styles.cancelButton} onClick={() => setIsEditingTheme(false)}>{t("cancel")}</button>
                        <button className={`${styles.saveButton} editAndSaveButton editAndSave`} onClick={saveTheme}>{t("save")}</button>
                    </Tooltip>
                </div>
            ) : savedTheme ? (
                <div className={styles.themeDisplay}>
                    <div className={styles.genderAndThemeInfo}>
                        <FaPlayCircle className={styles.genderAndThemeIcon} />
                        <div className={styles.genderAndThemeInfoBlock}>
                            <p>{t("channel.theme")}: <strong>{savedTheme}</strong></p>
                        </div>
                    </div>
                    <button
                        className={`${styles.editButton} editAndSaveButton editButton`}
                        onClick={() => setIsEditingTheme(true)}
                    >
                        {t("change.theme")}
                    </button>
                </div>
            ) : (
                <div>
                    <ThemeInput channelTheme={channelTheme} setChannelTheme={setChannelTheme} error={error} />
                </div>
            )}
        </>
    );
};

export default Theme;
