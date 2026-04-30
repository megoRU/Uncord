import { WorkerLogLevel, WorkerLogTag, RtpCodecCapability, TransportListenIp } from 'mediasoup/node/lib/types.js';

interface MediasoupConfig {
  worker: {
    rtcMinPort: number;
    rtcMaxPort: number;
    logLevel: WorkerLogLevel;
    logTags: WorkerLogTag[];
  };
  router: {
    mediaCodecs: RtpCodecCapability[];
  };
  webRtcTransport: {
    listenIps: TransportListenIp[];
    initialAvailableOutgoingBitrate: number;
    minimumAvailableOutgoingBitrate: number;
    maxSctpMessageSize: number;
  };
}

interface Config {
  listenIp: string;
  listenPort: number;
  mediasoup: MediasoupConfig;
}

const config: Config = {
  listenIp: '127.0.0.1',
  listenPort: 3000,
  mediasoup: {
    // Worker settings
    worker: {
      rtcMinPort: 10000,
      rtcMaxPort: 10100,
      logLevel: 'warn',
      logTags: [
        'info',
        'ice',
        'dtls',
        'rtp',
        'srtp',
        'rtcp',
      ],
    },
    // Router settings
    router: {
      mediaCodecs: [
        {
          kind: 'audio',
          mimeType: 'audio/opus',
          clockRate: 48000,
          channels: 2,
        },
      ],
    },
    // WebRtcTransport settings
    webRtcTransport: {
      listenIps: [
        {
          ip: '127.0.0.1',
          announcedIp: undefined,
        },
      ],
      initialAvailableOutgoingBitrate: 1000000,
      minimumAvailableOutgoingBitrate: 600000,
      maxSctpMessageSize: 262144,
    },
  },
};

export default config;
