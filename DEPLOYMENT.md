# Deploying Lukuchupi

Since Lukuchupi uses a Node.js backend with Socket.io for real-time communication, it cannot be hosted on static hosting services like GitHub Pages or Vercel (frontend only). You need a service that runs a server.

## Option 1: Render.com (Recommended & Free)
1.  Push your code to GitHub (already done).
2.  Go to [Render.com](https://render.com) and sign up/login with GitHub.
3.  Click **New +** -> **Web Service**.
4.  Connect your `Lukuchupi` repository.
5.  Configure the service:
    - **Name**: `lukuchupi-app` (or similar)
    - **Environment**: `Node`
    - **Build Command**: `npm install`
    - **Start Command**: `node server.js`
6.  Click **Create Web Service**.
7.  Render will deploy your app and give you a URL (e.g., `https://lukuchupi.onrender.com`).
8.  Share this URL with friends!

## Option 2: Glitch.com (Fastest for testing)
1.  Go to [Glitch.com](https://glitch.com).
2.  Click **New Project** -> **Import from GitHub**.
3.  Paste your repository URL: `https://github.com/Mahmoud-Hussain/Lukuchupi`.
4.  Glitch will automatically install and start the server.
5.  Click **Share** -> **Live Site** to get the link.

## Option 3: Local Network (No Deployment)
If you just want to talk to people on your same Wi-Fi:
1.  Find your computer's local IP address (e.g., `192.168.1.x`).
    - Windows: Open terminal and type `ipconfig`.
2.  Run the server: `node server.js`.
3.  Tell your friends to open `http://<YOUR_IP_ADDRESS>:3000` on their browsers.
    - *Note: Browsers might block microphone access on non-localhost http sites. Deploying to Render (Option 1) provides HTTPS, which avoids this issue.*
