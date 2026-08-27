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

export const apiRequest = async (path, options = {}) => {
    const method = options.method || "GET";
    const headers = {
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...(["POST", "PUT", "PATCH", "DELETE"].includes(method) ? { "X-CSRF-Protection": "1" } : {}),
        ...(options.headers || {})
    };

    const res = await fetch(`${config.backendUrl}${path}`, {
        ...options,
        method,
        headers,
        credentials: "include"
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
        const error = data.error || {};
        throw new ApiError(res.status, error.code || "REQUEST_FAILED", error.message || "Request failed", error.details);
    }

    return data;
};
