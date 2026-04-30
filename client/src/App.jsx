import React, { useState, useEffect, useRef } from 'react';
import socket from './socket';
import mediasoupService from './MediasoupService';

function App() {
  const [joined, setJoined] = useState(false);
  const [nickname, setNickname] = useState('');
  const [roomId, setRoomId] = useState('main');
  const [peers, setPeers] = useState([]); // [{ peerId, nickname, isSpeaking }]
  const [isMuted, setIsMuted] = useState(false);
  const [activeSpeaker, setActiveSpeaker] = useState(null);

  const localStreamRef = useRef(null);
  const remoteAudiosRef = useRef({});

  useEffect(() => {
    socket.on('peerJoined', ({ peerId, nickname }) => {
      setPeers(prev => [...prev, { peerId, nickname, isSpeaking: false }]);
    });

    socket.on('peerLeft', ({ peerId }) => {
      setPeers(prev => prev.filter(p => p.peerId !== peerId));
      if (remoteAudiosRef.current[peerId]) {
        remoteAudiosRef.current[peerId].remove();
        delete remoteAudiosRef.current[peerId];
      }
    });

    socket.on('newProducer', async ({ peerId, producerId }) => {
      await consumeProducer(producerId, peerId);
    });

    socket.on('activeSpeaker', ({ peerId }) => {
      setActiveSpeaker(peerId);
    });

    return () => {
      socket.off('peerJoined');
      socket.off('peerLeft');
      socket.off('newProducer');
      socket.off('activeSpeaker');
    };
  }, []);

  const consumeProducer = async (producerId, peerId) => {
    await mediasoupService.consume(producerId, peerId, (track) => {
      const stream = new MediaStream([track]);
      const audio = new Audio();
      audio.srcObject = stream;
      audio.play().catch(e => console.error('Audio play failed', e));
      remoteAudiosRef.current[peerId] = audio;
    });
  };

  const join = async () => {
    if (!nickname) return alert('Введите никнейм');
    socket.connect();
    const { peers: initialPeers } = await mediasoupService.joinRoom(roomId, nickname);
    setPeers(initialPeers.map(p => ({ peerId: p.peerId, nickname: p.nickname, isSpeaking: false })));

    await mediasoupService.createSendTransport();
    await mediasoupService.createRecvTransport();

    // Consume existing producers
    for (const peer of initialPeers) {
      if (peer.producers) {
        for (const producer of peer.producers) {
          await consumeProducer(producer.producerId, peer.peerId);
        }
      }
    }

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    localStreamRef.current = stream;
    const track = stream.getAudioTracks()[0];
    await mediasoupService.produceAudio(track);

    setJoined(true);
  };

  const toggleMute = () => {
    if (localStreamRef.current) {
      const track = localStreamRef.current.getAudioTracks()[0];
      track.enabled = !track.enabled;
      setIsMuted(!track.enabled);
    }
  };

  if (!joined) {
    return (
      <div style={{ padding: '20px', textAlign: 'center', fontFamily: 'sans-serif' }}>
        <h1>Uncord - Голосовой чат</h1>
        <input
          placeholder="Никнейм"
          value={nickname}
          onChange={e => setNickname(e.target.value)}
          style={{ marginBottom: '10px', padding: '8px', width: '200px' }}
        /><br/>
        <input
          placeholder="ID Комнаты"
          value={roomId}
          onChange={e => setRoomId(e.target.value)}
          style={{ marginBottom: '10px', padding: '8px', width: '200px' }}
        /><br/>
        <button onClick={join} style={{ padding: '10px 20px', cursor: 'pointer' }}>Войти</button>
      </div>
    );
  }

  return (
    <div style={{ padding: '20px', fontFamily: 'sans-serif' }}>
      <h1>Комната: {roomId}</h1>
      <div style={{ marginBottom: '20px', border: '1px solid #ccc', padding: '10px', borderRadius: '8px' }}>
        <h3>Участники:</h3>
        <ul style={{ listStyle: 'none', padding: 0 }}>
          <li style={{
            padding: '5px',
            color: activeSpeaker === socket.id ? '#2ecc71' : '#2c3e50',
            fontWeight: activeSpeaker === socket.id ? 'bold' : 'normal',
            borderLeft: activeSpeaker === socket.id ? '4px solid #2ecc71' : '4px solid transparent'
          }}>
            {nickname} (Вы) {isMuted ? ' [ВЫКЛ МИКР]' : ''}
          </li>
          {peers.map(p => (
            <li key={p.peerId} style={{
              padding: '5px',
              color: activeSpeaker === p.peerId ? '#2ecc71' : '#2c3e50',
              fontWeight: activeSpeaker === p.peerId ? 'bold' : 'normal',
              borderLeft: activeSpeaker === p.peerId ? '4px solid #2ecc71' : '4px solid transparent'
            }}>
              {p.nickname}
            </li>
          ))}
        </ul>
      </div>
      <button onClick={toggleMute} style={{
        padding: '10px 20px',
        backgroundColor: isMuted ? '#e74c3c' : '#3498db',
        color: 'white',
        border: 'none',
        borderRadius: '5px',
        cursor: 'pointer'
      }}>
        {isMuted ? 'Включить микрофон' : 'Выключить микрофон'}
      </button>
    </div>
  );
}

export default App;
