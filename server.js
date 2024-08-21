import { app } from './app/app.js';
import {sequelize, testConnection, syncDatabase } from './app/database/db-sequelize.js';
import { testModels } from './app/database/db-test.js';
import User from './app/database/user.js';
// import User from './app/database/User.js';

const port = 7777;


  
  async function main() {
    try {
      // Test the connection
      // await testConnection();
      // Sync the database
      // await syncDatabase();

      // Test the models
    //   await testModels();

      // Start the server
      app.listen(port, () => console.log(`Server is listening at ${port}`));
    } catch (error) {
      console.error('An error occurred:', error);
    }
  }
  
  main();


// app.listen(port,() => console.log(`Server is listening at ${port}`));