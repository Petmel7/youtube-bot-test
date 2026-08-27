
import { IoMdMoon, IoMdSunny } from "react-icons/io";
import { useTheme } from "../context/ThemeContext";

const ThemeIcon = () => {
    const { theme, toggleTheme } = useTheme();

    if (!theme) return null;

    return (
        <button type="button" onClick={toggleTheme} className="theme-toggle">
            {theme === "light" ? <IoMdMoon /> : <IoMdSunny />}
        </button>
    );
};

export default ThemeIcon;
