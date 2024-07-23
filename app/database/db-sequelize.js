import { Sequelize } from 'sequelize';
// import Workday from './Workday.js';


export const sequelize = new Sequelize('postgres', 'postgres', 'postgres', {
  host: 'terraform-20240723063318697600000001.cke6oq31sriv.us-east-1.rds.amazonaws.com',
  port: 5432,
  dialect: 'postgres',
  dialectOptions: {
    ssl: {
      require: true,
      rejectUnauthorized: false
    }
  }
});

export const testConnection = async function testConnection() {
  try {
    await sequelize.authenticate();
    console.log('Connection has been established successfully.');
  } catch (error) {
    console.error('Unable to connect to the database:', error);
  }
}

export const syncDatabase = async function syncDatabase() {
  try {
    await sequelize.sync({ force: true });
    console.log("All models were synchronized successfully.");
  } catch (error) {
    console.error('Unable to sync the database:', error);
  }
}

// export { sequelize, testConnection, syncDatabase };