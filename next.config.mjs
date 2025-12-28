/** @type {import('next').NextConfig} */
const nextConfig = {

    // for random user image
    images: {
        remotePatterns: [
          {
            protocol: "https",
            hostname: "randomuser.me",
          },
        ],
    },
};

export default nextConfig;
