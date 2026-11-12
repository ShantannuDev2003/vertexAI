import Razorpay from "razorpay"
import dotenv from "dotenv"

dotenv.config()

console.log("Razorpay credential check:", {
    keyIdPresent: Boolean(process.env.RAZORPAY_KEY_ID),
    keyIdPrefix: process.env.RAZORPAY_KEY_ID?.slice(0, 8),
    keySecretPresent: Boolean(process.env.RAZORPAY_KEY_SECRET),
    keySecretLength: process.env.RAZORPAY_KEY_SECRET?.length,
})

const razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET,
})

export default razorpay