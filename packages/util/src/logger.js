const lvls = ['silent','error','warn','info','debug'];
function levelFromEnv() {
  let lvl = 'silent';
  try {
    if (typeof process !== 'undefined' && process.env && process.env.NOISY_LOG_LEVEL) lvl = String(process.env.NOISY_LOG_LEVEL);
    if (typeof globalThis !== 'undefined' && globalThis.NOISY_LOG_LEVEL) lvl = String(globalThis.NOISY_LOG_LEVEL);
  } catch {}
  const idx = lvls.indexOf(lvl.toLowerCase());
  return idx === -1 ? 0 : idx;
}
const cur = levelFromEnv();
function make(method, minIdx) {
  return (...args) => { if (cur >= minIdx) console[method](...args); };
}
export const logger = {
  error: make('error', 1),
  warn:  make('warn',  2),
  info:  make('info',  3),
  debug: make('debug', 4),
};
