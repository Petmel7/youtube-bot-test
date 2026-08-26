import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { fetchUsers } from "../services/userService";
import {
    fetchAdminPaymentIntents,
    fetchAdminPaymentLedger,
    fetchAdminPaymentMethods
} from "../services/adminPaymentService";
import styles from "../styles/admin.module.css";

const formatDate = (value) => {
    if (!value) return "-";
    return new Intl.DateTimeFormat(undefined, {
        dateStyle: "short",
        timeStyle: "short"
    }).format(new Date(value));
};

const shortText = (value) => {
    if (!value) return "-";
    if (value.length <= 18) return value;
    return `${value.slice(0, 8)}...${value.slice(-6)}`;
};

const formatUsdMinor = (value) => {
    if (!Number.isFinite(value)) return "-";
    return new Intl.NumberFormat(undefined, {
        style: "currency",
        currency: "USD"
    }).format(value / 100);
};

const Badge = ({ children, tone = "neutral" }) => (
    <span className={`${styles.badge} ${styles[`badge_${tone}`]}`}>{children}</span>
);

const Admin = () => {
    const { t } = useTranslation();
    const [users, setUsers] = useState([]);
    const [methods, setMethods] = useState([]);
    const [intents, setIntents] = useState([]);
    const [ledger, setLedger] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [statusFilter, setStatusFilter] = useState("");
    const [methodFilter, setMethodFilter] = useState("");

    const loadAdminData = useCallback(async () => {
        setLoading(true);
        setError(null);

        try {
            const [usersData, methodsData, intentsData, ledgerData] = await Promise.all([
                fetchUsers(),
                fetchAdminPaymentMethods(),
                fetchAdminPaymentIntents({
                    status: statusFilter,
                    methodId: methodFilter,
                    limit: 25
                }),
                fetchAdminPaymentLedger({ type: "CREDIT", limit: 25 })
            ]);

            setUsers(usersData || []);
            setMethods(methodsData.paymentMethods || []);
            setIntents(intentsData.intents || []);
            setLedger(ledgerData.ledger || []);
        } catch (err) {
            console.error("Error fetching admin payment data:", err);
            setError(t("admin.payments.errors.load"));
        } finally {
            setLoading(false);
        }
    }, [methodFilter, statusFilter, t]);

    useEffect(() => {
        loadAdminData();
    }, [loadAdminData]);

    const statuses = useMemo(() => (
        Array.from(new Set(intents.map(intent => intent.status).filter(Boolean))).sort()
    ), [intents]);

    const copyValue = async (value) => {
        if (!navigator.clipboard || !value) return;
        await navigator.clipboard.writeText(value);
    };

    return (
        <main className={styles.adminPage}>
            <header className={styles.header}>
                <div>
                    <h1>{t("admin.title")}</h1>
                    <p>{t("admin.payments.readOnlyNote")}</p>
                </div>
                <button className={styles.refreshButton} type="button" onClick={loadAdminData} disabled={loading}>
                    {loading ? t("loading") : t("admin.refresh")}
                </button>
            </header>

            {error && <div className={styles.error}>{error}</div>}

            <section className={styles.summaryGrid}>
                <div className={styles.metric}>
                    <span>{t("admin.users")}</span>
                    <strong>{users.length}</strong>
                </div>
                <div className={styles.metric}>
                    <span>{t("admin.payments.methods")}</span>
                    <strong>{methods.length}</strong>
                </div>
                <div className={styles.metric}>
                    <span>{t("admin.payments.recentIntents")}</span>
                    <strong>{intents.length}</strong>
                </div>
                <div className={styles.metric}>
                    <span>{t("admin.payments.recentCredits")}</span>
                    <strong>{ledger.length}</strong>
                </div>
            </section>

            <section className={styles.section}>
                <div className={styles.sectionHeader}>
                    <h2>{t("admin.payments.methods")}</h2>
                </div>
                <div className={styles.tableWrap}>
                    <table className={styles.table}>
                        <thead>
                            <tr>
                                <th>{t("admin.payments.method")}</th>
                                <th>{t("admin.payments.token")}</th>
                                <th>{t("admin.payments.network")}</th>
                                <th>{t("admin.payments.flags")}</th>
                                <th>{t("admin.payments.treasury")}</th>
                                <th>{t("admin.payments.confirmations")}</th>
                            </tr>
                        </thead>
                        <tbody>
                            {methods.map(method => (
                                <tr key={method.id}>
                                    <td>
                                        <strong>{method.name}</strong>
                                        <span>{method.id}</span>
                                    </td>
                                    <td>{method.token?.symbol} · {method.token?.decimals}</td>
                                    <td>
                                        <strong>{method.network}</strong>
                                        <span>{method.caipNetworkId}</span>
                                    </td>
                                    <td className={styles.badges}>
                                        <Badge tone={method.enabled ? "success" : "muted"}>
                                            {method.enabled ? t("admin.payments.enabled") : t("admin.payments.disabled")}
                                        </Badge>
                                        <Badge tone={method.production ? "success" : "warning"}>
                                            {method.production ? t("admin.payments.production") : t("admin.payments.testnet")}
                                        </Badge>
                                        {method.smoke && <Badge tone="warning">{t("admin.payments.smoke")}</Badge>}
                                    </td>
                                    <td>
                                        <button className={styles.copyButton} type="button" onClick={() => copyValue(method.treasuryAddress)}>
                                            {shortText(method.treasuryAddress)}
                                        </button>
                                    </td>
                                    <td>{method.confirmations}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </section>

            <section className={styles.section}>
                <div className={styles.sectionHeader}>
                    <h2>{t("admin.payments.recentIntents")}</h2>
                    <div className={styles.filters}>
                        <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
                            <option value="">{t("admin.payments.allStatuses")}</option>
                            {statuses.map(status => <option key={status} value={status}>{status}</option>)}
                        </select>
                        <select value={methodFilter} onChange={(event) => setMethodFilter(event.target.value)}>
                            <option value="">{t("admin.payments.allMethods")}</option>
                            {methods.map(method => <option key={method.id} value={method.id}>{method.name}</option>)}
                        </select>
                    </div>
                </div>
                <div className={styles.tableWrap}>
                    <table className={styles.table}>
                        <thead>
                            <tr>
                                <th>{t("admin.payments.status")}</th>
                                <th>{t("admin.payments.method")}</th>
                                <th>{t("admin.payments.amount")}</th>
                                <th>{t("admin.payments.user")}</th>
                                <th>{t("admin.payments.payer")}</th>
                                <th>{t("admin.payments.transaction")}</th>
                                <th>{t("admin.payments.dates")}</th>
                                <th>{t("admin.payments.failure")}</th>
                            </tr>
                        </thead>
                        <tbody>
                            {intents.map(intent => (
                                <tr key={intent.id}>
                                    <td><Badge tone={intent.credited ? "success" : "neutral"}>{intent.status}</Badge></td>
                                    <td>
                                        <strong>{intent.paymentMethodId}</strong>
                                        <span>{intent.caipNetworkId}</span>
                                    </td>
                                    <td>
                                        <strong>{formatUsdMinor(intent.expectedUsdAmountMinor)}</strong>
                                        <span>{intent.creditAmount} {t("admin.payments.credits")}</span>
                                        <span>{intent.expectedTokenAmountBaseUnits} {intent.tokenSymbol}</span>
                                    </td>
                                    <td>{shortText(intent.userId)}</td>
                                    <td>{shortText(intent.payerAddress)}</td>
                                    <td>{shortText(intent.txHash || intent.transactionSignature || intent.candidateTxHash)}</td>
                                    <td>
                                        <span>{t("admin.payments.created")}: {formatDate(intent.createdAt)}</span>
                                        <span>{t("admin.payments.expires")}: {formatDate(intent.expiresAt)}</span>
                                        <span>{t("admin.payments.confirmed")}: {formatDate(intent.confirmedAt)}</span>
                                    </td>
                                    <td>{intent.failureCode || intent.failureReason || "-"}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </section>

            <section className={styles.section}>
                <div className={styles.sectionHeader}>
                    <h2>{t("admin.payments.recentCredits")}</h2>
                </div>
                <div className={styles.tableWrap}>
                    <table className={styles.table}>
                        <thead>
                            <tr>
                                <th>{t("admin.payments.transaction")}</th>
                                <th>{t("admin.payments.user")}</th>
                                <th>{t("admin.payments.method")}</th>
                                <th>{t("admin.payments.amount")}</th>
                                <th>{t("admin.payments.balance")}</th>
                                <th>{t("admin.payments.created")}</th>
                            </tr>
                        </thead>
                        <tbody>
                            {ledger.map(entry => (
                                <tr key={entry.id}>
                                    <td>{shortText(entry.txHash)}</td>
                                    <td>{shortText(entry.userId)}</td>
                                    <td>
                                        <strong>{entry.paymentMethodId || "-"}</strong>
                                        <span>{entry.networkId || entry.chainId || "-"}</span>
                                    </td>
                                    <td>{entry.amount} {entry.unit}</td>
                                    <td>{entry.balanceBefore ?? "-"} -&gt; {entry.balanceAfter ?? "-"}</td>
                                    <td>{formatDate(entry.createdAt)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </section>
        </main>
    );
};

export default Admin;
