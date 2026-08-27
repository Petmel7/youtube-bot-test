import { useCallback, useEffect, useRef, useState } from "react";

const useTooltip = ({ closeDelay = 0 } = {}) => {
    const [isTooltipOpen, setIsTooltipOpen] = useState(false);
    const closeTimerRef = useRef(null);

    const clearCloseTimer = useCallback(() => {
        if (closeTimerRef.current) {
            clearTimeout(closeTimerRef.current);
            closeTimerRef.current = null;
        }
    }, []);

    const showTooltip = useCallback(() => {
        clearCloseTimer();
        setIsTooltipOpen(true);
    }, [clearCloseTimer]);

    const hideTooltip = useCallback(() => {
        clearCloseTimer();

        if (closeDelay > 0) {
            closeTimerRef.current = setTimeout(() => {
                setIsTooltipOpen(false);
                closeTimerRef.current = null;
            }, closeDelay);
            return;
        }

        setIsTooltipOpen(false);
    }, [clearCloseTimer, closeDelay]);

    const toggleTooltip = useCallback(() => {
        clearCloseTimer();
        setIsTooltipOpen((isOpen) => !isOpen);
    }, [clearCloseTimer]);

    useEffect(() => clearCloseTimer, [clearCloseTimer]);

    return { isTooltipOpen, showTooltip, hideTooltip, toggleTooltip };
};

export default useTooltip;
