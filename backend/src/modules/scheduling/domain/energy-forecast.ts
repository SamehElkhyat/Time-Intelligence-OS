/**
 * Hour-by-hour expectation of the user's energy and focus.
 *
 * Sources, in order of trust:
 *   LOGGED    — averages of the user's own energy check-ins around that hour
 *   DECLARED  — the focus window the user declared in preferences
 *   UNKNOWN   — nothing to go on. We return null instead of assuming a "typical" rhythm.
 */
export interface EnergySample {
  /** Local hour 0..23 at which the check-in was recorded. */
  hour: number;
  /** 1..5 */
  energy: number;
  focus: number;
}

export interface HourExpectation {
  hour: number;
  energy: number | null;
  focus: number | null;
  source: 'LOGGED' | 'DECLARED' | 'UNKNOWN';
  samples: number;
}

export interface EnergyForecast {
  hours: HourExpectation[];
  /** Total check-ins the forecast is built from. */
  sampleSize: number;
  /** 0..100 */
  confidence: number;
}

const MIN_SAMPLES_PER_HOUR = 3;
const round1 = (n: number): number => Math.round(n * 10) / 10;

export function forecastEnergy(
  samples: readonly EnergySample[],
  declaredPeak: { startMinute: number; endMinute: number } | null,
): EnergyForecast {
  const hours: HourExpectation[] = [];
  for (let hour = 0; hour < 24; hour++) {
    // Triangular smoothing over the neighbouring hours (weights 1-2-1) to tolerate sparse logs.
    let wSum = 0;
    let eSum = 0;
    let fSum = 0;
    let n = 0;
    for (const s of samples) {
      const dist = Math.min(Math.abs(s.hour - hour), 24 - Math.abs(s.hour - hour));
      if (dist > 1) continue;
      const w = dist === 0 ? 2 : 1;
      wSum += w;
      eSum += w * s.energy;
      fSum += w * s.focus;
      n++;
    }
    if (n >= MIN_SAMPLES_PER_HOUR) {
      hours.push({ hour, energy: round1(eSum / wSum), focus: round1(fSum / wSum), source: 'LOGGED', samples: n });
      continue;
    }
    if (declaredPeak) {
      const startH = declaredPeak.startMinute / 60;
      const endH = declaredPeak.endMinute / 60;
      const inPeak = hour + 0.5 >= startH && hour + 0.5 < endH;
      hours.push({ hour, energy: inPeak ? 4 : 3, focus: inPeak ? 4 : 3, source: 'DECLARED', samples: n });
      continue;
    }
    hours.push({ hour, energy: null, focus: null, source: 'UNKNOWN', samples: n });
  }
  const logged = hours.filter((h) => h.source === 'LOGGED').length;
  const confidence = Math.min(95, Math.round((logged / 16) * 60 + Math.min(40, samples.length)));
  return { hours, sampleSize: samples.length, confidence: samples.length === 0 ? (declaredPeak ? 25 : 0) : confidence };
}
