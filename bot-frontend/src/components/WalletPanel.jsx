import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAppKit, useAppKitAccount, useAppKitProvider } from "@reown/appkit/react";
import { useAccount, useChainId, useSignMessage, useSwitchChain, useWriteContract } from "wagmi";
import { FaCheckCircle, FaCopy, FaExternalLinkAlt, FaRedoAlt, FaWallet } from "react-icons/fa";
import {
    createPayerChallenge,
    createPaymentIntent,
    fetchPaymentIntent,
    fetchPaymentMethods,
    fetchPaymentPackages,
    fetchWallet,
    verifyPaymentIntent
} from "../services/paymentService";
import { getInjectedSolanaProvider, sendSolanaSplTokenPayment } from "../services/solanaPaymentClient";
import { appKitNetworks, isWalletConnectConfigured, walletConnectInitializationError } from "../wallet/appKit";
import styles from "../styles/walletPanel.module.css";

const txHashPattern = /^(0x[a-fA-F0-9]{64}|[1-9A-HJ-NP-Za-km-z]{64,128})$/;
const solanaSignaturePattern = /^[1-9A-HJ-NP-Za-km-z]{64,128}$/;
const settlementStatuses = new Set(["CONFIRMED", "CONFIRMED_OVERPAID"]);
const pendingStatuses = new Set(["PENDING", "SUBMITTED", "VERIFYING", "CONFIRMING"]);
const createFlowStates = {
    idle: "idle",
    creatingChallenge: "creatingChallenge",
    awaitingSignature: "awaitingSignature",
    creatingIntent: "creatingIntent"
};
const paymentFlowStates = {
    idle: "idle",
    waitingWallet: "waitingWallet",
    sendingSolanaTransfer: "sendingSolanaTransfer",
    submitted: "submitted",
    verifying: "verifying"
};
const signatureTimeoutMs = 120000;
const erc20TransferAbi = [{
    type: "function",
    name: "transfer",
    stateMutability: "nonpayable",
    inputs: [
        { name: "to", type: "address" },
        { name: "value", type: "uint256" }
    ],
    outputs: []
}];
const walletLinks = [
    ["MetaMask", "https://metamask.io/download/"],
    ["Rabby", "https://rabby.io/"],
    ["Coinbase Wallet", "https://www.coinbase.com/wallet/downloads"],
    ["Rainbow", "https://rainbow.me/"],
    ["Trust Wallet", "https://trustwallet.com/download"]
];

const formatUsdMinor = (amount) => `$${((amount || 0) / 100).toFixed(2)}`;

const formatTokenAmount = (baseUnits, decimals) => {
    if (!baseUnits || !Number.isInteger(decimals)) return baseUnits || "";
    if (decimals === 0) return baseUnits;

    const padded = baseUnits.padStart(decimals + 1, "0");
    const whole = padded.slice(0, -decimals);
    const fraction = padded.slice(-decimals).replace(/0+$/, "");

    return fraction ? `${whole}.${fraction}` : whole;
};

const statusTone = (status) => {
    if (settlementStatuses.has(status)) return styles.success;
    if (["UNDERPAID", "MANUAL_REVIEW_REQUIRED", "EXPIRED", "REJECTED", "FAILED", "CANCELLED"].includes(status)) return styles.danger;
    if (pendingStatuses.has(status)) return styles.pending;
    return "";
};

const FieldRow = ({ label, value, copyable = false, onCopy }) => (
    <div className={styles.fieldRow}>
        <span className={styles.fieldLabel}>{label}</span>
        <span className={styles.fieldValue}>{value ?? "-"}</span>
        {copyable && value !== null && value !== undefined && value !== "" && (
            <button className={styles.iconButton} type="button" onClick={() => onCopy(value)} title={label} aria-label={label}>
                <FaCopy />
            </button>
        )}
    </div>
);

const shortenAddress = (address) => address ? `${address.slice(0, 6)}...${address.slice(-4)}` : "";
const normalizeAddress = (address) => String(address || "").toLowerCase();
const methodNamespace = (method) => method?.namespace || "eip155";
const isSolanaMethod = (method) => methodNamespace(method) === "solana";
const intentNamespace = (intent) => intent?.namespace || intent?.paymentMethod?.namespace || "eip155";
const isActiveCreateFlow = (state) => state !== createFlowStates.idle;
const isActivePaymentFlow = (state) => state !== paymentFlowStates.idle;
const isUserRejectedSignature = (error) => (
    error?.code === 4001 ||
    error?.name === "UserRejectedRequestError" ||
    /rejected|denied|declined/i.test(error?.message || "")
);
const isUserRejectedTransaction = isUserRejectedSignature;
const withTimeout = (promise, timeoutMs, createError) => new Promise((resolve, reject) => {
    const timeoutId = window.setTimeout(() => reject(createError()), timeoutMs);
    promise.then(
        (value) => {
            window.clearTimeout(timeoutId);
            resolve(value);
        },
        (error) => {
            window.clearTimeout(timeoutId);
            reject(error);
        }
    );
});

const createPaymentRequestLink = (intent) => {
    if (intentNamespace(intent) !== "eip155" || !intent?.token?.address || !intent?.recipientAddress || !intent?.expectedTokenAmountBaseUnits || !intent?.chainId) {
        return "";
    }

    return `ethereum:${intent.token.address}@${intent.chainId}/transfer?address=${intent.recipientAddress}&uint256=${intent.expectedTokenAmountBaseUnits}`;
};

const assetProvenanceLabel = (method, t) => {
    if (method?.token?.assetProvenance === "binance-peg") return t("wallet.assetProvenance.binancePeg");
    if (method?.token?.assetProvenance === "bnb-testnet") return t("wallet.assetProvenance.bnbTestnet");
    if (method?.token?.assetProvenance === "ethereum-sepolia-smoke") return t("wallet.assetProvenance.ethereumSepoliaSmoke");
    if (method?.token?.assetProvenance === "circle-native") return t("wallet.assetProvenance.circleNative");
    if (method?.token?.assetProvenance === "tether-native") return t("wallet.assetProvenance.tetherNative");
    return "";
};
const methodLabel = (method) => method ? (method.name || `${method.network} · ${method.token?.symbol || ""}`.trim()) : "-";
const methodNetworkLabel = (method) => method?.name || method?.network || method?.caipNetworkId || "-";
const methodCaipLabel = (method) => method?.caipNetworkId || (method?.chainId ? `eip155:${method.chainId}` : method?.networkId ? `solana:${method.networkId}` : "");
const methodBadges = (method, t) => {
    if (!method) return [];
    return [
        method.token?.symbol,
        assetProvenanceLabel(method, t),
        method.testnet ? t("wallet.testnet") : "",
        method.enabled === false ? t("wallet.unavailableMethod") : ""
    ].filter(Boolean);
};
const bytesToBase64 = (bytes) => window.btoa(String.fromCharCode(...Array.from(bytes)));
const getSolanaProviderAddress = (provider) => (
    provider?.publicKey?.toString?.() ||
    provider?.account?.address ||
    provider?.address ||
    ""
);

