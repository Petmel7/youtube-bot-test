import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { fetchUsers } from "../services/userService";
import {
    activateAdminPaymentConfigProposal,
    approveAdminPaymentConfigProposal,
    cancelAdminPaymentConfigProposal,
    confirmAdminPaymentConfigProposal,
    createAdminPaymentConfigProposal,
    fetchAdminPaymentConfig,
    fetchAdminPaymentConfigProposals,
    fetchAdminPaymentIntents,
    fetchAdminPaymentLedger,
    fetchAdminPaymentMethods,
    fetchAdminPaymentReconciliation,
    rejectAdminPaymentConfigProposal,
    retryAdminPaymentVerification,
    reviewAdminPaymentIntent
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
    const [reconciliation, setReconciliation] = useState([]);
    const [paymentConfigSummary, setPaymentConfigSummary] = useState(null);
    const [configProposals, setConfigProposals] = useState([]);
    const [loading, setLoading] = useState(true);
    const [actionLoading, setActionLoading] = useState(null);
    const [error, setError] = useState(null);
    const [statusFilter, setStatusFilter] = useState("");
    const [methodFilter, setMethodFilter] = useState("");
    const [reviewStatusFilter, setReviewStatusFilter] = useState("");
    const [reviewNotes, setReviewNotes] = useState({});
    const [proposalForm, setProposalForm] = useState({
        methodId: "",
        enabled: "",
        treasuryAddress: "",
        confirmations: "",
        reason: ""
    });
    const [proposalConfirmations, setProposalConfirmations] = useState({});

    const loadAdminData = useCallback(async () => {
        setLoading(true);
        setError(null);

        try {
            const [usersData, methodsData, intentsData, ledgerData, reconciliationData, configData, proposalsData] = await Promise.all([
                fetchUsers(),
                fetchAdminPaymentMethods(),
                fetchAdminPaymentIntents({
                    status: statusFilter,
                    methodId: methodFilter,
                    limit: 25
                }),
                fetchAdminPaymentLedger({ type: "CREDIT", limit: 25 }),
                fetchAdminPaymentReconciliation({
                    status: statusFilter,
                    methodId: methodFilter,
                    reviewStatus: reviewStatusFilter,
                    limit: 25
                }),
                fetchAdminPaymentConfig(),
                fetchAdminPaymentConfigProposals({ limit: 25 })
            ]);

            setUsers(usersData || []);
            setMethods(methodsData.paymentMethods || []);
            setIntents(intentsData.intents || []);
            setLedger(ledgerData.ledger || []);
            setReconciliation(reconciliationData.candidates || []);
            setPaymentConfigSummary(configData.config || null);
            setConfigProposals(proposalsData.proposals || []);
        } catch (err) {
            console.error("Error fetching admin payment data:", err);
            setError(t("admin.payments.errors.load"));
        } finally {
            setLoading(false);
        }
    }, [methodFilter, reviewStatusFilter, statusFilter, t]);

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

    const retryVerify = async (candidate) => {
        const intentId = candidate.intent?.id;
        if (!intentId) return;

        setActionLoading(`retry:${intentId}`);
        setError(null);
        try {
            await retryAdminPaymentVerification(intentId);
            await loadAdminData();
        } catch (err) {
            console.error("Error retrying payment verification:", err);
            setError(t("admin.payments.errors.retry"));
        } finally {
            setActionLoading(null);
        }
    };

    const markReviewed = async (candidate) => {
        const intentId = candidate.intent?.id;
        const note = (reviewNotes[intentId] || "").trim();
        if (!intentId || !note) {
            setError(t("admin.payments.errors.noteRequired"));
            return;
        }

        if (!window.confirm(t("admin.payments.confirmReview"))) {
            return;
        }

        const action = candidate.reason === "MANUAL_REVIEW"
            ? "MARK_UNDERPAYMENT_ACKNOWLEDGED"
            : "MARK_REVIEWED";

        setActionLoading(`review:${intentId}`);
        setError(null);
        try {
            await reviewAdminPaymentIntent(intentId, { action, note });
            setReviewNotes(current => ({ ...current, [intentId]: "" }));
            await loadAdminData();
        } catch (err) {
            console.error("Error marking payment reviewed:", err);
            setError(t("admin.payments.errors.review"));
        } finally {
            setActionLoading(null);
        }
    };

    const submitConfigProposal = async (event) => {
        event.preventDefault();
        const change = { methodId: proposalForm.methodId };

        if (!change.methodId) {
            setError(t("admin.payments.errors.methodRequired"));
            return;
        }

        if (proposalForm.enabled !== "") change.enabled = proposalForm.enabled === "true";
        if (proposalForm.treasuryAddress.trim()) change.treasuryAddress = proposalForm.treasuryAddress.trim();
        if (proposalForm.confirmations !== "") change.confirmations = Number(proposalForm.confirmations);

        setActionLoading("config:create");
        setError(null);
        try {
            await createAdminPaymentConfigProposal({
                reason: proposalForm.reason,
                methodChanges: [change]
            });
            setProposalForm({ methodId: "", enabled: "", treasuryAddress: "", confirmations: "", reason: "" });
            await loadAdminData();
        } catch (err) {
            console.error("Error creating payment config proposal:", err);
            setError(t("admin.payments.errors.configProposal"));
        } finally {
            setActionLoading(null);
        }
    };

    const runProposalAction = async (proposal, action) => {
        const proposalId = proposal.id;
        setActionLoading(`config:${action}:${proposalId}`);
        setError(null);
        try {
            if (action === "confirm") {
                await confirmAdminPaymentConfigProposal(proposalId, proposalConfirmations[proposalId] || "");
            } else if (action === "approve") {
                await approveAdminPaymentConfigProposal(proposalId);
            } else if (action === "activate") {
                await activateAdminPaymentConfigProposal(proposalId);
            } else if (action === "reject") {
                const note = window.prompt(t("admin.payments.configActionNote"));
                if (note === null) return;
                await rejectAdminPaymentConfigProposal(proposalId, note);
            } else if (action === "cancel") {
                const note = window.prompt(t("admin.payments.configActionNote"));
                if (note === null) return;
                await cancelAdminPaymentConfigProposal(proposalId, note);
            }
            await loadAdminData();
        } catch (err) {
            console.error("Error updating payment config proposal:", err);
            setError(t("admin.payments.errors.configAction"));
        } finally {
            setActionLoading(null);
        }
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
                <div className={styles.metric}>
                    <span>{t("admin.payments.reconciliation")}</span>
                    <strong>{reconciliation.length}</strong>
                </div>
            </section>

            <section className={styles.section}>
                <div className={styles.sectionHeader}>
                    <h2>{t("admin.payments.configWorkflow")}</h2>
                </div>
                <div className={styles.configGrid}>
                    <div className={styles.configPanel}>
                        <h3>{t("admin.payments.currentConfig")}</h3>
                        <p>{t("admin.payments.configSource")}: {paymentConfigSummary?.source || "-"}</p>
                        <p>{t("admin.payments.configVersion")}: {paymentConfigSummary?.version ?? "-"}</p>
                        <p>{t("admin.payments.futureOnlyWarning")}</p>
                    </div>
                    <form className={styles.configPanel} onSubmit={submitConfigProposal}>
                        <h3>{t("admin.payments.createProposal")}</h3>
                        <select value={proposalForm.methodId} onChange={(event) => setProposalForm(current => ({ ...current, methodId: event.target.value }))}>
                            <option value="">{t("admin.payments.selectMethod")}</option>
                            {methods.map(method => <option key={method.id} value={method.id}>{method.name}</option>)}
                        </select>
                        <select value={proposalForm.enabled} onChange={(event) => setProposalForm(current => ({ ...current, enabled: event.target.value }))}>
                            <option value="">{t("admin.payments.leaveEnabledUnchanged")}</option>
                            <option value="true">{t("admin.payments.enabled")}</option>
                            <option value="false">{t("admin.payments.disabled")}</option>
                        </select>
                        <input value={proposalForm.treasuryAddress} onChange={(event) => setProposalForm(current => ({ ...current, treasuryAddress: event.target.value }))} placeholder={t("admin.payments.newTreasury")} />
                        <input type="number" min="1" max="500" value={proposalForm.confirmations} onChange={(event) => setProposalForm(current => ({ ...current, confirmations: event.target.value }))} placeholder={t("admin.payments.newConfirmations")} />
                        <textarea value={proposalForm.reason} onChange={(event) => setProposalForm(current => ({ ...current, reason: event.target.value }))} placeholder={t("admin.payments.proposalReason")} maxLength={1000} required />
                        <button className={styles.actionButton} type="submit" disabled={Boolean(actionLoading)}>
                            {actionLoading === "config:create" ? t("loading") : t("admin.payments.createProposal")}
                        </button>
                    </form>
                </div>
                <div className={styles.tableWrap}>
                    <table className={styles.table}>
                        <thead>
                            <tr>
                                <th>{t("admin.payments.status")}</th>
                                <th>{t("admin.payments.reason")}</th>
                                <th>{t("admin.payments.configDiff")}</th>
                                <th>{t("admin.payments.confirmation")}</th>
                                <th>{t("admin.payments.actions")}</th>
                            </tr>
                        </thead>
                        <tbody>
                            {configProposals.map(proposal => (
                                <tr key={proposal.id}>
                                    <td><Badge tone={proposal.status === "ACTIVATED" ? "success" : "neutral"}>{proposal.status}</Badge></td>
                                    <td>
                                        <strong>{proposal.reason}</strong>
                                        <span>{formatDate(proposal.createdAt)}</span>
                                    </td>
                                    <td>
                                        {(proposal.normalizedPreview?.diff || []).map(diff => (
                                            <span key={diff.methodId}>{diff.methodId}: {Object.keys(diff.after || {}).join(", ")}</span>
                                        ))}
                                    </td>
                                    <td>
                                        {proposal.status === "PENDING_CONFIRMATION" ? (
                                            <input value={proposalConfirmations[proposal.id] || ""} onChange={(event) => setProposalConfirmations(current => ({ ...current, [proposal.id]: event.target.value }))} placeholder={proposal.confirmationPhrase || "CONFIRM PAYMENT CONFIG CHANGE"} />
                                        ) : "-"}
                                    </td>
                                    <td>
                                        <div className={styles.actions}>
                                            {proposal.status === "PENDING_CONFIRMATION" && (
                                                <button className={styles.actionButton} type="button" onClick={() => runProposalAction(proposal, "confirm")} disabled={Boolean(actionLoading)}>
                                                    {t("admin.payments.confirmProposal")}
                                                </button>
                                            )}
                                            {proposal.status === "PENDING_APPROVAL" && (
                                                <button className={styles.actionButton} type="button" onClick={() => runProposalAction(proposal, "approve")} disabled={Boolean(actionLoading)}>
                                                    {t("admin.payments.approveProposal")}
                                                </button>
                                            )}
                                            {proposal.status === "APPROVED" && (
                                                <button className={styles.actionButton} type="button" onClick={() => runProposalAction(proposal, "activate")} disabled={Boolean(actionLoading)}>
                                                    {t("admin.payments.activateProposal")}
                                                </button>
                                            )}
                                            {["PENDING_CONFIRMATION", "PENDING_APPROVAL", "APPROVED"].includes(proposal.status) && (
                                                <>
                                                    <button className={styles.actionButton} type="button" onClick={() => runProposalAction(proposal, "reject")} disabled={Boolean(actionLoading)}>
                                                        {t("admin.payments.rejectProposal")}
                                                    </button>
                                                    <button className={styles.actionButton} type="button" onClick={() => runProposalAction(proposal, "cancel")} disabled={Boolean(actionLoading)}>
                                                        {t("admin.payments.cancelProposal")}
                                                    </button>
                                                </>
                                            )}
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </section>

            <section className={styles.section}>
                <div className={styles.sectionHeader}>
                    <h2>{t("admin.payments.reconciliation")}</h2>
                    <div className={styles.filters}>
                        <select value={reviewStatusFilter} onChange={(event) => setReviewStatusFilter(event.target.value)}>
                            <option value="">{t("admin.payments.allReviewStatuses")}</option>
                            <option value="REVIEWED">{t("admin.payments.reviewed")}</option>
                            <option value="UNDERPAYMENT_ACKNOWLEDGED">{t("admin.payments.underpaymentAcknowledged")}</option>
                            <option value="PAID_UNCREDITED_REVIEWED">{t("admin.payments.paidUncreditedReviewed")}</option>
                        </select>
                    </div>
                </div>
                <div className={styles.tableWrap}>
                    <table className={styles.table}>
                        <thead>
                            <tr>
                                <th>{t("admin.payments.reason")}</th>
                                <th>{t("admin.payments.status")}</th>
                                <th>{t("admin.payments.method")}</th>
                                <th>{t("admin.payments.amount")}</th>
                                <th>{t("admin.payments.user")}</th>
                                <th>{t("admin.payments.transaction")}</th>
                                <th>{t("admin.payments.review")}</th>
                                <th>{t("admin.payments.actions")}</th>
                            </tr>
                        </thead>
                        <tbody>
                            {reconciliation.map(candidate => {
                                const intent = candidate.intent || {};
                                const intentId = intent.id;
                                return (
                                    <tr key={intentId}>
                                        <td><Badge tone="warning">{candidate.reason || t("admin.payments.review")}</Badge></td>
                                        <td>
                                            <Badge tone={intent.credited ? "success" : "neutral"}>{intent.status}</Badge>
                                            <span>{intent.failureCode || intent.failureReason || "-"}</span>
                                        </td>
                                        <td>
                                            <strong>{intent.paymentMethodId}</strong>
                                            <span>{intent.caipNetworkId}</span>
                                        </td>
                                        <td>
                                            <strong>{formatUsdMinor(intent.expectedUsdAmountMinor)}</strong>
                                            <span>{intent.verifiedTokenAmountBaseUnits || "-"} / {intent.expectedTokenAmountBaseUnits} {intent.tokenSymbol}</span>
                                            <span>{intent.creditAmount} {t("admin.payments.credits")}</span>
                                        </td>
                                        <td>{shortText(intent.userId)}</td>
                                        <td>
                                            <span>{shortText(intent.payerAddress)}</span>
                                            <span>{shortText(intent.txHash || intent.transactionSignature || intent.candidateTxHash)}</span>
                                        </td>
                                        <td>
                                            <span>{candidate.reviewStatus || "-"}</span>
                                            <span>{candidate.latestAudit?.action || "-"}</span>
                                            <span>{candidate.latestAudit?.note || candidate.reviewNote || "-"}</span>
                                        </td>
                                        <td>
                                            <div className={styles.actions}>
                                                <button
                                                    className={styles.actionButton}
                                                    type="button"
                                                    onClick={() => retryVerify(candidate)}
                                                    disabled={Boolean(actionLoading)}
                                                >
                                                    {actionLoading === `retry:${intentId}` ? t("loading") : t("admin.payments.retryVerify")}
                                                </button>
                                                <textarea
                                                    value={reviewNotes[intentId] || ""}
                                                    onChange={(event) => setReviewNotes(current => ({ ...current, [intentId]: event.target.value }))}
                                                    placeholder={t("admin.payments.reviewNote")}
                                                    maxLength={1000}
                                                />
                                                <button
                                                    className={styles.actionButton}
                                                    type="button"
                                                    onClick={() => markReviewed(candidate)}
                                                    disabled={Boolean(actionLoading)}
                                                >
                                                    {actionLoading === `review:${intentId}` ? t("loading") : t("admin.payments.markReviewed")}
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
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
