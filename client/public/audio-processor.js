class VADProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.smoothedVolume = -100;
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    if (input.length > 0) {
      const samples = input[0];
      if (samples.length > 0) {
        let sumSquares = 0;
        for (let i = 0; i < samples.length; i++) {
          sumSquares += samples[i] * samples[i];
        }
        const rms = Math.sqrt(sumSquares / samples.length);
        // Use the same +35dB offset logic as before for consistency
        let db = rms > 0.000001 ? 20 * Math.log10(rms) + 35 : -100;

        if (db < -85) db = -100;
        db = Math.max(-100, Math.min(0, db));

        // Exponential smoothing (asymmetric: fast attack, slower decay)
        const alpha = db > this.smoothedVolume ? 0.4 : 0.12;
        this.smoothedVolume = this.smoothedVolume * (1 - alpha) + db * alpha;

        this.port.postMessage({
          volume: Math.round(this.smoothedVolume)
        });
      }
    }
    return true;
  }
}

registerProcessor('vad-processor', VADProcessor);
