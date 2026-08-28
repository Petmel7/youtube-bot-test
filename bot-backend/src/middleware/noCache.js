const noCache = (req, res, next) => {
    delete req.headers["if-none-match"];
    delete req.headers["if-modified-since"];

    res.set({
        "Cache-Control": "no-store, no-cache, must-revalidate, private",
        Pragma: "no-cache",
        Expires: "0"
    });

    next();
};

module.exports = noCache;