const PrePaymentSummary = ({ selectedPackage, selectedPaymentMethod }) => {
    const { t } = useTranslation();

    if (!selectedPackage && !selectedPaymentMethod) return null;

    return (
        <div className={styles.paymentSummary}>
            <h4>{t("wallet.paymentSummary")}</h4>
            <div className={styles.summaryGrid}>
                <div>
                    <span>{t("wallet.fields.credits")}</span>
                    <strong>{selectedPackage?.creditAmount ?? "-"}</strong>
                </div>
                <div>
                    <span>{t("wallet.fields.usd")}</span>
                    <strong>{selectedPackage ? formatUsdMinor(selectedPackage.expectedUsdAmountMinor) : "-"}</strong>
                </div>
                <div>
                    <span>{t("wallet.paymentMethod")}</span>
                    <strong>{methodLabel(selectedPaymentMethod)}</strong>
                </div>
                <div>
                    <span>{t("wallet.fields.network")}</span>
                    <strong>{selectedPaymentMethod?.caipNetworkId || (selectedPaymentMethod?.chainId ? `eip155:${selectedPaymentMethod.chainId}` : "-")}</strong>
                </div>
            </div>
        </div>
    );
};

const PaymentMethodMeta = ({ method }) => {
    const { t } = useTranslation();
    const badges = methodBadges(method, t);

    return (
        <>
            <span className={styles.methodCaip}>{methodCaipLabel(method)}</span>
            {badges.length > 0 && (
                <span className={styles.methodBadges}>
                    {badges.map(badge => <span className={styles.methodBadge} key={badge}>{badge}</span>)}
                </span>
            )}
        </>
    );
};

const PaymentMethodChooser = ({
    paymentMethods,
    selectedPaymentMethodId,
    setSelectedPaymentMethodId,
    actionLoading
}) => {
    const { t } = useTranslation();
    const availableMethods = paymentMethods.filter(method => method.enabled !== false);
    const selectedMethod = paymentMethods.find(method => method.id === selectedPaymentMethodId) || availableMethods[0] || paymentMethods[0];

    if (paymentMethods.length === 0) {
        return <p className={styles.muted}>{t("wallet.noPaymentMethods")}</p>;
    }

    if (availableMethods.length <= 1 && selectedMethod) {
        return (
            <div className={styles.methodSummary} aria-label={t("wallet.availablePaymentMethod")}>
                <span>{t("wallet.availablePaymentMethod")}</span>
                <strong>{methodNetworkLabel(selectedMethod)}</strong>
                <PaymentMethodMeta method={selectedMethod} />
            </div>
        );
    }

    return (
        <div className={styles.methodList} role="listbox" aria-label={t("wallet.chooseNetworkToken")}>
            {paymentMethods.map(method => {
                const selected = selectedPaymentMethodId === method.id;

                return (
                    <button
                        className={`${styles.methodButton} ${selected ? styles.methodButtonSelected : ""}`}
                        type="button"
                        key={method.id}
                        onClick={() => setSelectedPaymentMethodId(method.id)}
                        disabled={actionLoading || method.enabled === false}
                        aria-selected={selected}
                        role="option"
                    >
                        <strong>{methodNetworkLabel(method)}</strong>
                        <PaymentMethodMeta method={method} />
                    </button>
                );
            })}
        </div>
    );
};

const PaymentSummary = ({ intent }) => {
    const { t } = useTranslation();
    const tokenAmount = formatTokenAmount(intent.expectedTokenAmountBaseUnits, intent.token?.decimals);

    return (
        <div className={styles.paymentSummary}>
            <h4>{t("wallet.paymentSummary")}</h4>
            <div className={styles.summaryGrid}>
                <div>
                    <span>{t("wallet.fields.credits")}</span>
                    <strong>{intent.creditAmount}</strong>
                </div>
                <div>
                    <span>{t("wallet.fields.usd")}</span>
                    <strong>{formatUsdMinor(intent.expectedUsdAmountMinor)}</strong>
                </div>
                <div>
                    <span>{intent.token?.symbol || "USDC"}</span>
                    <strong>{tokenAmount}</strong>
                </div>
                <div>
                    <span>{t("wallet.fields.network")}</span>
                    <strong>{intent.paymentMethod?.name || `Chain ${intent.chainId}`}</strong>
                </div>
                <div>
                    <span>{t("wallet.fields.recipient")}</span>
                    <strong>{shortenAddress(intent.recipientAddress)}</strong>
                </div>
                <div>
                    <span>{t("wallet.fields.expires")}</span>
                    <strong>{intent.expiresAt ? new Date(intent.expiresAt).toLocaleString() : "-"}</strong>
                </div>
            </div>
        </div>
    );
};

const WalletFallbackPanel = () => {
    const { t } = useTranslation();

    return (
        <div className={styles.walletConnectBox}>
            <div>
                <strong>{t("wallet.connection.unavailableTitle")}</strong>
                <p>{t("wallet.connection.unavailableBody")}</p>
                {walletConnectInitializationError && (
                    <p className={styles.error}>{t("wallet.connection.initializationError")}</p>
                )}
            </div>
            <div className={styles.walletLinkGrid}>
                {walletLinks.map(([label, href]) => (
                    <a key={label} href={href} target="_blank" rel="noreferrer">
                        {label}
                        <FaExternalLinkAlt />
                    </a>
                ))}
            </div>
            <p className={styles.muted}>{t("wallet.connection.mobileQrFallback")}</p>
        </div>
    );
};

