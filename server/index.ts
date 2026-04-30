import express from 'express';
import http from 'http';
import { Server, Socket } from 'socket.io';
import * as mediasoup from 'mediasoup';
import config from './config.js';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import sequelize from './database.js';
import { User, Guild, Room } from './models/index.js';
import {
  Worker,
  Router,
  AudioLevelObserver,
  WebRtcTransport,
  Producer,
  Consumer,
  RtpCapabilities,
  DtlsParameters,
  MediaKind,
  RtpParameters
} from 'mediasoup/node/lib/types.js';

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

let worker: Worker;

interface Participant {
  nickname: string;
  transports: Map<string, WebRtcTransport>;
  producers: Map<string, Producer>;
  consumers: Map<string, Consumer>;
  roomId: string;
}

interface RoomData {
  router: Router;
  audioLevelObserver: AudioLevelObserver;
  participants: Map<string, Participant>;
}

const rooms = new Map<string, RoomData>(); // roomId -> { router, audioLevelObserver, participants: Map(socketId -> Participant) }
const onlineUsers = new Map<string, { userId: number; username: string }>(); // socketId -> { userId, username }

function broadcastOnlineUsers() {
  const uniqueUsers = new Map<number, { userId: number; username: string }>();
  for (const user of onlineUsers.values()) {
    uniqueUsers.set(user.userId, user);
  }
  io.emit('onlineUsersUpdate', Array.from(uniqueUsers.values()));
}

async function createWorker() {
  worker = await mediasoup.createWorker(config.mediasoup.worker);
  worker.on('died', () => {
    console.error('mediasoup worker died, exiting in 2 seconds...');
    setTimeout(() => process.exit(1), 2000);
  });
  console.log('mediasoup worker created');
}

async function initDB() {
  await sequelize.sync();
  console.log('Database synced');
}

initDB();
createWorker();

