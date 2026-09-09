import config from "../config/config";

export class ApiError extends Error {
    constructor(status, code, message, details) {
        super(message);
        this.status = status;
        this.code = code;
        this.details = details;
    }
}

export const createIdempotencyKey = () => {
    if (window.crypto?.randomUUID) {
        return window.crypto.randomUUID().replace(/-/g, "");
    }

    return `${Date.now()}_${Math.random().toString(36).slice(2, 18)}`;
};

let csrfTokenPromise = null;

const isMutatingMethod = (method) => ["POST", "PUT", "PATCH", "DELETE"].includes(method.toUpperCase());

const fetchCsrfToken = async ({ forceRefresh = false } = {}) => {
    if (!csrfTokenPromise || forceRefresh) {
        csrfTokenPromise = fetch(`${config.backendUrl}/csrf-token`, {
            method: "GET",
            credentials: "include",
            cache: "no-store"
        })
            .then(async (res) => {
                const data = await res.json().catch(() => ({}));
                if (!res.ok || !data.csrfToken) {
                    throw new ApiError(res.status, data.error?.code || "CSRF_TOKEN_FETCH_FAILED", data.error?.message || "Failed to fetch CSRF token", data.error?.details);
                }
                return data.csrfToken;
            })
            .catch((error) => {
                csrfTokenPromise = null;
                throw error;
            });
    }

    return csrfTokenPromise;
};

export const apiRequest = async (path, options = {}) => {
    const method = options.method || "GET";
    const mutating = isMutatingMethod(method);
    const csrfToken = mutating ? await fetchCsrfToken() : null;
    const headers = {
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...(mutating ? { "X-CSRF-Token": csrfToken } : {}),
        ...(options.headers || {})
    };

    const makeRequest = (requestHeaders) => fetch(`${config.backendUrl}${path}`, {
        ...options,
        method,
        headers: requestHeaders,
        credentials: "include"
    });

    let res = await makeRequest(headers);
    const data = await res.json().catch(() => ({}));
    if (!res.ok && mutating && ["CSRF_TOKEN_INVALID", "CSRF_TOKEN_REQUIRED"].includes(data.error?.code)) {
        const refreshedToken = await fetchCsrfToken({ forceRefresh: true });
        res = await makeRequest({
            ...headers,
            "X-CSRF-Token": refreshedToken
        });
        const retryData = await res.json().catch(() => ({}));
        if (!res.ok) {
            const error = retryData.error || {};
            throw new ApiError(res.status, error.code || "REQUEST_FAILED", error.message || "Request failed", error.details);
        }
        return retryData;
    }

    if (!res.ok) {
        const error = data.error || {};
        throw new ApiError(res.status, error.code || "REQUEST_FAILED", error.message || "Request failed", error.details);
    }

    return data;
};
