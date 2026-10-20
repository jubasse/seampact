# Mobile and Capacitor

Today, mobile and Capacitor apps use the TypeScript types, the zod validators and the `fetch` client. The `fetch` client accepts an injected `fetch`, which is how a Capacitor app sends its calls through native HTTP. React Native and Expo need a `crypto.randomUUID` polyfill until the client takes an injected key generator. Ionic and Capacitor apps are web apps, so they will use the React, Angular or Vue targets once those land (planned).
