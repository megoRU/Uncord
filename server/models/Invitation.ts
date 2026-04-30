import { DataTypes, Model, Optional } from 'sequelize';
import sequelize from '../database.js';

interface InvitationAttributes {
  id: number;
  code: string;
  guildId: number;
  creatorId: number;
}

interface InvitationCreationAttributes extends Optional<InvitationAttributes, 'id'> {}

class Invitation extends Model<InvitationAttributes, InvitationCreationAttributes> implements InvitationAttributes {
  declare id: number;
  declare code: string;
  declare guildId: number;
  declare creatorId: number;

  declare readonly createdAt: Date;
  declare readonly updatedAt: Date;
}

Invitation.init({
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true,
  },
  code: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true,
  },
  guildId: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  creatorId: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
}, {
  sequelize,
  modelName: 'Invitation',
});

export default Invitation;
