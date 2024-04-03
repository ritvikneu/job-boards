import express from "express";
import mongoose from "mongoose";
import cors from 'cors';
import route from "./routes/index.js";

const app = express();
app.use(cors());
app.use(express.json());
// app.use(express.urlencoded());
route(app);

// const connection = mongoose.connect('mongodb://127.0.0.1:27017/local');


export {
    app
} 
