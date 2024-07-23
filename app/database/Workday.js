import { DataTypes } from 'sequelize';
import { sequelize } from './db-sequelize.js';

const Workday = sequelize.define('Workday', {
  Job_URL: {
    type: DataTypes.STRING,
    primaryKey: true,
    allowNull: false
  },
  Posting_Date: {
    type: DataTypes.DATE,
    allowNull: false
  },
  CompanyName: {
    type: DataTypes.STRING,
    allowNull: false
  },
  Title: {
    type: DataTypes.STRING,
    allowNull: false
  },
  Location: {
    type: DataTypes.STRING
  },
  Country: {
    type: DataTypes.STRING
  },
  JobId: {
    type: DataTypes.STRING
  },
  FilterStatus: {
    type: DataTypes.STRING
  }
}, {
  indexes: [
    {
      unique: true,
      fields: ['Posting_Date']
    }
  ]
});

export default Workday;