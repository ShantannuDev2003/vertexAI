import dns from "dns";
dns.setServers(["8.8.8.8", "1.1.1.1"]);
import express from "express"
import dotenv from "dotenv"
import { connectDb } from './config/db.js'
import router from "./routes/auth.route.js";
dotenv.config();
import mongoose from "mongoose";
await mongoose.connect(process.env.MONGODB_URI);

console.log("DB connected");




const port = process.env.PORT || 8001

const app=express()

app.use(express.json())
app.use("/",router)
app.get("/",(req,res)=>{
    res.send({"message":"Hello from aut"})
})

app.listen(port,async ()=>{
    await connectDb()
    console.log(`auth started at ${port}`)
})