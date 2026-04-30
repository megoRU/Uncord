import React, { useState, useEffect, useRef } from 'react';
import socket from './socket';
import mediasoupService from './MediasoupService';

interface User {
  id: number;
  username: string;
}

interface Guild {
  id: number;
  name: string;
}

interface Room {
  id: number;
  name: string;
  guildId: number;
}

interface Peer {
  peerId: string;
  nickname: string;
  producers?: { producerId: string; kind: string }[];
}

interface AuthResponse {
  success: boolean;
  user: User;
  error?: string;
}

interface GetGuildsResponse {
  success: boolean;
  guilds: Guild[];
}

interface GetRoomsResponse {
  success: boolean;
  rooms: Room[];
}

interface GenericResponse {
  success: boolean;
  error?: string;
}

function App() {
  const [user, setUser] = useState<User | null>(null);
  const [isRegistering, setIsRegistering] = useState(false);
  const [isInitialAuthChecked, setIsInitialAuthChecked] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  const [guilds, setGuilds] = useState<Guild[]>([]);
  const [selectedGuild, setSelectedGuild] = useState<Guild | null>(null);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [currentRoom, setCurrentRoom] = useState<Room | null>(null);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalTitle, setModalTitle] = useState('');
  const [modalValue, setModalValue] = useState('');
  const [modalAction, setModalAction] = useState<((val: string) => void) | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isInviteManagerOpen, setIsSettingsInviteManagerOpen] = useState(false);
  const [invites, setInvites] = useState<{ id: number; code: string }[]>([]);

  const [peers, setPeers] = useState<Peer[]>([]);
  const [activeSpeaker, setActiveSpeaker] = useState<string | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [isDeafened, setIsDeafened] = useState(false);
  const [onlineUsers, setOnlineUsers] = useState<User[]>([]);
  const [ping, setPing] = useState<number | null>(null);
  const [showDebug, setShowDebug] = useState(false);

  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteAudiosRef = useRef<{ [peerId: string]: HTMLAudioElement }>({});

  useEffect(() => {
    let pingInterval: any;
    if (user) {
      pingInterval = setInterval(() => {
        const start = Date.now();
        socket.emit('ping', () => {
          setPing(Date.now() - start);
        });
      }, 3000);
    }
    return () => clearInterval(pingInterval);
  }, [user]);

  useEffect(() => {
    const savedUser = localStorage.getItem('user');
    if (savedUser) {
      const parsedUser = JSON.parse(savedUser);
      setUser(parsedUser);
      socket.connect();
      // Inform server about existing session
      socket.emit('login', { username: parsedUser.username, autoLogin: true }, (res: AuthResponse) => {
        if (res.success) {
          loadGuilds();
        } else {
          localStorage.removeItem('user');
          setUser(null);
        }
        setIsInitialAuthChecked(true);
      });
    } else {
      setIsInitialAuthChecked(true);
    }

    socket.on('peerJoined', ({ peerId, nickname }: { peerId: string; nickname: string }) => {
      setPeers(prev => [...prev, { peerId, nickname }]);
    });

    socket.on('peerLeft', ({ peerId }: { peerId: string }) => {
      setPeers(prev => prev.filter(p => p.peerId !== peerId));
      if (remoteAudiosRef.current[peerId]) {
        remoteAudiosRef.current[peerId].remove();
        delete remoteAudiosRef.current[peerId];
      }
    });

    socket.on('newProducer', async ({ peerId, producerId }: { peerId: string; producerId: string }) => {
      await consumeProducer(producerId, peerId);
    });

    socket.on('activeSpeaker', ({ peerId }: { peerId: string | null }) => {
      setActiveSpeaker(peerId);
    });

    socket.on('onlineUsersUpdate', (users: User[]) => {
      setOnlineUsers(users);
    });

    return () => {
      socket.off('peerJoined');
      socket.off('peerLeft');
      socket.off('newProducer');
      socket.off('activeSpeaker');
      socket.off('onlineUsersUpdate');
    };
  }, []);

  const consumeProducer = async (producerId: string, peerId: string) => {
    try {
      const track = await mediasoupService.consume(producerId, peerId);

      // Очистка предыдущего аудио для этого пира, если оно есть
      if (remoteAudiosRef.current[peerId]) {
        console.log(`Cleaning up old audio for peer ${peerId}`);
        remoteAudiosRef.current[peerId].pause();
        remoteAudiosRef.current[peerId].srcObject = null;
        remoteAudiosRef.current[peerId].remove();
      }

      const stream = new MediaStream([track]);
      const audio = new Audio();
      audio.srcObject = stream;
      audio.muted = isDeafened; // Учитываем состояние "Заглушено"

      console.log(`Attempting to play audio for peer ${peerId}, muted: ${audio.muted}`);
      audio.play()
        .then(() => console.log(`Successfully playing audio for peer ${peerId}`))
        .catch(e => {
          console.error(`Audio play failed for peer ${peerId}:`, e);
          if (e.name === 'NotAllowedError') {
            console.warn('Playback prevented by browser. User interaction might be required.');
          }
        });

      remoteAudiosRef.current[peerId] = audio;
    } catch (error) {
      console.error(`Failed to consume producer ${producerId} from peer ${peerId}:`, error);
    }
  };

  const handleAuth = () => {
    socket.connect();
    const action = isRegistering ? 'register' : 'login';
    socket.emit(action, { username, password }, (res: AuthResponse) => {
      if (res.success) {
        setUser(res.user);
        localStorage.setItem('user', JSON.stringify(res.user));
        loadGuilds();
      } else {
        alert(res.error);
      }
    });
  };

  const handleLogout = () => {
    localStorage.removeItem('user');
    setUser(null);
    socket.disconnect();
  };

  const loadGuilds = () => {
    socket.emit('getGuilds', (res: GetGuildsResponse) => {
      if (res.success) {
        setGuilds(res.guilds);
      } else {
        setGuilds([]);
      }
    });
  };

  const loadRooms = (guildId: number) => {
    socket.emit('getRooms', { guildId }, (res: GetRoomsResponse) => {
      if (res.success) setRooms(res.rooms);
    });
  };

  const leaveRoom = async () => {
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(t => t.stop());
      localStreamRef.current = null;
    }
    // Clean up remote audios
    Object.values(remoteAudiosRef.current).forEach(a => a.remove());
    remoteAudiosRef.current = {};

    await mediasoupService.leaveRoom();
    socket.emit('leaveRoom');

    setCurrentRoom(null);
    setPeers([]);
    setIsMuted(false);
    setIsDeafened(false);
  };

  const joinRoom = async (room: Room) => {
    if (currentRoom) {
      leaveRoom();
    }

    if (!user) return;

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
  };

  const createGuild = () => {
    setModalTitle('Создать гильдию');
    setModalValue('');
    setModalAction(() => (name: string) => {
      socket.emit('createGuild', { name }, (res: GenericResponse) => {
        if (res.success) loadGuilds();
      });
    });
    setIsModalOpen(true);
  };

  const joinByInvite = () => {
    setModalTitle('Вступить по приглашению');
    setModalValue('');
    setModalAction(() => (code: string) => {
      socket.emit('joinByInvite', { code }, (res: { success: boolean; guild?: Guild; error?: string }) => {
        if (res.success) {
          loadGuilds();
          if (res.guild) {
            setSelectedGuild(res.guild);
            loadRooms(res.guild.id);
          }
        } else {
          alert(res.error || 'Ошибка вступления');
        }
      });
    });
    setIsModalOpen(true);
  };

  const loadInvites = (guildId: number) => {
    socket.emit('getInvites', { guildId }, (res: { success: boolean; invites: any[] }) => {
      if (res.success) setInvites(res.invites);
    });
  };

  const createInvite = (guildId: number) => {
    socket.emit('createInvite', { guildId }, (res: { success: boolean }) => {
      if (res.success) loadInvites(guildId);
    });
  };

  const deleteInvite = (inviteId: number, guildId: number) => {
    socket.emit('deleteInvite', { inviteId }, (res: { success: boolean }) => {
      if (res.success) loadInvites(guildId);
    });
  };

  const createRoom = () => {
    if (!selectedGuild) return;
    setModalTitle('Создать комнату');
    setModalValue('');
    setModalAction(() => (name: string) => {
      socket.emit('createRoom', { name, guildId: selectedGuild.id }, (res: GenericResponse) => {
        if (res.success) loadRooms(selectedGuild.id);
      });
    });
    setIsModalOpen(true);
  };

  const toggleMute = () => {
    if (localStreamRef.current) {
      const track = localStreamRef.current.getAudioTracks()[0];
      track.enabled = !track.enabled;
      setIsMuted(!track.enabled);
    } else {
      setIsMuted(!isMuted);
    }
  };

  const toggleDeafen = () => {
    const nextDeafened = !isDeafened;
    setIsDeafened(nextDeafened);

    // Если звук выключен, микрофон тоже должен мутиться
    if (nextDeafened) {
      if (localStreamRef.current) {
        localStreamRef.current.getAudioTracks()[0].enabled = false;
      }
      setIsMuted(true);
    }

    // Управление громкостью удаленных аудио
    Object.values(remoteAudiosRef.current).forEach(audio => {
      audio.muted = nextDeafened;
    });
  };

  if (!isInitialAuthChecked) {
    return <div style={{ backgroundColor: '#36393f', height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white' }}>Загрузка...</div>;
  }

  if (!user) {
    return (
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        fontFamily: 'sans-serif',
        backgroundColor: '#36393f',
        color: 'white',
        height: '100vh',
        width: '100vw'
      }}>
        <div style={{ backgroundColor: '#2f3136', padding: '40px', borderRadius: '8px', boxShadow: '0 2px 10px rgba(0,0,0,0.2)', textAlign: 'center', minWidth: '400px' }}>
          <h1 style={{ marginBottom: '30px', fontSize: '32px' }}>{isRegistering ? 'Регистрация' : 'Вход'}</h1>
          <input placeholder="Имя пользователя" value={username} onChange={e => setUsername(e.target.value)} style={inputStyle} /><br/>
          <input placeholder="Пароль" type="password" value={password} onChange={e => setPassword(e.target.value)} style={inputStyle} /><br/>
          <button onClick={handleAuth} style={buttonStyle}>{isRegistering ? 'Зарегистрироваться' : 'Войти'}</button><br/>
          <p onClick={() => setIsRegistering(!isRegistering)} style={{ cursor: 'pointer', color: '#00aff4', marginTop: '20px', fontSize: '16px' }}>
            {isRegistering ? 'Уже есть аккаунт? Войти' : 'Нет аккаунта? Регистрация'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', height: '100vh', fontFamily: 'sans-serif', backgroundColor: '#2f3136', color: 'white' }}>
      {/* Sidebar: Guilds */}
      <div style={{ width: '70px', backgroundColor: '#202225', padding: '10px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <div style={{ flex: 1, width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <div onClick={createGuild} style={guildIconStyle} title="Создать гильдию">+</div>
          <div onClick={joinByInvite} style={{ ...guildIconStyle, backgroundColor: '#3ba55d' }} title="Вступить по приглашению">🔗</div>
          {guilds.map(g => (
            <div key={g.id} onClick={() => { setSelectedGuild(g); loadRooms(g.id); }} style={{ ...guildIconStyle, backgroundColor: selectedGuild?.id === g.id ? '#5865f2' : '#36393f' }}>
              {g.name[0]}
            </div>
          ))}
        </div>
        <div onClick={() => setIsSettingsOpen(true)} style={{ ...guildIconStyle, marginTop: 'auto' }} title="Настройки">⚙️</div>
      </div>

      {/* Sidebar: Rooms */}
      <div style={{ width: '240px', backgroundColor: '#2f3136', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '20px', borderBottom: '1px solid #202225', fontWeight: 'bold', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>{selectedGuild ? selectedGuild.name : 'Выберите гильдию'}</span>
        </div>
        <div style={{ flex: 1, padding: '10px', overflowY: 'auto' }}>
          {selectedGuild && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '5px', marginBottom: '15px' }}>
              <button onClick={() => { loadInvites(selectedGuild.id); setIsSettingsInviteManagerOpen(true); }} style={{ ...buttonStyle, fontSize: '14px', padding: '8px', backgroundColor: '#4f545c' }}>Управление приглашениями</button>
              <button onClick={createRoom} style={{ ...buttonStyle, fontSize: '14px', padding: '8px' }}>Создать комнату</button>
            </div>
          )}
          {rooms.map(r => (
            <div key={r.id} style={{ marginBottom: '10px' }}>
              <div onClick={() => joinRoom(r)} style={{
                padding: '8px',
                borderRadius: '4px',
                cursor: 'pointer',
                backgroundColor: currentRoom?.id === r.id ? '#4f545c' : 'transparent',
                marginBottom: '2px'
              }}>
                # {r.name}
              </div>
              {currentRoom?.id === r.id && (
                <div style={{ paddingLeft: '20px' }}>
                  <UserAvatar username={user.username} isSpeaking={activeSpeaker === socket.id} isMuted={isMuted} isMe small />
                  {peers.map(p => (
                    <UserAvatar key={p.peerId} username={p.nickname} isSpeaking={activeSpeaker === p.peerId} small />
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
        <div style={{ padding: '10px', backgroundColor: '#292b2f', display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'relative' }}>
          <div
            onClick={() => setShowDebug(!showDebug)}
            style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginRight: '5px', cursor: 'pointer' }}
            title="Показать отладку"
          >
            {user.username}
          </div>
          {showDebug && (
            <div style={{ position: 'absolute', bottom: '100%', left: '10px', backgroundColor: '#202225', padding: '10px', borderRadius: '4px', fontSize: '12px', zIndex: 100, border: '1px solid #4f545c' }}>
              <div>Server IP: localhost (3000)</div>
              <div>Ping: {ping}ms</div>
            </div>
          )}
          <div style={{ display: 'flex', gap: '5px' }}>
            <button onClick={toggleMute} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '18px', padding: '2px', position: 'relative' }} title={isMuted ? 'Включить микрофон' : 'Выключить микрофон'}>
              🎙️
              {isMuted && <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#ed4245', fontWeight: 'bold', fontSize: '24px', pointerEvents: 'none' }}>/</div>}
            </button>
            <button onClick={toggleDeafen} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '18px', padding: '2px', position: 'relative' }} title={isDeafened ? 'Включить звук' : 'Выключить звук'}>
              🎧
              {isDeafened && <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#ed4245', fontWeight: 'bold', fontSize: '24px', pointerEvents: 'none' }}>/</div>}
            </button>
            <button onClick={() => leaveRoom()} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '18px', padding: '2px' }} title="Выйти из канала">
              🚪
            </button>
          </div>
        </div>
      </div>

      {/* Main Area: Chat Placeholder */}
      <div style={{ flex: 1, backgroundColor: '#36393f', padding: '20px', display: 'flex', flexDirection: 'column' }}>
        {selectedGuild ? (
          <>
            <h3>{currentRoom ? `Канал: ${currentRoom.name}` : 'Выберите канал'}</h3>
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#8e9297', border: '1px dashed #4f545c', borderRadius: '8px' }}>
              Чат пока не доступен (Функция в разработке)
            </div>
          </>
        ) : (
          <div style={{ textAlign: 'center', marginTop: '100px' }}>
            <h2>Добро пожаловать, {user.username}!</h2>
            <p>Выберите гильдию и комнату, чтобы начать общение.</p>
          </div>
        )}
      </div>

      {/* Invite Manager Modal */}
      {isInviteManagerOpen && selectedGuild && (
        <div style={{ position: 'absolute', top: 0, left: 0, width: '100vw', height: '100vh', backgroundColor: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ backgroundColor: '#36393f', padding: '30px', borderRadius: '8px', minWidth: '400px' }}>
            <h3>Приглашения: {selectedGuild.name}</h3>
            <button onClick={() => createInvite(selectedGuild.id)} style={{ ...buttonStyle, marginBottom: '20px' }}>Создать новую ссылку</button>
            <div style={{ maxHeight: '200px', overflowY: 'auto', textAlign: 'left' }}>
              {invites.map(inv => (
                <div key={inv.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px', backgroundColor: '#2f3136', borderRadius: '4px', marginBottom: '5px' }}>
                  <code>{inv.code}</code>
                  <button onClick={() => deleteInvite(inv.id, selectedGuild.id)} style={{ backgroundColor: '#ed4245', border: 'none', color: 'white', padding: '5px 10px', borderRadius: '4px', cursor: 'pointer' }}>Удалить</button>
                </div>
              ))}
              {invites.length === 0 && <p style={{ color: '#8e9297' }}>Нет активных приглашений</p>}
            </div>
            <button onClick={() => setIsSettingsInviteManagerOpen(false)} style={{ ...buttonStyle, backgroundColor: '#4f545c', marginTop: '20px' }}>Закрыть</button>
          </div>
        </div>
      )}

      {/* Settings Modal */}
      {isSettingsOpen && (
        <div style={{ position: 'absolute', top: 0, left: 0, width: '100vw', height: '100vh', backgroundColor: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ backgroundColor: '#36393f', padding: '30px', borderRadius: '8px', minWidth: '300px', textAlign: 'center' }}>
            <h3 style={{ marginTop: 0 }}>Настройки</h3>
            <p>Аккаунт: <strong>{user.username}</strong></p>
            <button onClick={() => { handleLogout(); setIsSettingsOpen(false); }} style={{ ...buttonStyle, backgroundColor: '#ed4245' }}>Выйти из аккаунта</button>
            <button onClick={() => setIsSettingsOpen(false)} style={{ ...buttonStyle, backgroundColor: '#4f545c', marginTop: '10px' }}>Закрыть</button>
          </div>
        </div>
      )}

      {/* Modal */}
      {isModalOpen && (
        <div style={{ position: 'absolute', top: 0, left: 0, width: '100vw', height: '100vh', backgroundColor: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ backgroundColor: '#36393f', padding: '30px', borderRadius: '8px', minWidth: '300px', textAlign: 'center' }}>
            <h3 style={{ marginTop: 0 }}>{modalTitle}</h3>
            <input
              value={modalValue}
              onChange={e => setModalValue(e.target.value)}
              placeholder="Введите название"
              style={{ ...inputStyle, marginBottom: '20px' }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && modalValue) {
                  modalAction?.(modalValue);
                  setIsModalOpen(false);
                }
              }}
            />
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'center' }}>
              <button onClick={() => { modalAction?.(modalValue); setIsModalOpen(false); }} style={{ ...buttonStyle, width: 'auto', flex: 1 }}>ОК</button>
              <button onClick={() => setIsModalOpen(false)} style={{ ...buttonStyle, width: 'auto', flex: 1, backgroundColor: '#4f545c' }}>Отмена</button>
            </div>
          </div>
        </div>
      )}

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
      </div>
    </div>
  );
}

interface UserAvatarProps {
  username: string;
  isSpeaking?: boolean;
  isMuted?: boolean;
  isMe?: boolean;
  small?: boolean;
}

function UserAvatar({ username, isSpeaking, isMuted, isMe, small }: UserAvatarProps) {
  const size = small ? '32px' : '60px';
  const fontSize = small ? '14px' : '24px';
  const dotSize = small ? '12px' : '20px';

  return (
    <div style={{ display: small ? 'flex' : 'block', alignItems: 'center', textAlign: small ? 'left' : 'center', marginBottom: small ? '5px' : '0' }}>
      <div style={{
        width: size,
        height: size,
        borderRadius: '50%',
        backgroundColor: '#5865f2',
        margin: '0 auto 10px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: fontSize,
        border: isSpeaking ? (small ? '2px solid #3ba55d' : '4px solid #3ba55d') : (small ? '2px solid transparent' : '4px solid transparent'),
        position: 'relative'
      }}>
        {username[0]}
        {isMuted && (
          <div style={{
            position: 'absolute',
            bottom: 0,
            right: 0,
            backgroundColor: '#ed4245',
            borderRadius: '50%',
            width: dotSize,
            height: dotSize,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: small ? '8px' : '12px'
          }}>
            /
          </div>
        )}
      </div>
      <div style={{ marginLeft: small ? '10px' : '0', fontSize: small ? '14px' : 'inherit' }}>{username} {isMe && '(Вы)'}</div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  padding: '15px',
  marginBottom: '20px',
  width: '100%',
  boxSizing: 'border-box',
  borderRadius: '5px',
  border: 'none',
  backgroundColor: '#202225',
  color: 'white',
  fontSize: '18px'
};

const buttonStyle: React.CSSProperties = {
  padding: '15px 30px',
  width: '100%',
  backgroundColor: '#5865f2',
  color: 'white',
  border: 'none',
  borderRadius: '5px',
  cursor: 'pointer',
  fontWeight: 'bold',
  fontSize: '18px',
  marginTop: '10px'
};

const guildIconStyle: React.CSSProperties = {
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
