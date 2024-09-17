import express from "express";
import cors from 'cors';
import route from "./routes/index.js";
const app = express();
app.use(cors());
app.use(express.json());
route(app);

export { app } 
