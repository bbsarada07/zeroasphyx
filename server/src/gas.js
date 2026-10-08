const config = require('./config');

const LABEL = { H2S: 'H₂S', CO: 'CO', CH4: 'CH₄', O2: 'O₂' };

// Returns the list of failing gases for one set of values {h2s, co, ch4, o2}.
// Missing or non-numeric values fail (fail-safe).
function gasFailures(v) {
  const g = config.gas;
  const n = (x) => (x === null || x === undefined || x === '' ? NaN : Number(x));
  const h2s = n(v.h2s), co = n(v.co), ch4 = n(v.ch4), o2 = n(v.o2);
  const fails = [];
  if (!(h2s < g.h2sMax)) fails.push({ gas: 'H2S', value: v.h2s, text: `${LABEL.H2S} ${v.h2s} ppm (must be below ${g.h2sMax} ppm)` });
  if (!(co < g.coMax)) fails.push({ gas: 'CO', value: v.co, text: `${LABEL.CO} ${v.co} ppm (must be below ${g.coMax} ppm)` });
  if (!(ch4 < g.ch4Max)) fails.push({ gas: 'CH4', value: v.ch4, text: `${LABEL.CH4} ${v.ch4} % LEL (must be below ${g.ch4Max} % LEL)` });
  if (!(o2 >= g.o2Min && o2 <= g.o2Max)) {
    fails.push({ gas: 'O2', value: v.o2, text: `${LABEL.O2} ${Number.isFinite(o2) ? (o2 / 10).toFixed(1) : '?'} % (must be ${g.o2Min / 10}–${g.o2Max / 10} %)` });
  }
  return fails;
}

// Worst case across samples: highest H2S/CO/CH4, and the O2 value furthest outside the safe band.
function worstCase(samples) {
  const g = config.gas;
  const nums = (k) => samples.map((s) => Number(s[k]));
  const max = (k) => Math.max(...nums(k));
  const o2s = nums('o2');
  const o2Min = Math.min(...o2s), o2Max = Math.max(...o2s);
  let o2 = o2Min;
  if (!(o2Min < g.o2Min) && o2Max > g.o2Max) o2 = o2Max;
  return { h2s: max('h2s'), co: max('co'), ch4: max('ch4'), o2 };
}

const describeFailures = (fails) => fails.map((f) => f.text).join('; ');

module.exports = { gasFailures, worstCase, describeFailures };
