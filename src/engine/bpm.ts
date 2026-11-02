/** Onset-autocorrelation tempo estimate over a mono signal, folded into 70-180 BPM. */
export function estimateBpm(signal: Float32Array, sampleRate: number): number {
  const hop = Math.round(sampleRate / 100);
  const frames = Math.floor(signal.length / hop);
  if (frames < 300) return 120;
  const env = new Float32Array(frames);
  let prev = 0;
  for (let f = 0; f < frames; f++) {
    let sum = 0;
    for (let i = 0; i < hop; i++) sum += Math.abs(signal[f * hop + i]);
    const e = Math.log1p(sum);
    env[f] = Math.max(0, e - prev);
    prev = e;
  }
  const minLag = Math.round((60 / 180) * 100);
  const maxLag = Math.round((60 / 70) * 100);
  let best = minLag;
  let bestScore = -Infinity;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let s = 0;
    for (let i = 0; i + lag < frames; i++) s += env[i] * env[i + lag];
    // Mild preference for moderate tempi avoids locking on to half-time.
    const bpm = 6000 / lag;
    s *= Math.exp(-Math.pow(Math.log2(bpm / 120), 2));
    if (s > bestScore) {
      bestScore = s;
      best = lag;
    }
  }
  return Math.round((6000 / best) * 10) / 10;
}
