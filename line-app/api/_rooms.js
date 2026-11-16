// Room list, dorm defaults and per-room rent/rates.
//
// Precedence: env defaults → the dorm settings the owner saved (`dorm`) → the per-room override
// (`room:<room>`). Env stays as the fallback so an unconfigured deployment still works.
const store = require("./_store");

const ROOMS = (process.env.ROOMS || "201,202,203,204,205,206,207,208,209,210,211,212")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const DEFAULTS = {
  rent: Number(process.env.DEFAULT_RENT || 3500),
  waterRate: Number(process.env.WATER_RATE || 25),
  elecRate: Number(process.env.ELEC_RATE || 7),
};

const RATE_KEYS = ["rent", "waterRate", "elecRate"];

// What the owner saved from the settings screen (may be null on a fresh dorm).
async function dormOf() {
  return (await store.get("dorm")) || null;
}

// The defaults in force: env, overridden by the dorm settings. Read once per request and pass it
// down, otherwise every room costs one extra Blob read.
async function baseDefaults(dorm) {
  const saved = dorm === undefined ? await dormOf() : dorm;
  const base = { ...DEFAULTS };
  for (const key of RATE_KEYS) {
    const value = saved && saved[key];
    if (Number.isInteger(value) && value >= 0) base[key] = value;
  }
  return base;
}

async function configFor(room, base) {
  const defaults = base || (await baseDefaults());
  return { ...defaults, ...((await store.get(`room:${room}`)) || {}) };
}

module.exports = { ROOMS, configFor, DEFAULTS, dormOf, baseDefaults, RATE_KEYS };