const AppKitWalletControls = ({
    selectedPackage,
    selectedPaymentMethod,
    actionLoading,
    setActionLoading,
    setError,
    setNotice,
    setIntent,
    setPayerAddress,
    setTxHash
}) => {
    const { t } = useTranslation();
    const { open } = useAppKit();
    const { address, isConnected, status } = useAccount();
    const chainId = useChainId();
    const { signMessageAsync } = useSignMessage();
    const { switchChainAsync, isPending: switchingNetwork } = useSwitchChain();
    const expectedChainId = selectedPaymentMethod?.chainId;
    const expectedNetworkName = selectedPaymentMethod?.name || "-";
    const connectedNetworkName = chainId === expectedChainId ? expectedNetworkName : (chainId ? `Chain ${chainId}` : "-");
    const wrongNetwork = isConnected && Boolean(expectedChainId) && chainId !== expectedChainId;
    const [createFlowState, setCreateFlowState] = useState(createFlowStates.idle);
    const operationIdRef = useRef(0);
    const signingAddressRef = useRef("");
    const signingChainIdRef = useRef(null);
    const addressRef = useRef(address);
    const chainIdRef = useRef(chainId);
    const createFlowActive = isActiveCreateFlow(createFlowState);
    const awaitingSignature = createFlowState === createFlowStates.awaitingSignature;
    const createDisabled = actionLoading || createFlowActive || !selectedPackage || !selectedPaymentMethod || !isConnected || wrongNetwork || status === "connecting";

    useEffect(() => {
        addressRef.current = address;
        chainIdRef.current = chainId;
    }, [address, chainId]);

    const resetCreateFlow = useCallback(({ message = "", notice = "", cancelOperation = true } = {}) => {
        if (cancelOperation) operationIdRef.current += 1;
        signingAddressRef.current = "";
        signingChainIdRef.current = null;
        setCreateFlowState(createFlowStates.idle);
        setActionLoading(false);
        if (message) setError(message);
        setNotice(notice);
    }, [setActionLoading, setError, setNotice]);

    useEffect(() => {
        if (!awaitingSignature || !signingAddressRef.current) return;

        const walletChanged = !isConnected ||
            normalizeAddress(address) !== normalizeAddress(signingAddressRef.current) ||
            chainId !== signingChainIdRef.current;

        if (walletChanged) {
            resetCreateFlow({ message: t("wallet.errors.walletChanged") });
        }
    }, [address, awaitingSignature, chainId, isConnected, resetCreateFlow, t]);

    const openConnectModal = () => open({ view: "Connect", namespace: "eip155" });

    const handleSwitchNetwork = async () => {
        setError("");
        try {
            const network = appKitNetworks.find(item => item.id === expectedChainId);
            await switchChainAsync({ chainId: network?.id || expectedChainId });
        } catch (switchError) {
            setError(switchError.message || t("wallet.errors.switchNetwork"));
        }
    };

    const handleCreateIntent = async () => {
        if (!selectedPackage?.packageId || !address) return;

        const operationId = operationIdRef.current + 1;
        operationIdRef.current = operationId;
        signingAddressRef.current = "";
        signingChainIdRef.current = null;
        setActionLoading(true);
        setCreateFlowState(createFlowStates.creatingChallenge);
        setError("");
        setNotice("");
        try {
            if (chainId !== expectedChainId) {
                throw new Error(t("wallet.errors.wrongNetwork", { network: expectedNetworkName }));
            }

            const challenge = await createPayerChallenge({
                payerAddress: address,
                paymentMethodId: selectedPaymentMethod.id,
                namespace: "eip155"
            });
            if (operationId !== operationIdRef.current) return;
            if (normalizeAddress(challenge.payerAddress) !== normalizeAddress(address)) {
                throw new Error(t("wallet.errors.walletChanged"));
            }

            signingAddressRef.current = address;
            signingChainIdRef.current = chainId;
            setCreateFlowState(createFlowStates.awaitingSignature);
            setNotice(t("wallet.signing.openWallet"));

            const signature = await withTimeout(
                signMessageAsync({ account: address, message: challenge.message }),
                signatureTimeoutMs,
                () => new Error(t("wallet.errors.signatureTimedOut"))
            );
            if (operationId !== operationIdRef.current) return;
            if (
                normalizeAddress(addressRef.current) !== normalizeAddress(challenge.payerAddress) ||
                chainIdRef.current !== expectedChainId
            ) {
                throw new Error(t("wallet.errors.walletChanged"));
            }

            setCreateFlowState(createFlowStates.creatingIntent);
            const nextIntent = await createPaymentIntent({
                packageId: selectedPackage.packageId,
                paymentMethodId: selectedPaymentMethod.id,
                payerChallengeId: challenge.id,
                signature
            });
            if (operationId !== operationIdRef.current) return;
            if (normalizeAddress(nextIntent.payerAddress) !== normalizeAddress(address)) {
                throw new Error(t("wallet.errors.walletChanged"));
            }

            setIntent(nextIntent);
            setPayerAddress(nextIntent.payerAddress || challenge.payerAddress);
            setTxHash(nextIntent.txHash || "");
        } catch (createError) {
            if (operationId !== operationIdRef.current) return;
            setError(isUserRejectedSignature(createError)
                ? t("wallet.errors.signatureRejected")
                : (createError.shortMessage || createError.message || t("wallet.errors.create")));
        } finally {
            if (operationId === operationIdRef.current) {
                resetCreateFlow({ cancelOperation: false });
            }
        }
    };

    const handleCancelSignature = () => {
        resetCreateFlow({
            message: t("wallet.errors.signatureCancelled"),
            cancelOperation: true
        });
    };

    const createButtonText = {
        [createFlowStates.creatingChallenge]: t("wallet.signing.creatingChallenge"),
        [createFlowStates.awaitingSignature]: t("wallet.signing.waitingSignature"),
        [createFlowStates.creatingIntent]: t("wallet.signing.creatingIntent"),
        [createFlowStates.idle]: t("wallet.createIntent")
    }[createFlowState];

    return (
        <div className={styles.walletConnectBox}>
            <div className={styles.walletStatusRow}>
                <div>
                    <strong>{isConnected ? t("wallet.connection.connected") : t("wallet.connection.notConnected")}</strong>
                    <p>
                        {isConnected
                            ? `${shortenAddress(address)} · ${connectedNetworkName}`
                            : t("wallet.connection.connectBody")}
                    </p>
                </div>
                {!isConnected ? (
                    <button className={styles.iconTextButton} type="button" onClick={openConnectModal} disabled={actionLoading}>
                        <FaWallet />
                        {t("wallet.connection.connect")}
                    </button>
                ) : wrongNetwork ? (
                    <button className={styles.iconTextButton} type="button" onClick={handleSwitchNetwork} disabled={actionLoading || switchingNetwork}>
                        {switchingNetwork ? t("wallet.working") : t("wallet.connection.switchNetwork")}
                    </button>
                ) : (
                    <button className={styles.iconTextButton} type="button" onClick={() => open({ view: "Account" })} disabled={actionLoading}>
                        <FaWallet />
                        {t("wallet.connection.manage")}
                    </button>
                )}
            </div>
            {wrongNetwork && <p className={styles.error}>{t("wallet.connection.wrongNetwork", { network: expectedNetworkName })}</p>}
            {!isConnected && <p className={styles.muted}>{t("wallet.connection.mobileQr")}</p>}
            <button className={styles.primaryButton} type="button" onClick={handleCreateIntent} disabled={createDisabled}>
                {createButtonText}
            </button>
            {awaitingSignature && (
                <div className={styles.signaturePrompt}>
                    <p>{t("wallet.signing.waitingSignature")}</p>
                    <p className={styles.muted}>{t("wallet.signing.openWallet")}</p>
                    <button className={styles.secondaryButton} type="button" onClick={handleCancelSignature}>
                        {t("wallet.signing.cancel")}
                    </button>
                </div>
            )}
            {createDisabled && !actionLoading && (
                <p className={styles.muted}>
                    {!isConnected
                        ? t("wallet.connection.disabledConnect")
                        : wrongNetwork
                            ? t("wallet.connection.disabledNetwork", { network: expectedNetworkName })
                            : !selectedPaymentMethod
                                ? t("wallet.connection.disabledMethod")
                                : t("wallet.connection.disabledPackage")}
                </p>
            )}
        </div>
    );
};

