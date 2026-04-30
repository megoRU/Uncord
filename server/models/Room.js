const { DataTypes } = require('sequelize');
const sequelize = require('../database');

const Room = sequelize.define('Room', {
  name: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  guildId: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
});

module.exports = Room;
