import User from './User.js';
import Guild from './Guild.js';
import Room from './Room.js';

// Define associations
User.hasMany(Guild, { foreignKey: 'ownerId' });
Guild.belongsTo(User, { as: 'owner', foreignKey: 'ownerId' });

Guild.hasMany(Room, { foreignKey: 'guildId' });
Room.belongsTo(Guild, { foreignKey: 'guildId' });

export { User, Guild, Room };
