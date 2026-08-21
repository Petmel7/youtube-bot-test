import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAppKit } from "@reown/appkit/react";
import { useAccount, useChainId, useSignMessage, useSwitchChain } from "wagmi";
import { FaCheckCircle, FaCopy, FaExternalLinkAlt, FaRedoAlt, FaWallet } from "react-icons/fa";
import {
    createPayerChallenge,
    createPaymentIntent,
    fetchPaymentIntent,
    fetchPaymentPackages,
    fetchWallet,
    verifyPaymentIntent
} from "../services/paymentService";
import config from "../config/config";
import { appKitExpectedNetwork, isWalletConnectConfigured, walletConnectInitializationError } from "../wallet/appKit";
import styles from "../styles/walletPanel.module.css";

const txHashPattern = /^0x[a-fA-F0-9]{64}$/;
const settlementStatuses = new Set(["CONFIRMED", "CONFIRMED_OVERPAID"]);
const pendingStatuses = new Set(["PENDING", "SUBMITTED", "VERIFYING", "CONFIRMING"]);
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
const isUserRejectedSignature = (error) => (
    error?.code === 4001 ||
    error?.name === "UserRejectedRequestError" ||
    /rejected|denied|declined/i.test(error?.message || "")
);

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
    const expectedChainId = config.paymentNetwork.id;
    const expectedNetworkName = config.paymentNetwork.name;
    const connectedNetworkName = chainId === expectedChainId ? expectedNetworkName : (chainId ? `Chain ${chainId}` : "-");
    const wrongNetwork = isConnected && chainId !== expectedChainId;
    const createDisabled = actionLoading || !selectedPackage || !isConnected || wrongNetwork || status === "connecting";

    const openConnectModal = () => open({ view: "Connect", namespace: "eip155" });

    const handleSwitchNetwork = async () => {
        setError("");
        try {
            await switchChainAsync({ chainId: appKitExpectedNetwork.id });
        } catch (switchError) {
            setError(switchError.message || t("wallet.errors.switchNetwork"));
        }
    };

    const handleCreateIntent = async () => {
        if (!selectedPackage?.packageId || !address) return;

        setActionLoading(true);
        setError("");
        setNotice("");
        try {
            if (chainId !== expectedChainId) {
                throw new Error(t("wallet.errors.wrongNetwork", { network: expectedNetworkName }));
            }

            const challenge = await createPayerChallenge(address);
            if (normalizeAddress(challenge.payerAddress) !== normalizeAddress(address)) {
                throw new Error(t("wallet.errors.walletChanged"));
            }

            const signature = await signMessageAsync({ message: challenge.message });
            const nextIntent = await createPaymentIntent({
                packageId: selectedPackage.packageId,
                payerChallengeId: challenge.id,
                signature
            });
            if (normalizeAddress(nextIntent.payerAddress) !== normalizeAddress(address)) {
                throw new Error(t("wallet.errors.walletChanged"));
            }

            setIntent(nextIntent);
            setPayerAddress(nextIntent.payerAddress || challenge.payerAddress);
            setTxHash(nextIntent.txHash || "");
        } catch (createError) {
            setError(isUserRejectedSignature(createError)
                ? t("wallet.errors.signatureRejected")
                : (createError.shortMessage || createError.message || t("wallet.errors.create")));
        } finally {
            setActionLoading(false);
        }
    };

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
                {actionLoading ? t("wallet.working") : t("wallet.createIntent")}
            </button>
            {createDisabled && !actionLoading && (
                <p className={styles.muted}>
                    {!isConnected
                        ? t("wallet.connection.disabledConnect")
                        : wrongNetwork
                            ? t("wallet.connection.disabledNetwork", { network: expectedNetworkName })
                            : t("wallet.connection.disabledPackage")}
                </p>
            )}
        </div>
    );
};

const WalletPanel = () => {
    const { t } = useTranslation();
    const [wallet, setWallet] = useState(null);
    const [packages, setPackages] = useState([]);
    const [selectedPackageId, setSelectedPackageId] = useState("");
    const [intent, setIntent] = useState(null);
    const [txHash, setTxHash] = useState("");
    const [payerAddress, setPayerAddress] = useState("");
    const [loading, setLoading] = useState(true);
    const [actionLoading, setActionLoading] = useState(false);
    const [error, setError] = useState("");
    const [notice, setNotice] = useState("");

    const selectedPackage = useMemo(
        () => packages.find(paymentPackage => paymentPackage.packageId === selectedPackageId) || packages[0],
        [packages, selectedPackageId]
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
                const [nextWallet, nextPackages] = await Promise.all([
                    fetchWallet(),
                    fetchPaymentPackages()
                ]);

                if (ignore) return;
                setWallet(nextWallet);
                setPackages(nextPackages);
                setSelectedPackageId(current => current || nextPackages[0]?.packageId || "");
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
            const result = await verifyPaymentIntent(intent.id, normalizedHash.toLowerCase());
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

    const tokenAmount = intent
        ? formatTokenAmount(intent.expectedTokenAmountBaseUnits, intent.token?.decimals)
        : "";

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

                    {isWalletConnectConfigured ? (
                        <AppKitWalletControls
                            selectedPackage={selectedPackage}
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

                            <FieldRow label={t("wallet.fields.chainId")} value={intent.chainId} />
                            <FieldRow label={t("wallet.fields.token")} value={`${intent.token?.symbol || ""} (${intent.token?.decimals ?? "-"} ${t("wallet.fields.decimals")})`} />
                            <FieldRow label={t("wallet.fields.tokenAddress")} value={intent.token?.address} copyable onCopy={copyValue} />
                            <FieldRow label={t("wallet.fields.recipient")} value={intent.recipientAddress} copyable onCopy={copyValue} />
                            <FieldRow label={t("wallet.fields.payer")} value={intent.payerAddress || payerAddress} copyable onCopy={copyValue} />
                            <FieldRow label={t("wallet.fields.tokenAmount")} value={`${tokenAmount} ${intent.token?.symbol || ""}`.trim()} />
                            <FieldRow label={t("wallet.fields.baseUnits")} value={intent.expectedTokenAmountBaseUnits} copyable onCopy={copyValue} />
                            <FieldRow label={t("wallet.fields.usd")} value={formatUsdMinor(intent.expectedUsdAmountMinor)} />
                            <FieldRow label={t("wallet.fields.credits")} value={intent.creditAmount} />
                            <FieldRow label={t("wallet.fields.expires")} value={intent.expiresAt ? new Date(intent.expiresAt).toLocaleString() : ""} />
                            {intent.confirmationCount !== null && (
                                <FieldRow label={t("wallet.fields.confirmations")} value={`${intent.confirmationCount}/${intent.requiredConfirmations || "-"}`} />
                            )}

                            {intent.failureReason && <p className={styles.error}>{intent.failureReason}</p>}

                            <form className={styles.verifyForm} onSubmit={handleVerify}>
                                <input
                                    className={styles.txInput}
                                    type="text"
                                    value={txHash}
                                    onChange={(event) => setTxHash(event.target.value)}
                                    placeholder={t("wallet.txHashPlaceholder")}
                                    disabled={actionLoading || intent.credited}
                                />
                                <button className={styles.primaryButton} type="submit" disabled={actionLoading || intent.credited}>
                                    {intent.credited ? <FaCheckCircle /> : null}
                                    {intent.credited ? t("wallet.credited") : t("wallet.verify")}
                                </button>
                            </form>
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
