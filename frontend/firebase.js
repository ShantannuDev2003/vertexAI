// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import {getAuth,GoogleAuthProvider} from "firebase/auth";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
    authDomain: "vertexai-420bd.firebaseapp.com",
    projectId: "vertexai-420bd",
    storageBucket: "vertexai-420bd.firebasestorage.app",
    messagingSenderId: "394206829394",
    appId: "1:394206829394:web:8e6e5a0574176d38bef88b",
    measurementId: "G-FR0LWPSY74"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
