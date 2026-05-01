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
        console.log('Creating send transport with params:', params);
        this.sendTransport = this.device.createSendTransport(params);

        this.sendTransport.on('connect', ({ dtlsParameters }, callback, _errback) => {
          socket.emit('connectTransport', { transportId: this.sendTransport?.id, dtlsParameters }, () => {
            callback();
          });
        });

        this.sendTransport.on('produce', ({ kind, rtpParameters }, callback, _errback) => {
          console.log('Transport produce event:', kind);
          socket.emit('produce', { transportId: this.sendTransport?.id, kind, rtpParameters }, ({ id }: { id: string }) => {
            console.log('Producer created with id:', id);
            callback({ id });
          });
        });

        this.sendTransport.on('connectionstatechange', (state) => {
          console.log('Send transport connection state change:', state);
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

        this.recvTransport.on('connectionstatechange', (state) => {
          console.log('Recv transport connection state change:', state);
        });

        resolve();
      });
    });
  }

  async produceAudio(track: MediaStreamTrack, paused: boolean = false) {
    if (!this.sendTransport) return;
    const producer = await this.sendTransport.produce({ track, appData: { paused } });

    if (paused) {
      await producer.pause();
    }

    this.producers.set(producer.id, producer);
    return producer;
  }

  async pauseProducer(producerId?: string) {
    if (producerId) {
      const producer = this.producers.get(producerId);
      if (producer && !producer.paused) {
        await producer.pause();
        producer.track!.enabled = false;
      }
    } else {
      for (const producer of this.producers.values()) {
        if (producer.kind === 'audio' && !producer.paused) {
          await producer.pause();
          producer.track!.enabled = false;
        }
      }
    }
  }

  async resumeProducer(producerId?: string) {
    if (producerId) {
      const producer = this.producers.get(producerId);
      if (producer && producer.paused) {
        producer.track!.enabled = true;
        await producer.resume();
      }
    } else {
      for (const producer of this.producers.values()) {
        if (producer.kind === 'audio' && producer.paused) {
          producer.track!.enabled = true;
          await producer.resume();
        }
      }
    }
  }

  async consume(producerId: string, _peerId: string): Promise<MediaStreamTrack> {
    return new Promise((resolve, reject) => {
      if (!this.recvTransport || !this.device) {
        return reject(new Error('Transport or Device not initialized'));
      }

      socket.emit('consume', {
        transportId: this.recvTransport.id,
        producerId,
        rtpCapabilities: this.device.rtpCapabilities
      }, async (params: any) => {
        if (params.error) {
          console.error('Consume error:', params.error);
          return reject(new Error(params.error));
        }

        if (!this.recvTransport) return reject(new Error('Transport closed'));

        try {
          const consumer = await this.recvTransport.consume(params);
          this.consumers.set(consumer.id, consumer);

          socket.emit('resumeConsumer', { consumerId: consumer.id });
          resolve(consumer.track);
        } catch (error) {
          console.error('recvTransport.consume failed:', error);
          reject(error);
        }
      });
    });
  }

  async leaveRoom() {
    this.producers.forEach(p => p.close());
    this.consumers.forEach(c => c.close());
    if (this.sendTransport) this.sendTransport.close();
    if (this.recvTransport) this.recvTransport.close();
    this.producers.clear();
    this.consumers.clear();
    this.sendTransport = null;
    this.recvTransport = null;
    this.device = null;
  }
}

export default new MediasoupService();
