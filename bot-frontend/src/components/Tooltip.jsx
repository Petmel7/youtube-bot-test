
const Tooltip = ({ children, isTooltipOpen, className = "", ...props }) => (
    <>
        {isTooltipOpen && (
            <div className={`dropdown-menu${className ? ` ${className}` : ""}`} {...props}>
                {children}
            </div>)}
    </>
)

export default Tooltip;
