import { apiRequest, createIdempotencyKey } from "./api";

export const fetchWallet = async () => {
    const data = await apiRequest("/api/payments/wallet");
    return data.wallet;
};

export const fetchPaymentPackages = async () => {
    const data = await apiRequest("/api/payments/packages");
    return data.packages || [];
};

export const createPaymentIntent = async (packageId) => {
    const idempotencyKey = createIdempotencyKey();
    const data = await apiRequest("/api/payments/intents", {
        method: "POST",
        headers: { "Idempotency-Key": idempotencyKey },
        body: JSON.stringify({ packageId })
    });

    return data.intent;
};

export const fetchPaymentIntent = async (id) => {
    const data = await apiRequest(`/api/payments/intents/${id}`);
    return data.intent;
};

export const verifyPaymentIntent = async (id, txHash) => {
    const data = await apiRequest(`/api/payments/intents/${id}/verify`, {
        method: "POST",
        body: JSON.stringify({ txHash })
    });

    return {
        intent: data.intent,
        settlement: data.settlement || null
    };
};
