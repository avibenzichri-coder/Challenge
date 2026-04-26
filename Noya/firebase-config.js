import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import { getFirestore } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';

const firebaseConfig = {
  apiKey: "AIzaSyB-67j8fAtRhX7EzqW3mIUTC9qNsfW1bpE",
  authDomain: "noya-s-store.firebaseapp.com",
  projectId: "noya-s-store",
  storageBucket: "noya-s-store.firebasestorage.app",
  messagingSenderId: "531476573700",
  appId: "1:531476573700:web:c840a1926984890a190f51"
};

const app  = initializeApp(firebaseConfig);
const db   = getFirestore(app);
const auth = getAuth(app);

export { db, auth };
