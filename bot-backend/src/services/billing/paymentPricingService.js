const { badRequest } = require("../../utils/errors");
const { paymentConfig } = require("../../config/config");

const assertPositiveInteger = (value, field) => {
    if (!Number.isSafeInteger(value) || value <= 0) {
        throw new Error(`Invalid ${field}`);
    }
};

const assertTokenDecimals = (value) => {
    if (!Number.isSafeInteger(value) || value < 0) {
        throw new Error("Invalid payment method tokenDecimals");
    }
};

const calculateStablecoinBaseUnits = (expectedUsdAmountMinor, tokenDecimals) => {
    assertPositiveInteger(expectedUsdAmountMinor, "payment package expectedUsdAmountMinor");
    assertTokenDecimals(tokenDecimals);

    const numerator = BigInt(expectedUsdAmountMinor) * (10n ** BigInt(tokenDecimals));
    if (numerator % 100n !== 0n) {
        throw new Error("Invalid stablecoin amount precision");
    }

    return (numerator / 100n).toString();
};

const clonePackage = (pkg, pricingVersion) => Object.freeze({
    packageId: pkg.packageId,
    creditAmount: pkg.creditAmount,
    expectedUsdAmountMinor: pkg.expectedUsdAmountMinor,
    pricingVersion
});

const parsePaymentPackages = (packagesJson, { pricingVersion = paymentConfig.pricingVersion } = {}) => {
    if (typeof pricingVersion !== "string" || pricingVersion.trim() === "") {
        throw new Error("Invalid PAYMENT_PRICING_VERSION configuration");
    }

    let parsed;
    try {
        parsed = JSON.parse(packagesJson);
    } catch {
        throw new Error("Invalid PAYMENT_PACKAGES_JSON configuration");
    }

    if (!Array.isArray(parsed) || parsed.length === 0) {
        throw new Error("Invalid PAYMENT_PACKAGES_JSON configuration");
    }

    const seen = new Set();
    return parsed.map((pkg) => {
        if (!pkg || typeof pkg !== "object" || Array.isArray(pkg)) {
            throw new Error("Invalid PAYMENT_PACKAGES_JSON configuration");
        }

        if (typeof pkg.packageId !== "string" || pkg.packageId.trim() === "") {
            throw new Error("Invalid payment packageId");
        }

        if (seen.has(pkg.packageId)) {
            throw new Error("Duplicate payment packageId");
        }
        seen.add(pkg.packageId);

        assertPositiveInteger(pkg.creditAmount, "payment package creditAmount");
        assertPositiveInteger(pkg.expectedUsdAmountMinor, "payment package expectedUsdAmountMinor");
        if (Object.prototype.hasOwnProperty.call(pkg, "expectedTokenAmountBaseUnits")) {
            throw new Error("Deprecated payment package expectedTokenAmountBaseUnits configuration");
        }

        return Object.freeze({
            packageId: pkg.packageId,
            creditAmount: pkg.creditAmount,
            expectedUsdAmountMinor: pkg.expectedUsdAmountMinor
        });
    });
};

const createPaymentPricingService = ({
    packagesJson = paymentConfig.packagesJson,
    pricingVersion = paymentConfig.pricingVersion
} = {}) => {
    const packages = parsePaymentPackages(packagesJson, { pricingVersion });
    const packageMap = new Map(packages.map(pkg => [pkg.packageId, pkg]));

    const getPackageSnapshot = (packageId) => {
        const pkg = packageMap.get(packageId);
        if (!pkg) {
            throw badRequest("INVALID_PAYMENT_PACKAGE", "Unknown payment package");
        }

        return clonePackage(pkg, pricingVersion);
    };

    const listPackageSnapshots = () => packages.map(pkg => clonePackage(pkg, pricingVersion));

    return { getPackageSnapshot, listPackageSnapshots };
};

module.exports = {
    calculateStablecoinBaseUnits,
    createPaymentPricingService,
    parsePaymentPackages
};
