export const validateChannelTheme = (channelTheme, setError) => {
    const isValid = !!channelTheme.trim();
    setError(prev => ({ ...prev, channelTheme: !isValid }));
    return isValid;
};
