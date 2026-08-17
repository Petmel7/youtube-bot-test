const { badRequest } = require("../../utils/errors");
const { paymentConfig } = require("../../config/config");

const canonicalDecimalStringPattern = /^(0|[1-9][0-9]*)$/;

const assertPositiveInteger = (value, field) => {
    if (!Number.isInteger(value) || value <= 0) {
        throw new Error(`Invalid ${field}`);
    }
};

const assertPositiveDecimalString = (value, field) => {
    if (typeof value !== "string" || !canonicalDecimalStringPattern.test(value) || BigInt(value) <= 0n) {
        throw new Error(`Invalid ${field}`);
    }
};

const clonePackage = (pkg, pricingVersion) => Object.freeze({
    packageId: pkg.packageId,
    creditAmount: pkg.creditAmount,
    expectedUsdAmountMinor: pkg.expectedUsdAmountMinor,
    expectedTokenAmountBaseUnits: pkg.expectedTokenAmountBaseUnits,
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
        assertPositiveDecimalString(pkg.expectedTokenAmountBaseUnits, "payment package expectedTokenAmountBaseUnits");

        return Object.freeze({
            packageId: pkg.packageId,
            creditAmount: pkg.creditAmount,
            expectedUsdAmountMinor: pkg.expectedUsdAmountMinor,
            expectedTokenAmountBaseUnits: pkg.expectedTokenAmountBaseUnits
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
    createPaymentPricingService,
    parsePaymentPackages
};
