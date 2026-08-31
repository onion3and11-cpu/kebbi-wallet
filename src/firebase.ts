import { initializeApp } from "firebase/app";
import { getDatabase } from "firebase/database";

const firebaseConfig = {
  apiKey: "AIzaSyCcPnoudpP8xD6nWEQaOUI5kdnhg5cpJlg",
  authDomain: "kebbi-wallet.firebaseapp.com",
  databaseURL: "https://kebbi-wallet-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "kebbi-wallet",
  storageBucket: "kebbi-wallet.firebasestorage.app",
  messagingSenderId: "1023789901435",
  appId: "1:1023789901435:web:1224fd918914ef418ba4de",
  measurementId: "G-QPL34G2B3D"
};

const app = initializeApp(firebaseConfig);

export const database = getDatabase(app);