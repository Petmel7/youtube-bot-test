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

export const fetchAdminPaymentConfig = async () => (
    apiRequest("/api/admin/payments/config")
);

export const fetchAdminPaymentConfigProposals = async (params = {}) => (
    apiRequest(`/api/admin/payments/config/proposals${toQueryString(params)}`)
);

export const createAdminPaymentConfigProposal = async ({ reason, methodChanges }) => (
    apiRequest("/api/admin/payments/config/proposals", {
        method: "POST",
        body: JSON.stringify({ reason, methodChanges })
    })
);

export const confirmAdminPaymentConfigProposal = async (proposalId, confirmationPhrase) => (
    apiRequest(`/api/admin/payments/config/proposals/${proposalId}/confirm`, {
        method: "POST",
        body: JSON.stringify({ confirmationPhrase })
    })
);

export const approveAdminPaymentConfigProposal = async (proposalId) => (
    apiRequest(`/api/admin/payments/config/proposals/${proposalId}/approve`, {
        method: "POST"
    })
);

export const activateAdminPaymentConfigProposal = async (proposalId) => (
    apiRequest(`/api/admin/payments/config/proposals/${proposalId}/activate`, {
        method: "POST"
    })
);

export const rejectAdminPaymentConfigProposal = async (proposalId, note) => (
    apiRequest(`/api/admin/payments/config/proposals/${proposalId}/reject`, {
        method: "POST",
        body: JSON.stringify({ note })
    })
);

export const cancelAdminPaymentConfigProposal = async (proposalId, note) => (
    apiRequest(`/api/admin/payments/config/proposals/${proposalId}/cancel`, {
        method: "POST",
        body: JSON.stringify({ note })
    })
);
