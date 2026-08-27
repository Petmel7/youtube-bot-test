
import { FaYoutube } from "react-icons/fa";
import { useEffect, useRef } from "react";
import useUser from "../hooks/useUser";
import useTooltip from "../hooks/useTooltip";
import LogoutButton from "./LogoutButton";
import AdminButton from "./AdminButton";
import Tooltip from "./Tooltip";
import ThemeIcon from "./ThemeIcon";
import styles from "../styles/header.module.css";
import { useTranslation } from "react-i18next";

const Header = () => {
    const { user, loading, error } = useUser();
    const { isTooltipOpen, showTooltip, hideTooltip, toggleTooltip } = useTooltip({ closeDelay: 100 });
    const accountMenuRef = useRef(null);
    const { t } = useTranslation();

    useEffect(() => {
        if (!isTooltipOpen) return undefined;

        const handleKeyDown = (event) => {
            if (event.key === "Escape") {
                hideTooltip();
            }
        };

        const handlePointerDown = (event) => {
            if (accountMenuRef.current && !accountMenuRef.current.contains(event.target)) {
                hideTooltip();
            }
        };

        document.addEventListener("keydown", handleKeyDown);
        document.addEventListener("mousedown", handlePointerDown);
        document.addEventListener("touchstart", handlePointerDown);

        return () => {
            document.removeEventListener("keydown", handleKeyDown);
            document.removeEventListener("mousedown", handlePointerDown);
            document.removeEventListener("touchstart", handlePointerDown);
        };
    }, [hideTooltip, isTooltipOpen]);

    const handleMenuBlur = (event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
            hideTooltip();
        }
    };

    if (loading || !user) return <p>{t("loading")}</p>;
    if (error) return <p>{error}</p>;

    return (
        <header className={styles.header}>
            <div className={styles.headerSection}>
                <FaYoutube className={styles.youTubeIcon} />
                <h1 className={styles.headerTitle}>{t("connected.to")}</h1>

                <div
                    ref={accountMenuRef}
                    className={styles.accountMenu}
                    onMouseEnter={showTooltip}
                    onMouseLeave={hideTooltip}
                    onFocus={showTooltip}
                    onBlur={handleMenuBlur}
                >
                    <button
                        type="button"
                        className={styles.accountTrigger}
                        onClick={toggleTooltip}
                        aria-haspopup="menu"
                        aria-expanded={isTooltipOpen}
                        aria-controls="header-user-menu"
                    >
                        {user?.picture && (
                            <img key={user.picture} src={user.picture} alt={t("avatar.alt") || "User Avatar"} className={styles.userAvatar} />
                        )}

                        <span className={styles.name}>{user.name}</span>
                    </button>

                    <Tooltip
                        id="header-user-menu"
                        isTooltipOpen={isTooltipOpen}
                        className={styles.headerDropdown}
                        role="menu"
                    >
                        <AdminButton />
                        <LogoutButton />
                        <ThemeIcon />
                    </Tooltip>
                </div>
            </div>
        </header>
    );
};

export default Header;


