const { DataTypes } = require('sequelize');
const sequelize = require('../database');

const Guild = sequelize.define('Guild', {
  name: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  ownerId: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
});

module.exports = Guild;
