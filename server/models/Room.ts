import { DataTypes, Model, Optional } from 'sequelize';
import sequelize from '../database.js';

interface RoomAttributes {
  id: number;
  name: string;
  guildId: number;
}

interface RoomCreationAttributes extends Optional<RoomAttributes, 'id'> {}

class Room extends Model<RoomAttributes, RoomCreationAttributes> implements RoomAttributes {
  declare id: number;
  declare name: string;
  declare guildId: number;

  declare readonly createdAt: Date;
  declare readonly updatedAt: Date;
}

Room.init({
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true,
  },
  name: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  guildId: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
}, {
  sequelize,
  modelName: 'Room',
});

export default Room;
