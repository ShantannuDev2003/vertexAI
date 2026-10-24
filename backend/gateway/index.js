import express from "express"
import dotenv from "dotenv"
dotenv.config();
import cors from "cors"
import cookieParser from "cookie-parser"
import morgan from "morgan"
import proxy from "express-http-proxy"
import { protect } from "./middleware/protect.js"
import { getCurrentUser } from "./controllers/user.controller.js"
import { proxyWithHeader } from "./utils/proxyWithHeader.js"
let port = process.env.PORT || 8000

const app=express()
app.use(cors({
    origin: process.env.FRONTEND_URL,
    credentials:true
}))

app.use(cookieParser())
app.use(morgan("dev"))
app.use("/api/auth", proxy(process.env.AUTH_SERVICE_URL))
app.use("/api/project",protect,proxyWithHeader(process.env.PROJECT_SERVICE_URL))
app.use("/api/file", protect, proxyWithHeader(process.env.FILE_SERVICE_URL))
app.use(
    "/api/ai",
    protect,
    proxyWithHeader(process.env.AI_SERVICE_URL)
)
app.get("/api/me",protect,getCurrentUser)
app.get("/",(req,res)=>{
    res.send({"message":"Hello from gateway"})
})
app.listen(port,()=>{
    console.log(`gateway started at ${port}`)
})