import React, { useState, useEffect, useRef } from 'react';
import socket from './socket';
import mediasoupService from './MediasoupService';

function App() {
  const [user, setUser] = useState(null);
  const [isRegistering, setIsRegistering] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  const [guilds, setGuilds] = useState([]);
  const [selectedGuild, setSelectedGuild] = useState(null);
  const [rooms, setRooms] = useState([]);
  const [currentRoom, setCurrentRoom] = useState(null);

  const [peers, setPeers] = useState([]);
  const [activeSpeaker, setActiveSpeaker] = useState(null);
  const [isMuted, setIsMuted] = useState(false);
  const [onlineUsers, setOnlineUsers] = useState([]);

  const localStreamRef = useRef(null);
  const remoteAudiosRef = useRef({});

  useEffect(() => {
    socket.on('peerJoined', ({ peerId, nickname }) => {
      setPeers(prev => [...prev, { peerId, nickname }]);
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

  const handleAuth = () => {
    socket.connect();
    const action = isRegistering ? 'register' : 'login';
    socket.emit(action, { username, password }, (res) => {
      if (res.success) {
        setUser(res.user);
        loadGuilds();
      } else {
        alert(res.error);
      }
    });
  };

  const loadGuilds = () => {
    socket.emit('getGuilds', (res) => {
      if (res.success) setGuilds(res.guilds);
    });
  };

  const loadRooms = (guildId) => {
    socket.emit('getRooms', { guildId }, (res) => {
      if (res.success) setRooms(res.rooms);
    });
  };

  const leaveRoom = () => {
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(t => t.stop());
      localStreamRef.current = null;
    }
    // Clean up remote audios
    Object.values(remoteAudiosRef.current).forEach(a => a.remove());
    remoteAudiosRef.current = {};

    setCurrentRoom(null);
    setPeers([]);
    // We would need to tell the server we left, but the current server logic handles it on disconnect
    // or when joining a new room we can replace state.
    // To properly leave without reload, we need a 'leaveRoom' event on server.
    // For now, let's at least reset the local state.
  };

  const joinRoom = async (room) => {
    if (currentRoom) {
      leaveRoom();
    }

    const { peers: initialPeers } = await mediasoupService.joinRoom(room.id, user.username);
    setPeers(initialPeers.map(p => ({ peerId: p.peerId, nickname: p.nickname })));

    await mediasoupService.createSendTransport();
    await mediasoupService.createRecvTransport();

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

    setCurrentRoom(room);
    updateOnlineUsers();
  };

  const updateOnlineUsers = () => {
    socket.emit('getOnlineUsers', (users) => {
      setOnlineUsers(users);
    });
  };

  const createGuild = () => {
    const name = prompt('Название гильдии:');
    if (name) {
      socket.emit('createGuild', { name }, (res) => {
        if (res.success) loadGuilds();
      });
    }
  };

  const createRoom = () => {
    const name = prompt('Название комнаты:');
    if (name && selectedGuild) {
      socket.emit('createRoom', { name, guildId: selectedGuild.id }, (res) => {
        if (res.success) loadRooms(selectedGuild.id);
      });
    }
  };

  const toggleMute = () => {
    if (localStreamRef.current) {
      const track = localStreamRef.current.getAudioTracks()[0];
      track.enabled = !track.enabled;
      setIsMuted(!track.enabled);
    }
  };

  if (!user) {
    return (
      <div style={{ padding: '40px', textAlign: 'center', fontFamily: 'sans-serif', backgroundColor: '#36393f', color: 'white', height: '100vh' }}>
        <h2>{isRegistering ? 'Регистрация' : 'Вход'}</h2>
        <input placeholder="Имя пользователя" value={username} onChange={e => setUsername(e.target.value)} style={inputStyle} /><br/>
        <input placeholder="Пароль" type="password" value={password} onChange={e => setPassword(e.target.value)} style={inputStyle} /><br/>
        <button onClick={handleAuth} style={buttonStyle}>{isRegistering ? 'Зарегистрироваться' : 'Войти'}</button><br/>
        <p onClick={() => setIsRegistering(!isRegistering)} style={{ cursor: 'pointer', color: '#00aff4' }}>
          {isRegistering ? 'Уже есть аккаунт? Войти' : 'Нет аккаунта? Регистрация'}
        </p>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', height: '100vh', fontFamily: 'sans-serif', backgroundColor: '#2f3136', color: 'white' }}>
      {/* Sidebar: Guilds */}
      <div style={{ width: '70px', backgroundColor: '#202225', padding: '10px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <div onClick={createGuild} style={guildIconStyle} title="Создать гильдию">+</div>
        {guilds.map(g => (
          <div key={g.id} onClick={() => { setSelectedGuild(g); loadRooms(g.id); }} style={{ ...guildIconStyle, backgroundColor: selectedGuild?.id === g.id ? '#5865f2' : '#36393f' }}>
            {g.name[0]}
          </div>
        ))}
      </div>

      {/* Sidebar: Rooms */}
      <div style={{ width: '240px', backgroundColor: '#2f3136', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '20px', borderBottom: '1px solid #202225', fontWeight: 'bold' }}>
          {selectedGuild ? selectedGuild.name : 'Выберите гильдию'}
        </div>
        <div style={{ flex: 1, padding: '10px' }}>
          {selectedGuild && <button onClick={createRoom} style={{ ...buttonStyle, width: '100%', marginBottom: '10px' }}>+ Создать комнату</button>}
          {rooms.map(r => (
            <div key={r.id} onClick={() => joinRoom(r)} style={{
              padding: '8px',
              borderRadius: '4px',
              cursor: 'pointer',
              backgroundColor: currentRoom?.id === r.id ? '#4f545c' : 'transparent',
              marginBottom: '2px'
            }}>
              # {r.name}
            </div>
          ))}
        </div>
        <div style={{ padding: '10px', backgroundColor: '#292b2f', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span>{user.username}</span>
          {currentRoom && (
            <button onClick={toggleMute} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '20px' }}>
              {isMuted ? '🔇' : '🎙️'}
            </button>
          )}
        </div>
      </div>

      {/* Main Area: Voice status and Users */}
      <div style={{ flex: 1, backgroundColor: '#36393f', padding: '20px', display: 'flex', flexDirection: 'column' }}>
        {currentRoom ? (
          <>
            <h3>В канале: {currentRoom.name}</h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))', gap: '20px' }}>
              <UserAvatar username={user.username} isSpeaking={activeSpeaker === socket.id} isMuted={isMuted} isMe />
              {peers.map(p => (
                <UserAvatar key={p.peerId} username={p.nickname} isSpeaking={activeSpeaker === p.peerId} />
              ))}
            </div>
          </>
        ) : (
          <div style={{ textAlign: 'center', marginTop: '100px' }}>
            <h2>Добро пожаловать, {user.username}!</h2>
            <p>Выберите гильдию и комнату, чтобы начать общение.</p>
          </div>
        )}
      </div>

      {/* Online Users List */}
      <div style={{ width: '200px', backgroundColor: '#2f3136', padding: '10px', borderLeft: '1px solid #202225' }}>
        <h4 style={{ color: '#8e9297', fontSize: '12px', textTransform: 'uppercase' }}>В сети — {onlineUsers.length}</h4>
        {onlineUsers.map(u => (
          <div key={u.id} style={{ display: 'flex', alignItems: 'center', marginBottom: '8px' }}>
            <div style={{ width: '32px', height: '32px', borderRadius: '50%', backgroundColor: '#5865f2', marginRight: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              {u.username[0]}
            </div>
            <span>{u.username}</span>
          </div>
        ))}
        <button onClick={updateOnlineUsers} style={{ fontSize: '10px', marginTop: '10px' }}>Обновить список</button>
      </div>
    </div>
  );
}

function UserAvatar({ username, isSpeaking, isMuted, isMe }) {
  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{
        width: '60px',
        height: '60px',
        borderRadius: '50%',
        backgroundColor: '#5865f2',
        margin: '0 auto 10px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: '24px',
        border: isSpeaking ? '4px solid #3ba55d' : '4px solid transparent',
        position: 'relative'
      }}>
        {username[0]}
        {isMuted && <span style={{ position: 'absolute', bottom: 0, right: 0, fontSize: '14px' }}>🚫</span>}
      </div>
      <div>{username} {isMe && '(Вы)'}</div>
    </div>
  );
}

const inputStyle = {
  padding: '10px',
  marginBottom: '10px',
  width: '250px',
  borderRadius: '3px',
  border: 'none',
  backgroundColor: '#202225',
  color: 'white'
};

const buttonStyle = {
  padding: '10px 20px',
  backgroundColor: '#5865f2',
  color: 'white',
  border: 'none',
  borderRadius: '3px',
  cursor: 'pointer',
  fontWeight: 'bold'
};

const guildIconStyle = {
  width: '48px',
  height: '48px',
  borderRadius: '50%',
  backgroundColor: '#36393f',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: '20px',
  marginBottom: '8px',
  cursor: 'pointer',
  transition: 'border-radius 0.2s',
  userSelect: 'none'
};

export default App;
