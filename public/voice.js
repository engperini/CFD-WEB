export class PushToTalkRecorder {
  constructor() {
    this.stream = null;
    this.recorder = null;
    this.chunks = [];
    this.stopPromise = null;
  }

  async start() {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("Este navegador não oferece acesso ao microfone.");
    }
    if (this.recorder?.state === "recording") return;

    this.stream ||= await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      }
    });

    const mimeType = selectMimeType();
    this.chunks = [];
    this.recorder = mimeType
      ? new MediaRecorder(this.stream, { mimeType })
      : new MediaRecorder(this.stream);

    this.recorder.addEventListener("dataavailable", (event) => {
      if (event.data.size > 0) this.chunks.push(event.data);
    });

    this.stopPromise = new Promise((resolve, reject) => {
      this.recorder.addEventListener(
        "stop",
        () => {
          const blob = new Blob(this.chunks, {
            type: this.recorder.mimeType || mimeType || "audio/webm"
          });
          resolve(blob);
        },
        { once: true }
      );
      this.recorder.addEventListener("error", () => reject(new Error("Falha na gravação.")), {
        once: true
      });
    });

    this.recorder.start(250);
  }

  async stop() {
    if (!this.recorder || this.recorder.state !== "recording") return null;
    this.recorder.stop();
    return this.stopPromise;
  }

  cancel() {
    if (this.recorder?.state === "recording") this.recorder.stop();
    this.chunks = [];
  }
}

export async function blobToBase64(blob) {
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function selectMimeType() {
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/ogg;codecs=opus",
    "audio/mp4",
    "audio/webm"
  ];
  return candidates.find((candidate) => MediaRecorder.isTypeSupported(candidate)) || "";
}
