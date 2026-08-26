import { apiRequest } from "./api";

const toQueryString = (params = {}) => {
    const query = new URLSearchParams();

    Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== "") {
            query.set(key, value);
        }
    });

    const text = query.toString();
    return text ? `?${text}` : "";
};

export const fetchAdminPaymentMethods = async () => (
    apiRequest("/api/admin/payments/methods")
);

export const fetchAdminPaymentIntents = async (params = {}) => (
    apiRequest(`/api/admin/payments/intents${toQueryString(params)}`)
);

export const fetchAdminPaymentLedger = async (params = {}) => (
    apiRequest(`/api/admin/payments/ledger${toQueryString(params)}`)
);

export const fetchAdminPaymentReconciliation = async (params = {}) => (
    apiRequest(`/api/admin/payments/reconciliation${toQueryString(params)}`)
);

export const retryAdminPaymentVerification = async (paymentIntentId) => (
    apiRequest(`/api/admin/payments/intents/${paymentIntentId}/retry-verify`, {
        method: "POST"
    })
);

export const reviewAdminPaymentIntent = async (paymentIntentId, { action, note }) => (
    apiRequest(`/api/admin/payments/intents/${paymentIntentId}/review`, {
        method: "POST",
        body: JSON.stringify({ action, note })
    })
);
