import * as mediasoupClient from 'mediasoup-client';
import socket from './socket';
import {
  Device,
  Transport,
  Producer,
  Consumer,
  RtpCapabilities,
  TransportOptions,
  ProducerOptions,
  ConsumerOptions
} from 'mediasoup-client/lib/types';

interface JoinRoomResponse {
  rtpCapabilities: RtpCapabilities;
  peers: {
    peerId: string;
    nickname: string;
    producers: { producerId: string; kind: 'audio' | 'video' }[];
  }[];
}

class MediasoupService {
  private device: Device | null = null;
  private sendTransport: Transport | null = null;
  private recvTransport: Transport | null = null;
  private producers: Map<string, Producer> = new Map();
  private consumers: Map<string, Consumer> = new Map();

  async joinRoom(roomId: number | string, nickname: string): Promise<JoinRoomResponse> {
    return new Promise((resolve) => {
      socket.emit('joinRoom', { roomId, nickname }, async (data: JoinRoomResponse) => {
        const { rtpCapabilities } = data;
        await this.loadDevice(rtpCapabilities);
        resolve(data);
      });
    });
  }

  async loadDevice(rtpCapabilities: RtpCapabilities) {
    try {
      this.device = new mediasoupClient.Device();
      await this.device.load({ routerRtpCapabilities: rtpCapabilities });
    } catch (error) {
      console.error('loadDevice failed', error);
    }
  }

  async createSendTransport(): Promise<void> {
    return new Promise((resolve) => {
      socket.emit('createTransport', {}, async (params: TransportOptions) => {
        if (!this.device) return;
        this.sendTransport = this.device.createSendTransport(params);

        this.sendTransport.on('connect', ({ dtlsParameters }, callback, _errback) => {
          socket.emit('connectTransport', { transportId: this.sendTransport?.id, dtlsParameters }, () => {
            callback();
          });
        });

        this.sendTransport.on('produce', ({ kind, rtpParameters }, callback, _errback) => {
          socket.emit('produce', { transportId: this.sendTransport?.id, kind, rtpParameters }, ({ id }: { id: string }) => {
            callback({ id });
          });
        });

        resolve();
      });
    });
  }

  async createRecvTransport(): Promise<void> {
    return new Promise((resolve) => {
      socket.emit('createTransport', {}, async (params: TransportOptions) => {
        if (!this.device) return;
        this.recvTransport = this.device.createRecvTransport(params);

        this.recvTransport.on('connect', ({ dtlsParameters }, callback, _errback) => {
          socket.emit('connectTransport', { transportId: this.recvTransport?.id, dtlsParameters }, () => {
            callback();
          });
        });

        resolve();
      });
    });
  }

  async produceAudio(track: MediaStreamTrack) {
    if (!this.sendTransport) return;
    const producer = await this.sendTransport.produce({ track });
    this.producers.set(producer.id, producer);
    return producer;
  }

  async consume(producerId: string, _peerId: string, callback: (track: MediaStreamTrack) => void) {
    if (!this.recvTransport || !this.device) return;
    socket.emit('consume', {
      transportId: this.recvTransport.id,
      producerId,
      rtpCapabilities: this.device.rtpCapabilities
    }, async (params: ConsumerOptions) => {
      if (!this.recvTransport) return;
      const consumer = await this.recvTransport.consume(params);
      this.consumers.set(consumer.id, consumer);

      socket.emit('resumeConsumer', { consumerId: consumer.id });

      callback(consumer.track);
    });
  }
}

export default new MediasoupService();
