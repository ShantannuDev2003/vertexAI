import { app } from "../config/firebase.js"
import { getAuth } from "firebase-admin/auth"
import User from "../models/user.model.js"
import crypto from "crypto"
import redis from "../../../shared/redis/redis.js"

export const login = async (req, res) => {
    try {
        // console.log("========== LOGIN START ==========");

        const { token } = req.body;
        // console.log("1. Token received");
        // console.log("2. Firebase token verified");

        const decoded = await getAuth(app).verifyIdToken(token);
        // console.log("2. Firebase token verified");

        // console.log("3. Looking for user:", decoded.uid);

        let user = await User.findOne({
            firebaseUid: decoded.uid
        });

        // console.log("4. User lookup result:", user);

        if (!user) {
            console.log("5. User doesn't exist. Creating user...");

            user = await User.create({
                firebaseUid: decoded.uid,
                email: decoded.email,
                name: decoded.name,
                avatar: decoded.picture
            });

            // console.log("6. User created:", user);
        }

        // console.log("7. Creating session");

        const sessionId = crypto.randomUUID();

        // console.log("8. Session ID:", sessionId);

        await redis.set(
            `session-${sessionId}`,
            JSON.stringify({
                name: user.name,
                _id: user._id,
                email: user.email,
                avatar: user.avatar
            }),
            "EX",
            60 * 60 * 24 * 7
        );

        // console.log("9. Redis session created");

        res.cookie("session", sessionId, {
            httpOnly: true,
            secure: process.env.NODE_ENV === "production",
            sameSite: "strict",
            maxAge: 60 * 60 * 24 * 7 * 1000
        });

        // console.log("10. Cookie created");

        // console.log("========== LOGIN SUCCESS ==========");

        return res.status(200).json(user);

    } catch (error) {
        // console.error("========== LOGIN ERROR ==========");
        // console.error(error);
        // console.error(error.stack);

        return res.status(500).json({
            message: error.message
        });
    }
};

export const logout=async(req,res)=>{

    try {

        const sessionId = req.cookies.session;

        if (sessionId) {
            await redis.del(`session-${sessionId}`);
        }

        res.clearCookie("session");

        return res.status(200).json({
            message: "logout successful"
        });
    }catch(error){ 
        console.error("Error during logout:", error)
    }
}