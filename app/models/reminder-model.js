import mongoose, { Schema } from "mongoose";

const reminderSchema = new mongoose.Schema({
    name: { type:String, required: true},
    details: { type:String, required: true},
    createdDate: String,
    modifiedDate : String,
    status: String

});

const reminder  = mongoose.model('reminder', reminderSchema );

export default reminder;