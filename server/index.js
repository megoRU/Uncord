const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mediasoup = require('mediasoup');
const config = require('./config');
const cors = require('cors');

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

let worker;
const rooms = new Map(); // roomId -> { router, audioLevelObserver, participants: Map(socketId -> { nickname, transports, producers, consumers }) }

async function createWorker() {
  worker = await mediasoup.createWorker(config.mediasoup.worker);
  worker.on('died', () => {
    console.error('mediasoup worker died, exiting in 2 seconds...');
    setTimeout(() => process.exit(1), 2000);
  });
  console.log('mediasoup worker created');
}

createWorker();

async function createWebRtcTransport(router) {
  const transport = await router.createWebRtcTransport(config.mediasoup.webRtcTransport);

  transport.on('dtlsstatechange', (dtlsState) => {
    if (dtlsState === 'closed') transport.close();
  });

  return {
    transport,
    params: {
      id: transport.id,
      iceParameters: transport.iceParameters,
      iceCandidates: transport.iceCandidates,
      dtlsParameters: transport.dtlsParameters,
    },
  };
}

io.on('connection', (socket) => {
  console.log('New connection:', socket.id);

  socket.on('joinRoom', async ({ roomId, nickname }, callback) => {
    console.log(`User ${nickname} (${socket.id}) joining room ${roomId}`);

    let room = rooms.get(roomId);
    if (!room) {
      const router = await worker.createRouter(config.mediasoup.router);
      const audioLevelObserver = await router.createAudioLevelObserver({
        interval: 300,
        threshold: -70,
      });

      audioLevelObserver.on('volumes', (volumes) => {
        const { producer } = volumes[0];
        for (const [peerId, peerData] of room.participants) {
          if (peerData.producers.has(producer.id)) {
            io.to(roomId).emit('activeSpeaker', { peerId, nickname: peerData.nickname });
            break;
          }
        }
      });

      audioLevelObserver.on('silence', () => {
        io.to(roomId).emit('activeSpeaker', { peerId: null });
      });

      room = {
        router,
        audioLevelObserver,
        participants: new Map()
      };
      rooms.set(roomId, room);
    }

    room.participants.set(socket.id, {
      nickname,
      transports: new Map(),
      producers: new Map(),
      consumers: new Map(),
      roomId
    });

    socket.join(roomId);

    socket.to(roomId).emit('peerJoined', { peerId: socket.id, nickname });

    const peerList = [];
    for (const [id, data] of room.participants) {
      if (id !== socket.id) {
        // Collect existing producers to inform the new user
        const producers = [];
        data.producers.forEach(p => {
          producers.push({ producerId: p.id, kind: p.kind });
        });
        peerList.push({ peerId: id, nickname: data.nickname, producers });
      }
    }

    callback({ rtpCapabilities: room.router.rtpCapabilities, peers: peerList });
  });

  socket.on('createTransport', async (_, callback) => {
    const peer = Array.from(rooms.values()).find(r => r.participants.has(socket.id))?.participants.get(socket.id);
    const room = rooms.get(peer?.roomId);
    if (!room) return;

    const { transport, params } = await createWebRtcTransport(room.router);
    peer.transports.set(transport.id, transport);
    callback(params);
  });

  socket.on('connectTransport', async ({ transportId, dtlsParameters }, callback) => {
    const peer = Array.from(rooms.values()).find(r => r.participants.has(socket.id))?.participants.get(socket.id);
    const transport = peer?.transports.get(transportId);
    if (transport) {
      await transport.connect({ dtlsParameters });
      callback();
    }
  });

  socket.on('produce', async ({ transportId, kind, rtpParameters }, callback) => {
    const peer = Array.from(rooms.values()).find(r => r.participants.has(socket.id))?.participants.get(socket.id);
    const room = rooms.get(peer?.roomId);
    const transport = peer?.transports.get(transportId);

    if (transport) {
      const producer = await transport.produce({ kind, rtpParameters });
      peer.producers.set(producer.id, producer);

      if (kind === 'audio') {
        room.audioLevelObserver.addProducer({ producerId: producer.id });
      }

      callback({ id: producer.id });

      socket.to(peer.roomId).emit('newProducer', { peerId: socket.id, producerId: producer.id, kind });
    }
  });

  socket.on('consume', async ({ transportId, producerId, rtpCapabilities }, callback) => {
    const peer = Array.from(rooms.values()).find(r => r.participants.has(socket.id))?.participants.get(socket.id);
    const room = rooms.get(peer?.roomId);
    const transport = peer?.transports.get(transportId);

    if (room && room.router.canConsume({ producerId, rtpCapabilities })) {
      const consumer = await transport.consume({
        producerId,
        rtpCapabilities,
        paused: true,
      });

      peer.consumers.set(consumer.id, consumer);

      consumer.on('transportclose', () => {
        peer.consumers.delete(consumer.id);
      });

      callback({
        id: consumer.id,
        producerId,
        kind: consumer.kind,
        rtpParameters: consumer.rtpParameters,
      });
    }
  });

  socket.on('resumeConsumer', async ({ consumerId }) => {
    const peer = Array.from(rooms.values()).find(r => r.participants.has(socket.id))?.participants.get(socket.id);
    const consumer = peer?.consumers.get(consumerId);
    if (consumer) {
      await consumer.resume();
    }
  });

  socket.on('disconnect', () => {
    console.log('Socket disconnected:', socket.id);
    for (const [roomId, room] of rooms) {
      if (room.participants.has(socket.id)) {
        const peer = room.participants.get(socket.id);
        peer.transports.forEach(t => t.close());
        peer.producers.forEach(p => p.close());
        peer.consumers.forEach(c => c.close());

        room.participants.delete(socket.id);
        socket.to(roomId).emit('peerLeft', { peerId: socket.id });

        if (room.participants.size === 0) {
          room.router.close();
          rooms.delete(roomId);
        }
        break;
      }
    }
  });
});

const PORT = config.listenPort || 3000;
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
