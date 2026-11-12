// Room list + per-room rent/rates. Set ROOMS="101,102,103" to match your dorm.
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

async function configFor(room) {
  return { ...DEFAULTS, ...((await store.get(`room:${room}`)) || {}) };
}

module.exports = { ROOMS, configFor, DEFAULTS };
