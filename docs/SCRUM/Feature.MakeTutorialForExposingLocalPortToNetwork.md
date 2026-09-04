# Tutorial: Expose the Local Development Site to the Network

Create a tutorial for making the local development site available to other devices on the same network from an Apple Silicon Mac, such as an M3 Mac, using Docker Desktop, a VS Code dev container, and Nginx as the public entry point.

The tutorial should explain how to:

1. Configure the frontend development server to listen on the required Docker network interface.
2. Configure Nginx to reverse-proxy requests to the frontend service.
3. Publish only Nginx's port 80 through Docker Desktop; the frontend port should remain internal to Docker.
4. Find the Mac's local IP address using `ipconfig getifaddr en0` or `ipconfig getifaddr en1`.
5. Open the site from another device at `http://<mac-ip>`.
6. Check common problems such as Docker Desktop settings, Nginx configuration, macOS firewall settings, port conflicts, and devices connected to different networks.