const SolanaWalletControls = ({
    selectedPackage,
    selectedPaymentMethod,
    actionLoading,
    setActionLoading,
    setError,
    setNotice,
    setIntent,
    setPayerAddress,
    setTxHash
}) => {
    const { t } = useTranslation();
    const { open } = useAppKit();
    const { address: appKitAddress, isConnected: appKitConnected } = useAppKitAccount({ namespace: "solana" });
    const { walletProvider: appKitSolanaProvider } = useAppKitProvider("solana");
    const [createFlowState, setCreateFlowState] = useState(createFlowStates.idle);
    const [injectedAddress, setInjectedAddress] = useState("");
    const operationIdRef = useRef(0);
    const signingAddressRef = useRef("");
    const createFlowActive = isActiveCreateFlow(createFlowState);
    const awaitingSignature = createFlowState === createFlowStates.awaitingSignature;
    const injectedProvider = getInjectedSolanaProvider();
    const solanaProvider = appKitSolanaProvider || injectedProvider;
    const address = appKitAddress || injectedAddress || getSolanaProviderAddress(solanaProvider);
    const isConnected = Boolean(address);
    const createDisabled = actionLoading || createFlowActive || !selectedPackage || !selectedPaymentMethod || (!solanaProvider && !isWalletConnectConfigured);

    const resetCreateFlow = useCallback(({ message = "", notice = "", cancelOperation = true } = {}) => {
        if (cancelOperation) operationIdRef.current += 1;
        signingAddressRef.current = "";
        setCreateFlowState(createFlowStates.idle);
        setActionLoading(false);
        if (message) setError(message);
        setNotice(notice);
    }, [setActionLoading, setError, setNotice]);

    const connectSolanaWallet = async () => {
        if (isWalletConnectConfigured && !injectedProvider && !appKitConnected) {
            open({ view: "Connect", namespace: "solana" });
            return "";
        }

        if (!solanaProvider?.connect) {
            throw new Error(t("wallet.errors.solanaWalletProvider"));
        }
        const result = await solanaProvider.connect();
        const nextAddress = result?.publicKey?.toString?.() || solanaProvider.publicKey?.toString?.() || "";
        if (!nextAddress) throw new Error(t("wallet.errors.walletAccount"));
        setInjectedAddress(nextAddress);
        return nextAddress;
    };

    const handleCreateIntent = async () => {
        if (!selectedPackage?.packageId || !selectedPaymentMethod) return;

        const operationId = operationIdRef.current + 1;
        operationIdRef.current = operationId;
        setActionLoading(true);
        setCreateFlowState(createFlowStates.creatingChallenge);
        setError("");
        setNotice("");

        try {
            const payer = address || await connectSolanaWallet();
            if (!payer) {
                throw new Error(t("wallet.connection.disabledConnect"));
            }
            const challenge = await createPayerChallenge({
                payerAddress: payer,
                paymentMethodId: selectedPaymentMethod.id,
                namespace: "solana"
            });
            if (operationId !== operationIdRef.current) return;
            if (challenge.payerAddress !== payer) {
                throw new Error(t("wallet.errors.walletChanged"));
            }

            signingAddressRef.current = payer;
            setCreateFlowState(createFlowStates.awaitingSignature);
            setNotice(t("wallet.signing.openSolanaWallet"));

            if (!solanaProvider?.signMessage) {
                throw new Error(t("wallet.errors.solanaWalletProvider"));
            }

            const encodedMessage = new TextEncoder().encode(challenge.message);
            const signed = await withTimeout(
                solanaProvider.signMessage(encodedMessage, "utf8"),
                signatureTimeoutMs,
                () => new Error(t("wallet.errors.signatureTimedOut"))
            );
            if (operationId !== operationIdRef.current) return;

            const currentAddress = appKitAddress || getSolanaProviderAddress(solanaProvider) || payer;
            if (currentAddress !== signingAddressRef.current) {
                throw new Error(t("wallet.errors.walletChanged"));
            }

            const signatureBytes = signed?.signature || signed;
            const signature = bytesToBase64(signatureBytes);

            setCreateFlowState(createFlowStates.creatingIntent);
            const nextIntent = await createPaymentIntent({
                packageId: selectedPackage.packageId,
                paymentMethodId: selectedPaymentMethod.id,
                payerChallengeId: challenge.id,
                signature
            });
            if (operationId !== operationIdRef.current) return;

            setIntent(nextIntent);
            setPayerAddress(nextIntent.payerAddress || challenge.payerAddress);
            setTxHash(nextIntent.txHash || "");
            setNotice(t("wallet.solanaReadyToPay"));
        } catch (createError) {
            if (operationId !== operationIdRef.current) return;
            setError(isUserRejectedSignature(createError)
                ? t("wallet.errors.signatureRejected")
                : (createError.message || t("wallet.errors.create")));
        } finally {
            if (operationId === operationIdRef.current) {
                resetCreateFlow({ cancelOperation: false });
            }
        }
    };

    const createButtonText = {
        [createFlowStates.creatingChallenge]: t("wallet.signing.creatingChallenge"),
        [createFlowStates.awaitingSignature]: t("wallet.signing.signingSolanaChallenge"),
        [createFlowStates.creatingIntent]: t("wallet.signing.creatingIntent"),
        [createFlowStates.idle]: t("wallet.createIntent")
    }[createFlowState];

    return (
        <div className={styles.walletConnectBox}>
            <div className={styles.walletStatusRow}>
                <div>
                    <strong>{isConnected ? t("wallet.connection.solanaConnected") : t("wallet.connection.solanaNotConnected")}</strong>
                    <p>{isConnected ? `${shortenAddress(address)} · ${selectedPaymentMethod?.name || t("wallet.solanaNetwork")}` : t("wallet.connection.solanaConnectBody")}</p>
                </div>
                <button className={styles.iconTextButton} type="button" onClick={connectSolanaWallet} disabled={actionLoading || (!solanaProvider && !isWalletConnectConfigured)}>
                    <FaWallet />
                    {isConnected ? t("wallet.connection.manage") : t("wallet.connection.connectSolana")}
                </button>
            </div>
            {!solanaProvider && !isWalletConnectConfigured && <p className={styles.error}>{t("wallet.errors.solanaWalletProvider")}</p>}
            <button className={styles.primaryButton} type="button" onClick={handleCreateIntent} disabled={createDisabled}>
                {createButtonText}
            </button>
            {awaitingSignature && (
                <div className={styles.signaturePrompt}>
                    <p>{t("wallet.signing.signingSolanaChallenge")}</p>
                    <p className={styles.muted}>{t("wallet.signing.openSolanaWallet")}</p>
                    <button className={styles.secondaryButton} type="button" onClick={() => resetCreateFlow({ message: t("wallet.errors.signatureCancelled") })}>
                        {t("wallet.signing.cancel")}
                    </button>
                </div>
            )}
        </div>
    );
};

