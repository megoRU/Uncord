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
          channels: 1, // Моно для голоса достаточно
          parameters: {
            'useinbandfec': 1,
            'usedtx': 1,
            'maxaveragebitrate': 96000, // 96kbps моно - это очень высокое качество
            'cbr': 0, // Variable bitrate для эффективности
          },
        },
      ],
    },
    // WebRtcTransport settings
    webRtcTransport: {
      listenIps: [
        {
          ip: '127.0.0.1',
          announcedIp: '127.0.0.1',
        },
      ],
      enableUdp: true,
      enableTcp: true,
      preferUdp: true,
      initialAvailableOutgoingBitrate: 1000000,
      minimumAvailableOutgoingBitrate: 600000,
      maxSctpMessageSize: 262144,
    },
  },
};

export default config;
