const User = require('./User');
const Guild = require('./Guild');
const Room = require('./Room');

// Define associations
User.hasMany(Guild, { foreignKey: 'ownerId' });
Guild.belongsTo(User, { as: 'owner', foreignKey: 'ownerId' });

Guild.hasMany(Room, { foreignKey: 'guildId' });
Room.belongsTo(Guild, { foreignKey: 'guildId' });

module.exports = { User, Guild, Room };
