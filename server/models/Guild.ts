import { DataTypes, Model, Optional } from 'sequelize';
import sequelize from '../database.js';

interface GuildAttributes {
  id: number;
  name: string;
  ownerId: number;
}

interface GuildCreationAttributes extends Optional<GuildAttributes, 'id'> {}

class Guild extends Model<GuildAttributes, GuildCreationAttributes> implements GuildAttributes {
  public id!: number;
  public name!: string;
  public ownerId!: number;

  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

Guild.init({
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true,
  },
  name: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  ownerId: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
}, {
  sequelize,
  modelName: 'Guild',
});

export default Guild;
