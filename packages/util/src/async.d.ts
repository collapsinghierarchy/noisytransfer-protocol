/**
 * Race a promise against a timeout, rejecting if it doesn’t settle in `ms`.
 * Ensures its watchdog timer is cleared to avoid resource leaks in tests.
 *
 * @template T
 * @param {Promise<T>} promise  Promise to race
 * @param {string}     label    Used in the timeout error message
 * @param {number}     ms       Timeout in milliseconds
 * @returns {Promise<T>}
 */
export function withTimeout<T>(promise: Promise<T>, label: string, ms?: number): Promise<T>;
