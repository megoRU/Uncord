import { DataTypes, Model } from 'sequelize';
import sequelize from '../database.js';

interface GuildMemberAttributes {
  guildId: number;
  userId: number;
}

class GuildMember extends Model<GuildMemberAttributes> implements GuildMemberAttributes {
  declare guildId: number;
  declare userId: number;
}

GuildMember.init({
  guildId: {
    type: DataTypes.INTEGER,
    primaryKey: true,
  },
  userId: {
    type: DataTypes.INTEGER,
    primaryKey: true,
  },
}, {
  sequelize,
  modelName: 'GuildMember',
});

export default GuildMember;
