/** Records what the master bus plays. */
export class Recorder {
  private rec: MediaRecorder | null = null;
  private dest: MediaStreamAudioDestinationNode;
  private chunks: Blob[] = [];
  private started = 0;

  constructor(
    private ctx: AudioContext,
    source: AudioNode,
  ) {
    this.dest = ctx.createMediaStreamDestination();
    source.connect(this.dest);
  }

  get mime() {
    const types = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4'];
    return types.find((t) => MediaRecorder.isTypeSupported(t)) ?? '';
  }

  get active() {
    return this.rec?.state === 'recording';
  }

  start() {
    this.chunks = [];
    this.rec = new MediaRecorder(this.dest.stream, this.mime ? { mimeType: this.mime } : undefined);
    this.rec.ondataavailable = (e) => e.data.size && this.chunks.push(e.data);
    this.rec.start(250);
    this.started = this.ctx.currentTime;
  }

  stop(): Promise<{ blob: Blob; seconds: number } | null> {
    const r = this.rec;
    if (!r || r.state === 'inactive') return Promise.resolve(null);
    const seconds = this.ctx.currentTime - this.started;
    return new Promise((resolve) => {
      r.onstop = () => resolve({ blob: new Blob(this.chunks, { type: r.mimeType }), seconds });
      r.stop();
    });
  }
}