const AppKitPaymentActions = ({
    intent,
    txHash,
    setTxHash,
    actionLoading,
    setActionLoading,
    setError,
    setNotice,
    setIntent,
    loadWallet
}) => {
    const { t } = useTranslation();
    const { address, isConnected } = useAccount();
    const chainId = useChainId();
    const { writeContractAsync } = useWriteContract();
    const [paymentFlowState, setPaymentFlowState] = useState(paymentFlowStates.idle);
    const expectedChainId = intent.chainId;
    const wrongNetwork = isConnected && Boolean(expectedChainId) && chainId !== expectedChainId;
    const paymentActive = isActivePaymentFlow(paymentFlowState);
    const paymentDisabled = actionLoading || paymentActive || !intent || intent.credited || !isConnected || wrongNetwork;

    const verifySubmittedHash = async (submittedTxHash) => {
        setPaymentFlowState(paymentFlowStates.verifying);
        const result = await verifyPaymentIntent(intent.id, submittedTxHash.toLowerCase());
        setIntent(result.intent);

        if (result.intent.credited || settlementStatuses.has(result.intent.status)) {
            await loadWallet();
            setNotice(t("wallet.paymentFlow.confirmed"));
        } else if (pendingStatuses.has(result.intent.status)) {
            setNotice(t("wallet.paymentFlow.pendingConfirmations"));
        }
    };

    const handlePayWithWallet = async () => {
        if (!intent || !address) return;

        setActionLoading(true);
        setPaymentFlowState(paymentFlowStates.waitingWallet);
        setError("");
        setNotice(t("wallet.paymentFlow.waitingWallet"));

        try {
            if (chainId !== expectedChainId) {
                throw new Error(t("wallet.errors.wrongNetwork", { network: intent.paymentMethod?.name || `Chain ${intent.chainId}` }));
            }

            if (normalizeAddress(intent.payerAddress) !== normalizeAddress(address)) {
                throw new Error(t("wallet.errors.walletChanged"));
            }

            const submittedTxHash = await writeContractAsync({
                address: intent.token.address,
                abi: erc20TransferAbi,
                functionName: "transfer",
                args: [intent.recipientAddress, window.BigInt(intent.expectedTokenAmountBaseUnits)],
                chainId: expectedChainId,
                account: address
            });

            setPaymentFlowState(paymentFlowStates.submitted);
            setTxHash(submittedTxHash);
            setNotice(t("wallet.paymentFlow.submitted"));
            await verifySubmittedHash(submittedTxHash);
        } catch (paymentError) {
            setError(isUserRejectedTransaction(paymentError)
                ? t("wallet.errors.paymentCancelled")
                : (paymentError.shortMessage || paymentError.message || t("wallet.errors.payment")));
        } finally {
            setPaymentFlowState(paymentFlowStates.idle);
            setActionLoading(false);
        }
    };

    const handleRetryVerify = async () => {
        const normalizedHash = txHash.trim();
        if (!txHashPattern.test(normalizedHash)) {
            setError(t("wallet.errors.txHash"));
            return;
        }

        setActionLoading(true);
        setError("");
        setNotice("");
        try {
            await verifySubmittedHash(normalizedHash);
        } catch (verifyError) {
            setError(verifyError.message || t("wallet.errors.verify"));
        } finally {
            setPaymentFlowState(paymentFlowStates.idle);
            setActionLoading(false);
        }
    };

    const buttonText = {
        [paymentFlowStates.waitingWallet]: t("wallet.paymentFlow.waitingWallet"),
        [paymentFlowStates.submitted]: t("wallet.paymentFlow.submitted"),
        [paymentFlowStates.verifying]: t("wallet.paymentFlow.verifying"),
        [paymentFlowStates.idle]: t("wallet.payWithWallet")
    }[paymentFlowState];

    return (
        <div className={styles.paymentActions}>
            <button className={styles.primaryButton} type="button" onClick={handlePayWithWallet} disabled={paymentDisabled}>
                {buttonText}
            </button>
            {pendingStatuses.has(intent.status) && txHash && (
                <button className={styles.secondaryButton} type="button" onClick={handleRetryVerify} disabled={actionLoading || paymentActive}>
                    {t("wallet.paymentFlow.retryVerify")}
                </button>
            )}
            {wrongNetwork && <p className={styles.error}>{t("wallet.connection.wrongNetwork", { network: intent.paymentMethod?.name || `Chain ${intent.chainId}` })}</p>}
            {!isConnected && <p className={styles.muted}>{t("wallet.connection.disabledConnect")}</p>}
        </div>
    );
};

