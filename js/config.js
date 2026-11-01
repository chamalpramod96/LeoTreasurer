// Leo Treasurer settings.
//
// 1. Paste your Firebase web-app config below (Firebase Console → Project settings → Your apps).
//    These values are not secret — access is protected by firestore.rules.
// 2. While apiKey is empty the app runs in DEMO MODE: sample data, kept only in this browser.

export const firebaseConfig = {
  apiKey: "",
  authDomain: "",
  projectId: "",
  storageBucket: "",
  messagingSenderId: "",
  appId: "",
};

export const settings = {
  clubName: "Leo Club",        // e.g. "Leo Club of Colombo Central"
  currencySymbol: "Rs.",
  locale: "en-LK",              // number formatting: 1,234,567.50
  leoYearStartMonth: 7,         // Leo year runs July → June
};