async function createWebRtcTransport(router: Router) {
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

interface CustomSocket extends Socket {
  userId?: number;
  username?: string;
}

io.on('connection', (socket: CustomSocket) => {
  console.log('New connection:', socket.id);

  socket.on('register', async ({ username, password }, callback: (res: any) => void) => {
    try {
      const hashedPassword = await bcrypt.hash(password, 10);
      const user = await User.create({ username, password: hashedPassword });

      socket.userId = user.id;
      socket.username = user.username;
      onlineUsers.set(socket.id, { userId: user.id, username: user.username });
      broadcastOnlineUsers();

      callback({ success: true, user: { id: user.id, username: user.username } });
    } catch (error) {
      console.error('Registration error:', error);
      callback({ success: false, error: 'User already exists or other error' });
    }
  });

  socket.on('login', async ({ username, password, autoLogin }, callback: (res: any) => void) => {
    try {
      const user = await User.findOne({ where: { username } });
      if (user && (autoLogin || (password && await bcrypt.compare(password, user.password)))) {
        socket.userId = user.id;
        socket.username = user.username;
        onlineUsers.set(socket.id, { userId: user.id, username: user.username });
        broadcastOnlineUsers();
        callback({ success: true, user: { id: user.id, username: user.username } });
      } else {
        callback({ success: false, error: 'Invalid credentials' });
      }
    } catch (error) {
      console.error('Login error:', error);
      callback({ success: false, error: 'Login failed' });
    }
  });

  socket.on('createGuild', async ({ name }, callback: (res: any) => void) => {
    if (!socket.userId) return callback({ success: false, error: 'Unauthorized' });
    try {
      const guild = await Guild.create({ name, ownerId: socket.userId });
      // Create a default room for the guild
      await Room.create({ name: 'Общий', guildId: guild.id });
      callback({ success: true, guild });
    } catch (error) {
      callback({ success: false, error: 'Failed to create guild' });
    }
  });

  socket.on('getGuilds', async (callback: (res: any) => void) => {
    try {
      const guilds = await Guild.findAll();
      callback({ success: true, guilds });
    } catch (error) {
      callback({ success: false, error: 'Failed to get guilds' });
    }
  });

  socket.on('createRoom', async ({ name, guildId }, callback: (res: any) => void) => {
    if (!socket.userId) return callback({ success: false, error: 'Unauthorized' });
    try {
      const room = await Room.create({ name, guildId });
      callback({ success: true, room });
    } catch (error) {
      callback({ success: false, error: 'Failed to create room' });
    }
  });

  socket.on('getRooms', async ({ guildId }, callback: (res: any) => void) => {
    try {
      const roomsList = await Room.findAll({ where: { guildId } });
      callback({ success: true, rooms: roomsList });
    } catch (error) {
      callback({ success: false, error: 'Failed to get rooms' });
    }
  });

  socket.on('joinRoom', async ({ roomId, nickname }, callback: (res: any) => void) => {
    roomId = String(roomId);
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
        const currentRoom = rooms.get(roomId);
        if (!currentRoom) return;

        for (const [peerId, peerData] of currentRoom.participants) {
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

    const peerList: any[] = [];
    for (const [id, data] of room.participants) {
      if (id !== socket.id) {
        // Collect existing producers to inform the new user
        const producers: any[] = [];
        data.producers.forEach(p => {
          producers.push({ producerId: p.id, kind: p.kind });
        });
        peerList.push({ peerId: id, nickname: data.nickname, producers });
      }
    }

    callback({ rtpCapabilities: room.router.rtpCapabilities, peers: peerList });
  });

  socket.on('createTransport', async (_, callback: (res: any) => void) => {
    const peer = Array.from(rooms.values()).find(r => r.participants.has(socket.id))?.participants.get(socket.id);
    const room = rooms.get(peer?.roomId || '');
    if (!room) return;

    const { transport, params } = await createWebRtcTransport(room.router);
    peer?.transports.set(transport.id, transport);
    callback(params);
  });

  socket.on('connectTransport', async ({ transportId, dtlsParameters }: { transportId: string; dtlsParameters: DtlsParameters }, callback: () => void) => {
    const peer = Array.from(rooms.values()).find(r => r.participants.has(socket.id))?.participants.get(socket.id);
    const transport = peer?.transports.get(transportId);
    if (transport) {
      await transport.connect({ dtlsParameters });
      callback();
    }
  });

  socket.on('produce', async ({ transportId, kind, rtpParameters }: { transportId: string; kind: MediaKind; rtpParameters: RtpParameters }, callback: (res: any) => void) => {
    const peer = Array.from(rooms.values()).find(r => r.participants.has(socket.id))?.participants.get(socket.id);
    const room = rooms.get(peer?.roomId || '');
    const transport = peer?.transports.get(transportId);

    if (transport && room && peer) {
      const producer = await transport.produce({ kind, rtpParameters });
      peer.producers.set(producer.id, producer);

      if (kind === 'audio') {
        room.audioLevelObserver.addProducer({ producerId: producer.id });
      }

      callback({ id: producer.id });

      socket.to(peer.roomId).emit('newProducer', { peerId: socket.id, producerId: producer.id, kind });
    }
  });

  socket.on('consume', async ({ transportId, producerId, rtpCapabilities }: { transportId: string; producerId: string; rtpCapabilities: RtpCapabilities }, callback: (res: any) => void) => {
    const peer = Array.from(rooms.values()).find(r => r.participants.has(socket.id))?.participants.get(socket.id);
    const room = rooms.get(peer?.roomId || '');
    const transport = peer?.transports.get(transportId);

    if (room && transport && room.router.canConsume({ producerId, rtpCapabilities })) {
      const consumer = await transport.consume({
        producerId,
        rtpCapabilities,
        paused: true,
      });

      peer?.consumers.set(consumer.id, consumer);

      consumer.on('transportclose', () => {
        peer?.consumers.delete(consumer.id);
      });

      callback({
        id: consumer.id,
        producerId,
        kind: consumer.kind,
        rtpParameters: consumer.rtpParameters,
      });
    }
  });

  socket.on('resumeConsumer', async ({ consumerId }: { consumerId: string }) => {
    const peer = Array.from(rooms.values()).find(r => r.participants.has(socket.id))?.participants.get(socket.id);
    const consumer = peer?.consumers.get(consumerId);
    if (consumer) {
      await consumer.resume();
    }
  });

  socket.on('getOnlineUsers', (callback: (res: any) => void) => {
    callback(Array.from(onlineUsers.values()));
  });

  socket.on('ping', (callback: () => void) => {
    callback();
  });

  socket.on('disconnect', () => {
    console.log('Socket disconnected:', socket.id);
    onlineUsers.delete(socket.id);
    broadcastOnlineUsers();
    for (const [roomId, room] of rooms) {
      if (room.participants.has(socket.id)) {
        const peer = room.participants.get(socket.id);
        if (peer) {
          peer.transports.forEach(t => t.close());
          peer.producers.forEach(p => p.close());
          peer.consumers.forEach(c => c.close());
        }

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