const SolanaPaymentActions = ({
    intent,
    txHash,
    setTxHash,
    actionLoading,
    setActionLoading,
    setError,
    setNotice,
    setIntent,
    loadWallet
}) => {
    const { t } = useTranslation();
    const { address: appKitAddress, isConnected: appKitConnected } = useAppKitAccount({ namespace: "solana" });
    const { walletProvider: appKitSolanaProvider } = useAppKitProvider("solana");
    const [paymentFlowState, setPaymentFlowState] = useState(paymentFlowStates.idle);
    const injectedProvider = getInjectedSolanaProvider();
    const solanaProvider = appKitSolanaProvider || injectedProvider;
    const connectedAddress = appKitAddress || getSolanaProviderAddress(solanaProvider);
    const paymentActive = isActivePaymentFlow(paymentFlowState);
    const paymentDisabled = actionLoading || paymentActive || !intent || intent.credited || !solanaProvider || !connectedAddress;

    const verifySubmittedSignature = async (submittedSignature) => {
        setPaymentFlowState(paymentFlowStates.verifying);
        const result = await verifyPaymentIntent(intent.id, submittedSignature);
        setIntent(result.intent);

        if (result.intent.credited || settlementStatuses.has(result.intent.status)) {
            await loadWallet();
            setNotice(t("wallet.paymentFlow.finalized"));
        } else if (pendingStatuses.has(result.intent.status)) {
            setNotice(t("wallet.paymentFlow.solanaPending"));
        }
    };

    const handlePayWithSolanaWallet = async () => {
        if (!intent) return;

        setActionLoading(true);
        setPaymentFlowState(paymentFlowStates.waitingWallet);
        setError("");
        setNotice(t("wallet.paymentFlow.waitingWallet"));

        try {
            if (!solanaProvider || !connectedAddress) {
                throw new Error(t("wallet.errors.solanaWalletProvider"));
            }

            if (connectedAddress !== intent.payerAddress) {
                throw new Error(t("wallet.errors.walletChanged"));
            }

            setPaymentFlowState(paymentFlowStates.sendingSolanaTransfer);
            setNotice(t("wallet.paymentFlow.sendingSolanaTransfer"));
            const submittedSignature = await sendSolanaSplTokenPayment({
                intent,
                provider: solanaProvider,
                payerAddress: connectedAddress
            });

            setPaymentFlowState(paymentFlowStates.submitted);
            setTxHash(submittedSignature);
            setNotice(t("wallet.paymentFlow.submitted"));
            await verifySubmittedSignature(submittedSignature);
        } catch (paymentError) {
            setError(isUserRejectedTransaction(paymentError)
                ? t("wallet.errors.paymentCancelled")
                : (paymentError.message || t("wallet.errors.solanaPayment")));
        } finally {
            setPaymentFlowState(paymentFlowStates.idle);
            setActionLoading(false);
        }
    };

    const handleRetryVerify = async () => {
        const normalizedSignature = txHash.trim();
        if (!solanaSignaturePattern.test(normalizedSignature)) {
            setError(t("wallet.errors.solanaSignature"));
            return;
        }

        setActionLoading(true);
        setError("");
        setNotice("");
        try {
            await verifySubmittedSignature(normalizedSignature);
        } catch (verifyError) {
            setError(verifyError.message || t("wallet.errors.verify"));
        } finally {
            setPaymentFlowState(paymentFlowStates.idle);
            setActionLoading(false);
        }
    };

    return (
        <div className={styles.paymentActions}>
            <button className={styles.primaryButton} type="button" onClick={handlePayWithSolanaWallet} disabled={paymentDisabled}>
                {{
                    [paymentFlowStates.waitingWallet]: t("wallet.paymentFlow.waitingWallet"),
                    [paymentFlowStates.sendingSolanaTransfer]: t("wallet.paymentFlow.sendingSolanaTransfer"),
                    [paymentFlowStates.submitted]: t("wallet.paymentFlow.submitted"),
                    [paymentFlowStates.verifying]: t("wallet.paymentFlow.verifying"),
                    [paymentFlowStates.idle]: t("wallet.payWithSolanaWallet")
                }[paymentFlowState]}
            </button>
            {!solanaProvider && <p className={styles.error}>{t("wallet.errors.solanaWalletProvider")}</p>}
            {solanaProvider && !connectedAddress && <p className={styles.muted}>{appKitConnected ? t("wallet.errors.walletAccount") : t("wallet.connection.disabledConnect")}</p>}
            <p className={styles.muted}>{t("wallet.solanaAutomaticPayment")}</p>
            {pendingStatuses.has(intent.status) && txHash && (
                <button className={styles.secondaryButton} type="button" onClick={handleRetryVerify} disabled={actionLoading || paymentActive}>
                    {paymentFlowState === paymentFlowStates.verifying ? t("wallet.paymentFlow.verifying") : t("wallet.paymentFlow.retryVerify")}
                </button>
            )}
        </div>
    );
};

