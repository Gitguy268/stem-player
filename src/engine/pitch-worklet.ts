/**
 * Two-tap granular pitch shifter. The source is a plain string so it can be
 * loaded from a Blob URL with no extra build step.
 */
export const PITCH_WORKLET = `
class PitchShift extends AudioWorkletProcessor {
  static get parameterDescriptors() { return [{ name: 'ratio', defaultValue: 1, minValue: 0.25, maxValue: 4, automationRate: 'k-rate' }]; }
  constructor() {
    super();
    this.size = 4096; this.buf = [new Float32Array(this.size * 2), new Float32Array(this.size * 2)];
    this.w = 0; this.phase = 0;
  }
  process(inputs, outputs, params) {
    const input = inputs[0], output = outputs[0], ratio = params.ratio[0];
    const n = output[0].length, size = this.size, len = size * 2;
    if (ratio === 1) {
      for (let c = 0; c < output.length; c++) { const i = input[c] || input[0]; if (i) output[c].set(i); else output[c].fill(0); }
      return true;
    }
    const step = (1 - ratio) / size;
    for (let s = 0; s < n; s++) {
      for (let c = 0; c < 2; c++) { const i = input[c] || input[0]; this.buf[c][this.w] = i ? i[s] : 0; }
      for (let c = 0; c < output.length; c++) {
        let sum = 0;
        for (let tap = 0; tap < 2; tap++) {
          const p = (this.phase + tap / 2) % 1;
          const d = p * size;
          const pos = (this.w - d + len) % len;
          const a = Math.floor(pos), f = pos - a;
          const v = this.buf[c][a] * (1 - f) + this.buf[c][(a + 1) % len] * f;
          sum += v * Math.sin(Math.PI * p);
        }
        output[c][s] = sum;
      }
      this.w = (this.w + 1) % len;
      this.phase = (this.phase + step + 1) % 1;
    }
    return true;
  }
}
registerProcessor('pitch-shift', PitchShift);
`;
