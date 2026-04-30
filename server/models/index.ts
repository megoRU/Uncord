import User from './User.js';
import Guild from './Guild.js';
import Room from './Room.js';
import GuildMember from './GuildMember.js';
import Invitation from './Invitation.js';

// Define associations
User.hasMany(Guild, { foreignKey: 'ownerId' });
Guild.belongsTo(User, { as: 'owner', foreignKey: 'ownerId' });

Guild.hasMany(Room, { foreignKey: 'guildId' });
Room.belongsTo(Guild, { foreignKey: 'guildId' });

// Many-to-Many User <-> Guild through GuildMember
User.belongsToMany(Guild, { through: GuildMember, foreignKey: 'userId' });
Guild.belongsToMany(User, { through: GuildMember, foreignKey: 'guildId' });

// Invitation associations
Guild.hasMany(Invitation, { foreignKey: 'guildId' });
Invitation.belongsTo(Guild, { foreignKey: 'guildId' });
Invitation.belongsTo(User, { as: 'creator', foreignKey: 'creatorId' });

export { User, Guild, Room, GuildMember, Invitation };
