import * as mediasoupClient from 'mediasoup-client';
import socket from './socket';

class MediasoupService {
  constructor() {
    this.device = null;
    this.sendTransport = null;
    this.recvTransport = null;
    this.producers = new Map();
    this.consumers = new Map();
  }

  async joinRoom(roomId, nickname) {
    return new Promise((resolve) => {
      socket.emit('joinRoom', { roomId, nickname }, async (data) => {
        const { rtpCapabilities } = data;
        await this.loadDevice(rtpCapabilities);
        resolve(data);
      });
    });
  }

  async loadDevice(rtpCapabilities) {
    try {
      this.device = new mediasoupClient.Device();
      await this.device.load({ routerRtpCapabilities: rtpCapabilities });
    } catch (error) {
      console.error('loadDevice failed', error);
    }
  }

  async createSendTransport() {
    return new Promise((resolve) => {
      socket.emit('createTransport', {}, async (params) => {
        this.sendTransport = this.device.createSendTransport(params);

        this.sendTransport.on('connect', ({ dtlsParameters }, callback, errback) => {
          socket.emit('connectTransport', { transportId: this.sendTransport.id, dtlsParameters }, () => {
            callback();
          });
        });

        this.sendTransport.on('produce', ({ kind, rtpParameters }, callback, errback) => {
          socket.emit('produce', { transportId: this.sendTransport.id, kind, rtpParameters }, ({ id }) => {
            callback({ id });
          });
        });

        resolve();
      });
    });
  }

  async createRecvTransport() {
    return new Promise((resolve) => {
      socket.emit('createTransport', {}, async (params) => {
        this.recvTransport = this.device.createRecvTransport(params);

        this.recvTransport.on('connect', ({ dtlsParameters }, callback, errback) => {
          socket.emit('connectTransport', { transportId: this.recvTransport.id, dtlsParameters }, () => {
            callback();
          });
        });

        resolve();
      });
    });
  }

  async produceAudio(track) {
    const producer = await this.sendTransport.produce({ track });
    this.producers.set(producer.id, producer);
    return producer;
  }

  async consume(producerId, peerId, callback) {
    socket.emit('consume', {
      transportId: this.recvTransport.id,
      producerId,
      rtpCapabilities: this.device.rtpCapabilities
    }, async (params) => {
      const consumer = await this.recvTransport.consume(params);
      this.consumers.set(consumer.id, consumer);

      socket.emit('resumeConsumer', { consumerId: consumer.id });

      callback(consumer.track);
    });
  }
}

export default new MediasoupService();
