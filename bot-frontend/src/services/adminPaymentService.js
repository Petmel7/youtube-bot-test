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