const WalletPanel = () => {
    const { t } = useTranslation();
    const [wallet, setWallet] = useState(null);
    const [packages, setPackages] = useState([]);
    const [paymentMethods, setPaymentMethods] = useState([]);
    const [selectedPackageId, setSelectedPackageId] = useState("");
    const [selectedPaymentMethodId, setSelectedPaymentMethodId] = useState("");
    const [intent, setIntent] = useState(null);
    const [txHash, setTxHash] = useState("");
    const [payerAddress, setPayerAddress] = useState("");
    const [loading, setLoading] = useState(true);
    const [actionLoading, setActionLoading] = useState(false);
    const [error, setError] = useState("");
    const [notice, setNotice] = useState("");
    const [showManualTxHash, setShowManualTxHash] = useState(false);

    const selectedPackage = useMemo(
        () => packages.find(paymentPackage => paymentPackage.packageId === selectedPackageId) || packages[0],
        [packages, selectedPackageId]
    );
    const selectedPaymentMethod = useMemo(
        () => paymentMethods.find(method => method.id === selectedPaymentMethodId) || paymentMethods[0],
        [paymentMethods, selectedPaymentMethodId]
    );

    const loadWallet = async () => {
        const nextWallet = await fetchWallet();
        setWallet(nextWallet);
    };

    useEffect(() => {
        let ignore = false;

        const load = async () => {
            setLoading(true);
            setError("");
            try {
                const [nextWallet, nextPackages, methodOptions] = await Promise.all([
                    fetchWallet(),
                    fetchPaymentPackages(),
                    fetchPaymentMethods()
                ]);

                if (ignore) return;
                setWallet(nextWallet);
                setPackages(nextPackages);
                setPaymentMethods(methodOptions.paymentMethods);
                setSelectedPackageId(current => current || nextPackages[0]?.packageId || "");
                setSelectedPaymentMethodId(current => current || methodOptions.defaultPaymentMethodId || methodOptions.paymentMethods[0]?.id || "");
            } catch (loadError) {
                if (!ignore) setError(loadError.message || t("wallet.errors.load"));
            } finally {
                if (!ignore) setLoading(false);
            }
        };

        load();

        return () => {
            ignore = true;
        };
    }, [t]);

    useEffect(() => {
        if (!intent) return;
        if (intent.packageId === selectedPackageId && intent.paymentMethodId === selectedPaymentMethodId) return;

        setIntent(null);
        setTxHash("");
        setPayerAddress("");
        setShowManualTxHash(false);
        setNotice("");
        setError("");
    }, [intent, selectedPackageId, selectedPaymentMethodId]);

    const copyValue = async (value) => {
        if (!navigator.clipboard) return;
        try {
            await navigator.clipboard.writeText(String(value));
            setNotice(t("wallet.copied"));
            window.setTimeout(() => setNotice(""), 1800);
        } catch {
            setNotice("");
        }
    };

    const handleRefresh = async () => {
        setActionLoading(true);
        setError("");
        try {
            await loadWallet();
            if (intent?.id) {
                setIntent(await fetchPaymentIntent(intent.id));
            }
        } catch (refreshError) {
            setError(refreshError.message || t("wallet.errors.load"));
        } finally {
            setActionLoading(false);
        }
    };

    const handleVerify = async (event) => {
        event.preventDefault();
        if (!intent?.id) return;

        const normalizedHash = txHash.trim();
        if (!txHashPattern.test(normalizedHash)) {
            setError(t("wallet.errors.txHash"));
            return;
        }

        setActionLoading(true);
        setError("");
        setNotice("");
        try {
            const result = await verifyPaymentIntent(
                intent.id,
                intentNamespace(intent) === "solana" ? normalizedHash : normalizedHash.toLowerCase()
            );
            setIntent(result.intent);

            if (result.intent.credited || settlementStatuses.has(result.intent.status)) {
                await loadWallet();
                setNotice(t("wallet.settled"));
            }
        } catch (verifyError) {
            setError(verifyError.message || t("wallet.errors.verify"));
        } finally {
            setActionLoading(false);
        }
    };

    const paymentRequestLink = createPaymentRequestLink(intent);

    return (
        <section className={styles.walletPanel}>
            <div className={styles.panelHeader}>
                <div>
                    <h2>{t("wallet.title")}</h2>
                    <p>{t("wallet.subtitle")}</p>
                </div>
                <button className={styles.iconTextButton} type="button" onClick={handleRefresh} disabled={loading || actionLoading}>
                    <FaRedoAlt />
                    {t("wallet.refresh")}
                </button>
            </div>

            {loading ? (
                <p className={styles.muted}>{t("loading")}</p>
            ) : (
                <>
                    <div className={styles.balanceGrid}>
                        <div>
                            <span>{t("wallet.balance")}</span>
                            <strong>{wallet?.balance ?? 0}</strong>
                        </div>
                        <div>
                            <span>{t("wallet.reserved")}</span>
                            <strong>{wallet?.reserved ?? 0}</strong>
                        </div>
                        <div>
                            <span>{t("wallet.available")}</span>
                            <strong>{wallet?.available ?? 0}</strong>
                        </div>
                    </div>

                    <div className={styles.packageList}>
                        {packages.map(paymentPackage => (
                            <button
                                className={`${styles.packageButton} ${selectedPackageId === paymentPackage.packageId ? styles.packageButtonSelected : ""}`}
                                type="button"
                                key={paymentPackage.packageId}
                                onClick={() => setSelectedPackageId(paymentPackage.packageId)}
                                disabled={actionLoading}
                            >
                                <strong>{paymentPackage.creditAmount}</strong>
                                <span>{formatUsdMinor(paymentPackage.expectedUsdAmountMinor)}</span>
                            </button>
                        ))}
                    </div>
                    {packages.length === 0 && <p className={styles.muted}>{t("wallet.noPackages")}</p>}

                    <div className={styles.selectorHeader}>
                        <strong>{t("wallet.paymentMethod")}</strong>
                        <span>{paymentMethods.filter(method => method.enabled !== false).length <= 1 ? t("wallet.onlyOnePaymentMethod") : t("wallet.chooseNetworkToken")}</span>
                    </div>
                    <PaymentMethodChooser
                        paymentMethods={paymentMethods}
                        selectedPaymentMethodId={selectedPaymentMethodId}
                        setSelectedPaymentMethodId={setSelectedPaymentMethodId}
                        actionLoading={actionLoading}
                    />

                    {!intent && (
                        <PrePaymentSummary
                            selectedPackage={selectedPackage}
                            selectedPaymentMethod={selectedPaymentMethod}
                        />
                    )}

                    {isSolanaMethod(selectedPaymentMethod) ? (
                        <SolanaWalletControls
                            selectedPackage={selectedPackage}
                            selectedPaymentMethod={selectedPaymentMethod}
                            actionLoading={actionLoading}
                            setActionLoading={setActionLoading}
                            setError={setError}
                            setNotice={setNotice}
                            setIntent={setIntent}
                            setPayerAddress={setPayerAddress}
                            setTxHash={setTxHash}
                        />
                    ) : isWalletConnectConfigured ? (
                        <AppKitWalletControls
                            selectedPackage={selectedPackage}
                            selectedPaymentMethod={selectedPaymentMethod}
                            actionLoading={actionLoading}
                            setActionLoading={setActionLoading}
                            setError={setError}
                            setNotice={setNotice}
                            setIntent={setIntent}
                            setPayerAddress={setPayerAddress}
                            setTxHash={setTxHash}
                        />
                    ) : (
                        <WalletFallbackPanel />
                    )}

                    {intent && (
                        <div className={styles.intentBox}>
                            <div className={styles.intentHeader}>
                                <h3>{t("wallet.paymentInstructions")}</h3>
                                <span className={`${styles.statusBadge} ${statusTone(intent.status)}`}>
                                    {t(`wallet.status.${intent.status?.toLowerCase()}`, intent.status)}
                                </span>
                            </div>

                            <PaymentSummary intent={intent} />

                            {intentNamespace(intent) === "solana" ? (
                                <SolanaPaymentActions
                                    intent={intent}
                                    txHash={txHash}
                                    setTxHash={setTxHash}
                                    actionLoading={actionLoading}
                                    setActionLoading={setActionLoading}
                                    setError={setError}
                                    setNotice={setNotice}
                                    setIntent={setIntent}
                                    loadWallet={loadWallet}
                                />
                            ) : isWalletConnectConfigured && (
                                <AppKitPaymentActions
                                    intent={intent}
                                    txHash={txHash}
                                    setTxHash={setTxHash}
                                    actionLoading={actionLoading}
                                    setActionLoading={setActionLoading}
                                    setError={setError}
                                    setNotice={setNotice}
                                    setIntent={setIntent}
                                    loadWallet={loadWallet}
                                />
                            )}

                            <details className={styles.collapsibleBlock}>
                                <summary>{t("wallet.advancedDetails")}</summary>
                                <FieldRow label={t("wallet.fields.paymentIntentId")} value={intent.id} copyable onCopy={copyValue} />
                                <FieldRow label={intentNamespace(intent) === "solana" ? t("wallet.fields.solanaNetwork") : t("wallet.fields.chainId")} value={intentNamespace(intent) === "solana" ? (intent.networkId || intent.paymentMethod?.networkId) : intent.chainId} />
                                <FieldRow label={t("wallet.fields.caipNetworkId")} value={intent.paymentMethod?.caipNetworkId || (intentNamespace(intent) === "solana" ? `solana:${intent.networkId}` : `eip155:${intent.chainId}`)} copyable onCopy={copyValue} />
                                <FieldRow label={t("wallet.fields.token")} value={`${intent.token?.symbol || ""} (${intent.token?.decimals ?? "-"} ${t("wallet.fields.decimals")})`} />
                                <FieldRow label={intentNamespace(intent) === "solana" ? t("wallet.fields.mintAddress") : t("wallet.fields.tokenAddress")} value={intent.token?.address} copyable onCopy={copyValue} />
                                <FieldRow label={t("wallet.fields.recipient")} value={intent.recipientAddress} copyable onCopy={copyValue} />
                                <FieldRow label={t("wallet.fields.payer")} value={intent.payerAddress || payerAddress} copyable onCopy={copyValue} />
                                <FieldRow label={t("wallet.fields.tokenAmount")} value={`${formatTokenAmount(intent.expectedTokenAmountBaseUnits, intent.token?.decimals)} ${intent.token?.symbol || ""}`.trim()} />
                                <FieldRow label={t("wallet.fields.baseUnits")} value={intent.expectedTokenAmountBaseUnits} copyable onCopy={copyValue} />
                                <FieldRow label={t("wallet.fields.usd")} value={formatUsdMinor(intent.expectedUsdAmountMinor)} />
                                <FieldRow label={t("wallet.fields.credits")} value={intent.creditAmount} />
                                <FieldRow label={t("wallet.fields.expires")} value={intent.expiresAt ? new Date(intent.expiresAt).toLocaleString() : ""} />
                                {paymentRequestLink && (
                                    <FieldRow label={t("wallet.qrPayment")} value={paymentRequestLink} copyable onCopy={copyValue} />
                                )}
                                {txHash && <FieldRow label={intentNamespace(intent) === "solana" ? t("wallet.fields.transactionSignature") : t("wallet.fields.txHash")} value={txHash} copyable onCopy={copyValue} />}
                                {paymentRequestLink && (
                                    <p className={styles.muted}>{t("wallet.qrCompatibilityNote")}</p>
                                )}
                            </details>

                            {intent.confirmationCount !== null && (
                                <FieldRow label={t("wallet.fields.confirmations")} value={`${intent.confirmationCount}/${intent.requiredConfirmations || "-"}`} />
                            )}

                            {intent.failureReason && <p className={styles.error}>{intent.failureReason}</p>}

                            <button
                                className={styles.linkButton}
                                type="button"
                                onClick={() => setShowManualTxHash(current => !current)}
                            >
                                {t("wallet.manualTxHash")}
                            </button>
                            {showManualTxHash && (
                                <form className={styles.verifyForm} onSubmit={handleVerify}>
                                    <input
                                        className={styles.txInput}
                                        type="text"
                                        value={txHash}
                                        onChange={(event) => setTxHash(event.target.value)}
                                        placeholder={intentNamespace(intent) === "solana" ? t("wallet.solanaSignaturePlaceholder") : t("wallet.txHashPlaceholder")}
                                        disabled={actionLoading || intent.credited}
                                    />
                                    <button className={styles.primaryButton} type="submit" disabled={actionLoading || intent.credited}>
                                        {intent.credited ? <FaCheckCircle /> : null}
                                        {intent.credited ? t("wallet.credited") : t("wallet.verify")}
                                    </button>
                                </form>
                            )}
                        </div>
                    )}
                </>
            )}

            {notice && <p className={styles.notice}>{notice}</p>}
            {error && <p className={styles.error}>{error}</p>}
        </section>
    );
};

export default WalletPanel;
