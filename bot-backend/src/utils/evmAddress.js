const evmAddressPattern = /^0x[a-fA-F0-9]{40}$/;

const isValidEvmAddress = (value) => typeof value === "string" && evmAddressPattern.test(value);

const normalizeEvmAddress = (value) => {
    if (!isValidEvmAddress(value)) {
        return null;
    }

    return value.toLowerCase();
};

module.exports = { isValidEvmAddress, normalizeEvmAddress };
