// Shared output formatting helpers

// Safely format numbers that may be missing from API responses
export const formatNumber = (value: number | null | undefined): string => {
    return value !== null && value !== undefined
        ? value.toLocaleString()
        : "N/A";
};

// Format prices where 0 means "not available for purchase"
export const formatPrice = (num: number): string =>
    num > 0 ? num.toLocaleString() : "N/A";

// Percentage of part/total, guarded against division by zero
export const percent = (
    part: number | undefined,
    total: number | undefined,
    decimals = 2
): string => {
    if (!total || part === undefined || part === null) {
        return (0).toFixed(decimals);
    }
    return ((part / total) * 100).toFixed(decimals);
};
