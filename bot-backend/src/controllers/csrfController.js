const { createCsrfToken } = require("../services/security/csrfService");

const getCsrfToken = (req, res) => {
    res.json({
        success: true,
        csrfToken: createCsrfToken(req)
    });
};

module.exports = {
    getCsrfToken
};
